import Foundation

/// Diagnostics log (Settings → About → Copy log), same as the desktop app.
enum Log {
    private static let queue = DispatchQueue(label: "log")
    private static let max = 256 * 1024

    static var url: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("spotitube.log")
    }

    static func write(_ line: String) {
        let ts = Int(Date().timeIntervalSince1970)
        let text = "[\(ts)] \(line.replacingOccurrences(of: "\n", with: "\n    "))\n"
        NSLog("SpotiTube: %@", line)
        queue.async {
            let u = url
            if let attrs = try? FileManager.default.attributesOfItem(atPath: u.path), let size = attrs[.size] as? Int, size > max,
               let s = try? String(contentsOf: u) {
                let half = String(s.suffix(s.count / 2))
                let cut = half.firstIndex(of: "\n").map { half.index(after: $0) } ?? half.startIndex
                try? String(half[cut...]).write(to: u, atomically: true, encoding: .utf8)
            }
            if let h = try? FileHandle(forWritingTo: u) {
                h.seekToEndOfFile()
                h.write(Data(text.utf8))
                try? h.close()
            } else {
                try? text.write(to: u, atomically: true, encoding: .utf8)
            }
        }
    }

    static func read() -> String {
        queue.sync { (try? String(contentsOf: url)) ?? "" }
    }
}
