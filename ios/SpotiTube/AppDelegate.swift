import AVFoundation
import CarPlay
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        Log.write("launch \(Engine.appVersion) (iOS \(UIDevice.current.systemVersion))")
        AudioEngine.shared.setUp()
        // The web engine (UI + YouTube Music logic) starts right away: CarPlay
        // can connect without the phone UI ever being shown.
        _ = Engine.shared
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        if session.role == UISceneSession.Role.carTemplateApplication {
            let c = UISceneConfiguration(name: "CarPlay", sessionRole: session.role)
            c.delegateClass = CarPlaySceneDelegate.self
            return c
        }
        let c = UISceneConfiguration(name: "Default", sessionRole: session.role)
        c.delegateClass = SceneDelegate.self
        return c
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        w.backgroundColor = .black
        w.rootViewController = WebHostViewController()
        w.makeKeyAndVisible()
        window = w
        if let url = connectionOptions.urlContexts.first?.url { Engine.shared.openURL(url) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let url = URLContexts.first?.url { Engine.shared.openURL(url) }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        AudioEngine.shared.setForeground(true)
        Engine.shared.emit("app-state", "active")
    }

    func sceneWillResignActive(_ scene: UIScene) {
        Engine.shared.emit("app-state", "inactive")
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        AudioEngine.shared.setForeground(false)
        Engine.shared.emit("app-state", "background")
    }
}

/// Hosts the shared web view plus the native video layer above it.
final class WebHostViewController: UIViewController {
    override func loadView() {
        let v = UIView()
        v.backgroundColor = .black
        view = v
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let wv = Engine.shared.webView
        wv.removeFromSuperview()
        wv.frame = view.bounds
        wv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(wv)
        let video = AudioEngine.shared.videoView
        video.removeFromSuperview()
        view.addSubview(video)
        Engine.shared.host = self
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        Engine.shared.statusBarDark ? .darkContent : .lightContent
    }

    override var prefersStatusBarHidden: Bool { Engine.shared.statusBarHidden }

    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }

    override var prefersHomeIndicatorAutoHidden: Bool { false }
}
