import { http } from './transport';

export const YTM = 'https://music.youtube.com';

export const apiConfig = {
  hl: 'en',
  gl: 'US',
  onBehalfOfUser: undefined as string | undefined,
};

export class ApiError extends Error {
  status: number;
  constructor(msg: string, status = 0) {
    super(msg);
    this.status = status;
  }
}

const VISITOR_KEY = 'st.visitorData';
let visitorData: string | null = safeGet(VISITOR_KEY);
let visitorPromise: Promise<void> | null = null;

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

export function getVisitorData(): string | null {
  return visitorData;
}

function setVisitor(v: string) {
  visitorData = v;
  try {
    localStorage.setItem(VISITOR_KEY, v);
  } catch {}
}

export function webRemixVersion(): string {
  const d = new Date(Date.now() - 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `1.${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.01.00`;
}

async function ensureVisitor(): Promise<void> {
  if (visitorData) return;
  visitorPromise ??= (async () => {
    try {
      const r = await http({ url: YTM + '/', auth: false });
      const m = r.body.match(/"VISITOR_DATA"\s*:\s*"([^"]+)"/);
      if (m) setVisitor(m[1]);
    } catch {
      /* ignore */
    }
  })();
  await visitorPromise;
}

export interface ClientSpec {
  clientName: string;
  clientVersion: string;
  clientNameId?: number;
  userAgent?: string;
  extra?: Record<string, unknown>;
}

export const WEB_REMIX: ClientSpec = { clientName: 'WEB_REMIX', clientVersion: webRemixVersion(), clientNameId: 67 };

interface CacheEntry {
  at: number;
  data: any;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 3 * 60 * 1000;
const CACHE_MAX = 40;

export function clearApiCache() {
  cache.clear();
}

export interface InnertubeOptions {
  host?: string;
  client?: ClientSpec;
  query?: string;
  auth?: boolean;
  cache?: boolean;
  /** extra top-level context fields */
  context?: Record<string, unknown>;
}

export async function innertube(endpoint: string, body: Record<string, any> = {}, opts: InnertubeOptions = {}): Promise<any> {
  const host = opts.host ?? YTM;
  const client = opts.client ?? WEB_REMIX;
  await ensureVisitor();
  const key = opts.cache ? endpoint + '|' + (opts.query ?? '') + '|' + JSON.stringify(body) + '|' + apiConfig.onBehalfOfUser : '';
  if (key) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;
  }
  const context: any = {
    client: {
      clientName: client.clientName,
      clientVersion: client.clientVersion,
      hl: apiConfig.hl,
      gl: apiConfig.gl,
      ...(visitorData ? { visitorData } : {}),
      ...(client.userAgent ? { userAgent: client.userAgent } : {}),
      ...(client.extra ?? {}),
    },
    user: apiConfig.onBehalfOfUser && client.clientName === 'WEB_REMIX' ? { onBehalfOfUser: apiConfig.onBehalfOfUser } : {},
    ...(opts.context ?? {}),
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: '*/*',
    Origin: host,
    Referer: host + '/',
    'X-YouTube-Client-Name': String(client.clientNameId ?? 67),
    'X-YouTube-Client-Version': client.clientVersion,
  };
  if (client.userAgent) headers['User-Agent'] = client.userAgent;
  if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;

  const res = await http({
    url: `${host}/youtubei/v1/${endpoint}?prettyPrint=false${opts.query ?? ''}`,
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, context }),
    auth: opts.auth ?? true,
  });
  let json: any;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new ApiError(`Unexpected response (HTTP ${res.status})`, res.status);
  }
  if (res.status >= 400) {
    throw new ApiError(json?.error?.message ?? `HTTP ${res.status}`, res.status);
  }
  const vd = json?.responseContext?.visitorData;
  if (vd && !visitorData) setVisitor(vd);
  if (key) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), data: json });
  }
  return json;
}

/** WEB_REMIX request to music.youtube.com */
export function ytm(endpoint: string, body: Record<string, any> = {}, query = '', useCache = false): Promise<any> {
  return innertube(endpoint, body, { query, cache: useCache });
}

/** Mutating request: also invalidates the browse cache. */
export async function ytmWrite(endpoint: string, body: Record<string, any> = {}): Promise<any> {
  const r = await innertube(endpoint, body);
  clearApiCache();
  return r;
}
