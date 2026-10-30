//! macOS Now Playing: the menu bar / Control Center player, the keyboard's
//! media keys, AirPods and Bluetooth headset buttons all go through
//! MPRemoteCommandCenter. The web player pushes its state here; commands come
//! back as the same `media-key` events the Windows media keys use.

use serde::Deserialize;
#[cfg(not(target_os = "macos"))]
use tauri::AppHandle;

#[derive(Deserialize, Default, Clone)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct NowPlaying {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub art: Option<String>,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub playing: bool,
    /// false: only playback state / position changed
    #[serde(default)]
    pub full: bool,
}

#[cfg(not(target_os = "macos"))]
pub fn setup(_app: &AppHandle) {}

#[cfg(not(target_os = "macos"))]
pub fn update(_app: &AppHandle, _http: reqwest::Client, _np: NowPlaying) {}

#[cfg(target_os = "macos")]
pub use imp::{setup, update};

#[cfg(target_os = "macos")]
mod imp {
    use super::NowPlaying;
    use std::cell::RefCell;
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::AnyThread;
    use objc2_app_kit::NSImage;
    use objc2_core_foundation::CGSize;
    use objc2_foundation::{NSData, NSDictionary, NSNumber, NSString};
    use objc2_media_player::*;
    use tauri::{AppHandle, Emitter};

    struct State {
        info: NowPlaying,
        art_url: Option<String>,
        artwork: Option<Retained<MPMediaItemArtwork>>,
        /// command targets stay registered as long as these live
        _targets: Vec<Retained<AnyObject>>,
    }

    thread_local! {
        // only touched on the main thread
        static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    }

    fn obj<T: objc2::Message>(r: Retained<T>) -> Retained<AnyObject> {
        // SAFETY: every Objective-C object is an AnyObject
        unsafe { Retained::cast_unchecked(r) }
    }

    pub fn setup(app: &AppHandle) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || unsafe {
            let cc = MPRemoteCommandCenter::sharedCommandCenter();
            let mut targets = Vec::new();
            let mut on = |cmd: Retained<MPRemoteCommand>, action: &'static str| {
                let h = handle.clone();
                let block = RcBlock::new(move |_e: NonNull<MPRemoteCommandEvent>| {
                    let _ = h.emit("media-key", action);
                    MPRemoteCommandHandlerStatus::Success
                });
                cmd.setEnabled(true);
                targets.push(cmd.addTargetWithHandler(&block));
            };
            on(cc.togglePlayPauseCommand(), "playpause");
            on(cc.playCommand(), "play");
            on(cc.pauseCommand(), "pause");
            on(cc.nextTrackCommand(), "next");
            on(cc.previousTrackCommand(), "previous");
            on(cc.stopCommand(), "stop");

            // dragging the progress bar in Control Center
            let seek = cc.changePlaybackPositionCommand();
            let h = handle.clone();
            let block = RcBlock::new(move |e: NonNull<MPRemoteCommandEvent>| {
                // SAFETY: this command always sends a position event
                let t = e.cast::<MPChangePlaybackPositionCommandEvent>().as_ref().positionTime();
                let _ = h.emit("media-seek", t);
                MPRemoteCommandHandlerStatus::Success
            });
            seek.setEnabled(true);
            targets.push(seek.addTargetWithHandler(&block));

            STATE.with(|s| {
                *s.borrow_mut() = Some(State { info: NowPlaying::default(), art_url: None, artwork: None, _targets: targets });
            });
        });
    }

    /// Rebuilds the Now Playing dictionary from the current state.
    fn publish(st: &State) {
        unsafe {
            let i = &st.info;
            let mut keys: Vec<&NSString> = Vec::new();
            let mut vals: Vec<Retained<AnyObject>> = Vec::new();
            let mut put = |k: &'static NSString, v: Retained<AnyObject>| {
                keys.push(k);
                vals.push(v);
            };
            if let Some(t) = &i.title {
                put(MPMediaItemPropertyTitle, obj(NSString::from_str(t)));
            }
            if let Some(a) = &i.artist {
                put(MPMediaItemPropertyArtist, obj(NSString::from_str(a)));
            }
            if let Some(a) = i.album.as_ref().filter(|a| !a.is_empty()) {
                put(MPMediaItemPropertyAlbumTitle, obj(NSString::from_str(a)));
            }
            if i.duration > 0.0 {
                put(MPMediaItemPropertyPlaybackDuration, obj(NSNumber::new_f64(i.duration)));
            }
            put(MPNowPlayingInfoPropertyElapsedPlaybackTime, obj(NSNumber::new_f64(i.position.max(0.0))));
            put(MPNowPlayingInfoPropertyPlaybackRate, obj(NSNumber::new_f64(if i.playing { 1.0 } else { 0.0 })));
            if let Some(a) = &st.artwork {
                put(MPMediaItemPropertyArtwork, obj(a.clone()));
            }
            let dict = NSDictionary::from_retained_objects(&keys, &vals);
            let center = MPNowPlayingInfoCenter::defaultCenter();
            center.setNowPlayingInfo(if i.title.is_some() { Some(&dict) } else { None });
            center.setPlaybackState(if i.title.is_none() {
                MPNowPlayingPlaybackState::Stopped
            } else if i.playing {
                MPNowPlayingPlaybackState::Playing
            } else {
                MPNowPlayingPlaybackState::Paused
            });
        }
    }

    fn make_artwork(bytes: Vec<u8>) -> Option<Retained<MPMediaItemArtwork>> {
        unsafe {
            let data = NSData::from_vec(bytes);
            let img = NSImage::initWithData(NSImage::alloc(), &data)?;
            let size: CGSize = img.size();
            let keep = img.clone();
            let block = RcBlock::new(move |_s: CGSize| -> NonNull<NSImage> { NonNull::from(&*keep) });
            Some(MPMediaItemArtwork::initWithBoundsSize_requestHandler(MPMediaItemArtwork::alloc(), size, &block))
        }
    }

    pub fn update(app: &AppHandle, http: reqwest::Client, np: NowPlaying) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let fetch = STATE.with(|s| {
                let mut s = s.borrow_mut();
                let st = s.as_mut()?;
                let art = np.art.clone();
                let full = np.full;
                if full {
                    st.info = np;
                } else {
                    st.info.position = np.position;
                    st.info.playing = np.playing;
                    if np.duration > 0.0 {
                        st.info.duration = np.duration;
                    }
                }
                let mut fetch = None;
                if full && art.is_some() && art != st.art_url {
                    st.art_url = art.clone();
                    st.artwork = None;
                    fetch = art;
                }
                publish(st);
                fetch
            });
            let Some(url) = fetch else { return };
            // artwork arrives a moment later
            tauri::async_runtime::spawn(async move {
                let Ok(resp) = http.get(&url).send().await else { return };
                let Ok(bytes) = resp.bytes().await else { return };
                let bytes = bytes.to_vec();
                let _ = handle.run_on_main_thread(move || {
                    STATE.with(|s| {
                        let mut s = s.borrow_mut();
                        let Some(st) = s.as_mut() else { return };
                        if st.art_url.as_deref() != Some(url.as_str()) {
                            return; // the song changed meanwhile
                        }
                        st.artwork = make_artwork(bytes);
                        publish(st);
                    });
                });
            });
        });
    }
}
