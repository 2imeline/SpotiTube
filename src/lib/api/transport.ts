import { invoke } from '@tauri-apps/api/core';

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** attach Google session (default true) */
  auth?: boolean;
}

export interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function http(req: HttpRequest): Promise<HttpResponse> {
  if (isTauri) return invoke<HttpResponse>('http', { req });
  // browser preview fallback (no CORS bypass; only useful against mocks)
  const r = await fetch(req.url, { method: req.method ?? (req.body ? 'POST' : 'GET'), headers: req.headers, body: req.body });
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  return { status: r.status, body: await r.text(), headers };
}

export async function call<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error(`${cmd} requires the desktop app`);
  return invoke<T>(cmd, args);
}
