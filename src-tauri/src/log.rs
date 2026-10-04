//! Small persistent diagnostics log (panics + UI errors) so crashes can be
//! reported. Lives next to the session file; capped in size.

use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static PATH: OnceLock<PathBuf> = OnceLock::new();
const MAX: u64 = 256 * 1024;

pub fn init(dir: &std::path::Path) {
    let _ = std::fs::create_dir_all(dir);
    let _ = PATH.set(dir.join("spotitube.log"));
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        write(&format!("PANIC in thread '{}': {info}", thread.name().unwrap_or("?")));
        prev(info);
    }));
    write(&format!("started SpotiTube {} ({})", env!("CARGO_PKG_VERSION"), std::env::consts::OS));
}

pub fn write(line: &str) {
    let Some(path) = PATH.get() else { return };
    // keep the newest half when the file grows too large
    if std::fs::metadata(path).map(|m| m.len() > MAX).unwrap_or(false) {
        if let Ok(s) = std::fs::read_to_string(path) {
            let cut = s.len() / 2;
            let cut = s[cut..].find('\n').map(|i| cut + i + 1).unwrap_or(cut);
            let _ = std::fs::write(path, &s[cut..]);
        }
    }
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[{ts}] {}", line.replace('\n', "\n    "));
    }
}

pub fn read() -> String {
    PATH.get().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn log_error(message: String) {
    write(&format!("UI: {}", message.chars().take(2000).collect::<String>()));
}

#[tauri::command]
pub fn read_log() -> String {
    read()
}
