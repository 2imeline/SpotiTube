//! In-app updater: checks the latest GitHub release, downloads the matching
//! package (installer / MSI / portable exe), verifies its SHA-256 against the
//! digest GitHub publishes for the asset, then hands over to a tiny script that
//! installs it after the app exits and starts the new version.

use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

use crate::AppState;

const REPO: &str = "2imeline/SpotiTube";

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    current: String,
    latest: String,
    available: bool,
    notes: String,
    url: String,
    /// "installer" | "msi" | "portable"
    mode: String,
}

#[derive(Serialize, Clone)]
struct Progress {
    downloaded: u64,
    total: u64,
}

fn parse_version(v: &str) -> Vec<u64> {
    v.trim_start_matches('v')
        .split(['.', '-', '+'])
        .take(3)
        .map(|p| p.parse().unwrap_or(0))
        .collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    parse_version(latest) > parse_version(current)
}

/// How this copy was installed, which decides the asset we update with.
fn install_mode() -> (&'static str, PathBuf) {
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    if dir.join("uninstall.exe").exists() {
        return ("installer", exe);
    }
    let lower = dir.to_string_lossy().to_lowercase();
    if lower.contains("program files") || lower.contains("programfiles") {
        return ("msi", exe);
    }
    ("portable", exe)
}

async fn fetch_latest(state: &AppState) -> Result<serde_json::Value, String> {
    let resp = state
        .http
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("User-Agent", "SpotiTube-Updater")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub returned HTTP {}", resp.status()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_update(app: AppHandle, state: State<'_, AppState>) -> Result<UpdateInfo, String> {
    let rel = fetch_latest(&state).await?;
    let latest = rel["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    let current = app.package_info().version.to_string();
    Ok(UpdateInfo {
        available: !latest.is_empty() && is_newer(&latest, &current),
        notes: rel["body"].as_str().unwrap_or("").to_string(),
        url: rel["html_url"].as_str().unwrap_or("").to_string(),
        mode: install_mode().0.to_string(),
        current,
        latest,
    })
}

fn pick_asset<'a>(assets: &'a [serde_json::Value], mode: &str) -> Option<&'a serde_json::Value> {
    let suffix = match mode {
        "installer" => "-setup.exe",
        "msi" => ".msi",
        _ => "-portable.exe",
    };
    assets
        .iter()
        .find(|a| a["name"].as_str().map(|n| n.ends_with(suffix)).unwrap_or(false))
}

#[tauri::command]
pub async fn install_update(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let rel = fetch_latest(&state).await?;
    let (mode, exe) = install_mode();
    let assets = rel["assets"].as_array().cloned().unwrap_or_default();
    let asset = pick_asset(&assets, mode).ok_or("This release has no package for your install type")?;
    let url = asset["browser_download_url"].as_str().ok_or("missing download url")?;
    if !url.starts_with(&format!("https://github.com/{REPO}/releases/download/")) {
        return Err("Unexpected download location".into());
    }
    let name = asset["name"].as_str().unwrap_or("SpotiTube-update.exe");
    let expected = asset["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")).map(|s| s.to_lowercase());

    // download (streamed, with progress events)
    let mut resp = state
        .http
        .get(url)
        .header("User-Agent", "SpotiTube-Updater")
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed (HTTP {})", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut data: Vec<u8> = Vec::with_capacity(total as usize);
    let mut hasher = Sha256::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Download failed: {e}"))? {
        hasher.update(&chunk);
        data.extend_from_slice(&chunk);
        let _ = app.emit("update-progress", Progress { downloaded: data.len() as u64, total });
    }
    let digest: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if let Some(exp) = expected {
        if exp != digest {
            return Err("Downloaded file failed the integrity check; update cancelled".into());
        }
    }

    let dir = std::env::temp_dir().join("spotitube-update");
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join(name);
    std::fs::write(&file, &data).map_err(|e| e.to_string())?;
    drop(data);

    launch_installer(mode, &file, &exe)?;
    // give the helper a moment to start, then quit so files can be replaced
    std::thread::sleep(std::time::Duration::from_millis(300));
    app.exit(0);
    Ok(())
}

#[cfg(windows)]
fn launch_installer(mode: &str, file: &Path, exe: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let f = file.display();
    let e = exe.display();
    // wait for this process to exit, install, then relaunch
    let script = match mode {
        "installer" => format!("timeout /t 2 /nobreak >nul & \"{f}\" /S & start \"\" \"{e}\""),
        "msi" => format!("timeout /t 2 /nobreak >nul & msiexec /i \"{f}\" /passive /norestart & start \"\" \"{e}\""),
        _ => format!(
            "timeout /t 2 /nobreak >nul & move /Y \"{f}\" \"{e}\" >nul & start \"\" \"{e}\""
        ),
    };
    std::process::Command::new("cmd")
        .raw_arg(format!("/C \"{script}\""))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|err| format!("Couldn't start the installer: {err}"))?;
    Ok(())
}

#[cfg(not(windows))]
fn launch_installer(_mode: &str, file: &Path, _exe: &Path) -> Result<(), String> {
    Err(format!("Automatic install is only supported on Windows. The update was downloaded to {}", file.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare() {
        assert!(is_newer("1.2.0", "1.1.0"));
        assert!(is_newer("v1.10.0", "1.9.9"));
        assert!(is_newer("2.0.0", "1.99.99"));
        assert!(!is_newer("1.1.0", "1.1.0"));
        assert!(!is_newer("1.0.9", "1.1.0"));
    }

    #[test]
    fn picks_asset_by_mode() {
        let assets: Vec<serde_json::Value> = serde_json::from_str(
            r#"[{"name":"SpotiTube-1.2.0-portable.exe"},{"name":"SpotiTube-1.2.0-setup.exe"},{"name":"SpotiTube-1.2.0.msi"}]"#,
        )
        .unwrap();
        assert_eq!(pick_asset(&assets, "installer").unwrap()["name"], "SpotiTube-1.2.0-setup.exe");
        assert_eq!(pick_asset(&assets, "msi").unwrap()["name"], "SpotiTube-1.2.0.msi");
        assert_eq!(pick_asset(&assets, "portable").unwrap()["name"], "SpotiTube-1.2.0-portable.exe");
    }
}
