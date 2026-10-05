import AVKit
import UIKit

/// Native implementations of the commands the web app invokes
/// (the iOS counterparts of the desktop app's Rust commands).
enum Commands {
    /// Media commands run synchronously on the main thread, in call order.
    static func runSync(_ cmd: String, _ a: [String: Any]) -> Result<Any?, Error>? {
        guard cmd.hasPrefix("audio_") || cmd.hasPrefix("video_") else { return nil }
        return Result { try AudioEngine.shared.command(cmd, a) }
    }

    @MainActor
    static func run(_ cmd: String, _ a: [String: Any]) async throws -> Any? {
        switch cmd {
        case "native_ready":
            Engine.shared.markReady()
            return ["platform": "ios", "version": Engine.appVersion, "carplay": CarPlaySceneDelegate.connected]

        // ---- network + Google session
        case "http":
            return try await Http.request(a["req"] as? [String: Any] ?? [:])
        case "auth_status":
            return Auth.shared.status()
        case "set_auth_user":
            Auth.shared.setAuthUser(a["index"] as? Int ?? 0)
            Engine.shared.emit("auth-changed", true)
            return nil
        case "set_cookies":
            try Auth.shared.paste(a["cookie"] as? String ?? "")
            Engine.shared.emit("auth-changed", true)
            return true
        case "logout":
            Auth.shared.logout()
            Engine.shared.emit("auth-changed", false)
            return nil
        case "login":
            LoginViewController.present()
            return nil
        case "stream_proxy_base":
            // streams are fetched natively (see StreamLoader); the web code
            // only passes the URL + user agent through
            return "stream://local/?k=1"
        case "upload_song":
            try await Uploader.upload(a)
            return nil

        // ---- system
        case "open_external":
            guard let s = a["url"] as? String, let u = URL(string: s), u.scheme == "https" || u.scheme == "http" else { throw BridgeError("invalid url") }
            await UIApplication.shared.open(u)
            return nil
        case "share":
            Share.present(text: a["text"] as? String, url: a["url"] as? String)
            return nil
        case "show_route_picker":
            RoutePicker.show()
            return nil
        case "haptic":
            Haptics.play(a["style"] as? String ?? "light")
            return nil
        case "set_status_bar":
            Engine.shared.statusBarDark = a["dark"] as? Bool ?? false
            Engine.shared.statusBarHidden = a["hidden"] as? Bool ?? false
            Engine.shared.refreshStatusBar()
            return nil
        case "check_update":
            return try await Updater.check()
        case "install_update":
            try await Updater.install()
            return nil
        case "log_error":
            Log.write("UI: \((a["message"] as? String ?? "").prefix(2000))")
            return nil
        case "read_log":
            return Log.read()
        case "autotest_log":
            Log.write("AUTOTEST: \(a["message"] as? String ?? "")")
            return nil
        case "autotest_shot":
            try await Autotest.shot(a["name"] as? String ?? "shot")
            return nil
        case "autotest_done":
            Autotest.done()
            return nil

        // ---- desktop-only features
        case "set_media_keys", "discord_configure", "discord_set_activity":
            return nil

        // ---- Spotify
        case "spotify_login":
            try SpotifyLink.shared.login(clientId: a["clientId"] as? String ?? "")
            return nil
        case "spotify_logout":
            SpotifyLink.shared.logout()
            return nil
        case "spotify_web_connect":
            SpotifyLink.shared.webConnect()
            return nil
        case "spotify_web_token":
            return try await SpotifyLink.shared.webToken()
        case "spotify_web_logout":
            await SpotifyLink.shared.webLogout()
            return nil
        case "spotify_status":
            return SpotifyLink.shared.status()
        case "spotify_get":
            return try await SpotifyLink.shared.get(url: a["url"] as? String ?? "", via: a["via"] as? String ?? "auto")

        // ---- CarPlay
        case "carplay_refresh":
            CarPlaySceneDelegate.current?.refresh(a["what"] as? String)
            return nil

        default:
            throw BridgeError("unknown command \(cmd)")
        }
    }
}

/// AirPlay / Bluetooth output picker (Spotify's "devices" button).
enum RoutePicker {
    private static let picker: AVRoutePickerView = {
        let p = AVRoutePickerView(frame: CGRect(x: -100, y: -100, width: 1, height: 1))
        p.prioritizesVideoDevices = false
        return p
    }()

    @MainActor
    static func show() {
        guard let host = Engine.shared.host?.view else { return }
        if picker.superview !== host { host.addSubview(picker) }
        // AVRoutePickerView has no public "present": tap its internal button
        for case let b as UIButton in picker.subviews {
            b.sendActions(for: .touchUpInside)
            return
        }
    }
}

enum Haptics {
    static func play(_ style: String) {
        switch style {
        case "select": UISelectionFeedbackGenerator().selectionChanged()
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case "heavy": UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}

enum Share {
    static func present(text: String?, url: String?) {
        guard let top = Engine.shared.topController else { return }
        var items: [Any] = []
        if let t = text, !t.isEmpty { items.append(t) }
        if let s = url, let u = URL(string: s) { items.append(u) }
        guard !items.isEmpty else { return }
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        vc.popoverPresentationController?.sourceView = top.view
        vc.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY - 80, width: 1, height: 1)
        top.present(vc, animated: true)
    }
}

/// Uploads a song to the user's YouTube Music library (same protocol as desktop).
enum Uploader {
    static func upload(_ a: [String: Any]) async throws {
        guard let b64 = a["__raw"] as? String, let bytes = Data(base64Encoded: b64) else { throw BridgeError("expected file data") }
        let headers = a["headers"] as? [String: String] ?? [:]
        let name = (headers["x-filename"]?.removingPercentEncoding) ?? "upload.mp3"
        guard Auth.shared.loggedIn, let authz = Auth.shared.authorization(origin: "https://music.youtube.com") else { throw BridgeError("Not signed in") }
        let user = String(Auth.shared.authUser)
        let cookie = Auth.shared.cookieHeader()
        func base(_ url: URL) -> URLRequest {
            var r = URLRequest(url: url)
            r.httpMethod = "POST"
            r.setValue(BROWSER_UA, forHTTPHeaderField: "User-Agent")
            r.setValue(cookie, forHTTPHeaderField: "Cookie")
            r.setValue(authz, forHTTPHeaderField: "Authorization")
            r.setValue(user, forHTTPHeaderField: "X-Goog-AuthUser")
            r.setValue("https://music.youtube.com", forHTTPHeaderField: "Origin")
            return r
        }
        var start = base(URL(string: "https://upload.youtube.com/upload/usermusic/http?authuser=\(user)")!)
        start.setValue("application/x-www-form-urlencoded;charset=utf-8", forHTTPHeaderField: "Content-Type")
        start.setValue("start", forHTTPHeaderField: "X-Goog-Upload-Command")
        start.setValue(String(bytes.count), forHTTPHeaderField: "X-Goog-Upload-Header-Content-Length")
        start.setValue("resumable", forHTTPHeaderField: "X-Goog-Upload-Protocol")
        start.httpBody = Data("filename=\(name)".utf8)
        let (_, r1) = try await Http.session.data(for: start)
        guard let h1 = r1 as? HTTPURLResponse, let up = h1.value(forHTTPHeaderField: "X-Goog-Upload-URL"), let upURL = URL(string: up) else {
            throw BridgeError("upload rejected (HTTP \((r1 as? HTTPURLResponse)?.statusCode ?? 0))")
        }
        var put = base(upURL)
        put.setValue("upload, finalize", forHTTPHeaderField: "X-Goog-Upload-Command")
        put.setValue("0", forHTTPHeaderField: "X-Goog-Upload-Offset")
        let (_, r2) = try await Http.session.upload(for: put, from: bytes)
        let code = (r2 as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw BridgeError("upload failed (HTTP \(code))") }
    }
}

/// Sideloaded apps can't replace themselves: point at the new IPA instead.
enum Updater {
    static let repo = "2imeline/SpotiTube"

    static func latest() async throws -> [String: Any] {
        var r = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases/latest")!)
        r.setValue("SpotiTube-iOS", forHTTPHeaderField: "User-Agent")
        r.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let (d, resp) = try await Http.session.data(for: r)
        guard (resp as? HTTPURLResponse)?.statusCode == 200, let o = try JSONSerialization.jsonObject(with: d) as? [String: Any] else {
            throw BridgeError("Couldn't reach GitHub")
        }
        return o
    }

    static func newer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }
        let y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
            if l != r { return l > r }
        }
        return false
    }

    static func check() async throws -> [String: Any] {
        let rel = try await latest()
        let tag = (rel["tag_name"] as? String ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "v"))
        let current = Engine.appVersion
        return [
            "current": current,
            "latest": tag,
            "available": !tag.isEmpty && newer(tag, than: current),
            "notes": rel["body"] as? String ?? "",
            "url": rel["html_url"] as? String ?? "",
            "mode": "ipa",
        ]
    }

    @MainActor
    static func install() async throws {
        let rel = try await latest()
        let assets = rel["assets"] as? [[String: Any]] ?? []
        let ipa = assets.first { ($0["name"] as? String ?? "").hasSuffix(".ipa") }
        let link = (ipa?["browser_download_url"] as? String) ?? (rel["html_url"] as? String) ?? "https://github.com/\(repo)/releases/latest"
        if let u = URL(string: link) { await UIApplication.shared.open(u) }
    }
}

/// Screenshots for the CI simulator run (`-autotest` launch argument).
enum Autotest {
    static var dir: URL {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("autotest")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    @MainActor
    static func shot(_ name: String) async throws {
        let wv = Engine.shared.webView
        let img: UIImage = try await withCheckedThrowingContinuation { c in
            wv.takeSnapshot(with: nil) { img, err in
                if let img { c.resume(returning: img) } else { c.resume(throwing: err ?? BridgeError("snapshot failed")) }
            }
        }
        let safe = name.replacingOccurrences(of: "/", with: "_")
        try img.pngData()?.write(to: dir.appendingPathComponent("\(safe).png"))
    }

    static func done() {
        try? Data(Log.read().utf8).write(to: dir.appendingPathComponent("log.txt"))
        try? Data("ok".utf8).write(to: dir.appendingPathComponent("done"))
    }
}
