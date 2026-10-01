import type { Card, LikeStatus, Track } from '../api/types';
import { LIBRARY, getLibrary, loadAll, rateSong, ratePlaylist, subscribe, unsubscribe, sendFeedback } from '../api/ytm';
import { auth } from './auth.svelte';
import { ui } from './ui.svelte';

class Library {
  playlists = $state.raw<Card[]>([]);
  loading = $state(false);
  likes = $state<Record<string, LikeStatus>>({});
  saved = $state<Record<string, boolean>>({});
  subs = $state<Record<string, boolean>>({});
  inLib = $state<Record<string, boolean>>({});

  owned = $derived(
    this.playlists.filter((p) => {
      const id = p.browseId?.replace(/^VL/, '');
      return id && id !== 'LM' && id !== 'SE' && p.menu?.editablePlaylistId === id;
    }),
  );

  async refresh() {
    if (!auth.loggedIn) {
      this.playlists = [];
      return;
    }
    this.loading = true;
    try {
      const first = await getLibrary(LIBRARY.playlists);
      this.playlists = (await loadAll(first, 600)).filter((i): i is Card => i.kind === 'card');
    } catch (e) {
      console.warn('library', e);
    } finally {
      this.loading = false;
    }
  }

  likeOf(t: Pick<Track, 'videoId' | 'likeStatus'>): LikeStatus {
    return this.likes[t.videoId] ?? t.likeStatus ?? 'INDIFFERENT';
  }

  async rate(t: Pick<Track, 'videoId' | 'likeStatus' | 'title'>, status: LikeStatus) {
    if (!auth.loggedIn) return ui.toast('Sign in to rate songs');
    const prev = this.likeOf(t);
    this.likes[t.videoId] = status;
    try {
      await rateSong(t.videoId, status);
      ui.toast(status === 'LIKE' ? 'Added to Liked Music' : status === 'DISLIKE' ? 'Disliked' : 'Removed from Liked Music');
    } catch (e) {
      this.likes[t.videoId] = prev;
      ui.error(e);
    }
  }

  toggleLike(t: Track) {
    return this.rate(t, this.likeOf(t) === 'LIKE' ? 'INDIFFERENT' : 'LIKE');
  }

  isSaved(id: string, fallback?: boolean) {
    return this.saved[id] ?? fallback ?? false;
  }

  /** Save / remove an album or playlist from the library. */
  async setSaved(playlistId: string, saved: boolean) {
    if (!auth.loggedIn) return ui.toast('Sign in to save to your library');
    const prev = this.saved[playlistId];
    this.saved[playlistId] = saved;
    try {
      await ratePlaylist(playlistId, saved ? 'LIKE' : 'INDIFFERENT');
      ui.toast(saved ? 'Saved to Your Library' : 'Removed from Your Library');
      this.refresh();
    } catch (e) {
      this.saved[playlistId] = prev;
      ui.error(e);
    }
  }

  isSubscribed(channelId: string, fallback?: boolean) {
    return this.subs[channelId] ?? fallback ?? false;
  }

  async setSubscribed(channelId: string, on: boolean) {
    if (!auth.loggedIn) return ui.toast('Sign in to follow artists');
    const prev = this.subs[channelId];
    this.subs[channelId] = on;
    try {
      await (on ? subscribe(channelId) : unsubscribe(channelId));
      ui.toast(on ? 'Subscribed' : 'Unsubscribed');
    } catch (e) {
      this.subs[channelId] = prev;
      ui.error(e);
    }
  }

  inLibrary(t: Track) {
    return this.inLib[t.videoId] ?? t.menu?.inLibrary ?? false;
  }

  async setInLibrary(t: Track, on: boolean) {
    const token = on ? t.menu?.libraryAdd : t.menu?.libraryRemove;
    if (!token) return ui.toast('Not available for this item');
    this.inLib[t.videoId] = on;
    try {
      await sendFeedback([token]);
      ui.toast(on ? 'Added to library' : 'Removed from library');
    } catch (e) {
      delete this.inLib[t.videoId];
      ui.error(e);
    }
  }
}

export const library = new Library();
