// "Date added" for YouTube Music playlists. YouTube Music doesn't say when a
// song was added, so SpotiTube keeps its own record: the exact time for songs
// added through the app, and the time a new song was first seen in a playlist
// for songs added elsewhere (the YouTube Music app or website). Songs that
// were already there the first time a playlist was opened stay undated.

const KEY = 'st.added';
const MAX_PLAYLISTS = 200;

/** playlist id -> video id -> ms (0 = already there at the first visit) */
type Store = Record<string, { at: number; v: Record<string, number>; scanned?: boolean }>;

function read(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

class Added {
  data = $state<Store>(read());

  private save() {
    const ids = Object.keys(this.data);
    if (ids.length > MAX_PLAYLISTS) {
      for (const id of ids.sort((a, b) => this.data[a].at - this.data[b].at).slice(0, ids.length - MAX_PLAYLISTS)) delete this.data[id];
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {}
  }

  of(playlistId: string, videoId: string): number | undefined {
    return this.data[playlistId]?.v[videoId] || undefined;
  }

  /** songs added through SpotiTube */
  record(playlistId: string, videoIds: string[]) {
    const p = (this.data[playlistId] ??= { at: Date.now(), v: {} });
    const now = Date.now();
    for (const id of videoIds) p.v[id] = now;
    this.save();
  }

  /**
   * Compares the full song list of a playlist with what was there last time:
   * new songs get today's date, removed ones are forgotten (so re-adding
   * them later dates them again).
   */
  scan(playlistId: string, videoIds: string[]) {
    const prev = this.data[playlistId];
    const now = Date.now();
    const v: Record<string, number> = {};
    for (const id of videoIds) {
      const known = prev?.v[id];
      // first full scan: what's there is undated (unless added through the app)
      v[id] = prev?.scanned ? (known ?? now) : (known ?? 0);
    }
    this.data[playlistId] = { at: now, v, scanned: true };
    this.save();
  }
}

export const added = new Added();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Spotify style: "5 minutes ago", "3 days ago", "2 weeks ago", "Mar 5, 2024" */
export function formatAdded(ms?: number): string {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'Just now';
  if (s < 3600) return plural(Math.floor(s / 60), 'minute');
  if (s < 86400) return plural(Math.floor(s / 3600), 'hour');
  if (s < 7 * 86400) return plural(Math.floor(s / 86400), 'day');
  if (s < 28 * 86400) return plural(Math.floor(s / (7 * 86400)), 'week');
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
