import type { Lyrics } from '../api/types';
import { getLrclib, getLyrics } from '../api/ytm';
import { player } from './player.svelte';
import { settings } from '../stores/settings.svelte';

class LyricsStore {
  videoId = $state<string | null>(null);
  loading = $state(false);
  data = $state.raw<Lyrics | null>(null);
  private cache = new Map<string, Lyrics | null>();

  active = $derived.by(() => {
    const lines = this.data?.lines;
    if (!lines?.length) return -1;
    const t = player.time + 0.3;
    let lo = 0, hi = lines.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].start <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  });

  async load() {
    const t = player.current;
    if (!t) {
      this.data = null;
      this.videoId = null;
      return;
    }
    if (this.videoId === t.videoId && (this.data || this.loading)) return;
    this.videoId = t.videoId;
    if (this.cache.has(t.videoId)) {
      this.data = this.cache.get(t.videoId)!;
      return;
    }
    this.loading = true;
    this.data = null;
    let result: Lyrics | null = null;
    try {
      const tabs = await player.loadTabs();
      if (tabs?.lyricsId) result = await getLyrics(tabs.lyricsId).catch(() => null);
      if (settings.lrclib && t.type !== 'episode' && !result?.lines) {
        const lr = await getLrclib({ title: t.title, artist: t.artists[0]?.name ?? '', album: t.album?.name, duration: t.durationSec ?? player.duration });
        if (lr?.lines?.length || (!result && lr)) result = lr;
      }
    } catch {
      /* none */
    }
    this.cache.set(t.videoId, result);
    if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!);
    if (this.videoId === t.videoId) {
      this.data = result;
      this.loading = false;
    }
  }
}

export const lyrics = new LyricsStore();
