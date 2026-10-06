// Playback engine: queue management, streaming, media session, history.
import { listen } from '@tauri-apps/api/event';
import type { Paged, Track } from '../api/types';
import { addHistoryItem, getPlayerInfo, getWatchQueue, type WatchOptions } from '../api/ytm';
import { call, isTauri } from '../api/transport';
import { invalidateStream, resolveStream, type Stream } from './streams';
import { auth } from '../stores/auth.svelte';
import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';
import { bestThumb } from '../util/thumbs';
import { needsMatch, resolveTrack } from '../api/match';
import { isIOS } from '../native/platform';
import { NativeMedia, type NativeMeta } from '../native/media';

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
  /** bumps on every user seek (for Discord timestamps) */
  seekCount = $state(0);

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
  private sourceToken = 0;
  private sleepTimer?: ReturnType<typeof setTimeout>;
  private prefetched = '';
  private stallTimer?: ReturnType<typeof setTimeout>;
  private stalled = false;
  /** iOS: native AVPlayer engine (null on desktop) */
  native: NativeMedia | null = null;
  private preloaded: { qid: number; stream: Stream } | null = null;
  private preloadToken = 0;

  init() {
    let v: HTMLVideoElement;
    if (isIOS) {
      // playback, background audio, lock screen and CarPlay are native on iPhone
      this.native = new NativeMedia();
      v = this.native as unknown as HTMLVideoElement;
    } else {
      v = document.createElement('video');
      v.preload = 'auto';
      v.playsInline = true;
      v.className = 'media-el';
      v.disablePictureInPicture = false;
      const host = document.createElement('div');
      host.id = 'media-host';
      host.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;overflow:hidden;opacity:0;pointer-events:none';
      host.appendChild(v);
      document.body.appendChild(host);
    }
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
      this.stalled = false;
      clearTimeout(this.stallTimer);
      this.retries = 0;
      this.consecutiveFails = 0;
      this.registerPlay();
      this.preloadNext();
    });
    v.addEventListener('pause', () => {
      this.playing = false;
      this.loading = false;
      clearTimeout(this.stallTimer);
      this.save();
    });
    v.addEventListener('waiting', () => {
      this.loading = true;
      // stuck buffering (dropped connection, expired link): reload with a fresh stream
      clearTimeout(this.stallTimer);
      this.stallTimer = setTimeout(() => this.loading && !this.el.paused && this.onStall('buffering'), 12_000);
    });
    v.addEventListener('canplay', () => {
      this.loading = false;
      clearTimeout(this.stallTimer);
    });
    v.addEventListener('progress', () => {
      const b = v.buffered;
      if (b.length) this.buffered = b.end(b.length - 1);
    });
    v.addEventListener('ended', () => this.onEnded());
    v.addEventListener('error', () => this.onMediaError());

    this.restore();
    if (this.native) this.volume = 1; // the phone's volume buttons control loudness
    else this.setupMediaSession();
    if (isTauri) {
      listen<string>('media-key', (e) => {
        if (e.payload === 'playpause') this.toggle();
        else if (e.payload === 'next') this.next();
        else if (e.payload === 'previous') this.previous();
        else if (e.payload === 'stop') this.pause();
      });
    }
    // silent stop: "playing" but the position doesn't move
    let lastT = -1;
    let still = 0;
    setInterval(() => {
      if (!this.playing || this.loading || this.el.paused || !this.el.src || document.hidden) {
        still = 0;
        lastT = -1;
        return;
      }
      const t = this.native ? this.native.reportedTime : this.el.currentTime;
      still = Math.abs(t - lastT) < 0.05 ? still + 1 : 0;
      lastT = t;
      if (still >= 4) {
        still = 0;
        this.onStall('stopped');
      }
    }, 4000);
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
    this.preloaded = null;
    this.preloadToken++;
    this.time = startAt;
    this.duration = t.durationSec ?? 0;
    this.buffered = 0;
    this.gain = 1;
    this.registered = '';
    if (this.tabs?.videoId !== t.videoId) this.tabs = null;
    this.updateMetadata();
    if (this.queue.length - index <= 3) this.extend();
    try {
      // tracks from Spotify: find the YouTube Music song first
      if (needsMatch(t)) {
        const ok = await resolveTrack(t);
        if (token !== this.loadToken) return;
        if (!ok) throw new Error('not found on YouTube Music');
        this.failedFor = t.videoId;
      }
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
      if (this.native) {
        this.native.video = s.video;
        this.native.meta = this.nativeMeta(t, s);
      }
      this.el.src = s.url;
      if (autoplay) {
        await this.el.play().catch((e) => {
          // source load failures are handled by the media 'error' event (client fallback)
          if (e?.name !== 'AbortError' && e?.name !== 'NotSupportedError') throw e;
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

  /** reload the current song where it stopped, with a freshly resolved stream */
  private onStall(why: string) {
    const t = this.current;
    if (!t || !this.el.src) return;
    console.warn('playback stalled:', why);
    clearTimeout(this.stallTimer);
    if (this.retries >= 3) {
      // repeated stalls: stop cleanly so the play button works again
      this.retries = 0;
      this.stalled = true;
      this.loading = false;
      this.el.pause();
      this.playing = false;
      ui.toast(`Playback of "${t.title}" stalled. Tap play to retry.`, 'error');
      return;
    }
    this.retries++;
    invalidateStream(t.videoId);
    if (t.counterpart) invalidateStream(t.counterpart.videoId);
    this.load(this.index, true, this.el.currentTime || this.time);
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
      if (t.counterpart) invalidateStream(t.counterpart.videoId);
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

  /** returns once the next song is loading (the iOS engine waits for it) */
  onEnded(): Promise<unknown> {
    if (this.sleepEndOfTrack) {
      this.sleepEndOfTrack = false;
      this.playing = false;
      return Promise.resolve();
    }
    if (this.repeat === 'one') {
      this.el.currentTime = 0;
      return this.el.play().catch(() => {});
    }
    return this.next(true);
  }

  // ------------------------------------------------------------ iOS native engine

  private nativeMeta(t: Track, s?: Stream): NativeMeta {
    return {
      title: t.title,
      artist: t.artists.map((a) => a.name).join(', '),
      album: t.album?.name ?? '',
      artwork: bestThumb(t.thumbnails, 544),
      duration: t.durationSec ?? s?.duration,
      qid: t.qid,
      videoId: t.videoId,
      mime: s?.mime,
    };
  }

  /** what plays after the current song, honouring repeat / sleep timer */
  get upcoming(): Track | null {
    if (this.repeat === 'one' || this.sleepEndOfTrack) return null;
    if (this.index < this.queue.length - 1) return this.queue[this.index + 1];
    if (this.repeat === 'all' && this.queue.length > 1) return this.queue[0];
    return null;
  }

  /** hand the next song to AVQueuePlayer so it starts on time with the phone locked */
  async preloadNext() {
    if (!this.native || !this.current) return;
    const tok = ++this.preloadToken;
    const nxt = this.upcoming;
    if (!nxt) {
      if (this.preloaded) {
        this.preloaded = null;
        this.native.preloadNext(null);
      }
      return;
    }
    if (this.preloaded?.qid === nxt.qid) return;
    try {
      if (needsMatch(nxt) && !(await resolveTrack(nxt))) return;
      const s = await resolveStream(nxt.videoId, this.video);
      if (tok !== this.preloadToken || this.upcoming?.qid !== nxt.qid) return;
      this.preloaded = { qid: nxt.qid!, stream: s };
      this.native.preloadNext(s.url, this.nativeMeta(nxt, s));
    } catch (e) {
      console.warn('preload next', e);
    }
  }

  /** AVQueuePlayer moved on to the preloaded song by itself */
  async onNativeAdvanced(qid: number | null) {
    const p = this.preloaded;
    this.preloaded = null;
    this.preloadToken++;
    const i = qid == null ? -1 : this.queue.findIndex((t) => t.qid === qid);
    if (i < 0 || !p || p.qid !== qid) return this.next(true);
    const t = this.queue[i];
    this.loadToken++;
    this.index = i;
    this.failed = [];
    this.retries = 0;
    this.failedFor = t.videoId;
    this.consecutiveFails = 0;
    this.stream = p.stream;
    this.time = 0;
    this.duration = t.durationSec ?? p.stream.duration ?? 0;
    this.buffered = 0;
    this.registered = '';
    this.loading = false;
    this.playing = true;
    this.gain = settings.normalize && p.stream.loudnessDb != null && p.stream.loudnessDb > 0 ? Math.pow(10, -p.stream.loudnessDb / 20) : 1;
    this.applyVolume();
    if (this.tabs?.videoId !== t.videoId) this.tabs = null;
    this.native?.adopt(p.stream.url, this.nativeMeta(t, p.stream));
    this.updateMetadata();
    if (this.queue.length - i <= 3) await this.extend();
    await this.registerPlay();
    await this.preloadNext();
    this.save();
  }

  /** after the page was reloaded while native audio kept playing */
  adoptNative(st: { src: string; time: number; duration: number; playing: boolean; videoId?: string }) {
    if (!this.native || !st.src) return;
    const i = this.queue.findIndex((t) => t.videoId === st.videoId);
    if (i < 0) return;
    this.index = i;
    this.native.adopt(st.src, this.nativeMeta(this.queue[i]));
    this.time = st.time;
    if (st.duration) this.duration = st.duration;
    this.playing = st.playing;
    this.loading = false;
    this.updateMetadata();
    if (st.playing) this.preloadNext();
  }

  private onProgress() {
    const d = this.duration || this.el.duration;
    if (!d) return;
    // prefetch next stream URL so the transition is instant
    if (this.time > d * 0.5 || d - this.time < 30) {
      const nxt = this.queue[this.index + 1];
      if (nxt && this.prefetched !== nxt.videoId) {
        this.prefetched = nxt.videoId;
        (needsMatch(nxt) ? resolveTrack(nxt) : Promise.resolve(true))
          .then((ok): unknown => ok && resolveStream(nxt.videoId, this.video))
          .catch(() => {});
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
      if (needsMatch(last) && !(await resolveTrack(last).catch(() => false))) return false;
      // seed autoplay from the whole playlist (more varied) when possible, else from the last song
      const pl = this.source?.path?.match(/^\/playlist\/([^/?]+)/)?.[1];
      const r = pl && pl !== 'LM' && pl !== 'SE'
        ? await getWatchQueue({ playlistId: 'RDAMPL' + pl, radio: true }).catch(() => getWatchQueue({ videoId: last.videoId, radio: true }))
        : await getWatchQueue({ videoId: last.videoId, radio: true });
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
  /**
   * Play a fixed list (album, playlist, liked songs...).
   * `more` loads the rest of a long list in the background, so shuffle covers
   * the *whole* playlist instead of the first page.
   */
  playTracks(tracks: Track[], start = 0, source?: QueueSource, opts: { shuffle?: boolean; more?: () => Promise<Paged<Track>> } = {}) {
    const list = tracks.filter((t) => t.videoId && t.isAvailable !== false);
    if (!list.length) return;
    const token = ++this.sourceToken;
    const startTrack = tracks[start];
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
    const loading = this.load(startIdx);
    if (opts.more) this.loadRest(opts.more, token);
    return loading;
  }

  /** Background-load the remaining pages of the current source list. */
  private async loadRest(more: () => Promise<Paged<Track>>, token: number) {
    let next: (() => Promise<Paged<Track>>) | undefined = more;
    let total = this.queue.length;
    while (next && token === this.sourceToken && total < 5000) {
      try {
        const page: Paged<Track> = await next();
        if (token !== this.sourceToken) return;
        next = page.continuation;
        const add = page.items.filter((t) => t.videoId && t.isAvailable !== false).map(tag);
        total += add.length;
        if (add.length) this.appendSource(add);
      } catch {
        return;
      }
    }
  }

  /** Add tracks that belong to the current source (keeps shuffle order random). */
  private appendSource(add: Track[]) {
    if (this.unshuffled) this.unshuffled = [...this.unshuffled, ...add];
    if (!this.shuffle) {
      this.queue = [...this.queue, ...add];
      return;
    }
    const q = [...this.queue];
    for (const t of add) {
      const lo = this.index + 1;
      const pos = lo + Math.floor(Math.random() * (q.length - lo + 1));
      q.splice(pos, 0, t);
    }
    this.queue = q;
  }

  /** Start a watch playlist (radio, mix, playlist by id) like YouTube Music does. */
  async playWatch(o: WatchOptions, source?: QueueSource) {
    this.sourceToken++;
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
      await this.load(idx);
    } catch (e) {
      this.loading = false;
      ui.error(e);
    }
  }

  /** Play a single song: starts instantly, then fills "up next" with its radio. */
  async playTrack(t: Track, source?: QueueSource) {
    this.sourceToken++;
    this.queue = [tag(t)];
    this.unshuffled = null;
    this.shuffle = false;
    this.cont = undefined;
    this.source = source ?? { title: t.title };
    this.failed = [];
    const loading = this.load(0);
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
    await loading;
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
      return this.load(i);
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
    const curQid = this.current?.qid;
    this.queue = q;
    this.index = Math.max(0, q.findIndex((t) => t.qid === curQid));
  }

  clearUpcoming() {
    this.queue = this.queue.slice(0, this.index + 1);
    this.cont = undefined;
  }

  toggle() {
    if (!this.current) return;
    if (!this.el.src || this.error || (this.stalled && this.el.paused)) {
      this.stalled = false;
      return this.load(this.index, true, this.el.currentTime || this.time);
    }
    if (this.el.paused) this.el.play().catch((e) => e?.name !== 'AbortError' && this.onMediaError());
    else {
      // pausing while stuck buffering: stop for real and reload on the next play
      if (this.loading) this.stalled = true;
      this.el.pause();
      this.playing = false;
      this.loading = false;
    }
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
    return this.load(this.index - 1);
  }

  seek(t: number) {
    if (!this.el.src) {
      this.time = t;
      return;
    }
    this.el.currentTime = Math.max(0, t);
    this.time = this.el.currentTime;
    this.seekCount++;
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
        const curQid = this.current?.qid;
        const present = new Set(this.queue.map((t) => t.qid));
        const restored = this.unshuffled.filter((t) => present.has(t.qid));
        const restoredIds = new Set(restored.map((t) => t.qid));
        const extra = this.queue.filter((t) => !restoredIds.has(t.qid));
        this.queue = [...restored, ...extra];
        this.index = Math.max(0, this.queue.findIndex((t) => t.qid === curQid));
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
    // the native timer also fires while the page is asleep
    if (this.native) call('audio_sleep', typeof minutes === 'number' ? { at: Date.now() + minutes * 60_000 } : {}).catch(() => {});
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
