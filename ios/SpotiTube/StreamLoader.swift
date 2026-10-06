import AVFoundation
import UniformTypeIdentifiers

/// Feeds AVPlayer from googlevideo with bounded Range requests and the
/// user agent of the YouTube client that produced the URL (the iOS
/// counterpart of the desktop app's local stream proxy).
final class StreamLoader: NSObject, AVAssetResourceLoaderDelegate, URLSessionDataDelegate {
    static let scheme = "ststream"
    private static let chunk: Int64 = 10 * 1024 * 1024

    let url: URL
    let ua: String
    let mime: String?
    let queue = DispatchQueue(label: "stream-loader")
    private var session: URLSession!
    private var contentLength: Int64 = 0

    private final class Req {
        let lr: AVAssetResourceLoadingRequest
        var offset: Int64 = 0
        var end: Int64 = 0
        var task: URLSessionDataTask?
        /// consecutive failed attempts for the current chunk
        var attempts = 0
        init(_ lr: AVAssetResourceLoadingRequest) { self.lr = lr }
    }

    private var byTask: [Int: Req] = [:]
    private var byRequest: [ObjectIdentifier: Req] = [:]

    init(url: URL, ua: String, mime: String?) {
        self.url = url
        self.ua = ua
        self.mime = mime
        super.init()
        let q = OperationQueue()
        q.underlyingQueue = queue
        q.maxConcurrentOperationCount = 1
        let cfg = URLSessionConfiguration.default
        cfg.httpCookieStorage = nil
        cfg.httpShouldSetCookies = false
        cfg.urlCache = nil
        cfg.timeoutIntervalForRequest = 30
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: q)
    }

    deinit { session.invalidateAndCancel() }

    var assetURL: URL {
        var c = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        c.scheme = StreamLoader.scheme
        return c.url!
    }

    func makeAsset() -> AVURLAsset {
        let asset = AVURLAsset(url: assetURL)
        asset.resourceLoader.setDelegate(self, queue: queue)
        return asset
    }

    // MARK: AVAssetResourceLoaderDelegate (on `queue`)

    func resourceLoader(_ loader: AVAssetResourceLoader, shouldWaitForLoadingOfRequestedResource lr: AVAssetResourceLoadingRequest) -> Bool {
        let r = Req(lr)
        if let dr = lr.dataRequest {
            r.offset = dr.currentOffset != 0 ? dr.currentOffset : dr.requestedOffset
            if dr.requestsAllDataToEndOfResource {
                r.end = contentLength > 0 ? contentLength - 1 : Int64.max
            } else {
                r.end = dr.requestedOffset + Int64(dr.requestedLength) - 1
            }
        } else {
            r.offset = 0
            r.end = 1
        }
        byRequest[ObjectIdentifier(lr)] = r
        start(r)
        return true
    }

    func resourceLoader(_ loader: AVAssetResourceLoader, didCancel lr: AVAssetResourceLoadingRequest) {
        if let r = byRequest.removeValue(forKey: ObjectIdentifier(lr)) {
            r.task?.cancel()
        }
    }

    private func start(_ r: Req) {
        let last = r.end == Int64.max ? r.offset + StreamLoader.chunk - 1 : min(r.end, r.offset + StreamLoader.chunk - 1)
        var q = URLRequest(url: url)
        q.setValue("bytes=\(r.offset)-\(last)", forHTTPHeaderField: "Range")
        q.setValue(ua, forHTTPHeaderField: "User-Agent")
        q.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
        q.setValue("https://www.youtube.com/", forHTTPHeaderField: "Referer")
        let t = session.dataTask(with: q)
        r.task = t
        byTask[t.taskIdentifier] = r
        t.resume()
    }

    /// Network hiccups (Wi-Fi ↔ cellular, a dropped connection, a 5xx) retry
    /// the same chunk with backoff instead of failing the whole song.
    private func retry(_ r: Req, _ error: Error) {
        guard r.attempts < 3, byRequest[ObjectIdentifier(r.lr)] != nil, !r.lr.isCancelled, !r.lr.isFinished else {
            done(r, error)
            return
        }
        r.attempts += 1
        let delay = 0.5 * pow(2, Double(r.attempts - 1))
        Log.write("stream chunk failed (\(error.localizedDescription)), retry \(r.attempts) in \(delay)s")
        queue.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, self.byRequest[ObjectIdentifier(r.lr)] != nil, !r.lr.isCancelled, !r.lr.isFinished else { return }
            self.start(r)
        }
    }

    private func done(_ r: Req, _ error: Error? = nil) {
        byRequest.removeValue(forKey: ObjectIdentifier(r.lr))
        guard !r.lr.isFinished, !r.lr.isCancelled else { return }
        if let error { r.lr.finishLoading(with: error) } else { r.lr.finishLoading() }
    }

    private func uti() -> String {
        let base = (mime ?? "audio/mp4").split(separator: ";").first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? "audio/mp4"
        if let t = UTType(mimeType: base) { return t.identifier }
        return base.hasPrefix("video") ? "public.mpeg-4" : "public.mpeg-4-audio"
    }

    // MARK: URLSessionDataDelegate (on `queue`)

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let r = byTask[dataTask.taskIdentifier], let h = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        if h.statusCode >= 400 {
            byTask.removeValue(forKey: dataTask.taskIdentifier)
            let err = NSError(domain: "SpotiTubeStream", code: h.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(h.statusCode)"])
            // 4xx means the URL expired or was refused: let the page fetch a new one
            if h.statusCode >= 500 { retry(r, err) } else { done(r, err) }
            completionHandler(.cancel)
            return
        }
        if let cr = h.value(forHTTPHeaderField: "Content-Range"), let total = cr.split(separator: "/").last.flatMap({ Int64($0) }) {
            contentLength = total
        } else if h.statusCode == 200, h.expectedContentLength > 0 {
            contentLength = h.expectedContentLength
        }
        if let info = r.lr.contentInformationRequest {
            info.contentType = uti()
            info.contentLength = contentLength
            info.isByteRangeAccessSupported = true
        }
        if r.end == Int64.max, contentLength > 0 { r.end = contentLength - 1 }
        if r.lr.dataRequest == nil {
            byTask.removeValue(forKey: dataTask.taskIdentifier)
            done(r)
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let r = byTask[dataTask.taskIdentifier], let dr = r.lr.dataRequest, !r.lr.isCancelled, !r.lr.isFinished else { return }
        dr.respond(with: data)
        r.offset += Int64(data.count)
        r.attempts = 0
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let r = byTask.removeValue(forKey: task.taskIdentifier) else { return }
        if r.lr.isCancelled || r.lr.isFinished { return }
        if let error {
            if (error as NSError).code == NSURLErrorCancelled { return }
            retry(r, error)
            return
        }
        let more = r.offset <= r.end && (contentLength == 0 || r.offset < contentLength)
        if more { start(r) } else { done(r) }
    }
}
