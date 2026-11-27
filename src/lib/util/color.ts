// Extracts a dominant, slightly saturated colour from an image (for the
// Spotify-style gradient headers). Uses a tiny 24px canvas: cheap.
const cache = new Map<string, string>();

export function dominantColor(url: string | undefined): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
          const sat = max - min;
          const w = 1 + sat / 32; // favour saturated pixels
          if (max < 20) continue;
          r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
        }
        if (!n) return resolve(null);
        r /= n; g /= n; b /= n;
        // normalise brightness for a pleasant dark-UI gradient
        const m = Math.max(r, g, b) || 1;
        const k = Math.min(1.4, 170 / m);
        const col = `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
        cache.set(url, col);
        resolve(col);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export type RGB = [number, number, number];
const palettes = new Map<string, RGB[]>();

/**
 * The cover's main colours (most present first, distinct from each other),
 * brightened just enough to glow on a dark background. For the visualizer.
 */
export function palette(url: string | undefined, n = 4): Promise<RGB[] | null> {
  if (!url) return Promise.resolve(null);
  const hit = palettes.get(url);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const S = 32;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, S, S);
        const d = ctx.getImageData(0, 0, S, S).data;
        // 4 bits per channel buckets, weighted towards saturated pixels
        const buckets = new Map<number, { r: number; g: number; b: number; w: number }>();
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          if (max < 24) continue;
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const w = 1 + ((max - min) / 255) * 3;
          const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, w: 0 };
          e.r += r * w; e.g += g * w; e.b += b * w; e.w += w;
          buckets.set(key, e);
        }
        const ranked = [...buckets.values()].sort((a, b) => b.w - a.w).map((e) => [e.r / e.w, e.g / e.w, e.b / e.w] as RGB);
        const out: RGB[] = [];
        for (const col of ranked) {
          if (out.every((o) => Math.hypot(o[0] - col[0], o[1] - col[1], o[2] - col[2]) > 60)) out.push(col);
          if (out.length === n) break;
        }
        if (!out.length) return resolve(null);
        // too few distinct colours: lighter / darker shades of the first
        while (out.length < n) out.push(out[0].map((v) => v * (out.length % 2 ? 0.6 : 1.35)) as RGB);
        const glow = out.map((col) => {
          const m = Math.max(...col) || 1;
          const k = Math.min(2.2, Math.max(1, 200 / m));
          return col.map((v) => Math.min(255, Math.round(v * k))) as RGB;
        });
        palettes.set(url, glow);
        resolve(glow);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
