import AVFoundation
import MediaPlayer
import UIKit

/// Native playback for the iPhone app: AVQueuePlayer (so the next song is
/// queued in advance and keeps playing with the phone locked), lock screen /
/// Control Center / CarPlay "Now Playing", remote commands and video.
/// The web player drives it through `audio_*` commands and receives
/// HTMLMediaElement-style events back.
final class AudioEngine: NSObject {
    static let shared = AudioEngine()

    let player = AVQueuePlayer()
    let videoView = VideoView()

    final class Item {
        let src: String
        var meta: [String: Any]
        let item: AVPlayerItem
        let asset: AVURLAsset
        let loader: StreamLoader?
        let video: Bool
        var ready = false
        var pendingSeek: Double?
        var observers: [NSKeyValueObservation] = []
        init(src: String, meta: [String: Any], asset: AVURLAsset, loader: StreamLoader?, video: Bool) {
            self.src = src
            self.meta = meta
            self.asset = asset
            self.loader = loader
            self.video = video
            item = AVPlayerItem(asset: asset)
            item.preferredForwardBufferDuration = video ? 20 : 0
        }
    }

    private(set) var current: Item?
    private var next: Item?
    private var foreground = true
    private var rate: Float = 1
    private var volume: Float = 1
    private var timeObserver: Any?
    private var lastBuffered: Double = -1
    private var sleepTimer: Timer?
    private var artworkFor: String?
    private var artwork: MPMediaItemArtwork?
    private var statusObs: NSKeyValueObservation?
    private var itemObs: NSKeyValueObservation?
    private var wasPlaying = false
    var videoRect: CGRect?

    // MARK: setup

    func setUp() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default, policy: .longFormAudio, options: [])
        player.automaticallyWaitsToMinimizeStalling = true
        player.actionAtItemEnd = .advance
        player.allowsExternalPlayback = true

        statusObs = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            DispatchQueue.main.async { self?.statusChanged(p.timeControlStatus) }
        }
        itemObs = player.observe(\.currentItem, options: [.new]) { [weak self] p, _ in
            DispatchQueue.main.async { self?.currentItemChanged(p.currentItem) }
        }
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 4), queue: .main) { [weak self] t in
            self?.tick(t)
        }
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(itemEnded(_:)), name: .AVPlayerItemDidPlayToEndTime, object: nil)
        nc.addObserver(self, selector: #selector(itemFailed(_:)), name: .AVPlayerItemFailedToPlayToEndTime, object: nil)
        nc.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(mediaReset), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        setUpRemoteCommands()
        videoView.isHidden = true
    }

    func setForeground(_ on: Bool) {
        foreground = on
        // a visible player layer pauses video in the background: detach it so the sound keeps going
        videoView.playerLayer.player = on && current?.video == true ? player : nil
        if on { emitTime(force: true) }
    }

    // MARK: commands

    func command(_ cmd: String, _ a: [String: Any]) throws -> Any? {
        switch cmd {
        case "audio_load": load(a)
        case "audio_preload": preload(a)
        case "audio_play": play()
        case "audio_pause": player.pause()
        case "audio_stop": stop()
        case "audio_seek": seek(num(a["time"]) ?? 0)
        case "audio_rate": setRate(Float(num(a["rate"]) ?? 1))
        case "audio_volume":
            volume = Float(num(a["volume"]) ?? 1)
            player.volume = volume
        case "audio_meta":
            if let m = a["meta"] as? [String: Any] { current?.meta.merge(m) { _, n in n } }
            updateNowPlaying(full: true)
        case "audio_controls": updateControls(a)
        case "audio_sleep": setSleep(num(a["at"]))
        case "audio_state": return state()
        case "video_rect": setVideoRect(a)
        default: throw BridgeError("unknown media command \(cmd)")
        }
        return nil
    }

    private func num(_ v: Any?) -> Double? {
        if let d = v as? Double { return d }
        if let n = v as? NSNumber { return n.doubleValue }
        if let i = v as? Int { return Double(i) }
        return nil
    }

    private func makeItem(_ src: String, meta: [String: Any], video: Bool) -> Item? {
        guard let u = URL(string: src) else { return nil }
        if u.scheme == "stream" {
            // stream://local/?k=1&u=<googlevideo url>&ua=<client user agent>&m=<mime>
            let q = URLComponents(url: u, resolvingAgainstBaseURL: false)?.queryItems ?? []
            guard let raw = q.first(where: { $0.name == "u" })?.value, let target = URL(string: raw) else { return nil }
            let ua = q.first(where: { $0.name == "ua" })?.value ?? BROWSER_UA
            let mime = meta["mime"] as? String
            let loader = StreamLoader(url: target, ua: ua, mime: mime)
            return Item(src: src, meta: meta, asset: loader.makeAsset(), loader: loader, video: video)
        }
        return Item(src: src, meta: meta, asset: AVURLAsset(url: u), loader: nil, video: video)
    }

    private func observe(_ it: Item) {
        it.observers = [
            it.item.observe(\.status, options: [.new]) { [weak self, weak it] item, _ in
                DispatchQueue.main.async {
                    guard let self, let it else { return }
                    self.itemStatus(it, item.status)
                }
            },
            it.item.observe(\.loadedTimeRanges, options: [.new]) { [weak self, weak it] _, _ in
                DispatchQueue.main.async {
                    guard let self, let it, it === self.current else { return }
                    self.emitBuffered()
                }
            },
        ]
    }

    private func load(_ a: [String: Any]) {
        let src = a["src"] as? String ?? ""
        let meta = a["meta"] as? [String: Any] ?? [:]
        let video = a["video"] as? Bool ?? false
        clearItems()
        guard !src.isEmpty else { return }
        guard let it = makeItem(src, meta: meta, video: video) else {
            Engine.shared.audioEvent("error", ["message": "Invalid stream URL"])
            return
        }
        observe(it)
        current = it
        lastBuffered = -1
        Log.write("load \"\(meta["title"] as? String ?? "?")\"\(video ? " (video)" : "")")
        player.insert(it.item, after: nil)
        player.volume = volume
        videoView.playerLayer.player = video && foreground ? player : nil
        layoutVideo()
        updateNowPlaying(full: true)
        Engine.shared.audioEvent("loadstart")
    }

    private func preload(_ a: [String: Any]) {
        if let n = next {
            player.remove(n.item)
            next = nil
        }
        guard let cur = current, let src = a["src"] as? String, !src.isEmpty else { return }
        guard let it = makeItem(src, meta: a["meta"] as? [String: Any] ?? [:], video: cur.video) else { return }
        observe(it)
        // only queue behind the item that is actually playing
        if player.items().contains(where: { $0 === cur.item }) {
            player.insert(it.item, after: cur.item)
            next = it
        }
    }

    private func clearItems() {
        player.pause()
        player.removeAllItems()
        current?.observers = []
        next?.observers = []
        current = nil
        next = nil
    }

    private func stop() {
        clearItems()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        videoView.isHidden = true
    }

    /// The finished item leaves AVQueuePlayer's list: put a fresh copy back
    /// (repeat-one, "previous" at the start of the queue, replay after the end).
    private func ensureQueued() {
        guard let cur = current, !player.items().contains(where: { $0 === cur.item }) else { return }
        let fresh = Item(src: cur.src, meta: cur.meta, asset: cur.asset, loader: cur.loader, video: cur.video)
        fresh.pendingSeek = cur.pendingSeek
        observe(fresh)
        current = fresh
        player.removeAllItems()
        player.insert(fresh.item, after: nil)
        if let n = next { player.insert(n.item, after: fresh.item) }
    }

    func play() {
        guard current != nil else { return }
        ensureQueued()
        try? AVAudioSession.sharedInstance().setActive(true)
        if #available(iOS 16.0, *) { player.defaultRate = rate }
        player.playImmediately(atRate: rate)
        updateNowPlaying(full: false)
    }

    func seek(_ t: Double) {
        guard current != nil else { return }
        ensureQueued()
        guard let it = current else { return }
        if !it.ready {
            it.pendingSeek = t
            return
        }
        let time = CMTime(seconds: max(0, t), preferredTimescale: 1000)
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: CMTime(seconds: 0.2, preferredTimescale: 1000)) { [weak self] _ in
            DispatchQueue.main.async {
                self?.updateNowPlaying(full: false)
                self?.emitTime(force: true)
            }
        }
    }

    private func setRate(_ r: Float) {
        rate = r
        if #available(iOS 16.0, *) { player.defaultRate = r }
        if player.timeControlStatus != .paused { player.rate = r }
        updateNowPlaying(full: false)
    }

    private func setSleep(_ at: Double?) {
        sleepTimer?.invalidate()
        sleepTimer = nil
        guard let at else { return }
        let delay = at / 1000 - Date().timeIntervalSince1970
        sleepTimer = Timer.scheduledTimer(withTimeInterval: max(0, delay), repeats: false) { [weak self] _ in
            self?.player.pause()
            Engine.shared.emit("sleep-timer", "done")
        }
    }

    private func state() -> [String: Any] {
        [
            "src": current?.src ?? "",
            "time": currentTime,
            "duration": duration,
            "playing": player.timeControlStatus != .paused,
            "qid": current?.meta["qid"] ?? NSNull(),
            "videoId": current?.meta["videoId"] ?? NSNull(),
        ]
    }

    var currentTime: Double {
        let t = player.currentTime().seconds
        return t.isFinite ? t : 0
    }

    var duration: Double {
        if let d = current?.item.duration.seconds, d.isFinite, d > 0 { return d }
        return num(current?.meta["duration"]) ?? 0
    }

    // MARK: observers

    private func itemStatus(_ it: Item, _ status: AVPlayerItem.Status) {
        switch status {
        case .readyToPlay:
            guard !it.ready else { return }
            it.ready = true
            guard it === current else { return }
            if let s = it.pendingSeek {
                it.pendingSeek = nil
                seek(s)
            }
            Engine.shared.audioEvent("durationchange", ["duration": duration])
            Engine.shared.audioEvent("loadedmetadata", ["duration": duration])
            Engine.shared.audioEvent("canplay")
            updateNowPlaying(full: false)
        case .failed:
            guard it === current else {
                // the preloaded song failed: drop it, the web player resolves it again later
                if it === next {
                    player.remove(it.item)
                    next = nil
                }
                return
            }
            let msg = it.item.error?.localizedDescription ?? "Playback failed"
            Log.write("media error: \(msg)")
            Engine.shared.audioEvent("error", ["message": msg])
        default:
            break
        }
    }

    private func statusChanged(_ s: AVPlayer.TimeControlStatus) {
        switch s {
        case .playing:
            wasPlaying = true
            Engine.shared.audioEvent("play")
            Engine.shared.audioEvent("playing")
        case .paused:
            if wasPlaying {
                wasPlaying = false
                Engine.shared.audioEvent("pause", ["time": currentTime])
            }
        case .waitingToPlayAtSpecifiedRate:
            if player.reasonForWaitingToPlay != .noItemToPlay { Engine.shared.audioEvent("waiting") }
        @unknown default:
            break
        }
        updateNowPlaying(full: false)
    }

    private func currentItemChanged(_ item: AVPlayerItem?) {
        guard let n = next, item === n.item else { return }
        // AVQueuePlayer moved on to the song the web player queued in advance
        Log.write("advanced to queued \"\(n.meta["title"] as? String ?? "?")\" (app \(foreground ? "foreground" : "background"))")
        current?.observers = []
        current = n
        next = nil
        lastBuffered = -1
        updateNowPlaying(full: true)
        videoView.playerLayer.player = n.video && foreground ? player : nil
        Task { @MainActor in
            do {
                let t0 = Date()
                try await Engine.shared.call("advanced", ["src": n.src, "qid": n.meta["qid"] ?? NSNull()])
                Log.write("web player synced after advance in \(Int(Date().timeIntervalSince(t0) * 1000)) ms")
            } catch {
                Log.write("advanced callback failed: \(error.localizedDescription)")
            }
        }
        if n.ready {
            Engine.shared.audioEvent("durationchange", ["duration": duration])
            Engine.shared.audioEvent("loadedmetadata", ["duration": duration])
        }
    }

    @objc private func itemEnded(_ n: Notification) {
        guard let item = n.object as? AVPlayerItem else { return }
        DispatchQueue.main.async {
            guard let cur = self.current, item === cur.item else { return }
            // with a queued next song AVQueuePlayer continues by itself
            if self.next != nil { return }
            Log.write("song ended without a queued next song (app \(self.foreground ? "foreground" : "background"))")
            Task { @MainActor in
                do {
                    let t0 = Date()
                    try await Engine.shared.call("ended")
                    Log.write("web player handled the end in \(Int(Date().timeIntervalSince(t0) * 1000)) ms")
                } catch {
                    Log.write("ended callback failed: \(error.localizedDescription)")
                }
            }
        }
    }

    @objc private func itemFailed(_ n: Notification) {
        guard let item = n.object as? AVPlayerItem else { return }
        DispatchQueue.main.async {
            guard item === self.current?.item else { return }
            let err = (n.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error)?.localizedDescription ?? "Playback stopped"
            Log.write("media failed to end: \(err)")
            Engine.shared.audioEvent("error", ["message": err])
        }
    }

    @objc private func interrupted(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .ended, let o = n.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt,
           AVAudioSession.InterruptionOptions(rawValue: o).contains(.shouldResume) {
            DispatchQueue.main.async { self.play() }
        }
    }

    @objc private func routeChanged(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        // headphones unplugged / car disconnected: AVPlayer pauses itself
        DispatchQueue.main.async { self.updateNowPlaying(full: false) }
    }

    @objc private func mediaReset() {
        DispatchQueue.main.async {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, policy: .longFormAudio, options: [])
            Engine.shared.audioEvent("error", ["message": "Audio system was reset"])
        }
    }

    private func tick(_ t: CMTime) {
        guard foreground, current != nil else { return }
        emitTime(force: false)
    }

    private func emitTime(force: Bool) {
        guard current != nil else { return }
        Engine.shared.audioEvent("timeupdate", ["time": currentTime, "duration": duration])
        if force { emitBuffered() }
    }

    private func emitBuffered() {
        guard let r = current?.item.loadedTimeRanges.last?.timeRangeValue else { return }
        let end = (r.start + r.duration).seconds
        guard end.isFinite, abs(end - lastBuffered) > 0.5 else { return }
        lastBuffered = end
        if foreground { Engine.shared.audioEvent("progress", ["buffered": end]) }
    }

    // MARK: Now Playing + remote commands

    private func updateNowPlaying(full: Bool) {
        let c = MPNowPlayingInfoCenter.default()
        guard let cur = current else { return }
        var info = full ? [String: Any]() : (c.nowPlayingInfo ?? [:])
        if full {
            let m = cur.meta
            info[MPMediaItemPropertyTitle] = m["title"] as? String ?? ""
            info[MPMediaItemPropertyArtist] = m["artist"] as? String ?? ""
            info[MPMediaItemPropertyAlbumTitle] = m["album"] as? String ?? ""
            info[MPNowPlayingInfoPropertyMediaType] = NSNumber(value: (cur.video ? MPNowPlayingInfoMediaType.video : .audio).rawValue)
            if let a = m["artwork"] as? String, a == artworkFor, let art = artwork {
                info[MPMediaItemPropertyArtwork] = art
            } else if let a = m["artwork"] as? String, let u = URL(string: a) {
                loadArtwork(u, key: a)
            }
        }
        info[MPMediaItemPropertyPlaybackDuration] = duration
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPNowPlayingInfoPropertyPlaybackRate] = player.timeControlStatus == .playing ? Double(rate) : 0.0
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = 1.0
        c.nowPlayingInfo = info
    }

    private func loadArtwork(_ u: URL, key: String) {
        URLSession.shared.dataTask(with: u) { [weak self] d, _, _ in
            guard let self, let d, let img = UIImage(data: d) else { return }
            DispatchQueue.main.async {
                guard self.current?.meta["artwork"] as? String == key else { return }
                let art = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
                self.artworkFor = key
                self.artwork = art
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = art
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }.resume()
    }

    private func remote(_ action: String, _ extra: [String: Any] = [:]) {
        var args = extra
        args["action"] = action
        Log.write("remote command \(action)")
        Task { @MainActor in
            do {
                try await Engine.shared.call("remote", args)
            } catch {
                Log.write("remote \(action) failed: \(error.localizedDescription)")
            }
        }
    }

    private func setUpRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.current == nil {
                self.remote("play")
            } else {
                self.play()
            }
            return .success
        }
        c.pauseCommand.addTarget { [weak self] _ in
            self?.player.pause()
            return .success
        }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.player.timeControlStatus == .paused { self.play() } else { self.player.pause() }
            return .success
        }
        c.stopCommand.addTarget { [weak self] _ in
            self?.player.pause()
            return .success
        }
        c.nextTrackCommand.addTarget { [weak self] _ in
            self?.remote("next")
            return .success
        }
        c.previousTrackCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.currentTime > 3 { self.seek(0) } else { self.remote("previous") }
            return .success
        }
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            guard let self, let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.seek(e.positionTime)
            return .success
        }
        c.changeShuffleModeCommand.addTarget { [weak self] e in
            guard let e = e as? MPChangeShuffleModeCommandEvent else { return .commandFailed }
            self?.remote("shuffle", ["on": e.shuffleType != .off])
            return .success
        }
        c.changeRepeatModeCommand.addTarget { [weak self] e in
            guard let e = e as? MPChangeRepeatModeCommandEvent else { return .commandFailed }
            let mode = e.repeatType == .one ? "one" : e.repeatType == .all ? "all" : "off"
            self?.remote("repeat", ["mode": mode])
            return .success
        }
        c.likeCommand.localizedTitle = "Like"
        c.likeCommand.localizedShortTitle = "Like"
        c.likeCommand.addTarget { [weak self] _ in
            self?.remote("like")
            return .success
        }
        c.dislikeCommand.isEnabled = false
        c.bookmarkCommand.isEnabled = false
        c.skipForwardCommand.isEnabled = false
        c.skipBackwardCommand.isEnabled = false
        c.seekForwardCommand.isEnabled = false
        c.seekBackwardCommand.isEnabled = false
    }

    /// Web player state for lock screen / CarPlay controls.
    private func updateControls(_ a: [String: Any]) {
        let c = MPRemoteCommandCenter.shared()
        if let s = a["shuffle"] as? Bool { c.changeShuffleModeCommand.currentShuffleType = s ? .items : .off }
        if let r = a["repeat"] as? String { c.changeRepeatModeCommand.currentRepeatType = r == "one" ? .one : r == "all" ? .all : .off }
        if let l = a["liked"] as? Bool { c.likeCommand.isActive = l }
        if let e = a["canLike"] as? Bool { c.likeCommand.isEnabled = e }
        CarPlaySceneDelegate.current?.controlsChanged(a)
    }

    // MARK: video

    private func setVideoRect(_ a: [String: Any]) {
        if let x = num(a["x"]), let y = num(a["y"]), let w = num(a["w"]), let h = num(a["h"]), w > 0, h > 0 {
            videoRect = CGRect(x: x, y: y, width: w, height: h)
            videoView.radius = CGFloat(num(a["radius"]) ?? 0)
        } else {
            videoRect = nil
        }
        layoutVideo()
    }

    private func layoutVideo() {
        guard let r = videoRect, current?.video == true else {
            videoView.isHidden = true
            return
        }
        videoView.frame = r
        videoView.isHidden = false
        if foreground { videoView.playerLayer.player = player }
    }
}

final class VideoView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    var radius: CGFloat = 0 {
        didSet {
            layer.cornerRadius = radius
            layer.masksToBounds = radius > 0
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        playerLayer.videoGravity = .resizeAspect
        isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) { fatalError() }
}
