import type { Thumb } from '../api/types';

/** Pick (and if possible resize) a thumbnail URL for a given pixel size. */
export function bestThumb(thumbs: Thumb[] | undefined, size = 226): string | undefined {
  if (!thumbs?.length) return undefined;
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const want = Math.round(size * dpr);
  const sorted = [...thumbs].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const pick = sorted.find((t) => (t.width ?? 0) >= want) ?? sorted[sorted.length - 1];
  let url = pick.url;
  if (url.startsWith('//')) url = 'https:' + url;
  if (/googleusercontent\.com|ggpht\.com/.test(url)) {
    if (/=w\d+-h\d+/.test(url)) {
      const w = pick.width ?? want, h = pick.height ?? want;
      const ratio = w && h ? h / w : 1;
      url = url.replace(/=w\d+-h\d+/, `=w${want}-h${Math.round(want * ratio)}`);
    } else if (/=s\d+/.test(url)) url = url.replace(/=s\d+/, `=s${want}`);
  }
  return url;
}

export function artistNames(a: { name: string }[] | undefined): string {
  return (a ?? []).map((x) => x.name).join(', ');
}
