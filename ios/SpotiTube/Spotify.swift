import CryptoKit
import UIKit
import WebKit

/// Spotify linking (same design as the desktop app):
/// * official: OAuth PKCE against the user's own developer app, redirect
///   intercepted inside the sign-in sheet;
/// * experimental: a Spotify web player session whose bearer token unlocks
///   friend activity and full profiles.
final class SpotifyLink: NSObject {
    static let shared = SpotifyLink()
    static let redirect = "http://127.0.0.1:43821/callback"
    static let scopes = "user-read-private user-read-email playlist-read-private playlist-read-collaborative user-follow-read user-library-read user-read-recently-played user-top-read"

    struct OAuth: Codable {
        var client_id: String
        var access_token: String
        var refresh_token: String
        var expires_at: Double
    }

    private var oauth: OAuth?
    private var pending: (clientId: String, verifier: String, state: String)?
    private var web: (token: String, clientToken: String, at: Date)?
    private var webController: SpotifyWebController?
    var webVisible = false

    private var path: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("spotify.json")
    }

    override init() {
        super.init()
        if let d = try? Data(contentsOf: path) { oauth = try? JSONDecoder().decode(OAuth.self, from: d) }
    }

    private func save() {
        if let o = oauth, let d = try? JSONEncoder().encode(o) {
            try? d.write(to: path, options: .atomic)
        } else {
            try? FileManager.default.removeItem(at: path)
        }
    }

    static func b64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func random(_ n: Int) -> String {
        let ch = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return String((0..<n).map { _ in ch.randomElement()! })
    }

    // MARK: official OAuth

    @MainActor
    func login(clientId raw: String) throws {
        let clientId = raw.trimmingCharacters(in: .whitespaces)
        guard clientId.count >= 16, clientId.allSatisfy({ $0.isLetter || $0.isNumber }) else {
            throw BridgeError("That doesn't look like a Spotify Client ID")
        }
        let verifier = SpotifyLink.random(64)
        let challenge = SpotifyLink.b64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        let st = SpotifyLink.random(16)
        pending = (clientId, verifier, st)
        var c = URLComponents(string: "https://accounts.spotify.com/authorize")!
        c.queryItems = [
            .init(name: "response_type", value: "code"),
            .init(name: "client_id", value: clientId),
            .init(name: "scope", value: SpotifyLink.scopes),
            .init(name: "redirect_uri", value: SpotifyLink.redirect),
            .init(name: "state", value: st),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "code_challenge", value: challenge),
        ]
        let vc = SpotifyLoginController(url: c.url!) { [weak self] q in
            Task { @MainActor in
                var err: String?
                do { try await self?.finish(q) } catch { err = (error as? BridgeError)?.message ?? error.localizedDescription }
                Engine.shared.emit("spotify-changed", err as Any?)
            }
        }
        let nav = UINavigationController(rootViewController: vc)
        Engine.shared.topController?.present(nav, animated: true)
    }

    private func finish(_ q: [String: String]) async throws {
        if let e = q["error"] { throw BridgeError("Spotify login was cancelled (\(e))") }
        guard let p = pending else { throw BridgeError("No login in progress") }
        pending = nil
        guard q["state"] == p.state else { throw BridgeError("Login state mismatch") }
        guard let code = q["code"] else { throw BridgeError("No authorization code") }
        let t = try await tokenRequest([
            "grant_type": "authorization_code", "code": code, "redirect_uri": SpotifyLink.redirect,
            "client_id": p.clientId, "code_verifier": p.verifier,
        ])
        oauth = OAuth(client_id: p.clientId, access_token: t.access, refresh_token: t.refresh ?? "", expires_at: Date().timeIntervalSince1970 + t.expires - 60)
        save()
    }

    private func tokenRequest(_ form: [String: String]) async throws -> (access: String, refresh: String?, expires: Double) {
        var r = URLRequest(url: URL(string: "https://accounts.spotify.com/api/token")!)
        r.httpMethod = "POST"
        r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        r.httpBody = Data(form.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }.joined(separator: "&").utf8)
        let (d, resp) = try await Http.session.data(for: r)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200, let o = try JSONSerialization.jsonObject(with: d) as? [String: Any], let at = o["access_token"] as? String else {
            throw BridgeError("Spotify rejected the login (\(code)): \(String(decoding: d, as: UTF8.self))")
        }
        return (at, o["refresh_token"] as? String, (o["expires_in"] as? Double) ?? 3600)
    }

    private func oauthToken() async throws -> String? {
        guard var o = oauth else { return nil }
        if Date().timeIntervalSince1970 < o.expires_at { return o.access_token }
        let t = try await tokenRequest(["grant_type": "refresh_token", "refresh_token": o.refresh_token, "client_id": o.client_id])
        o.access_token = t.access
        if let r = t.refresh { o.refresh_token = r }
        o.expires_at = Date().timeIntervalSince1970 + t.expires - 60
        oauth = o
        save()
        return t.access
    }

    func logout() {
        oauth = nil
        save()
        Engine.shared.emit("spotify-changed", nil)
    }

    func status() -> [String: Any] {
        [
            "linked": oauth != nil,
            "client_id": oauth?.client_id as Any? ?? NSNull(),
            "web_token": web.map { Date().timeIntervalSince($0.at) < 45 * 60 } ?? false,
        ]
    }

    // MARK: experimental web session

    @MainActor
    func webConnect() {
        openWeb(visible: true)
    }

    @MainActor
    private func openWeb(visible: Bool) {
        if let c = webController {
            if visible && !c.presented { c.present() }
            return
        }
        webVisible = visible
        let c = SpotifyWebController { [weak self] token, ct in
            guard let self else { return }
            self.web = (token, ct, Date())
            if self.webVisible { Engine.shared.emit("spotify-web-changed", true) }
            self.webController?.close()
            self.webController = nil
        } needsLogin: { [weak self] in
            guard let self, !self.webVisible else { return }
            // signed out: show it so the user can log in
            self.webVisible = true
            self.webController?.present()
        }
        webController = c
        if visible { c.present() } else { c.startHidden() }
    }

    @MainActor
    func webToken() async throws -> String? {
        if let w = web, Date().timeIntervalSince(w.at) < 45 * 60 { return w.token }
        openWeb(visible: false)
        for _ in 0..<100 {
            try await Task.sleep(nanoseconds: 300_000_000)
            if let w = web, Date().timeIntervalSince(w.at) < 45 * 60 { return w.token }
            if webVisible { return nil } // waiting for the user to sign in
        }
        throw BridgeError("Spotify web player didn't respond")
    }

    @MainActor
    func webLogout() async {
        web = nil
        let store = WKWebsiteDataStore.default()
        let records = await store.dataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes())
        let spotify = records.filter { $0.displayName.contains("spotify") }
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: spotify)
        Engine.shared.emit("spotify-web-changed", false)
    }

    // MARK: requests

    static func allowed(_ url: String) -> Bool {
        guard url.hasPrefix("https://"), let host = URL(string: url)?.host else { return false }
        return host == "api.spotify.com" || (host.hasSuffix(".spotify.com") && (host.contains("spclient") || host == "api-partner.spotify.com"))
    }

    @MainActor
    func get(url: String, via: String) async throws -> String {
        guard SpotifyLink.allowed(url), let u = URL(string: url) else { throw BridgeError("host not allowed") }
        var clientToken = ""
        var token: String?
        switch via {
        case "oauth": token = try await oauthToken()
        case "web":
            token = try await webToken()
            clientToken = web?.clientToken ?? ""
        default:
            token = try await oauthToken()
            if token == nil {
                token = try await webToken()
                clientToken = web?.clientToken ?? ""
            }
        }
        guard let token else { throw BridgeError("Spotify isn't connected") }
        var r = URLRequest(url: u)
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("WebPlayer", forHTTPHeaderField: "App-Platform")
        if !clientToken.isEmpty { r.setValue(clientToken, forHTTPHeaderField: "client-token") }
        let (d, resp) = try await Http.session.data(for: r)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 && via != "oauth" { web = nil }
        guard (200..<300).contains(code) else {
            Log.write("spotify \(code) via \(via): \(url.split(separator: "?").first ?? "")")
            throw BridgeError("Spotify returned HTTP \(code)")
        }
        return String(decoding: d, as: UTF8.self)
    }
}

/// OAuth sheet: intercepts the loopback redirect instead of listening on it.
final class SpotifyLoginController: UIViewController, WKNavigationDelegate {
    private let url: URL
    private let done: ([String: String]) -> Void
    private var finished = false

    init(url: URL, done: @escaping ([String: String]) -> Void) {
        self.url = url
        self.done = done
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Connect Spotify"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(cancel))
        let wv = WKWebView(frame: view.bounds, configuration: WKWebViewConfiguration())
        wv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        wv.customUserAgent = SAFARI_IOS_UA
        wv.navigationDelegate = self
        view.addSubview(wv)
        wv.load(URLRequest(url: url))
    }

    @objc private func cancel() {
        if !finished {
            finished = true
            done(["error": "access_denied"])
        }
        dismiss(animated: true)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = action.request.url, u.absoluteString.hasPrefix(SpotifyLink.redirect) else { return decisionHandler(.allow) }
        decisionHandler(.cancel)
        guard !finished else { return }
        finished = true
        var q: [String: String] = [:]
        for i in URLComponents(url: u, resolvingAgainstBaseURL: false)?.queryItems ?? [] { q[i.name] = i.value ?? "" }
        done(q)
        dismiss(animated: true)
    }
}

/// Spotify web player in a sheet (to sign in) or off-screen (to refresh the
/// token). An injected hook reports the player's bearer token.
final class SpotifyWebController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    static let hook = """
    (() => {
      if (window.__stHook) return; window.__stHook = 1;
      let last = '';
      const send = (auth, ct) => {
        if (!auth || !/^Bearer /i.test(auth)) return;
        const t = auth.slice(7);
        if (t === last) return; last = t;
        try { window.webkit.messageHandlers.sptoken.postMessage({ token: t, ct: ct || '' }); } catch (e) {}
      };
      const get = (h, k) => {
        if (!h) return null;
        try {
          if (h instanceof Headers) return h.get(k);
          if (Array.isArray(h)) { const e = h.find((x) => String(x[0]).toLowerCase() === k); return e ? e[1] : null; }
          for (const key in h) if (key.toLowerCase() === k) return h[key];
        } catch (e) {}
        return null;
      };
      const of = window.fetch;
      window.fetch = function (input, init) {
        try {
          const u = typeof input === 'string' ? input : (input && input.url) || '';
          if (/spotify\\.com/.test(u)) {
            const h = (init && init.headers) || (input instanceof Request ? input.headers : null);
            send(get(h, 'authorization'), get(h, 'client-token'));
          }
        } catch (e) {}
        return of.apply(this, arguments);
      };
      const seen = new WeakMap();
      const osh = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
        try {
          const m = seen.get(this) || {}; m[String(k).toLowerCase()] = v; seen.set(this, m);
          if (String(k).toLowerCase() === 'authorization') send(v, m['client-token']);
        } catch (e) {}
        return osh.apply(this, arguments);
      };
    })();
    """

    private var web: WKWebView!
    private let onToken: (String, String) -> Void
    private let needsLogin: () -> Void
    private(set) var presented = false
    private var hiddenWindowHost: UIView?
    private var closed = false

    init(onToken: @escaping (String, String) -> Void, needsLogin: @escaping () -> Void) {
        self.onToken = onToken
        self.needsLogin = needsLogin
        super.init(nibName: nil, bundle: nil)
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.mediaTypesRequiringUserActionForPlayback = .all
        let ucc = WKUserContentController()
        ucc.addUserScript(WKUserScript(source: SpotifyWebController.hook, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        cfg.userContentController = ucc
        web = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 700), configuration: cfg)
        web.customUserAgent = SAFARI_MAC_UA
        web.navigationDelegate = self
        ucc.add(LeakAvoider(self), name: "sptoken")
        web.load(URLRequest(url: URL(string: "https://open.spotify.com/")!))
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Sign in to Spotify"
        view.backgroundColor = .black
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(userClose))
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        web.removeFromSuperview()
        web.frame = view.bounds
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(web)
    }

    func startHidden() {
        // off-screen but attached, so the page runs normally
        if let host = Engine.shared.host?.view {
            web.frame = CGRect(x: -2000, y: 0, width: 390, height: 700)
            web.isUserInteractionEnabled = false
            host.insertSubview(web, at: 0)
            hiddenWindowHost = host
        }
    }

    func present() {
        guard !presented, let top = Engine.shared.topController else { return }
        presented = true
        web.isUserInteractionEnabled = true
        top.present(UINavigationController(rootViewController: self), animated: true)
    }

    @objc private func userClose() {
        close()
    }

    func close() {
        guard !closed else { return }
        closed = true
        web.stopLoading()
        web.removeFromSuperview()
        web.configuration.userContentController.removeScriptMessageHandler(forName: "sptoken")
        if presented { dismiss(animated: true) }
    }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let b = message.body as? [String: Any], let token = b["token"] as? String, token.count >= 40 else { return }
        let ct = b["ct"] as? String ?? ""
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
            // anonymous token: wait for the user to log in
            guard cookies.contains(where: { $0.name == "sp_dc" && !$0.value.isEmpty }) else { return }
            DispatchQueue.main.async { self.onToken(token, ct) }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self, !self.closed else { return }
            self.web.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                if !cookies.contains(where: { $0.name == "sp_dc" && !$0.value.isEmpty }) {
                    DispatchQueue.main.async { self.needsLogin() }
                }
            }
        }
    }
}

/// WKUserContentController retains its handlers strongly.
final class LeakAvoider: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(ucc, didReceive: message)
    }
}
