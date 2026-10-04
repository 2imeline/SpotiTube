import { apiConfig, clearApiCache } from '../api/innertube';
import { streamPrefs } from '../player/streams';
import { call, isTauri } from '../api/transport';

export type Theme = 'spotify' | 'aero' | 'apple';

export interface Settings {
  theme: Theme;
  accent: string;
  quality: 'high' | 'normal' | 'low';
  normalize: boolean;
  premium: boolean;
  hl: string;
  gl: string;
  mediaKeys: boolean;
  autoplay: boolean;
  lrclib: boolean;
  crossfade: number;
  zoom: number;
  reduceMotion: boolean;
  explicit: boolean;
  closeToMini: boolean;
  aeroWallpaper: 'aurora' | 'sky' | 'bubbles';
  autoUpdate: boolean;
  appleAppearance: 'auto' | 'light' | 'dark';
  discord: boolean;
  discordShow: 'app' | 'artist' | 'title';
  discordWhenPaused: boolean;
  discordButton: boolean;
  discordClientId: string;
}

const DEFAULTS: Settings = {
  theme: 'spotify',
  accent: '#1ed760',
  quality: 'high',
  normalize: true,
  premium: false,
  hl: 'en',
  gl: 'US',
  mediaKeys: true,
  autoplay: true,
  lrclib: true,
  crossfade: 0,
  zoom: 1,
  reduceMotion: false,
  explicit: true,
  closeToMini: false,
  aeroWallpaper: 'aurora',
  autoUpdate: true,
  appleAppearance: 'auto',
  discord: true,
  discordShow: 'app',
  discordWhenPaused: false,
  discordButton: true,
  discordClientId: '',
};

const KEY = 'st.settings';

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = $state(load());

// ---- color helpers
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
export function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}
export function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}
export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}
function shade(hex: string, amt: number) {
  const [r, g, b] = hexToRgb(hex);
  const t = amt > 0 ? 255 : 0;
  const p = Math.abs(amt);
  return rgbToHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
}
function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((x) => {
    x /= 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  const sysDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  root.classList.toggle('apple-dark', settings.theme === 'apple' && (settings.appleAppearance === 'dark' || (settings.appleAppearance === 'auto' && sysDark)));
  const a = settings.accent;
  const [r, g, b] = hexToRgb(a);
  root.style.setProperty('--accent', a);
  root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  root.style.setProperty('--accent-hover', shade(a, 0.18));
  root.style.setProperty('--accent-dark', shade(a, -0.35));
  root.style.setProperty('--accent-deep', shade(a, -0.7));
  root.style.setProperty('--on-accent', luminance(a) > 0.36 ? '#000000' : '#ffffff');
  root.style.zoom = String(settings.zoom);
  root.classList.toggle('reduce-motion', settings.reduceMotion);
  apiConfig.hl = settings.hl;
  apiConfig.gl = settings.gl;
  streamPrefs.quality = settings.quality;
  streamPrefs.premium = settings.premium;
}

let lastLang = settings.hl + settings.gl;
let lastKeys: boolean | null = null;
export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
  applySettings();
  if (lastLang !== settings.hl + settings.gl) {
    lastLang = settings.hl + settings.gl;
    clearApiCache();
  }
  if (isTauri && lastKeys !== settings.mediaKeys) {
    lastKeys = settings.mediaKeys;
    call('set_media_keys', { enabled: settings.mediaKeys }).catch(() => {});
  }
}

export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  saveSettings();
}

export const ACCENT_PRESETS = ['#1ed760', '#e22134', '#ff4632', '#ff7a00', '#ffd200', '#1db9ff', '#3d7bff', '#8a5cff', '#ff4fc3', '#00e0c6', '#ffffff'];
