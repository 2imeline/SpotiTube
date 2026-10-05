import CarPlay
import UIKit

/// CarPlay: a simple YouTube Music-style browser (Home / Library / Recents)
/// plus the system Now Playing screen. Lists come from the web engine
/// (`window.__native.handle('cp.*')`), playback from AudioEngine.
///
/// Note: the CarPlay app icon only shows up when the app is signed with the
/// `com.apple.developer.carplay-audio` entitlement. Without it CarPlay still
/// shows SpotiTube in its Now Playing screen with full controls.
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate, CPNowPlayingTemplateObserver {
    static weak var current: CarPlaySceneDelegate?
    static var connected: Bool { current != nil }

    private var ic: CPInterfaceController?
    private var tabs: CPTabBarTemplate?
    private var home = CPListTemplate(title: "Home", sections: [])
    private var library = CPListTemplate(title: "Library", sections: [])
    private var recents = CPListTemplate(title: "Recents", sections: [])
    private var images = NSCache<NSString, UIImage>()
    private var shuffleOn = false
    private var repeatMode = "off"

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        CarPlaySceneDelegate.current = self
        ic = interfaceController
        home.tabTitle = "Home"
        home.tabImage = UIImage(systemName: "house.fill")
        library.tabTitle = "Library"
        library.tabImage = UIImage(systemName: "music.note.list")
        recents.tabTitle = "Recents"
        recents.tabImage = UIImage(systemName: "clock.fill")
        for t in [home, library, recents] { t.emptyViewSubtitleVariants = ["Loading…"] }
        let tabs = CPTabBarTemplate(templates: [home, library, recents])
        self.tabs = tabs
        interfaceController.setRootTemplate(tabs, animated: false, completion: nil)

        let np = CPNowPlayingTemplate.shared
        np.isUpNextButtonEnabled = true
        np.upNextTitle = "Up Next"
        np.isAlbumArtistButtonEnabled = false
        np.add(self)
        updateNowPlayingButtons()

        Log.write("CarPlay connected")
        refresh(nil)
    }

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        CPNowPlayingTemplate.shared.remove(self)
        ic = nil
        if CarPlaySceneDelegate.current === self { CarPlaySceneDelegate.current = nil }
        Log.write("CarPlay disconnected")
    }

    /// Reload lists (also called by the web app when the account or library changes).
    func refresh(_ what: String?) {
        Task { @MainActor in
            if what == nil || what == "home" { await self.fill(self.home, "cp.home") }
            if what == nil || what == "library" { await self.fill(self.library, "cp.library") }
            if what == nil || what == "recents" { await self.fill(self.recents, "cp.recents") }
        }
    }

    @MainActor
    private func fill(_ t: CPListTemplate, _ call: String, _ args: [String: Any] = [:]) async {
        do {
            let r = try await Engine.shared.call(call, args)
            t.updateSections(sections(from: r))
            t.emptyViewSubtitleVariants = ["Nothing here yet"]
        } catch {
            t.emptyViewSubtitleVariants = ["Couldn't load: \(error.localizedDescription)"]
            Log.write("CarPlay \(call) failed: \(error.localizedDescription)")
        }
    }

    // ---- JSON → templates: {sections:[{title, items:[{id,title,subtitle,image,kind,playing}]}]}

    private func sections(from r: Any?) -> [CPListSection] {
        let maxSections = CPListTemplate.maximumSectionCount
        let maxItems = CPListTemplate.maximumItemCount
        var left = maxItems
        var out: [CPListSection] = []
        for s in ((r as? [String: Any])?["sections"] as? [[String: Any]] ?? []).prefix(maxSections) {
            guard left > 0 else { break }
            let rows = (s["items"] as? [[String: Any]] ?? []).prefix(left).map(item)
            left -= rows.count
            guard !rows.isEmpty else { continue }
            out.append(CPListSection(items: rows, header: s["title"] as? String, sectionIndexTitle: nil))
        }
        return out
    }

    private func item(_ d: [String: Any]) -> CPListItem {
        let id = d["id"] as? String ?? ""
        let kind = d["kind"] as? String ?? "play"
        let li = CPListItem(text: d["title"] as? String ?? "", detailText: d["subtitle"] as? String, image: UIImage(systemName: kind == "list" ? "music.note.list" : "music.note"))
        if kind == "list" { li.accessoryType = .disclosureIndicator }
        li.isPlaying = d["playing"] as? Bool ?? false
        li.playingIndicatorLocation = .trailing
        if let img = d["image"] as? String, !img.isEmpty { loadImage(img, into: li) }
        li.handler = { [weak self] _, done in
            guard let self else { return done() }
            Task { @MainActor in
                if kind == "list" {
                    await self.open(id, title: d["title"] as? String ?? "")
                } else {
                    _ = try? await Engine.shared.call("cp.play", ["id": id])
                    self.showNowPlaying()
                }
                done()
            }
        }
        return li
    }

    @MainActor
    private func open(_ id: String, title: String) async {
        let t = CPListTemplate(title: title, sections: [])
        t.emptyViewSubtitleVariants = ["Loading…"]
        ic?.pushTemplate(t, animated: true, completion: nil)
        await fill(t, "cp.open", ["id": id])
    }

    private func showNowPlaying() {
        guard let ic else { return }
        if ic.topTemplate === CPNowPlayingTemplate.shared { return }
        ic.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
    }

    private func loadImage(_ s: String, into li: CPListItem) {
        if let img = images.object(forKey: s as NSString) {
            li.setImage(img)
            return
        }
        guard let u = URL(string: s) else { return }
        URLSession.shared.dataTask(with: u) { [weak self, weak li] d, _, _ in
            guard let d, let img = UIImage(data: d) else { return }
            let size = CPListItem.maximumImageSize
            let scaled = UIGraphicsImageRenderer(size: size).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
            DispatchQueue.main.async {
                self?.images.setObject(scaled, forKey: s as NSString)
                li?.setImage(scaled)
            }
        }.resume()
    }

    // ---- Now Playing

    private func updateNowPlayingButtons() {
        let shuffle = CPNowPlayingShuffleButton { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in _ = try? await Engine.shared.call("remote", ["action": "shuffle", "on": !self.shuffleOn]) }
        }
        shuffle.isSelected = shuffleOn
        let rep = CPNowPlayingRepeatButton { [weak self] _ in
            guard let self else { return }
            let next = self.repeatMode == "off" ? "all" : self.repeatMode == "all" ? "one" : "off"
            Task { @MainActor in _ = try? await Engine.shared.call("remote", ["action": "repeat", "mode": next]) }
        }
        rep.isSelected = repeatMode != "off"
        CPNowPlayingTemplate.shared.updateNowPlayingButtons([shuffle, rep])
    }

    func controlsChanged(_ a: [String: Any]) {
        if let s = a["shuffle"] as? Bool { shuffleOn = s }
        if let r = a["repeat"] as? String { repeatMode = r }
        updateNowPlayingButtons()
    }

    func nowPlayingTemplateUpNextButtonTapped(_ nowPlayingTemplate: CPNowPlayingTemplate) {
        Task { @MainActor in
            let t = CPListTemplate(title: "Up Next", sections: [])
            self.ic?.pushTemplate(t, animated: true, completion: nil)
            await self.fill(t, "cp.queue")
        }
    }

    func nowPlayingTemplateAlbumArtistButtonTapped(_ nowPlayingTemplate: CPNowPlayingTemplate) {}
}
