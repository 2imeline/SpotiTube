// Finds the YouTube Music song for a track that came from Spotify.
import { search } from './ytm';
import type { Track } from './types';

const KEY = 'st.spMatch';
const cache = new Map<string, Track>();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as [string, Track][];
  for (const [k, v] of saved) cache.set(k, v);
} catch {}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify([...cache].slice(-1500)));
  } catch {}
}

export const needsMatch = (t: Track) => t.videoId.startsWith('sp:');

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s-\s.*(remaster|version|edit|mix|live|mono|stereo).*$/, ' ')
    .replace(/feat\.?.*$|ft\.?.*$/, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function words(s: string) {
  return new Set(norm(s).split(' ').filter(Boolean));
}
function overlap(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size);
}

export function score(want: Track, got: Track) {
  let s = overlap(want.title, got.title) * 3;
  const wa = want.artists.map((a) => a.name).join(' ');
  const ga = got.artists.map((a) => a.name).join(' ');
  s += overlap(wa, ga) * 2;
  if (want.durationSec && got.durationSec) {
    const d = Math.abs(want.durationSec - got.durationSec);
    s += d <= 3 ? 1.5 : d <= 10 ? 1 : d <= 30 ? 0 : -1.5;
  }
  if (got.type === 'song') s += 0.5;
  return s;
}

const inflight = new Map<string, Promise<Track | null>>();

/** Best YouTube Music match for a Spotify track (cached). */
export function matchTrack(t: Track): Promise<Track | null> {
  const key = t.spotifyId ?? `${t.title}|${t.artists.map((a) => a.name).join(',')}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(key);
  if (p) return p;
  p = (async () => {
    const q = `${t.title} ${t.artists.slice(0, 2).map((a) => a.name).join(' ')}`;
    const [songs, videos] = await Promise.all([search(q, 'songs').catch(() => null), search(q, 'videos').catch(() => null)]);
    const pool = [...(songs?.list?.items ?? []).slice(0, 6), ...(videos?.list?.items ?? []).slice(0, 3)].filter((i): i is Track => i.kind === 'track' && !!i.videoId);
    let best: Track | null = null;
    let bestScore = 2;
    for (const c of pool) {
      const s = score(t, c);
      if (s > bestScore) {
        best = c;
        bestScore = s;
      }
    }
    if (best) {
      cache.set(key, best);
      persist();
    }
    return best;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Fills in the YouTube Music ids of a Spotify track in place. */
export async function resolveTrack(t: Track): Promise<boolean> {
  if (!needsMatch(t)) return true;
  const m = await matchTrack(t);
  if (!m) return false;
  t.videoId = m.videoId;
  t.counterpart = m.counterpart;
  t.videoType = m.videoType;
  t.type = m.type;
  t.menu = m.menu;
  t.likeStatus = m.likeStatus;
  // links to the YouTube Music artist / album pages
  if (m.artists.some((a) => a.id)) t.artists = m.artists;
  if (m.album?.id) t.album = m.album;
  if (!t.durationSec) t.durationSec = m.durationSec;
  return true;
}

/** Resolves a list for actions that need real video ids (add to playlist, ...). Keeps the order. */
export async function resolveAll(tracks: Track[], onProgress?: (done: number) => void): Promise<string[]> {
  const ids: (string | null)[] = new Array(tracks.length).fill(null);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < tracks.length) {
      const i = next++;
      const c = { ...tracks[i] };
      if (await resolveTrack(c).catch(() => false)) ids[i] = c.videoId;
      onProgress?.(++done);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return ids.filter((x): x is string => !!x);
}
