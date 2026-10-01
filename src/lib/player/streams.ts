// Resolves a playable audio (or muxed video) URL for a video id.
//
// Strategy (mirrors yt-dlp's 2026 client selection):
//   1. VISIONOS client      - direct URLs, needs neither PO token nor JS player
//   2. TV (downgraded)      - needs signature/n challenge solving (EJS solver)
//   3. WEB_EMBEDDED_PLAYER  - same, works for most embeddable content
//   (+ WEB_REMIX first for Premium accounts: no PO token required there)
// Resolved URLs are routed through the local Rust proxy which forwards
// Range requests with the right User-Agent.
import { innertube, type ClientSpec } from '../api/innertube';
import { http, call, isTauri } from '../api/transport';
import { nav } from '../api/parse';

export interface Stream {
  url: string;
  rawUrl: string;
  mime: string;
  itag: number;
  bitrate: number;
  client: string;
  expires: number;
  loudnessDb?: number;
  duration?: number;
  video: boolean;
}

interface ClientDef extends ClientSpec {
  key: string;
  host: string;
  needsJs: boolean;
  useCookies: boolean;
  embedded?: boolean;
}

const CLIENTS: Record<string, ClientDef> = {
  visionos: {
    key: 'visionos',
    host: 'https://www.youtube.com',
    clientName: 'VISIONOS',
    clientVersion: '1.02',
    clientNameId: 101,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    extra: { deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471' },
    needsJs: false,
    useCookies: false,
  },
  tv: {
    key: 'tv',
    host: 'https://www.youtube.com',
    clientName: 'TVHTML5',
    clientVersion: '5.20260707',
    clientNameId: 7,
    userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
    needsJs: true,
    useCookies: true,
  },
  web_embedded: {
    key: 'web_embedded',
    host: 'https://www.youtube.com',
    clientName: 'WEB_EMBEDDED_PLAYER',
    clientVersion: '2.20260708.00.00',
    clientNameId: 56,
    needsJs: true,
    useCookies: true,
    embedded: true,
  },
  web_music: {
    key: 'web_music',
    host: 'https://music.youtube.com',
    clientName: 'WEB_REMIX',
    clientVersion: '1.20260707.12.00',
    clientNameId: 67,
    needsJs: true,
    useCookies: true,
  },
};

export const streamPrefs = {
  quality: 'high' as 'high' | 'normal' | 'low',
  premium: false,
  loggedIn: false,
};

// --------------------------------------------------------------- proxy

let proxyBase: string | null = null;
async function proxied(url: string, ua?: string): Promise<string> {
  if (!isTauri) return url;
  proxyBase ??= await call<string>('stream_proxy_base');
  return `${proxyBase}&u=${encodeURIComponent(url)}${ua ? '&ua=' + encodeURIComponent(ua) : ''}`;
}

// --------------------------------------------------------------- player JS + solver

interface PlayerJs {
  url: string;
  code?: string;
  sts?: number;
  preprocessed?: string;
}
let playerJs: PlayerJs | null = null;
let playerJsAt = 0;

async function getPlayerJs(): Promise<PlayerJs> {
  if (playerJs && Date.now() - playerJsAt < 6 * 3600_000) return playerJs;
  const r = await http({ url: 'https://www.youtube.com/iframe_api', auth: false });
  const id = r.body.match(/player\\?\/([0-9a-fA-F]{8})\\?\//)?.[1];
  if (!id) throw new Error('Could not determine YouTube player version');
  const url = `https://www.youtube.com/s/player/${id}/player_ias.vflset/en_US/base.js`;
  if (playerJs?.url === url) {
    playerJsAt = Date.now();
    return playerJs;
  }
  const js = await http({ url, auth: false });
  const sts = js.body.match(/(?:signatureTimestamp|sts)\s*:\s*(\d{5})/)?.[1];
  playerJs = { url, code: js.body, sts: sts ? +sts : undefined };
  playerJsAt = Date.now();
  return playerJs;
}

const CORE_KEY = 'st.solverCore';
function customCore(): string | undefined {
  try {
    return localStorage.getItem(CORE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Fetch the latest challenge solver from yt-dlp/ejs releases. */
export async function updateSolver(): Promise<string> {
  const r = await http({ url: 'https://github.com/yt-dlp/ejs/releases/latest/download/yt.solver.core.js', auth: false });
  if (r.status !== 200 || !r.body.includes('preprocessPlayer')) throw new Error(`Download failed (HTTP ${r.status})`);
  localStorage.setItem(CORE_KEY, r.body);
  if (playerJs) playerJs.preprocessed = undefined;
  return r.body.match(/version[^\d]*(\d+\.\d+\.\d+)/i)?.[1] ?? 'latest';
}

let worker: Worker | null = null;
let workerTimer: ReturnType<typeof setTimeout> | undefined;
let reqId = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.output);
    };
  }
  clearTimeout(workerTimer);
  // free the solver's memory when idle
  workerTimer = setTimeout(() => {
    if (pending.size === 0) {
      worker?.terminate();
      worker = null;
    }
  }, 20_000);
  return worker;
}

async function solve(sigs: string[], ns: string[]): Promise<{ sig: Record<string, string>; n: Record<string, string> }> {
  const pj = await getPlayerJs();
  const requests = [] as { type: 'n' | 'sig'; challenges: string[] }[];
  if (sigs.length) requests.push({ type: 'sig', challenges: sigs });
  if (ns.length) requests.push({ type: 'n', challenges: ns });
  const input = pj.preprocessed
    ? { type: 'preprocessed', preprocessed_player: pj.preprocessed, requests }
    : { type: 'player', player: pj.code, requests, output_preprocessed: true };
  const id = ++reqId;
  const w = getWorker();
  const output: any = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, input, core: customCore() });
  });
  if (output.type === 'error') throw new Error(output.error);
  if (output.preprocessed_player) {
    pj.preprocessed = output.preprocessed_player;
    pj.code = undefined; // drop the 2-3MB raw player once preprocessed
  }
  const res = { sig: {} as Record<string, string>, n: {} as Record<string, string> };
  output.responses.forEach((r: any, i: number) => {
    if (r.type === 'error') throw new Error(r.error);
    Object.assign(requests[i].type === 'sig' ? res.sig : res.n, r.data);
  });
  return res;
}

// --------------------------------------------------------------- formats

interface RawFormat {
  itag: number;
  url?: string;
  signatureCipher?: string;
  cipher?: string;
  mimeType: string;
  bitrate: number;
  averageBitrate?: number;
  audioTrack?: { audioIsDefault?: boolean };
  xtags?: string;
  isDrc?: boolean;
  contentLength?: string;
  audioQuality?: string;
}

function pickFormat(formats: RawFormat[], video: boolean): RawFormat | undefined {
  if (video) {
    const muxed = formats.filter((f) => f.mimeType.startsWith('video/mp4') && f.mimeType.includes('mp4a'));
    return muxed.sort((a, b) => b.bitrate - a.bitrate)[0];
  }
  let audio = formats.filter((f) => f.mimeType.startsWith('audio/') && !f.isDrc && !(f.xtags ?? '').includes('drc'));
  const defaults = audio.filter((f) => !f.audioTrack || f.audioTrack.audioIsDefault);
  if (defaults.length) audio = defaults;
  if (!audio.length) return undefined;
  const rate = (f: RawFormat) => f.averageBitrate ?? f.bitrate;
  // prefer opus, then aac
  const pref = (f: RawFormat) => (f.mimeType.includes('opus') ? 1 : 0);
  if (streamPrefs.quality === 'low') return audio.sort((a, b) => rate(a) - rate(b))[0];
  if (streamPrefs.quality === 'normal') {
    const mid = audio.filter((f) => rate(f) <= 140_000);
    if (mid.length) return mid.sort((a, b) => pref(b) - pref(a) || rate(b) - rate(a))[0];
  }
  return audio.sort((a, b) => rate(b) - rate(a) || pref(b) - pref(a))[0];
}

class Unplayable extends Error {}

async function tryClient(c: ClientDef, videoId: string, video: boolean): Promise<Stream> {
  let sts: number | undefined;
  if (c.needsJs) sts = (await getPlayerJs()).sts;
  const contentPlaybackContext: any = { html5Preference: 'HTML5_PREF_WANTS' };
  if (sts) contentPlaybackContext.signatureTimestamp = sts;
  const body: any = {
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    playbackContext: { contentPlaybackContext },
  };
  const pr = await innertube('player', body, {
    host: c.host,
    client: c,
    auth: c.useCookies && streamPrefs.loggedIn,
    context: c.embedded ? { thirdParty: { embedUrl: 'https://www.google.com/' } } : undefined,
  });
  const status = nav(pr, 'playabilityStatus', 'status');
  if (status !== 'OK') {
    throw new Unplayable(nav(pr, 'playabilityStatus', 'reason') ?? status ?? 'Unplayable');
  }
  const sd = pr.streamingData ?? {};
  const formats: RawFormat[] = video ? [...(sd.formats ?? [])] : [...(sd.adaptiveFormats ?? [])];
  const f = pickFormat(formats, video);
  if (!f) throw new Unplayable(video ? 'No video stream' : 'No audio stream');

  let url = f.url;
  if (!url) {
    const cipher = f.signatureCipher ?? f.cipher;
    if (!cipher) throw new Unplayable('No stream URL');
    const q = new URLSearchParams(cipher);
    const s = q.get('s')!;
    const sp = q.get('sp') ?? 'signature';
    const solved = await solve([s], []);
    const u = new URL(q.get('url')!);
    u.searchParams.set(sp, solved.sig[s]);
    url = u.toString();
  }
  if (c.needsJs) {
    const u = new URL(url);
    const n = u.searchParams.get('n');
    if (n) {
      const solved = await solve([], [n]);
      if (solved.n[n]) u.searchParams.set('n', solved.n[n]);
      url = u.toString();
    }
  }
  const expire = +(new URL(url).searchParams.get('expire') ?? 0) * 1000 || Date.now() + 5 * 3600_000;
  return {
    url: await proxied(url, c.userAgent),
    rawUrl: url,
    mime: f.mimeType,
    itag: f.itag,
    bitrate: f.averageBitrate ?? f.bitrate,
    client: c.key,
    expires: expire,
    loudnessDb: nav(pr, 'playerConfig', 'audioConfig', 'loudnessDb'),
    duration: +(nav(pr, 'videoDetails', 'lengthSeconds') ?? 0) || undefined,
    video,
  };
}

const cache = new Map<string, Stream>();
const inflight = new Map<string, Promise<Stream>>();

function order(): ClientDef[] {
  const list = [CLIENTS.visionos, CLIENTS.tv, CLIENTS.web_embedded];
  if (streamPrefs.premium && streamPrefs.loggedIn) list.unshift(CLIENTS.web_music);
  return list;
}

export function invalidateStream(videoId: string) {
  cache.delete(videoId + ':a');
  cache.delete(videoId + ':v');
}

/**
 * @param skip clients known to have failed for this video (e.g. 403 on the media URL)
 */
export function resolveStream(videoId: string, video = false, skip: string[] = []): Promise<Stream> {
  const key = videoId + (video ? ':v' : ':a');
  const hit = cache.get(key);
  if (hit && hit.expires - Date.now() > 20 * 60_000 && !skip.includes(hit.client)) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running && !skip.length) return running;
  const p = (async () => {
    const errors: string[] = [];
    for (const c of order()) {
      if (skip.includes(c.key)) continue;
      try {
        const s = await tryClient(c, videoId, video);
        cache.set(key, s);
        if (cache.size > 60) cache.delete(cache.keys().next().value!);
        return s;
      } catch (e: any) {
        errors.push(`${c.key}: ${e?.message ?? e}`);
        // a definitive "unavailable" from the anonymous client may be lifted by signed-in clients, keep going
      }
    }
    throw new Error(errors[0]?.replace(/^\w+: /, '') || 'This track is unavailable');
  })();
  inflight.set(key, p);
  p.catch(() => {}).finally(() => inflight.delete(key));
  return p;
}
