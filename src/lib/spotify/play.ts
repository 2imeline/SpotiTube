// Playing Spotify lists: tracks are matched to YouTube Music as they come up.
import { getPlaylist, type SpPlaylistPage } from '../api/spotify';
import { player } from '../player/player.svelte';
import { spotify } from '../stores/spotify.svelte';
import { ui } from '../stores/ui.svelte';
import type { Track } from '../api/types';

const cache = new Map<string, { at: number; page: SpPlaylistPage }>();

/** Official API first; Spotify-owned playlists are blocked there for new apps, so retry via the web session. */
export async function loadSpPlaylist(id: string): Promise<SpPlaylistPage> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.page;
  let page: SpPlaylistPage;
  try {
    page = await getPlaylist(id, spotify.linked ? 'oauth' : 'web');
  } catch (e) {
    if (!spotify.linked || !spotify.web) throw e;
    page = await getPlaylist(id, 'web');
  }
  cache.set(id, { at: Date.now(), page });
  return page;
}

export async function playSpPlaylist(id: string, name: string, shuffle = false) {
  try {
    const path = `/sp-playlist/${id}`;
    if (player.source?.path === path && !shuffle) return player.toggle();
    const { tracks } = await loadSpPlaylist(id);
    if (!tracks.length) return ui.toast('This playlist is empty');
    player.playTracks(tracks, 0, { title: name, path }, { shuffle });
  } catch (e) {
    ui.error(e);
  }
}

export function spTrack(o: { id?: string; name: string; artist: string; album?: string; image?: string }): Track {
  return {
    kind: 'track',
    videoId: 'sp:' + (o.id || o.name),
    spotifyId: o.id || undefined,
    title: o.name,
    artists: o.artist.split(/,\s*/).map((name) => ({ id: null, name })),
    album: o.album ? { id: null, name: o.album } : null,
    thumbnails: o.image ? [{ url: o.image }] : [],
    type: 'song',
  };
}
