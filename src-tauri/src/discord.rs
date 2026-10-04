//! Minimal Discord Rich Presence client over Discord's local IPC
//! (`\\.\pipe\discord-ipc-N` on Windows, `$XDG_RUNTIME_DIR/discord-ipc-N` on
//! Unix). A background thread owns the connection, reconnects when Discord is
//! (re)started and always applies the most recent activity.

use std::io::{Read, Write};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// Public client id of the open-source "YouTube Music" desktop app
/// (shows as "Listening to YouTube Music"). Users can supply their own.
pub const DEFAULT_CLIENT_ID: &str = "1177081335727267940";

pub enum Msg {
    Configure { enabled: bool, client_id: String },
    Activity(Option<Value>),
}

pub struct Discord {
    tx: Sender<Msg>,
}

impl Discord {
    pub fn start() -> Self {
        let (tx, rx) = channel();
        std::thread::Builder::new()
            .name("discord-rpc".into())
            .spawn(move || run(rx))
            .expect("spawn discord thread");
        Discord { tx }
    }
    pub fn send(&self, m: Msg) {
        let _ = self.tx.send(m);
    }
}

trait Pipe: Read + Write + Send {}
impl<T: Read + Write + Send> Pipe for T {}

#[cfg(windows)]
fn connect_pipe() -> Option<Box<dyn Pipe>> {
    for i in 0..10 {
        let path = format!(r"\\.\pipe\discord-ipc-{i}");
        if let Ok(f) = std::fs::OpenOptions::new().read(true).write(true).open(&path) {
            return Some(Box::new(f));
        }
    }
    None
}

#[cfg(unix)]
fn connect_pipe() -> Option<Box<dyn Pipe>> {
    use std::os::unix::net::UnixStream;
    let mut dirs: Vec<String> = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
        .iter()
        .filter_map(|k| std::env::var(k).ok())
        .collect();
    dirs.push("/tmp".into());
    let extra: Vec<String> = dirs
        .iter()
        .flat_map(|d| [format!("{d}/app/com.discordapp.Discord"), format!("{d}/snap.discord")])
        .collect();
    dirs.extend(extra);
    for d in &dirs {
        for i in 0..10 {
            if let Ok(s) = UnixStream::connect(format!("{d}/discord-ipc-{i}")) {
                let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
                return Some(Box::new(s));
            }
        }
    }
    None
}

fn write_frame(p: &mut dyn Pipe, op: u32, payload: &Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(payload)?;
    let mut buf = Vec::with_capacity(8 + body.len());
    buf.extend_from_slice(&op.to_le_bytes());
    buf.extend_from_slice(&(body.len() as u32).to_le_bytes());
    buf.extend_from_slice(&body);
    p.write_all(&buf)?;
    p.flush()
}

fn read_frame(p: &mut dyn Pipe) -> std::io::Result<(u32, Value)> {
    let mut hdr = [0u8; 8];
    p.read_exact(&mut hdr)?;
    let op = u32::from_le_bytes(hdr[0..4].try_into().unwrap());
    let len = u32::from_le_bytes(hdr[4..8].try_into().unwrap()) as usize;
    if len > 1 << 20 {
        return Err(std::io::Error::other("frame too large"));
    }
    let mut body = vec![0u8; len];
    p.read_exact(&mut body)?;
    Ok((op, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

fn nonce() -> String {
    format!("{:016x}{:016x}", fastrand::u64(..), fastrand::u64(..))
}

struct Conn {
    pipe: Box<dyn Pipe>,
}

impl Conn {
    fn open(client_id: &str) -> Option<Conn> {
        let mut pipe = connect_pipe()?;
        write_frame(&mut *pipe, 0, &json!({ "v": 1, "client_id": client_id })).ok()?;
        // expect READY dispatch
        let (op, v) = read_frame(&mut *pipe).ok()?;
        if op != 1 || v["evt"] != "READY" {
            return None;
        }
        Some(Conn { pipe })
    }

    fn set(&mut self, activity: Option<&Value>) -> std::io::Result<()> {
        let payload = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": nonce(),
        });
        write_frame(&mut *self.pipe, 1, &payload)?;
        // drain the response so the pipe never fills up
        let (op, _) = read_frame(&mut *self.pipe)?;
        if op == 2 {
            return Err(std::io::Error::other("discord closed the connection"));
        }
        Ok(())
    }
}

fn run(rx: Receiver<Msg>) {
    let mut enabled = false;
    let mut client_id = DEFAULT_CLIENT_ID.to_string();
    let mut desired: Option<Value> = None;
    let mut dirty = false;
    let mut conn: Option<Conn> = None;
    let mut last_attempt = Instant::now() - Duration::from_secs(60);

    loop {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Msg::Configure { enabled: e, client_id: id }) => {
                let id = if id.trim().chars().all(|c| c.is_ascii_digit()) && id.trim().len() >= 17 { id.trim().to_string() } else { DEFAULT_CLIENT_ID.to_string() };
                if id != client_id || !e {
                    if let Some(mut c) = conn.take() {
                        let _ = c.set(None);
                    }
                    last_attempt = Instant::now() - Duration::from_secs(60);
                }
                enabled = e;
                client_id = id;
                dirty = true;
            }
            Ok(Msg::Activity(a)) => {
                desired = a;
                dirty = true;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        if !enabled {
            continue;
        }
        if conn.is_none() {
            // only try to (re)connect every 15 s; Discord may simply not be running
            if desired.is_none() || last_attempt.elapsed() < Duration::from_secs(15) {
                continue;
            }
            last_attempt = Instant::now();
            conn = Conn::open(&client_id);
            dirty = conn.is_some();
        }
        if dirty {
            if let Some(c) = conn.as_mut() {
                if c.set(desired.as_ref()).is_err() {
                    conn = None;
                    last_attempt = Instant::now() - Duration::from_secs(60);
                    continue;
                }
            }
            dirty = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    struct Mem(Cursor<Vec<u8>>);
    impl Read for Mem {
        fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
            self.0.read(b)
        }
    }
    impl Write for Mem {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.0.get_mut().extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn frames_roundtrip() {
        let mut m = Mem(Cursor::new(Vec::new()));
        write_frame(&mut m, 1, &json!({"cmd": "SET_ACTIVITY"})).unwrap();
        let bytes = m.0.get_ref().clone();
        assert_eq!(u32::from_le_bytes(bytes[0..4].try_into().unwrap()), 1);
        let mut r = Mem(Cursor::new(bytes));
        let (op, v) = read_frame(&mut r).unwrap();
        assert_eq!(op, 1);
        assert_eq!(v["cmd"], "SET_ACTIVITY");
    }

    #[cfg(unix)]
    #[test]
    fn talks_to_fake_discord() {
        use std::os::unix::net::UnixListener;
        let dir = std::env::temp_dir().join(format!("drpc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sock = dir.join("discord-ipc-0");
        let _ = std::fs::remove_file(&sock);
        let listener = UnixListener::bind(&sock).unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let (op, hello) = read_frame(&mut s).unwrap();
            assert_eq!(op, 0);
            assert_eq!(hello["client_id"], "123456789012345678");
            write_frame(&mut s, 1, &json!({"cmd": "DISPATCH", "evt": "READY"})).unwrap();
            let (op, msg) = read_frame(&mut s).unwrap();
            write_frame(&mut s, 1, &json!({"cmd": "SET_ACTIVITY", "nonce": msg["nonce"]})).unwrap();
            (op, msg)
        });
        std::env::set_var("XDG_RUNTIME_DIR", &dir);
        let mut c = Conn::open("123456789012345678").expect("handshake");
        c.set(Some(&json!({"type": 2, "details": "All I Need", "state": "Radiohead"}))).unwrap();
        let (op, msg) = server.join().unwrap();
        assert_eq!(op, 1);
        assert_eq!(msg["cmd"], "SET_ACTIVITY");
        assert_eq!(msg["args"]["activity"]["details"], "All I Need");
        assert_eq!(msg["args"]["pid"], std::process::id());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
