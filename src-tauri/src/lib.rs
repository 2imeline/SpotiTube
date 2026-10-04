//! SpotiTube native backend.
//!
//! The UI talks to YouTube Music's InnerTube API through the `http` command so
//! requests are not subject to browser CORS rules and can carry the signed-in
//! Google session (cookies + SAPISIDHASH). Media is streamed through a small
//! local proxy (see `proxy.rs`).

mod discord;
mod proxy;
mod updater;

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";

#[derive(Default, Serialize, Deserialize, Clone)]
struct AuthData {
    cookies: BTreeMap<String, String>,
    #[serde(default)]
    auth_user: u32,
}

impl AuthData {
    fn sapisid(&self) -> Option<&String> {
        self.cookies
            .get("SAPISID")
            .or_else(|| self.cookies.get("__Secure-3PAPISID"))
    }
    fn logged_in(&self) -> bool {
        self.sapisid().is_some()
    }
    fn cookie_header(&self) -> String {
        let mut parts: Vec<String> = self
            .cookies
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect();
        if !self.cookies.contains_key("SOCS") {
            parts.push("SOCS=CAI".into());
        }
        parts.join("; ")
    }
}

struct AppState {
    http: reqwest::Client,
    auth: Arc<RwLock<AuthData>>,
    auth_path: PathBuf,
    proxy: proxy::ProxyInfo,
    discord: discord::Discord,
}

impl AppState {
    fn save_auth(&self) {
        let data = self.auth.read().clone();
        if let Some(dir) = self.auth_path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(&data) {
            let _ = std::fs::write(&self.auth_path, json);
        }
    }
}

fn sapisid_hash(sapisid: &str, origin: &str) -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut h = sha1_smol::Sha1::new();
    h.update(format!("{} {} {}", ts, sapisid, origin).as_bytes());
    let digest = h.digest().to_string();
    format!(
        "SAPISIDHASH {ts}_{d} SAPISID1PHASH {ts}_{d} SAPISID3PHASH {ts}_{d}",
        ts = ts,
        d = digest
    )
}

fn is_youtube_host(url: &str) -> bool {
    let host = url
        .split("://")
        .nth(1)
        .and_then(|r| r.split(['/', '?']).next())
        .unwrap_or("");
    host == "youtube.com" || host.ends_with(".youtube.com")
}

#[derive(Deserialize)]
struct HttpReq {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    /// attach the signed-in Google session (when available)
    auth: Option<bool>,
}

#[derive(Serialize)]
struct HttpRes {
    status: u16,
    body: String,
    headers: HashMap<String, String>,
}

/// Keeps rotating session cookies (e.g. __Secure-1PSIDTS) fresh.
fn absorb_set_cookies(state: &AppState, resp: &reqwest::Response) {
    let mut changed = false;
    {
        let mut auth = state.auth.write();
        if !auth.logged_in() {
            return;
        }
        for v in resp.headers().get_all("set-cookie") {
            let Ok(s) = v.to_str() else { continue };
            let lower = s.to_ascii_lowercase();
            if !lower.contains("domain=.youtube.com") {
                continue;
            }
            // ignore deletions / expiry
            if lower.contains("expires=thu, 01 jan 1970") || lower.contains("max-age=0") {
                continue;
            }
            let first = s.split(';').next().unwrap_or("");
            if let Some((name, value)) = first.split_once('=') {
                let (name, value) = (name.trim(), value.trim());
                if value.is_empty() || value == "EXPIRED" {
                    continue;
                }
                if auth.cookies.get(name).map(|v| v != value).unwrap_or(true) {
                    auth.cookies.insert(name.to_string(), value.to_string());
                    changed = true;
                }
            }
        }
    }
    if changed {
        state.save_auth();
    }
}

#[tauri::command]
async fn http(state: State<'_, AppState>, req: HttpReq) -> Result<HttpRes, String> {
    let method = req.method.as_deref().unwrap_or(if req.body.is_some() { "POST" } else { "GET" });
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut builder = state.http.request(method, &req.url);

    let mut has_ua = false;
    let mut origin = "https://music.youtube.com".to_string();
    if let Some(h) = &req.headers {
        for (k, v) in h {
            if k.eq_ignore_ascii_case("user-agent") {
                has_ua = true;
            }
            if k.eq_ignore_ascii_case("origin") {
                origin = v.clone();
            }
            builder = builder.header(k, v);
        }
    }
    if !has_ua {
        builder = builder.header("User-Agent", BROWSER_UA);
    }

    let yt = is_youtube_host(&req.url);
    let use_auth = req.auth.unwrap_or(true);
    if yt {
        let auth = state.auth.read();
        if use_auth && auth.logged_in() {
            builder = builder
                .header("Cookie", auth.cookie_header())
                .header("Authorization", sapisid_hash(auth.sapisid().unwrap(), &origin))
                .header("X-Goog-AuthUser", auth.auth_user.to_string())
                .header("X-Origin", origin.clone());
        } else {
            builder = builder.header("Cookie", "SOCS=CAI");
        }
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let resp = builder.send().await.map_err(|e| format!("network error: {e}"))?;
    if yt && use_auth {
        absorb_set_cookies(&state, &resp);
    }
    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(v) = v.to_str() {
            headers.insert(k.as_str().to_string(), v.to_string());
        }
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpRes { status, body, headers })
}

#[derive(Serialize)]
struct AuthStatus {
    logged_in: bool,
    auth_user: u32,
}

#[tauri::command]
fn auth_status(state: State<'_, AppState>) -> AuthStatus {
    let a = state.auth.read();
    AuthStatus { logged_in: a.logged_in(), auth_user: a.auth_user }
}

#[tauri::command]
fn set_auth_user(app: AppHandle, state: State<'_, AppState>, index: u32) {
    state.auth.write().auth_user = index;
    state.save_auth();
    let _ = app.emit("auth-changed", true);
}

/// Manual fallback: paste a `Cookie:` header copied from a signed-in browser.
#[tauri::command]
fn set_cookies(app: AppHandle, state: State<'_, AppState>, cookie: String) -> Result<bool, String> {
    let mut map = BTreeMap::new();
    let cookie = cookie.trim().trim_start_matches("Cookie:").trim_start_matches("cookie:");
    for part in cookie.split(';') {
        if let Some((k, v)) = part.split_once('=') {
            let (k, v) = (k.trim(), v.trim().trim_matches('"'));
            if !k.is_empty() {
                map.insert(k.to_string(), v.to_string());
            }
        }
    }
    let data = AuthData { cookies: map, auth_user: 0 };
    if !data.logged_in() {
        return Err("Cookie is missing SAPISID / __Secure-3PAPISID. Copy it from a signed-in music.youtube.com tab.".into());
    }
    *state.auth.write() = data;
    state.save_auth();
    let _ = app.emit("auth-changed", true);
    Ok(true)
}

#[tauri::command]
fn logout(app: AppHandle, state: State<'_, AppState>) {
    *state.auth.write() = AuthData::default();
    let _ = std::fs::remove_file(&state.auth_path);
    let _ = app.emit("auth-changed", false);
}

const LOGIN_URL: &str = "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&uilel=3&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Den%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F";

fn capture_login(app: AppHandle, win: tauri::WebviewWindow) {
    // give the page a moment to settle its cookies
    std::thread::sleep(Duration::from_millis(600));
    let mut map = BTreeMap::new();
    for u in ["https://music.youtube.com/", "https://www.youtube.com/"] {
        if let Ok(cookies) = win.cookies_for_url(u.parse().unwrap()) {
            for c in cookies {
                map.insert(c.name().to_string(), c.value().to_string());
            }
        }
    }
    let data = AuthData { cookies: map, auth_user: 0 };
    if !data.logged_in() {
        return;
    }
    let state = app.state::<AppState>();
    *state.auth.write() = data;
    state.save_auth();
    let _ = app.emit("auth-changed", true);
    let _ = win.close();
}

#[tauri::command]
async fn login(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("login") {
        let _ = w.set_focus();
        return Ok(());
    }
    let handle = app.clone();
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(
        &app,
        "login",
        WebviewUrl::External(LOGIN_URL.parse().unwrap()),
    )
    .title("Sign in with Google")
    .inner_size(500.0, 720.0)
    .center()
    // isolated, throw-away browser session: we keep our own copy of the cookies
    .incognito(true)
    .on_page_load(move |win, payload| {
        if payload.event() == PageLoadEvent::Finished
            && payload.url().host_str() == Some("music.youtube.com")
        {
            let app = handle.clone();
            std::thread::spawn(move || capture_login(app, win));
        }
    });
    #[cfg(not(windows))]
    {
        builder = builder.user_agent(BROWSER_UA);
    }
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn stream_proxy_base(state: State<'_, AppState>) -> String {
    format!("http://127.0.0.1:{}/stream?t={}", state.proxy.port, state.proxy.token)
}

/// Uploads a local audio file to the user's YouTube Music library.
/// Raw request body = file bytes, `x-filename` header = url-encoded name.
#[tauri::command]
async fn upload_song(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw file body".into());
    };
    let name = request
        .headers()
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .map(|v| urlencoding::decode(v).map(|s| s.into_owned()).unwrap_or_default())
        .unwrap_or_else(|| "upload.mp3".into());
    let (cookie, authz, user) = {
        let a = state.auth.read();
        let Some(sid) = a.sapisid() else { return Err("Not signed in".into()) };
        (a.cookie_header(), sapisid_hash(sid, "https://music.youtube.com"), a.auth_user)
    };
    let url = format!("https://upload.youtube.com/upload/usermusic/http?authuser={user}");
    let start = state
        .http
        .post(&url)
        .header("User-Agent", BROWSER_UA)
        .header("Cookie", &cookie)
        .header("Authorization", &authz)
        .header("X-Goog-AuthUser", user.to_string())
        .header("Origin", "https://music.youtube.com")
        .header("Content-Type", "application/x-www-form-urlencoded;charset=utf-8")
        .header("X-Goog-Upload-Command", "start")
        .header("X-Goog-Upload-Header-Content-Length", bytes.len().to_string())
        .header("X-Goog-Upload-Protocol", "resumable")
        .body(format!("filename={}", name))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let upload_url = start
        .headers()
        .get("X-Goog-Upload-URL")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("upload rejected (HTTP {})", start.status()))?;
    let resp = state
        .http
        .post(&upload_url)
        .header("User-Agent", BROWSER_UA)
        .header("Cookie", &cookie)
        .header("Authorization", &authz)
        .header("X-Goog-AuthUser", user.to_string())
        .header("Origin", "https://music.youtube.com")
        .header("X-Goog-Upload-Command", "upload, finalize")
        .header("X-Goog-Upload-Offset", "0")
        .body(bytes.clone())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("upload failed (HTTP {})", resp.status()))
    }
}

#[tauri::command]
fn set_media_keys(app: AppHandle, enabled: bool) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};
    let gs = app.global_shortcut();
    let keys = [Code::MediaPlayPause, Code::MediaTrackNext, Code::MediaTrackPrevious, Code::MediaStop];
    for code in keys {
        let sc = Shortcut::new(None, code);
        if enabled {
            if !gs.is_registered(sc) {
                let _ = gs.register(sc);
            }
        } else {
            let _ = gs.unregister(sc);
        }
    }
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("invalid url".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn discord_configure(state: State<'_, AppState>, enabled: bool, client_id: Option<String>) {
    state.discord.send(discord::Msg::Configure { enabled, client_id: client_id.unwrap_or_default() });
}

#[tauri::command]
fn discord_set_activity(state: State<'_, AppState>, activity: Option<serde_json::Value>) {
    state.discord.send(discord::Msg::Activity(activity));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_global_shortcut::{Code, ShortcutState};

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let action = match shortcut.key {
                        Code::MediaPlayPause => "playpause",
                        Code::MediaTrackNext => "next",
                        Code::MediaTrackPrevious => "previous",
                        Code::MediaStop => "stop",
                        _ => return,
                    };
                    let _ = app.emit("media-key", action);
                })
                .build(),
        )
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("spotitube"));
            let auth_path = dir.join("session.json");
            let auth: AuthData = std::fs::read_to_string(&auth_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            let http = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(45))
                .pool_idle_timeout(Duration::from_secs(60))
                .build()?;
            app.manage(AppState {
                http,
                auth: Arc::new(RwLock::new(auth)),
                auth_path,
                proxy: proxy::start(),
                discord: discord::Discord::start(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            http,
            auth_status,
            set_auth_user,
            set_cookies,
            logout,
            login,
            stream_proxy_base,
            upload_song,
            set_media_keys,
            open_external,
            discord_configure,
            discord_set_activity,
            updater::check_update,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SpotiTube");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn youtube_hosts() {
        assert!(is_youtube_host("https://music.youtube.com/youtubei/v1/browse"));
        assert!(is_youtube_host("https://www.youtube.com/iframe_api"));
        assert!(!is_youtube_host("https://lrclib.net/api/get"));
        assert!(!is_youtube_host("https://evil.com/?youtube.com"));
        assert!(!is_youtube_host("https://notyoutube.com/"));
    }

    #[test]
    fn sapisid_hash_format() {
        let h = sapisid_hash("abc", "https://music.youtube.com");
        assert!(h.starts_with("SAPISIDHASH "));
        let first = h.split(' ').nth(1).unwrap();
        let (ts, digest) = first.split_once('_').unwrap();
        assert!(ts.parse::<u64>().is_ok());
        assert_eq!(digest.len(), 40);
    }

    #[test]
    fn cookie_header_adds_consent() {
        let mut a = AuthData::default();
        a.cookies.insert("SAPISID".into(), "x".into());
        assert!(a.logged_in());
        assert!(a.cookie_header().contains("SOCS=CAI"));
    }
}
