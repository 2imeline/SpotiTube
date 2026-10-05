// iPhone glue: native → web callbacks (remote controls, auto-advance,
// CarPlay lists) and web → native state sync (Now Playing buttons, status bar).
import { untrack } from 'svelte';
import { listen } from '@tauri-apps/api/event';
import { call } from '../api/transport';
import { player } from '../player/player.svelte';
import { library } from '../stores/library.svelte';
import { settings } from '../stores/settings.svelte';
import { auth } from '../stores/auth.svelte';
import { ui } from '../stores/ui.svelte';
import { carplay } from './carplay';
import { isAutotest } from './platform';

async function remote(a: { action: string; on?: boolean; mode?: 'off' | 'all' | 'one' }) {
  switch (a.action) {
    case 'next':
      await player.next();
      break;
    case 'previous':
      await player.previous();
      break;
    case 'play':
      await player.toggle();
      break;
    case 'shuffle':
      if (player.shuffle !== !!a.on) player.toggleShuffle();
      break;
    case 'repeat':
      if (a.mode) player.repeat = a.mode;
      break;
    case 'like':
      if (player.current) await library.toggleLike(player.current);
      break;
  }
  return true;
}

async function handle(name: string, args: any): Promise<unknown> {
  switch (name) {
    case 'ended':
      await player.onEnded();
      return true;
    case 'advanced':
      if ((window as any).__autotestNoAdvance) {
        call('autotest_log', { message: `page handled 'advanced' (qid ${args?.qid}, visibility ${document.visibilityState})` }).catch(() => {});
        return true;
      }
      await player.onNativeAdvanced(args?.qid ?? null);
      return true;
    case 'remote':
      return remote(args ?? {});
  }
  if (name.startsWith('cp.')) return carplay(name, args ?? {});
  return null;
}

/** light status bar text, except on light themes */
function darkStatusBar(): boolean {
  if (ui.nowPlayingOpen) return false;
  if (settings.theme === 'aero') return true;
  if (settings.theme !== 'apple') return false;
  if (settings.appleAppearance === 'light') return true;
  if (settings.appleAppearance === 'dark') return false;
  return !matchMedia('(prefers-color-scheme: dark)').matches;
}

export async function initIOS() {
  (window as any).__native = {
    handle,
    // native → page call: run `handle` and answer through the bridge
    call(id: number, name: string, argsJSON: string) {
      Promise.resolve()
        .then(() => handle(name, JSON.parse(argsJSON)))
        .then(
          (result) => call('__reply', { id, result: result ?? null }),
          (e) => call('__reply', { id, error: String(e?.message ?? e) }),
        )
        .catch(() => {});
    },
  };

  $effect.root(() => {
    // lock screen / CarPlay buttons
    $effect(() => {
      const c = player.current;
      const liked = c ? library.likeOf(c) === 'LIKE' : false;
      call('audio_controls', { shuffle: player.shuffle, repeat: player.repeat, liked, canLike: !!c && c.type !== 'episode' && auth.loggedIn }).catch(() => {});
    });
    // queue the upcoming song natively whenever it changes
    $effect(() => {
      void [player.upcoming?.qid, player.video, player.playing];
      if (player.playing) untrack(() => player.preloadNext());
    });
    $effect(() => {
      const dark = darkStatusBar();
      call('set_status_bar', { dark }).catch(() => {});
    });
    // CarPlay lists follow the account and library
    let t: ReturnType<typeof setTimeout>;
    $effect(() => {
      void [auth.version, library.playlists];
      clearTimeout(t);
      t = setTimeout(() => call('carplay_refresh', {}).catch(() => {}), 1500);
    });
  });

  listen('sleep-timer', () => {
    player.sleepAt = null;
  });
  listen<string>('app-state', (e) => {
    if (e.payload === 'background') player.save();
  });

  try {
    await call('native_ready');
    // the page may have been reloaded while native audio kept playing
    const st = await call<any>('audio_state');
    if (st?.src) player.adoptNative(st);
  } catch (e) {
    console.warn('native init', e);
  }
  if (isAutotest) import('./autotest').then((m) => m.runAutotest());
}

export function haptic(style: 'light' | 'medium' | 'heavy' | 'select' | 'success' = 'light') {
  call('haptic', { style }).catch(() => {});
}

export function share(text: string, url?: string) {
  call('share', { text, url }).catch(() => {});
}
