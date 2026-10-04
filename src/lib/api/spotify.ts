// Spotify data: the official Web API (OAuth) plus, when enabled, the private
// endpoints the web player uses (friend activity, following lists, profiles).
// Every request goes through the Rust `spotify_get` command, which attaches the token.
import { call, isTauri } from './transport';
import type { Thumb, Track } from './types';

const API = 'https://api.spotify.com/v1';
const SPCLIENT = 'https://spclient.wg.spotify.com';

export type Via = 'oauth' | 'web' | 'auto';

export interface SpStatus {
  linked: boolean;
  client_id: string | null;
  web_token: boolean;
}

export async function spGet<T = any>(url: string, via: Via = 'auto'): Promise<T> {
  const text = await call<string>('spotify_get', { url, via });
  return text ? JSON.parse(text) : (null as T);
}

export const spStatus = (): Promise<SpStatus> => (isTauri ? call<SpStatus>('spotify_status') : Promise.resolve({ linked: false, client_id: null, web_token: false }));

// ------------------------------------------------------------------ shapes

export interface SpUser {
  id: string;
  name: string;
  image?: string;
  followers?: number;
  following?: number;
  url: string;
}

export interface SpPlaylist {
  id: string;
  name: string;
  image?: string;
  owner?: string;
  ownerId?: string;
  tracks?: number;
  description?: string;
  followers?: number;
}

export interface SpArtist {
  id: string;
  name: string;
  image?: string;
}

export interface SpFriend {
  user: SpUser;
  /** ms since epoch */
  timestamp: number;
  track?: { id: string; name: string; image?: string; artist: string; album?: string; context?: { uri: string; name: string } };
}

export interface SpProfile {
  user: SpUser;
  playlists: SpPlaylist[];
  artists: SpArtist[];
  playlistCount?: number;
}

export interface SpPlaylistPage {
  playlist: SpPlaylist;
  tracks: Track[];
  /** songs withheld by Spotify (someone else's playlist without the web session) */
  hidden?: boolean;
}

// ------------------------------------------------------------------ helpers

export const idOf = (uri?: string) => (uri ? uri.split(':').pop()! : '');
const img = (images?: { url: string; width?: number | null }[]) => (images?.length ? [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0].url : undefined);
const userUrl = (id: string) => `https://open.spotify.com/user/${id}`;
const clean = (s?: string) => (s ? s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"') : undefined);

function fmt(ms?: number) {
  if (!ms) return undefined;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Spotify track → queue track. It's matched to a YouTube Music song when played. */
export function toTrack(t: any): Track | null {
  if (!t || !t.name || (t.type && t.type !== 'track') || t.is_local) return null;
  const thumbs: Thumb[] = (t.album?.images ?? []).map((i: any) => ({ url: i.url, width: i.width ?? undefined, height: i.height ?? undefined }));
  return {
    kind: 'track',
    videoId: 'sp:' + (t.id ?? t.uri ?? t.name),
    spotifyId: t.id ?? undefined,
    title: t.name,
    artists: (t.artists ?? []).map((a: any) => ({ id: null, name: a.name })),
    album: t.album?.name ? { id: null, name: t.album.name } : null,
    duration: fmt(t.duration_ms),
    durationSec: t.duration_ms ? Math.round(t.duration_ms / 1000) : undefined,
    thumbnails: thumbs,
    explicit: !!t.explicit,
    type: 'song',
  };
}

function playlistOf(p: any): SpPlaylist {
  return {
    id: p.id ?? idOf(p.uri),
    name: p.name,
    image: img(p.images) ?? p.image_url,
    owner: p.owner?.display_name ?? p.owner_name,
    ownerId: p.owner?.id ?? idOf(p.owner_uri),
    tracks: p.tracks?.total ?? p.items?.total,
    description: clean(p.description),
    followers: p.followers?.total ?? p.followers_count,
  };
}

// ------------------------------------------------------------------ official Web API

export async function getMe(via: Via = 'auto'): Promise<SpUser> {
  const u = await spGet(`${API}/me`, via);
  return { id: u.id, name: u.display_name ?? u.id, image: img(u.images), followers: u.followers?.total, url: userUrl(u.id) };
}

export async function getMyPlaylists(): Promise<SpPlaylist[]> {
  const out: SpPlaylist[] = [];
  let url: string | null = `${API}/me/playlists?limit=50`;
  for (let i = 0; url && i < 6; i++) {
    const r: any = await spGet(url);
    out.push(...(r.items ?? []).filter(Boolean).map(playlistOf));
    url = r.next;
  }
  return out;
}

export async function getFollowedArtists(): Promise<SpArtist[]> {
  const r = await spGet(`${API}/me/following?type=artist&limit=50`);
  return (r.artists?.items ?? []).map((a: any) => ({ id: a.id, name: a.name, image: img(a.images) }));
}

/** A user's profile and public playlists. Prefers the richer web-player view when available. */
export async function getProfile(id: string, web: boolean): Promise<SpProfile> {
  if (web) {
    try {
      const p = await spGet(`${SPCLIENT}/user-profile-view/v3/profile/${encodeURIComponent(id)}?playlist_limit=50&artist_limit=20&episode_limit=0&market=from_token`, 'web');
      return {
        user: { id, name: p.name ?? id, image: p.image_url, followers: p.followers_count, following: p.following_count, url: userUrl(id) },
        playlists: (p.public_playlists ?? []).map(playlistOf),
        artists: (p.recently_played_artists ?? []).map((a: any) => ({ id: idOf(a.uri), name: a.name, image: a.image_url })),
        playlistCount: p.total_public_playlists_count,
      };
    } catch (e) {
      console.warn('web profile failed, using the official API', e);
    }
  }
  const [u, pl] = await Promise.all([spGet(`${API}/users/${encodeURIComponent(id)}`), spGet(`${API}/users/${encodeURIComponent(id)}/playlists?limit=50`).catch(() => ({ items: [] }))]);
  return {
    user: { id: u.id, name: u.display_name ?? u.id, image: img(u.images), followers: u.followers?.total, url: userUrl(u.id) },
    playlists: (pl.items ?? []).filter(Boolean).map(playlistOf),
    artists: [],
    playlistCount: pl.total,
  };
}

export async function getPlaylist(id: string, via: Via = 'auto'): Promise<SpPlaylistPage> {
  const p = await spGet(`${API}/playlists/${encodeURIComponent(id)}?additional_types=track`, via);
  const tracks: Track[] = [];
  // newer API versions call the list "items" (track under "item"), older ones "tracks"
  const first = p.items ?? p.tracks;
  const take = (page: any) => {
    for (const it of page?.items ?? []) {
      const t = toTrack(it.item ?? it.track);
      if (t) tracks.push(t);
    }
  };
  take(first);
  let next: string | null = first?.next ?? null;
  for (let i = 0; next && i < 40; i++) {
    const page: any = await spGet(next, via);
    take(page);
    next = page.next;
  }
  return { playlist: playlistOf(p), tracks };
}

/**
 * Track list through the web player's own playlist service. Used when the
 * Web API hides the songs (it only returns them for playlists you own or
 * collaborate on).
 */
export async function getPlaylistTracksWeb(id: string, limit = 1500): Promise<Track[]> {
  const r = await spGet(`${SPCLIENT}/playlist/v2/playlist/${encodeURIComponent(id)}?decorate=revision,length,attributes,timestamp,owner&market=from_token`, 'web');
  const ids: string[] = (r?.contents?.items ?? [])
    .map((i: any) => String(i.uri ?? ''))
    .filter((u: string) => u.startsWith('spotify:track:'))
    .map(idOf)
    .slice(0, limit);
  const out: Track[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const page = await spGet(`${API}/tracks?ids=${ids.slice(i, i + 50).join(',')}&market=from_token`, 'web');
    for (const t of page?.tracks ?? []) {
      const tr = toTrack(t);
      if (tr) out.push(tr);
    }
  }
  return out;
}

// ------------------------------------------------------------------ private (web player) endpoints

export async function getFriendActivity(): Promise<SpFriend[]> {
  const r = await spGet('https://guc-spclient.spotify.com/presence-view/v1/buddylist', 'web');
  return (r.friends ?? [])
    .map((f: any) => ({
      user: { id: idOf(f.user?.uri), name: f.user?.name ?? idOf(f.user?.uri), image: f.user?.imageUrl, url: userUrl(idOf(f.user?.uri)) },
      timestamp: f.timestamp ?? 0,
      track: f.track
        ? {
            id: idOf(f.track.uri),
            name: f.track.name,
            image: f.track.imageUrl,
            artist: f.track.artist?.name ?? '',
            album: f.track.album?.name,
            context: f.track.context?.uri ? { uri: f.track.context.uri, name: f.track.context.name } : undefined,
          }
        : undefined,
    }))
    .sort((a: SpFriend, b: SpFriend) => b.timestamp - a.timestamp);
}

export async function getFollowing(id: string, kind: 'following' | 'followers' = 'following'): Promise<SpUser[]> {
  const r = await spGet(`${SPCLIENT}/user-profile-view/v3/profile/${encodeURIComponent(id)}/${kind}?market=from_token`, 'web');
  return (r.profiles ?? [])
    .filter((p: any) => String(p.uri).startsWith('spotify:user:'))
    .map((p: any) => ({ id: idOf(p.uri), name: p.name ?? idOf(p.uri), image: p.image_url, followers: p.followers_count, url: userUrl(idOf(p.uri)) }));
}

export async function getTrack(id: string): Promise<Track | null> {
  return toTrack(await spGet(`${API}/tracks/${encodeURIComponent(id)}`));
}

/** Accepts a profile link, a spotify:user: URI or a bare id. */
export function parseUserLink(s: string): string | null {
  s = s.trim();
  const m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?user\/([^/?#]+)/i) ?? s.match(/^spotify:user:([^:]+)$/);
  if (m) return decodeURIComponent(m[1]);
  return /^[\w.-]{1,64}$/.test(s) ? s : null;
}

/** "3 min", "2 hr", "4 d" since a timestamp */
export function ago(ms: number) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d} d` : `${Math.round(d / 7)} w`;
}
