<script lang="ts">
  // Phone layout shared by the Spotify, Apple Music and Frutiger Aero themes:
  // page + floating mini player + tab bar, full-screen Now Playing, drawer.
  import MainView from '../components/MainView.svelte';
  import TabBar from './TabBar.svelte';
  import MiniBar from './MiniBar.svelte';
  import NowPlaying from './NowPlaying.svelte';
  import Drawer from './Drawer.svelte';
  import Icon from '../components/Icon.svelte';
  import { router } from '../stores/router.svelte';
  import { ui } from '../stores/ui.svelte';
  import { settings } from '../stores/settings.svelte';
  import { player } from '../player/player.svelte';
  import { isTabRoot } from './tabs';

  const root = $derived(isTabRoot(router.route.path, settings.theme));

  // iOS-style edge swipe to go back
  let sx = 0;
  let sy = 0;
  let dx = $state(0);
  let tracking = false;
  function start(e: TouchEvent) {
    const t = e.touches[0];
    tracking = t.clientX < 22 && router.canBack && !ui.nowPlayingOpen && !ui.menu;
    sx = t.clientX;
    sy = t.clientY;
    dx = 0;
  }
  function move(e: TouchEvent) {
    if (!tracking) return;
    const t = e.touches[0];
    if (Math.abs(t.clientY - sy) > 50 && dx < 30) {
      tracking = false;
      dx = 0;
      return;
    }
    dx = Math.max(0, t.clientX - sx);
  }
  function end() {
    if (tracking && dx > 90) router.back();
    tracking = false;
    dx = 0;
  }
</script>

<div class="m-app" class:has-player={!!player.current} data-root={root}>
  <div class="m-page" role="main" style={dx ? `transform:translateX(${dx}px);transition:none` : ''} ontouchstart={start} ontouchmove={move} ontouchend={end} ontouchcancel={end}>
    <MainView />
  </div>
  {#if !root && !ui.pageBar}
    <button class="m-back-float" aria-label="Back" onclick={() => router.back()}><Icon name="chevronLeft" size={22} /></button>
  {/if}
  <div class="m-bottom">
    {#if player.current}<MiniBar />{/if}
    <TabBar />
  </div>
  <Drawer />
  {#if ui.nowPlayingOpen}<NowPlaying />{/if}
</div>
