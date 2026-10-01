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
