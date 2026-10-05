<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Img from '../components/Img.svelte';
  import { player } from '../player/player.svelte';
  import { library } from '../stores/library.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import { artistNames, bestThumb } from '../util/thumbs';
  import { dominantColor } from '../util/color';
  import { haptic } from '../native/ios.svelte';
  import { call } from '../api/transport';

  const t = $derived(player.current!);
  const liked = $derived(t ? library.likeOf(t) === 'LIKE' : false);
  const pct = $derived(player.duration ? Math.min(100, (player.time / player.duration) * 100) : 0);
  let color = $state<string | null>(null);
  $effect(() => {
    dominantColor(bestThumb(t?.thumbnails, 60)).then((c) => (color = c));
  });

  // swipe left/right to change songs (Spotify)
  let sx = 0;
  let dx = $state(0);
  let swiping = false;
  function ts(e: TouchEvent) {
    sx = e.touches[0].clientX;
    swiping = true;
    dx = 0;
  }
  function tm(e: TouchEvent) {
    if (swiping) dx = e.touches[0].clientX - sx;
  }
  function te() {
    if (!swiping) return;
    swiping = false;
    if (dx < -70) {
      haptic('light');
      player.next();
    } else if (dx > 70) {
      haptic('light');
      player.previous();
    }
    dx = 0;
  }
  function open() {
    if (Math.abs(dx) > 8) return;
    ui.nowPlayingOpen = true;
  }
</script>

<div
  class="m-mini"
  style="--mini-color:{color ?? '#3a3a3a'}"
  role="button"
  tabindex="0"
  onclick={open}
  onkeydown={(e) => e.key === 'Enter' && open()}
  ontouchstart={ts}
  ontouchmove={tm}
  ontouchend={te}
>
  <div class="m-mini-body" style={dx ? `transform:translateX(${dx * 0.6}px)` : ''}>
    <Img thumbs={t.thumbnails} size={96} class="m-mini-art" />
    <div class="m-mini-text">
      <div class="t">{t.title}</div>
      <div class="a">{#if player.loading}<span class="m-mini-load"></span>{/if}{artistNames(t.artists)}</div>
    </div>
  </div>
  {#if settings.theme === 'spotify'}
    <button class="m-mini-btn" aria-label="Devices" onclick={(e) => { e.stopPropagation(); call('show_route_picker').catch(() => {}); }}><Icon name="devices" size={22} /></button>
    {#if t.type !== 'episode'}
      <button class="m-mini-btn" class:on={liked} aria-label={liked ? 'Remove from Liked Music' : 'Save to Liked Music'} onclick={(e) => { e.stopPropagation(); haptic(liked ? 'light' : 'success'); library.toggleLike(t); }}>
        <Icon name={liked ? 'checkCircle' : 'addCircle'} size={24} />
      </button>
    {/if}
  {/if}
  <button class="m-mini-btn play" aria-label={player.playing ? 'Pause' : 'Play'} onclick={(e) => { e.stopPropagation(); player.toggle(); }}>
    <Icon name={player.playing ? 'pause' : 'play'} size={settings.theme === 'spotify' ? 24 : 26} />
  </button>
  {#if settings.theme !== 'spotify'}
    <button class="m-mini-btn" aria-label="Next" onclick={(e) => { e.stopPropagation(); player.next(); }}><Icon name="next" size={24} /></button>
  {/if}
  <div class="m-mini-progress"><div style="width:{pct}%"></div></div>
</div>
