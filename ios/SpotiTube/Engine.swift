import UIKit
import WebKit

struct BridgeError: Error, LocalizedError {
    let message: String
    init(_ m: String) { message = m }
    var errorDescription: String? { message }
}

/// Owns the single web view that runs SpotiTube's UI and YouTube Music logic
/// (the same Svelte app as the desktop version). Native code talks to it
/// through a tiny bridge that mimics Tauri's IPC, so the web code is shared.
final class Engine: NSObject, WKNavigationDelegate, WKUIDelegate {
    static let shared = Engine()

    static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    let webView: WKWebView
    weak var host: UIViewController?
    var statusBarDark = false
    var statusBarHidden = false
    private(set) var ready = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var pendingURL: URL?

    override init() {
        let cfg = WKWebViewConfiguration()
        let ucc = WKUserContentController()
        cfg.userContentController = ucc
        cfg.setURLSchemeHandler(SchemeHandler(), forURLScheme: "app")
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.suppressesIncrementalRendering = false
        cfg.websiteDataStore = .default()
        // keep the page's JavaScript (queue, CarPlay lists) running while the
        // app plays in the background; private WebKit setting, so guarded
        let fg = NSSelectorFromString("_setAlwaysRunsAtForegroundPriority:")
        if cfg.responds(to: fg) {
            typealias SetBool = @convention(c) (AnyObject, Selector, Bool) -> Void
            unsafeBitCast(cfg.method(for: fg), to: SetBool.self)(cfg, fg, true)
            Log.write("web view runs at foreground priority")
        }
        let bounds = CGRect(x: 0, y: 0, width: 390, height: 844)
        webView = WKWebView(frame: bounds, configuration: cfg)
        super.init()
        ucc.addUserScript(WKUserScript(source: Engine.bootstrap(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.addScriptMessageHandler(BridgeHandler(), contentWorld: .page, name: "native")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.showsVerticalScrollIndicator = false
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        load()
    }

    private func load() {
        webView.load(URLRequest(url: URL(string: "app://localhost/index.html")!))
    }

    private static func bootstrap() -> String {
        var js = "window.__SPOTITUBE_PLATFORM__='ios';window.__SPOTITUBE_VERSION__=\(jsonString(appVersion));"
        if ProcessInfo.processInfo.arguments.contains("-autotest") { js += "window.__SPOTITUBE_AUTOTEST__=true;" }
        if let url = Bundle.main.url(forResource: "bridge", withExtension: "js"), let s = try? String(contentsOf: url) {
            js += s
        }
        return js
    }

    // MARK: readiness

    func markReady() {
        ready = true
        let w = waiters
        waiters = []
        w.forEach { $0.resume() }
        if let u = pendingURL {
            pendingURL = nil
            openURL(u)
        }
    }

    @MainActor
    func waitReady() async {
        if ready { return }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in waiters.append(c) }
    }

    // MARK: native → JS

    /// Calls `window.__native.handle(name, args)` and waits for its promise
    /// (the page answers through the bridge with `__reply`). Plain
    /// evaluateJavaScript keeps us off WebKit's Swift overlay, which recent
    /// iOS versions no longer ship as a separate library.
    private var replies: [Int: CheckedContinuation<Any?, Error>] = [:]
    private var nextReply = 0

    @MainActor
    @discardableResult
    func call(_ name: String, _ args: Any = [String: Any]()) async throws -> Any? {
        await waitReady()
        nextReply += 1
        let id = nextReply
        let js = "window.__native.call(\(id),\(Engine.jsonString(name)),\(Engine.jsonString(Engine.jsonString(args))))"
        return try await withCheckedThrowingContinuation { (c: CheckedContinuation<Any?, Error>) in
            replies[id] = c
            webView.evaluateJavaScript(js) { [weak self] _, err in
                // the script itself only starts the work; a failure here means the page isn't ready
                if let err, let c = self?.replies.removeValue(forKey: id) { c.resume(throwing: err) }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in
                self?.replies.removeValue(forKey: id)?.resume(throwing: BridgeError("\(name) timed out"))
            }
        }
    }

    /// `__reply` from the page: {id, result} or {id, error}
    func reply(_ a: [String: Any]) {
        guard let id = a["id"] as? Int, let c = replies.removeValue(forKey: id) else { return }
        if let e = a["error"] as? String { c.resume(throwing: BridgeError(e)) } else { c.resume(returning: a["result"]) }
    }

    /// Fire-and-forget Tauri-style event (`listen()` in the web code).
    func emit(_ event: String, _ payload: Any?) {
        guard ready else { return }
        let js = "window.__nativeEmit&&window.__nativeEmit(\(Engine.jsonString(event)),\(Engine.jsonString(payload ?? NSNull())))"
        DispatchQueue.main.async { self.webView.evaluateJavaScript(js, completionHandler: nil) }
    }

    /// Media element events for the web player's NativeMedia adapter.
    func audioEvent(_ type: String, _ data: [String: Any] = [:]) {
        guard ready else { return }
        let js = "window.__nativeAudio&&window.__nativeAudio(\(Engine.jsonString(type)),\(Engine.jsonString(data)))"
        DispatchQueue.main.async { self.webView.evaluateJavaScript(js, completionHandler: nil) }
    }

    func openURL(_ url: URL) {
        guard ready else {
            pendingURL = url
            return
        }
        emit("open-url", url.absoluteString)
    }

    static func jsonString(_ v: Any) -> String {
        if let d = try? JSONSerialization.data(withJSONObject: v, options: [.fragmentsAllowed]), let s = String(data: d, encoding: .utf8) {
            return s
        }
        return "null"
    }

    // MARK: presentation helpers

    var topController: UIViewController? {
        var c = host ?? UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.windows.first(where: { $0.isKeyWindow })?.rootViewController }
            .first
        while let p = c?.presentedViewController { c = p }
        return c
    }

    func refreshStatusBar() {
        host?.setNeedsStatusBarAppearanceUpdate()
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == "app" || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
            return decisionHandler(.allow)
        }
        // links never navigate the app itself
        if action.targetFrame?.isMainFrame ?? true, url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Log.write("web content process terminated, reloading")
        ready = false
        for (_, c) in replies { c.resume(throwing: BridgeError("page reloaded")) }
        replies = [:]
        load()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Log.write("navigation failed: \(error.localizedDescription)")
    }

    // MARK: WKUIDelegate

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, url.scheme == "https" || url.scheme == "http" { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard let top = topController else { return completionHandler() }
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        top.present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let top = topController else { return completionHandler(false) }
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        top.present(a, animated: true)
    }
}

/// JS → native: `webkit.messageHandlers.native.postMessage({cmd, args})`,
/// replies with a JSON string (or an error message).
final class BridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
            replyHandler(nil, "bad bridge message")
            return
        }
        let argsJSON = body["args"] as? String ?? "{}"
        let args = ((try? JSONSerialization.jsonObject(with: Data(argsJSON.utf8))) as? [String: Any]) ?? [:]
        // media commands run synchronously, in order
        if let r = Commands.runSync(cmd, args) {
            switch r {
            case .success(let v): replyHandler(Engine.jsonString(v ?? NSNull()), nil)
            case .failure(let e): replyHandler(nil, (e as? BridgeError)?.message ?? e.localizedDescription)
            }
            return
        }
        Task { @MainActor in
            do {
                let v = try await Commands.run(cmd, args)
                replyHandler(Engine.jsonString(v ?? NSNull()), nil)
            } catch {
                replyHandler(nil, (error as? BridgeError)?.message ?? error.localizedDescription)
            }
        }
    }
}
