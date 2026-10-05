// Scripted walk-through used by CI in the iPhone simulator: plays a song,
// opens the main screens in every theme and saves screenshots + a log.
import { call } from '../api/transport';
import { search } from '../api/ytm';
import type { Track } from '../api/types';
import { player } from '../player/player.svelte';
import { go } from '../stores/router.svelte';
import { ui } from '../stores/ui.svelte';
import { settings, saveSettings, applySettings } from '../stores/settings.svelte';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(m: string) {
  console.log('[autotest]', m);
  call('autotest_log', { message: m }).catch(() => {});
}

async function shot(name: string) {
  await sleep(500);
  await call('autotest_shot', { name }).catch((e) => log(`shot ${name} failed: ${e}`));
}

async function waitFor(sel: string, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (document.querySelector(sel)) return true;
    await sleep(250);
  }
  log(`timeout waiting for ${sel}`);
  return false;
}

function state(tag: string) {
  log(`${tag}: playing=${player.playing} loading=${player.loading} time=${player.time.toFixed(1)}/${player.duration.toFixed(0)} index=${player.index}/${player.queue.length} title="${player.current?.title}" client=${player.stream?.client} itag=${player.stream?.itag} mime=${player.stream?.mime} error=${player.error}`);
}

async function theme(t: 'spotify' | 'apple' | 'aero', album?: string) {
  settings.theme = t;
  saveSettings();
  applySettings();
  go('/');
  await waitFor('.shelf', 20000);
  await sleep(2500);
  await shot(`${t}-1-home`);
  go('/search');
  await sleep(2500);
  await shot(`${t}-2-search`);
  go('/library');
  await sleep(1500);
  await shot(`${t}-3-library`);
  if (album) {
    go(`/album/${album}`);
    await waitFor('.track', 15000);
    await sleep(1500);
    await shot(`${t}-4-album`);
  }
  ui.nowPlayingOpen = true;
  await sleep(1500);
  await shot(`${t}-5-nowplaying`);
  ui.npPane = 'lyrics';
  await sleep(2500);
  await shot(`${t}-6-lyrics`);
  ui.npPane = 'queue';
  await sleep(1200);
  await shot(`${t}-7-queue`);
  ui.npPane = 'none';
  ui.nowPlayingOpen = false;
  await sleep(600);
}

export async function runAutotest() {
  try {
    log(`start ${navigator.userAgent}`);
    await waitFor('.shelf', 30000);
    await sleep(2000);
    await shot('00-start');

    const r = await search('daft punk get lucky', 'songs');
    const t = r.list?.items.find((i): i is Track => i.kind === 'track');
    log(`search returned ${r.list?.items.length ?? 0} items, first: ${t?.title} (${t?.videoId})`);
    if (t) {
      await player.playTrack(t, { title: 'Autotest' });
      await sleep(9000);
      state('after 9s');
      await sleep(5000);
      state('after 14s');
      // natural end of song → native queue should continue to the next one
      if (player.duration > 30) {
        player.seek(player.duration - 5);
        await sleep(12000);
        state('after end of song');
      }
      await player.next();
      await sleep(7000);
      state('after next');
    }
    const album = player.current?.album?.id ?? undefined;
    go(`/search?q=${encodeURIComponent('daft punk')}`);
    await waitFor('.track, .top-result', 15000);
    await sleep(2000);
    await shot('01-search-results');
    if (player.current?.artists.find((a) => a.id)?.id) {
      go(`/artist/${player.current!.artists.find((a) => a.id)!.id}`);
      await waitFor('.track', 15000);
      await sleep(2000);
      await shot('02-artist');
    }
    go('/settings');
    await sleep(1500);
    await shot('03-settings');
    for (const th of ['spotify', 'apple', 'aero'] as const) await theme(th, album);
    settings.theme = 'spotify';
    saveSettings();
    applySettings();
    go('/');
    state('final');
  } catch (e: any) {
    log(`autotest error: ${e?.message ?? e}\n${e?.stack ?? ''}`);
  }
  await call('autotest_done').catch(() => {});

  // background test: CI sends the app to the background while a song ends,
  // the native queue + web callbacks must carry on to the following songs
  try {
    if (player.current && player.duration > 30) {
      if (!player.playing) await player.toggle();
      await sleep(3000);
      player.seek(Math.max(0, player.duration - 25));
      await sleep(1500);
      state('before background');
      await call('autotest_bg');
    }
  } catch (e: any) {
    log(`background test error: ${e?.message ?? e}`);
  }
}
