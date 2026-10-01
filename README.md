# SpotiTube

A **lightweight, native YouTube Music desktop app** for Windows with a pixel-faithful
Spotify-style interface — and a glossy **Frutiger Aero / Windows 7** theme.

It is *not* a wrapped music.youtube.com tab: the UI is a small (~90 KB gzipped)
Svelte app rendered by the system WebView2, talking directly to YouTube Music's
InnerTube API through a tiny Rust backend. Audio streams straight from Google's
CDN into a single `<audio>`/`<video>` element.

## Download

Grab the latest build from the **[Releases](../../releases/latest)** page:

| File | What it is |
| --- | --- |
| `SpotiTube-x.y.z-setup.exe` | Installer (per-user, no admin needed) — recommended |
| `SpotiTube-x.y.z-portable.exe` | Single executable, nothing to install |
| `SpotiTube-x.y.z.msi` | MSI package |

Windows 10/11. Uses the Microsoft Edge WebView2 runtime that ships with Windows.

## Features

**YouTube Music**
- Sign in with your Google account (built-in sign-in window, or paste browser cookies as a fallback); brand-account / multi-account switching
- Home feed with mood chips, Explore, New releases, Charts (every region), Moods & genres
- Search with suggestions, search history, "did you mean", and filters (songs, videos, albums, artists, community/featured playlists, podcasts, episodes, profiles)
- Artist pages (popular songs, albums, singles & EPs, videos, featured on, playlists, related artists, about), subscribe/unsubscribe, artist radio & shuffle
- Albums, playlists (incl. collaborative and chart playlists), podcasts and episodes
- Library: playlists, songs, albums, artists, subscriptions, podcasts, channels, Liked Music, Episodes for later, listening history, uploads (upload & delete your own files)
- Like / dislike, save to library, pin to Listen again, remove from history
- Create, edit, copy and delete playlists; add/remove songs; "add anyway" duplicate handling
- Up next queue with radio / autoplay, mixes, start radio from anything, song ⇄ video toggle
- Time-synced lyrics (YouTube Music, with LRCLIB fallback), related tab, song credits
- Plays are recorded to your YouTube Music history
- Volume normalization (YouTube loudness data), audio quality selection, Premium mode

**Player**
- Spotify-style now-playing bar, queue, now-playing panel, lyrics panel, full-screen player, mini player (always-on-top)
- Shuffle / repeat / repeat one, sleep timer, podcast playback speed
- Windows media controls (SMTC) + keyboard media keys, keyboard shortcuts
- Remembers your queue and position between launches

**Themes**
- **Spotify** (default) — a faithful clone of the Spotify desktop UI
- **Frutiger Aero** — Windows 7 glass, glossy orb buttons, three wallpapers (Aurora, Bliss-style sky, Aqua bubbles)
- **Global accent color** with a color wheel — both themes follow it (want red instead of Spotify green? one click)

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Space | Play / pause |
| Ctrl + → / ← | Next / previous |
| Shift + → / ← | Seek ±5 s |
| Ctrl + ↑ / ↓ | Volume |
| Ctrl + S / Ctrl + R | Shuffle / repeat |
| Ctrl + K | Search |
| Alt + ← / → | Back / forward |

## How it stays light

- Tauri 2 (Rust) instead of Electron: no bundled Chromium, ~5 MB installer
- One WebView, one media element; no hidden YouTube page running in the background
- Long lists are virtualized, images are lazy-loaded at the size they're shown
- The signature/"n" challenge solver (yt-dlp's EJS solver) only runs when the
  direct (JS-less) stream client fails, inside a worker that is terminated after use

## Building from source

```bash
npm ci
npx tauri build          # Windows: produces exe, NSIS setup and MSI
npx tauri dev            # development
```

Requires Node 20+ and Rust (stable). The GitHub Actions workflow in
`.github/workflows/build.yml` builds the Windows release automatically.

## Credits

- API structure ported from [ytmusicapi](https://github.com/sigma67/ytmusicapi) (MIT)
- Stream challenge solver: [yt-dlp/ejs](https://github.com/yt-dlp/ejs) (Unlicense)
- Lyrics fallback: [LRCLIB](https://lrclib.net)

SpotiTube is not affiliated with Google, YouTube or Spotify.
