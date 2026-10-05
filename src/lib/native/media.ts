// HTMLMediaElement look-alike backed by the native AVPlayer engine (iOS).
// The web player keeps its logic; playback, background audio, lock screen
// and CarPlay are native.
import { call } from '../api/transport';

export interface NativeMeta {
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  duration?: number;
  qid?: number;
  videoId?: string;
  mime?: string;
}

export class NativeMedia extends EventTarget {
  meta: NativeMeta = { title: '', artist: '' };
  /** play the muxed video stream (shown by the native video layer) */
  video = false;
  error: { message: string } | null = null;
  // inert HTMLMediaElement properties the player sets
  preload = 'auto';
  playsInline = true;
  className = '';
  disablePictureInPicture = false;
  readonly parentElement = null;

  private _src = '';
  private _time = 0;
  private _at = 0;
  private _duration = NaN;
  private _paused = true;
  private _rate = 1;
  private _volume = 1;
  private _buffered = 0;

  constructor() {
    super();
    (window as any).__nativeAudio = (type: string, data: any) => this.onNative(type, data ?? {});
  }

  private send(cmd: string, args: Record<string, unknown> = {}) {
    return call(cmd, args).catch((e) => console.warn(cmd, e));
  }

  get src() {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    this._time = 0;
    this._at = performance.now();
    this._duration = NaN;
    this._buffered = 0;
    this._paused = true;
    this.error = null;
    this.send('audio_load', { src: v, meta: this.meta, video: this.video });
  }
  removeAttribute(name: string) {
    if (name === 'src') {
      this._src = '';
      this.send('audio_stop');
    }
  }

  get currentTime() {
    if (this._paused || !this._src) return this._time;
    const t = this._time + ((performance.now() - this._at) / 1000) * this._rate;
    return isFinite(this._duration) ? Math.min(t, this._duration) : t;
  }
  set currentTime(t: number) {
    this._time = Math.max(0, t);
    this._at = performance.now();
    this.send('audio_seek', { time: this._time });
  }
  get duration() {
    return this._duration;
  }
  get paused() {
    return this._paused;
  }
  get ended() {
    return isFinite(this._duration) && this._time >= this._duration - 0.3;
  }
  get buffered() {
    const b = this._buffered;
    return { length: b > 0 ? 1 : 0, start: () => 0, end: () => b } as unknown as TimeRanges;
  }
  get volume() {
    return this._volume;
  }
  set volume(v: number) {
    this._volume = v;
    this.send('audio_volume', { volume: v });
  }
  get playbackRate() {
    return this._rate;
  }
  set playbackRate(r: number) {
    this._rate = r;
    this.send('audio_rate', { rate: r });
  }

  play(): Promise<void> {
    this._paused = false;
    this._at = performance.now();
    return call('audio_play').then(() => undefined);
  }
  pause() {
    this._time = this.currentTime;
    this._paused = true;
    this.send('audio_pause');
  }
  load() {}

  /** queue the next song natively so it starts even if the page is asleep */
  preloadNext(src: string | null, meta?: NativeMeta) {
    this.send('audio_preload', src ? { src, meta } : {});
  }
  /** keep the native item in sync after the player swapped to the preloaded one */
  adopt(src: string, meta: NativeMeta) {
    this._src = src;
    this.meta = meta;
    this._time = 0;
    this._at = performance.now();
    this._duration = meta.duration ?? NaN;
  }
  updateMeta(meta: Partial<NativeMeta>) {
    this.meta = { ...this.meta, ...meta };
    this.send('audio_meta', { meta });
  }

  private onNative(type: string, d: any) {
    switch (type) {
      case 'timeupdate':
        this._time = d.time ?? this._time;
        this._at = performance.now();
        if (d.duration > 0) this._duration = d.duration;
        break;
      case 'durationchange':
      case 'loadedmetadata':
        if (d.duration > 0) this._duration = d.duration;
        break;
      case 'play':
      case 'playing':
        this._paused = false;
        this._at = performance.now();
        break;
      case 'pause':
        if (typeof d.time === 'number') this._time = d.time;
        this._paused = true;
        break;
      case 'progress':
        this._buffered = d.buffered ?? 0;
        break;
      case 'error':
        this.error = { message: d.message ?? 'Playback failed' };
        this._paused = true;
        break;
    }
    this.dispatchEvent(new Event(type));
  }
}
