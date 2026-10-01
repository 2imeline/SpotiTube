// Playback engine: queue management, streaming, media session, history.
import { listen } from '@tauri-apps/api/event';
import type { Paged, Track } from '../api/types';
import { addHistoryItem, getPlayerInfo, getWatchQueue, type WatchOptions } from '../api/ytm';
import { isTauri } from '../api/transport';
import { invalidateStream, resolveStream, type Stream } from './streams';
import { auth } from '../stores/auth.svelte';
import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';
import { bestThumb } from '../util/thumbs';

export interface QueueSource {
  title: string;
  path?: string;
}

let qidCounter = 1;
const tag = (t: Track): Track => ({ ...t, qid: qidCounter++ });

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SAVE_KEY = 'st.playerState';

class Player {
  queue = $state<Track[]>([]);
  index = $state(-1);
  current = $derived(this.index >= 0 ? this.queue[this.index] : undefined);
  upNext = $derived(this.queue.slice(this.index + 1));
  playing = $state(false);
  loading = $state(false);
  time = $state(0);
  duration = $state(0);
  buffered = $state(0);
  volume = $state(0.8);
  muted = $state(false);
  shuffle = $state(false);
  repeat = $state<'off' | 'all' | 'one'>('off');
  video = $state(false);
  rate = $state(1);
  source = $state<QueueSource | null>(null);
  error = $state<string | null>(null);
  stream = $state<Stream | null>(null);
  /** lyrics/related browse ids for the current video */
  tabs = $state<{ videoId: string; lyricsId?: string; relatedId?: string } | null>(null);
  sleepAt = $state<number | null>(null);
  sleepEndOfTrack = $state(false);

  el!: HTMLVideoElement;
  private cont?: () => Promise<Paged<Track>>;
  private unshuffled: Track[] | null = null;
  private loadToken = 0;
  private failed: string[] = [];
  private failedFor = '';
  private consecutiveFails = 0;
  private retries = 0;
  private pendingSeek = 0;
  private registered = '';
  private gain = 1;
  private restoring = false;
  private extending = false;
  private sleepTimer?: ReturnType<typeof setTimeout>;
  private prefetched = '';

  init() {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.playsInline = true;
    v.className = 'media-el';
    v.disablePictureInPicture = false;
    const host = document.createElement('div');
    host.id = 'media-host';
    host.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;overflow:hidden;opacity:0;pointer-events:none';
    host.appendChild(v);
    document.body.appendChild(host);
    this.el = v;

    v.addEventListener('timeupdate', () => {
      this.time = v.currentTime;
      this.onProgress();
    });
    v.addEventListener('durationchange', () => {
      if (isFinite(v.duration)) this.duration = v.duration;
      this.updatePosition();
    });
    v.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek > 0) {
        v.currentTime = Math.min(this.pendingSeek, Math.max(0, v.duration - 1));
        this.pendingSeek = 0;
      }
      v.playbackRate = this.current?.type === 'episode' ? this.rate : 1;
    });
    v.addEventListener('play', () => (this.playing = true));
    v.addEventListener('playing', () => {
      this.playing = true;
      this.loading = false;
      this.retries = 0;
      this.consecutiveFails = 0;
      this.registerPlay();
    });
    v.addEventListener('pause', () => {
      this.playing = false;
      this.save();
    });
    v.addEventListener('waiting', () => (this.loading = true));
    v.addEventListener('canplay', () => (this.loading = false));
    v.addEventListener('progress', () => {
      const b = v.buffered;
      if (b.length) this.buffered = b.end(b.length - 1);
    });
    v.addEventListener('ended', () => this.onEnded());
    v.addEventListener('error', () => this.onMediaError());

    this.restore();
    this.setupMediaSession();
    if (isTauri) {
      listen<string>('media-key', (e) => {
        if (e.payload === 'playpause') this.toggle();
        else if (e.payload === 'next') this.next();
        else if (e.payload === 'previous') this.previous();
        else if (e.payload === 'stop') this.pause();
      });
    }
    window.addEventListener('beforeunload', () => this.save());
    setInterval(() => this.playing && this.save(), 10_000);
  }

  // ------------------------------------------------------------ loading

  private async load(index: number, autoplay = true, startAt = 0) {
    const token = ++this.loadToken;
    const t = this.queue[index];
    if (!t) return;
    if (this.failedFor !== t.videoId) {
      this.failed = [];
      this.retries = 0;
      this.failedFor = t.videoId;
    }
    this.index = index;
    this.loading = true;
    this.error = null;
    this.time = startAt;
    this.duration = t.durationSec ?? 0;
    this.buffered = 0;
    this.gain = 1;
    this.registered = '';
    if (this.tabs?.videoId !== t.videoId) this.tabs = null;
    this.updateMetadata();
    if (this.queue.length - index <= 3) this.extend();
    if (this.sleepEndOfTrack && index !== 0) {
      /* handled in onEnded */
    }
    try {
      const id = this.video && t.type === 'song' && t.counterpart ? t.counterpart.videoId : t.videoId;
      let s: Stream;
      try {
        s = await resolveStream(id, this.video, this.failed);
      } catch (err) {
        if (!this.video) throw err;
        // no muxed video stream available: keep playing the audio
        if (token === this.loadToken) ui.toast('Video is not available for this track, playing audio');
        s = await resolveStream(t.videoId, false, this.failed);
      }
      if (token !== this.loadToken) return;
      this.stream = s;
      if (settings.normalize && s.loudnessDb != null && s.loudnessDb > 0) this.gain = Math.pow(10, -s.loudnessDb / 20);
      this.applyVolume();
      this.pendingSeek = startAt;
      this.el.src = s.url;
      if (autoplay) {
        await this.el.play().catch((e) => {
          if (e?.name !== 'AbortError') throw e;
        });
      } else {
        this.loading = false;
      }
    } catch (e: any) {
      if (token !== this.loadToken) return;
      this.loading = false;
      this.error = e?.message ?? String(e);
      this.consecutiveFails++;
      ui.toast(`Can't play "${t.title}": ${this.error}`, 'error', 5000);
      // skip unplayable tracks, but don't race through the whole queue if streaming is broken
      if (autoplay && index < this.queue.length - 1 && this.consecutiveFails < 3) setTimeout(() => token === this.loadToken && this.next(true), 1200);
    }
  }

  private onMediaError() {
    if (!this.el.src || this.restoring) return;
    const t = this.current;
    if (!t || !this.stream) return;
    // most likely a 403/expired URL from one client: retry with the next client
    if (this.retries < 3) {
      this.retries++;
      this.failed = [...this.failed, this.stream.client];
      invalidateStream(t.videoId);
      const at = this.el.currentTime || this.time;
      this.load(this.index, true, at);
      return;
    }
    this.failed = [];
    this.retries = 0;
    ui.toast(`Playback failed for "${t.title}"`, 'error');
    if (this.index < this.queue.length - 1) this.next(true);
    else this.playing = false;
  }

  private onEnded() {
    if (this.sleepEndOfTrack) {
      this.sleepEndOfTrack = false;
      this.playing = false;
      return;
    }
    if (this.repeat === 'one') {
      this.el.currentTime = 0;
      this.el.play();
      return;
    }
    this.next(true);
  }

  private onProgress() {
    const d = this.duration || this.el.duration;
    if (!d) return;
    // prefetch next stream URL so the transition is instant
    if (this.time > d * 0.5 || d - this.time < 30) {
      const nxt = this.queue[this.index + 1];
      if (nxt && this.prefetched !== nxt.videoId) {
        this.prefetched = nxt.videoId;
        resolveStream(nxt.videoId, this.video).catch(() => {});
      }
    }
  }

  private async registerPlay() {
    const t = this.current;
    if (!t || this.registered === t.videoId) return;
    this.registered = t.videoId;
    if (!auth.loggedIn) return;
    try {
      const pr = await getPlayerInfo(t.videoId);
      addHistoryItem(pr).catch(() => {});
      const ldb = pr?.playerConfig?.audioConfig?.loudnessDb;
      if (settings.normalize && this.stream?.loudnessDb == null && ldb > 0) {
        this.gain = Math.pow(10, -ldb / 20);
        this.applyVolume();
      }
    } catch {
      /* history is best-effort */
    }
  }

  /** Append more radio/autoplay tracks when near the end of the queue. */
  private async extend(): Promise<boolean> {
    if (this.extending) return false;
    this.extending = true;
    try {
      if (this.cont) {
        const p = await this.cont();
        this.cont = p.continuation;
        const have = new Set(this.queue.map((t) => t.videoId));
        const add = p.items.filter((t) => !have.has(t.videoId)).map(tag);
        if (add.length) {
          this.queue = [...this.queue, ...add];
          return true;
        }
      }
      if (!settings.autoplay || this.repeat === 'all') return false;
      const last = this.queue[this.queue.length - 1];
      if (!last || this.index < this.queue.length - 2) return false;
      const r = await getWatchQueue({ videoId: last.videoId, radio: true });
      this.cont = r.continuation;
      const have = new Set(this.queue.map((t) => t.videoId));
      const add = r.tracks.filter((t) => !have.has(t.videoId)).map(tag);
      if (add.length) {
        this.queue = [...this.queue, ...add];
        return true;
      }
    } catch (e) {
      console.warn('extend queue', e);
    } finally {
      this.extending = false;
    }
    return false;
  }

  // ------------------------------------------------------------ public API

  /** Play a fixed list (album, playlist, liked songs...). */
  playTracks(tracks: Track[], start = 0, source?: QueueSource, opts: { shuffle?: boolean } = {}) {
    const list = tracks.filter((t) => t.videoId && t.isAvailable !== false);
    if (!list.length) return;
    let startTrack = tracks[start];
    let startIdx = Math.max(0, list.indexOf(startTrack));
    let q = list.map(tag);
    this.unshuffled = null;
    if (opts.shuffle ?? this.shuffle) {
      this.unshuffled = q;
      const first = opts.shuffle && start === 0 ? q[Math.floor(Math.random() * q.length)] : q[startIdx];
      q = [first, ...shuffled(q.filter((x) => x !== first))];
      startIdx = 0;
      this.shuffle = true;
    }
    this.queue = q;
    this.cont = undefined;
    this.source = source ?? null;
    this.failed = [];
    this.load(startIdx);
  }

  /** Start a watch playlist (radio, mix, playlist by id) like YouTube Music does. */
  async playWatch(o: WatchOptions, source?: QueueSource) {
    this.loading = true;
    try {
      const r = await getWatchQueue(o);
      if (!r.tracks.length) throw new Error('Nothing to play');
      this.unshuffled = null;
      this.shuffle = !!o.shuffle;
      this.queue = r.tracks.map(tag);
      this.cont = r.continuation;
      this.source = source ?? null;
      this.failed = [];
      const idx = o.videoId ? Math.max(0, r.tracks.findIndex((t) => t.videoId === o.videoId)) : 0;
      this.tabs = { videoId: r.tracks[idx].videoId, lyricsId: r.lyricsId, relatedId: r.relatedId };
      this.load(idx);
    } catch (e) {
      this.loading = false;
      ui.error(e);
    }
  }

  /** Play a single song: starts instantly, then fills "up next" with its radio. */
  async playTrack(t: Track, source?: QueueSource) {
    this.queue = [tag(t)];
    this.unshuffled = null;
    this.shuffle = false;
    this.cont = undefined;
    this.source = source ?? { title: t.title };
    this.failed = [];
    this.load(0);
    try {
      const r = await getWatchQueue({ videoId: t.videoId, playlistId: t.playlistId });
      if (this.queue[0]?.videoId !== t.videoId || this.queue.length > 1) return;
      const rest = r.tracks.filter((x) => x.videoId !== t.videoId).map(tag);
      const cur = this.queue[0];
      if (r.tracks[0]?.videoId === t.videoId) Object.assign(cur, { counterpart: r.tracks[0].counterpart, likeStatus: cur.likeStatus ?? r.tracks[0].likeStatus });
      this.queue = [cur, ...rest];
      this.cont = r.continuation;
      this.tabs = { videoId: t.videoId, lyricsId: r.lyricsId, relatedId: r.relatedId };
    } catch {
      /* radio is optional */
    }
  }

  async startRadio(o: { videoId?: string; playlistId?: string; params?: string; title?: string }) {
    await this.playWatch({ videoId: o.videoId, playlistId: o.playlistId, params: o.params, radio: !o.params }, { title: o.title ? `${o.title} Radio` : 'Radio' });
  }

  playNext(tracks: Track[]) {
    if (!this.current) return this.playTracks(tracks);
    const q = [...this.queue];
    q.splice(this.index + 1, 0, ...tracks.map(tag));
    this.queue = q;
    ui.toast(tracks.length > 1 ? `${tracks.length} songs will play next` : 'Will play next');
  }

  addToQueue(tracks: Track[]) {
    if (!this.current) return this.playTracks(tracks);
    this.queue = [...this.queue, ...tracks.map(tag)];
    ui.toast(tracks.length > 1 ? `Added ${tracks.length} songs to queue` : 'Added to queue');
  }

  jump(i: number) {
    if (i >= 0 && i < this.queue.length) {
      this.failed = [];
      this.load(i);
    }
  }

  removeAt(i: number) {
    if (i === this.index) return this.next();
    const q = [...this.queue];
    q.splice(i, 1);
    if (i < this.index) this.index--;
    this.queue = q;
  }

  move(from: number, to: number) {
    if (from === to) return;
    const q = [...this.queue];
    const [it] = q.splice(from, 1);
    q.splice(to, 0, it);
    const cur = this.current;
    this.queue = q;
    if (cur) this.index = q.indexOf(cur);
  }

  clearUpcoming() {
    this.queue = this.queue.slice(0, this.index + 1);
    this.cont = undefined;
  }

  toggle() {
    if (!this.current) return;
    if (!this.el.src || this.error) return this.load(this.index, true, this.time);
    if (this.el.paused) this.el.play().catch((e) => e?.name !== 'AbortError' && this.onMediaError());
    else this.el.pause();
  }
  play() {
    if (this.el.paused) this.toggle();
  }
  pause() {
    this.el.pause();
  }

  async next(auto = false) {
    if (this.index < this.queue.length - 1) return this.load(this.index + 1);
    if (this.repeat === 'all' && this.queue.length) return this.load(0);
    if (await this.extend()) return this.load(this.index + 1);
    if (auto) {
      this.playing = false;
      this.el.pause();
    }
  }

  previous() {
    if (this.time > 3 || this.index <= 0) return this.seek(0);
    this.load(this.index - 1);
  }

  seek(t: number) {
    if (!this.el.src) {
      this.time = t;
      return;
    }
    this.el.currentTime = Math.max(0, t);
    this.time = this.el.currentTime;
    this.updatePosition();
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.volume > 0) this.muted = false;
    this.applyVolume();
    try {
      localStorage.setItem('st.volume', String(this.volume));
    } catch {}
  }
  toggleMute() {
    this.muted = !this.muted;
    this.applyVolume();
  }
  applyVolume() {
    if (this.el) this.el.volume = this.muted ? 0 : Math.min(1, this.volume * this.volume * this.gain);
  }

  setRate(r: number) {
    this.rate = r;
    if (this.current?.type === 'episode') this.el.playbackRate = r;
  }

  toggleShuffle() {
    if (this.shuffle) {
      this.shuffle = false;
      if (this.unshuffled) {
        const cur = this.current;
        const present = new Set(this.queue.map((t) => t.qid));
        const restored = this.unshuffled.filter((t) => present.has(t.qid));
        const extra = this.queue.filter((t) => !restored.includes(t));
        this.queue = [...restored, ...extra];
        if (cur) this.index = this.queue.indexOf(cur);
      }
      this.unshuffled = null;
    } else {
      this.shuffle = true;
      this.unshuffled = [...this.queue];
      const head = this.queue.slice(0, this.index + 1);
      this.queue = [...head, ...shuffled(this.queue.slice(this.index + 1))];
    }
  }

  cycleRepeat() {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
  }

  setVideo(on: boolean) {
    if (this.video === on) return;
    this.video = on;
    if (this.current) {
      const was = this.playing;
      this.load(this.index, was, this.el.currentTime || this.time);
    }
  }

  setSleep(minutes: number | 'track' | null) {
    clearTimeout(this.sleepTimer);
    this.sleepAt = null;
    this.sleepEndOfTrack = false;
    if (minutes === 'track') {
      this.sleepEndOfTrack = true;
      ui.toast('Playback will stop at the end of this track');
    } else if (minutes) {
      this.sleepAt = Date.now() + minutes * 60_000;
      this.sleepTimer = setTimeout(() => {
        this.pause();
        this.sleepAt = null;
      }, minutes * 60_000);
      ui.toast(`Sleep timer set for ${minutes} minutes`);
    }
  }

  async loadTabs(): Promise<NonNullable<Player['tabs']> | null> {
    const t = this.current;
    if (!t) return null;
    if (this.tabs?.videoId === t.videoId) return this.tabs;
    try {
      const r = await getWatchQueue({ videoId: t.videoId });
      if (this.current?.videoId !== t.videoId) return null;
      this.tabs = { videoId: t.videoId, lyricsId: r.lyricsId, relatedId: r.relatedId };
      if (!t.counterpart && r.tracks[0]?.videoId === t.videoId && r.tracks[0].counterpart) t.counterpart = r.tracks[0].counterpart;
      return this.tabs;
    } catch {
      this.tabs = { videoId: t.videoId };
      return this.tabs;
    }
  }

  // ------------------------------------------------------------ media session

  private setupMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const h: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => this.play()],
      ['pause', () => this.pause()],
      ['stop', () => this.pause()],
      ['previoustrack', () => this.previous()],
      ['nexttrack', () => this.next()],
      ['seekto', (d) => d.seekTime != null && this.seek(d.seekTime)],
      ['seekbackward', (d) => this.seek(this.time - (d.seekOffset ?? 10))],
      ['seekforward', (d) => this.seek(this.time + (d.seekOffset ?? 10))],
    ];
    for (const [a, fn] of h) {
      try {
        ms.setActionHandler(a, fn);
      } catch {}
    }
  }

  private updateMetadata() {
    const t = this.current;
    const ms = navigator.mediaSession;
    if (t) document.title = `${t.title} • ${t.artists.map((a) => a.name).join(', ')}`;
    if (!ms || !t || typeof MediaMetadata === 'undefined') return;
    const art = bestThumb(t.thumbnails, 512);
    ms.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artists.map((a) => a.name).join(', '),
      album: t.album?.name ?? '',
      artwork: art ? [{ src: art, sizes: '512x512' }] : [],
    });
  }

  private updatePosition() {
    const ms = navigator.mediaSession;
    if (!ms?.setPositionState || !this.duration) return;
    try {
      ms.setPositionState({ duration: this.duration, position: Math.min(this.time, this.duration), playbackRate: this.el.playbackRate || 1 });
    } catch {}
  }

  // ------------------------------------------------------------ persistence

  save() {
    try {
      const slim = (t: Track) => ({
        kind: 'track', videoId: t.videoId, title: t.title, artists: t.artists, album: t.album, duration: t.duration,
        durationSec: t.durationSec, thumbnails: t.thumbnails.slice(-2), type: t.type, videoType: t.videoType,
        explicit: t.explicit, likeStatus: t.likeStatus, menu: t.menu, counterpart: t.counterpart ? { ...t.counterpart, counterpart: undefined, menu: undefined } : undefined,
      });
      const start = Math.max(0, this.index - 50);
      const q = this.queue.slice(start, start + 250);
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        queue: q.map(slim), index: this.index - start, time: this.el?.currentTime || this.time,
        source: this.source, repeat: this.repeat, video: this.video,
      }));
    } catch {}
  }

  private restore() {
    try {
      const v = localStorage.getItem('st.volume');
      if (v != null) this.volume = +v;
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
      if (s?.queue?.length) {
        this.queue = s.queue.map(tag);
        this.index = Math.min(s.index ?? 0, this.queue.length - 1);
        this.time = s.time ?? 0;
        this.duration = this.current?.durationSec ?? 0;
        this.source = s.source ?? null;
        this.repeat = s.repeat ?? 'off';
        this.video = !!s.video;
        this.updateMetadata();
      }
    } catch {}
    this.applyVolume();
  }
}

export const player = new Player();
