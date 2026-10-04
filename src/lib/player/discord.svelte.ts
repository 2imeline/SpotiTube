// Discord Rich Presence ("Listening to …" with progress bar, artwork and a
// "Play on YouTube Music" button). The Rust side owns the IPC connection.
import { call, isTauri } from '../api/transport';
import { player } from './player.svelte';
import { settings } from '../stores/settings.svelte';
import { bestThumb } from '../util/thumbs';

const SHOW = { app: 0, artist: 1, title: 2 } as const;

/** Discord requires 2..128 characters */
function fit(s: string | undefined, fallback: string): string {
  let v = (s ?? '').trim() || fallback;
  if (v.length < 2) v = v + ' ​';
  return v.length > 128 ? v.slice(0, 127) + '…' : v;
}

function activity(): Record<string, unknown> | null {
  const t = player.current;
  if (!t) return null;
  if (!player.playing && !settings.discordWhenPaused) return null;
  const artists = t.artists.map((a) => a.name).join(', ');
  let art = bestThumb(t.thumbnails, 512);
  if (art && art.length > 256) art = art.replace(/=w\d+-h\d+.*$/, '=w512-h512');
  const a: Record<string, any> = {
    type: 2, // Listening
    status_display_type: SHOW[settings.discordShow] ?? 0,
    details: fit(t.title, 'Unknown song'),
    state: fit(artists, t.type === 'episode' ? 'Podcast' : 'Unknown artist'),
    assets: {
      ...(art && art.length <= 256 ? { large_image: art } : {}),
      large_text: fit(player.playing ? t.album?.name ?? t.title : 'Paused', 'SpotiTube'),
    },
  };
  const dur = player.duration || t.durationSec || 0;
  if (player.playing && dur > 0) {
    const start = Date.now() - player.time * 1000;
    a.timestamps = { start: Math.round(start), end: Math.round(start + dur * 1000) };
  }
  if (settings.discordButton && t.videoId) {
    a.buttons = [{ label: 'Play on YouTube Music', url: `https://music.youtube.com/watch?v=${t.videoId}` }];
  }
  return a;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let last = '';

function push() {
  clearTimeout(timer);
  // debounce bursts (track change + play + metadata) into one update
  timer = setTimeout(() => {
    const a = settings.discord ? activity() : null;
    const key = JSON.stringify(a && { ...a, timestamps: undefined }) + (a?.timestamps ? Math.round((a.timestamps as any).start / 3000) : '');
    if (key === last) return;
    last = key;
    call('discord_set_activity', { activity: a }).catch(() => {});
  }, 700);
}

export function initDiscord() {
  if (!isTauri) return;
  $effect.root(() => {
    $effect(() => {
      call('discord_configure', { enabled: settings.discord, clientId: settings.discordClientId || null }).catch(() => {});
      last = '';
      push();
    });
    $effect(() => {
      // re-publish on anything that changes what Discord should show
      player.current?.qid;
      player.playing;
      player.seekCount;
      Math.round(player.duration);
      settings.discordShow;
      settings.discordWhenPaused;
      settings.discordButton;
      push();
    });
  });
}
