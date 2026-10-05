import CryptoKit
import Foundation
import UIKit
import WebKit

let BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"
/// Google only allows sign-in from what looks like a real browser.
let SAFARI_IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
let SAFARI_MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15"

func isYouTubeHost(_ url: URL) -> Bool {
    guard let h = url.host?.lowercased() else { return false }
    return h == "youtube.com" || h.hasSuffix(".youtube.com")
}

/// The `http` command: InnerTube & co. without browser CORS, carrying the
/// signed-in Google session (cookies + SAPISIDHASH) like the desktop app.
enum Http {
    static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.httpCookieAcceptPolicy = .never
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.timeoutIntervalForRequest = 45
        c.httpMaximumConnectionsPerHost = 8
        return URLSession(configuration: c)
    }()

    static func request(_ req: [String: Any]) async throws -> [String: Any] {
        guard let s = req["url"] as? String, let url = URL(string: s) else { throw BridgeError("invalid url") }
        var r = URLRequest(url: url)
        let body = req["body"] as? String
        r.httpMethod = (req["method"] as? String) ?? (body != nil ? "POST" : "GET")
        var hasUA = false
        var origin = "https://music.youtube.com"
        for (k, v) in (req["headers"] as? [String: Any]) ?? [:] {
            let value = "\(v)"
            if k.lowercased() == "user-agent" { hasUA = true }
            if k.lowercased() == "origin" { origin = value }
            r.setValue(value, forHTTPHeaderField: k)
        }
        if !hasUA { r.setValue(BROWSER_UA, forHTTPHeaderField: "User-Agent") }
        let yt = isYouTubeHost(url)
        let useAuth = (req["auth"] as? Bool) ?? true
        if yt { Auth.shared.apply(to: &r, origin: origin, useAuth: useAuth) }
        if let body { r.httpBody = Data(body.utf8) }

        let data: Data
        let resp: URLResponse
        do {
            (data, resp) = try await session.data(for: r)
        } catch {
            throw BridgeError("network error: \(error.localizedDescription)")
        }
        guard let h = resp as? HTTPURLResponse else { throw BridgeError("bad response") }
        if yt && useAuth { Auth.shared.absorb(h, url: url) }
        var headers: [String: String] = [:]
        for (k, v) in h.allHeaderFields { headers["\(k)".lowercased()] = "\(v)" }
        let text = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
        return ["status": h.statusCode, "body": text, "headers": headers]
    }
}

/// Google session for YouTube Music (cookies captured at sign-in).
final class Auth {
    static let shared = Auth()
    private let lock = NSLock()
    private var cookies: [String: String] = [:]
    private(set) var authUser = 0

    private var path: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("session.json")
    }

    init() {
        if let d = try? Data(contentsOf: path), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            cookies = o["cookies"] as? [String: String] ?? [:]
            authUser = o["auth_user"] as? Int ?? 0
        }
    }

    private func save() {
        let o: [String: Any] = ["cookies": cookies, "auth_user": authUser]
        if let d = try? JSONSerialization.data(withJSONObject: o) {
            var p = path
            try? d.write(to: p, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var rv = URLResourceValues()
            rv.isExcludedFromBackup = true
            try? p.setResourceValues(rv)
        }
    }

    private var sapisid: String? { cookies["SAPISID"] ?? cookies["__Secure-3PAPISID"] }
    var loggedIn: Bool { lock.locked { sapisid != nil } }

    func status() -> [String: Any] {
        lock.locked { ["logged_in": sapisid != nil, "auth_user": authUser] }
    }

    func cookieHeader() -> String {
        lock.locked {
            var parts = cookies.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }
            if cookies["SOCS"] == nil { parts.append("SOCS=CAI") }
            return parts.joined(separator: "; ")
        }
    }

    static func sapisidHash(_ sapisid: String, origin: String) -> String {
        let ts = Int(Date().timeIntervalSince1970)
        let digest = Insecure.SHA1.hash(data: Data("\(ts) \(sapisid) \(origin)".utf8)).map { String(format: "%02x", $0) }.joined()
        return "SAPISIDHASH \(ts)_\(digest) SAPISID1PHASH \(ts)_\(digest) SAPISID3PHASH \(ts)_\(digest)"
    }

    func authorization(origin: String) -> String? {
        let s = lock.locked { sapisid }
        return s.map { Auth.sapisidHash($0, origin: origin) }
    }

    func apply(to r: inout URLRequest, origin: String, useAuth: Bool) {
        if useAuth, let authz = authorization(origin: origin) {
            r.setValue(cookieHeader(), forHTTPHeaderField: "Cookie")
            r.setValue(authz, forHTTPHeaderField: "Authorization")
            r.setValue(String(authUser), forHTTPHeaderField: "X-Goog-AuthUser")
            r.setValue(origin, forHTTPHeaderField: "X-Origin")
        } else {
            r.setValue("SOCS=CAI", forHTTPHeaderField: "Cookie")
        }
    }

    /// Keeps rotating session cookies (e.g. __Secure-1PSIDTS) fresh.
    func absorb(_ resp: HTTPURLResponse, url: URL) {
        var fields: [String: String] = [:]
        for (k, v) in resp.allHeaderFields { fields["\(k)"] = "\(v)" }
        let jar = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
        var changed = false
        lock.locked {
            guard sapisid != nil else { return }
            for c in jar where c.domain.hasSuffix("youtube.com") {
                if c.value.isEmpty || c.value == "EXPIRED" { continue }
                if let e = c.expiresDate, e < Date() { continue }
                if cookies[c.name] != c.value {
                    cookies[c.name] = c.value
                    changed = true
                }
            }
        }
        if changed { lock.locked { save() } }
    }

    func set(cookies new: [String: String]) {
        lock.locked {
            cookies = new
            authUser = 0
            save()
        }
    }

    func setAuthUser(_ i: Int) {
        lock.locked {
            authUser = i
            save()
        }
    }

    func logout() {
        lock.locked {
            cookies = [:]
            authUser = 0
            try? FileManager.default.removeItem(at: path)
        }
    }

    /// Manual fallback: a `Cookie:` header copied from a signed-in browser.
    func paste(_ raw: String) throws {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        for p in ["Cookie:", "cookie:"] where s.hasPrefix(p) { s = String(s.dropFirst(p.count)) }
        var map: [String: String] = [:]
        for part in s.split(separator: ";") {
            let kv = part.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            if kv.count == 2, !kv[0].isEmpty { map[kv[0]] = kv[1].trimmingCharacters(in: CharacterSet(charactersIn: "\"")) }
        }
        guard map["SAPISID"] != nil || map["__Secure-3PAPISID"] != nil else {
            throw BridgeError("Cookie is missing SAPISID / __Secure-3PAPISID. Copy it from a signed-in music.youtube.com tab.")
        }
        set(cookies: map)
    }
}

extension NSLock {
    func locked<T>(_ f: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try f()
    }
}

// MARK: - Google sign-in sheet

final class LoginViewController: UIViewController, WKNavigationDelegate {
    static let loginURL = "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&uilel=3&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Den%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F"

    private var web: WKWebView!
    private var done = false

    static func present() {
        guard let top = Engine.shared.topController else { return }
        if top is LoginViewController || (top as? UINavigationController)?.viewControllers.first is LoginViewController { return }
        let nav = UINavigationController(rootViewController: LoginViewController())
        nav.modalPresentationStyle = .pageSheet
        top.present(nav, animated: true)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Sign in with Google"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(close))
        let cfg = WKWebViewConfiguration()
        // throw-away browser session: we keep our own copy of the cookies
        cfg.websiteDataStore = .nonPersistent()
        web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.customUserAgent = SAFARI_IOS_UA
        web.navigationDelegate = self
        view.addSubview(web)
        web.load(URLRequest(url: URL(string: LoginViewController.loginURL)!))
    }

    @objc private func close() {
        dismiss(animated: true)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !done, let host = webView.url?.host, host.hasSuffix("youtube.com") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.capture() }
    }

    private func capture() {
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { all in
            var map: [String: String] = [:]
            for c in all where c.domain.hasSuffix("youtube.com") { map[c.name] = c.value }
            guard !self.done, map["SAPISID"] != nil || map["__Secure-3PAPISID"] != nil else { return }
            self.done = true
            Auth.shared.set(cookies: map)
            Log.write("signed in with Google (\(map.count) cookies)")
            Engine.shared.emit("auth-changed", true)
            self.dismiss(animated: true)
        }
    }
}
