<script lang="ts">
  import Icon from './Icon.svelte';
  import Slider from './Slider.svelte';
  import { player } from '../player/player.svelte';
  import { library } from '../stores/library.svelte';
  import { ui } from '../stores/ui.svelte';
  import { settings, saveSettings } from '../stores/settings.svelte';
  import { artistNames, bestThumb } from '../util/thumbs';
  import { isTauri } from '../api/transport';
  import { onMount } from 'svelte';

  const IDLE_MS = 5000;
  const t = $derived(player.current);
  const liked = $derived(t ? library.likeOf(t) === 'LIKE' : false);
  const vinyl = $derived(settings.miniMode === 'vinyl');
  const art = $derived(bestThumb(t?.thumbnails, 400));

  // ---- YouTube-style auto hide: controls fade after 5 s without the cursor moving on the player
  let idle = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function wake() {
    idle = false;
    clearTimeout(timer);
    timer = setTimeout(() => (idle = true), IDLE_MS);
  }
  function left() {
    clearTimeout(timer);
    timer = setTimeout(() => (idle = true), IDLE_MS);
  }

  // ---- window: small, always on top; transparent + shadowless for vinyl mode
  let win: any = null;
  async function applyWindow(v: boolean) {
    document.documentElement.classList.toggle('transparent-window', v);
    if (!win) return;
    const d = await import('@tauri-apps/api/dpi');
    await win.setSize(v ? new d.LogicalSize(300, 380) : new d.LogicalSize(320, 320)).catch(() => {});
    await win.setShadow?.(!v).catch(() => {});
  }
  $effect(() => {
    applyWindow(vinyl);
  });

  onMount(() => {
    wake();
    // remember the full window's geometry so leaving the mini player puts it back exactly
    let prev: { w: number; h: number; x: number; y: number; max: boolean } | null = null;
    if (isTauri)
      (async () => {
        const m = await import('@tauri-apps/api/window');
        const d = await import('@tauri-apps/api/dpi');
        win = m.getCurrentWindow();
        const max = await win.isMaximized();
        if (max) await win.unmaximize();
        const size = await win.innerSize();
        const pos = await win.outerPosition();
        prev = { w: size.width, h: size.height, x: pos.x, y: pos.y, max };
        await win.setMinSize(new d.LogicalSize(220, 220));
        await win.setAlwaysOnTop(true);
        await applyWindow(vinyl);
      })();
    return async () => {
      clearTimeout(timer);
      document.documentElement.classList.remove('transparent-window');
      if (!win) return;
      const d = await import('@tauri-apps/api/dpi');
      await win.setShadow?.(true).catch(() => {});
      await win.setAlwaysOnTop(false);
      await win.setMinSize(new d.LogicalSize(820, 560));
      if (prev) {
        const f = await win.scaleFactor();
        await win.setSize(new d.PhysicalSize(Math.max(820 * f, prev.w), Math.max(560 * f, prev.h)));
        await win.setPosition(new d.PhysicalPosition(prev.x, prev.y));
        if (prev.max) await win.maximize();
      } else {
        await win.setSize(new d.LogicalSize(1280, 820));
        await win.center();
      }
    };
  });

  function toggleMode() {
    settings.miniMode = vinyl ? 'art' : 'vinyl';
    saveSettings();
    wake();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="mini-player"
  class:vinyl
  class:idle
  role="application"
  aria-label="Mini player"
  onmousemove={wake}
  onmouseenter={wake}
  onmouseleave={left}
  onmousedown={wake}
>
  {#if !vinyl}
    <div class="bg" style="background-image:url('{art}')"></div>
  {/if}
  <div class="drag" data-tauri-drag-region></div>

  <div class="top">
    <button class="mp-btn" aria-label={vinyl ? 'Artwork mode' : 'Vinyl mode'} title={vinyl ? 'Artwork mode' : 'Vinyl mode'} onclick={toggleMode}>
      <Icon name={vinyl ? 'grid' : 'album'} size={15} />
    </button>
    <button class="mp-btn" aria-label="Exit mini player" title="Exit mini player" onclick={() => (ui.miniPlayer = false)}><Icon name="expand" size={15} /></button>
  </div>

  {#if vinyl}
    <div class="record-wrap" data-tauri-drag-region>
      <div class="record" class:spinning={player.playing} data-tauri-drag-region>
        <div class="grooves" data-tauri-drag-region></div>
        <div class="label" data-tauri-drag-region style={art ? `background-image:url('${art}')` : ''}></div>
        <div class="hole"></div>
        <div class="sheen" data-tauri-drag-region></div>
      </div>
    </div>
  {/if}

  <div class="ui">
    <div class="meta">
      <div class="title">{t?.title ?? 'Nothing playing'}</div>
      <div class="artist">{artistNames(t?.artists)}</div>
    </div>
    <div class="controls">
      <Slider value={player.time} max={player.duration || 1} label="Seek" onchange={(v) => player.seek(v)} />
      <div class="row">
        <button class="ctrl" class:on={liked} aria-label="Like" onclick={() => t && library.toggleLike(t)}><Icon name={liked ? 'heartFill' : 'heart'} size={16} /></button>
        <button class="ctrl" aria-label="Previous" onclick={() => player.previous()}><Icon name="prev" size={18} /></button>
        <button class="ctrl-play big" aria-label={player.playing ? 'Pause' : 'Play'} onclick={() => player.toggle()}><Icon name={player.playing ? 'pause' : 'play'} size={18} /></button>
        <button class="ctrl" aria-label="Next" onclick={() => player.next()}><Icon name="next" size={18} /></button>
        <button class="ctrl" class:on={player.shuffle} aria-label="Shuffle" onclick={() => player.toggleShuffle()}><Icon name="shuffle" size={16} /></button>
      </div>
    </div>
  </div>
</div>

<style>
  .mini-player {
    height: 100vh;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    color: #fff;
    --drop: 74px; /* height of the controls block the title slides into */
  }
  .mini-player.idle {
    cursor: none;
  }
  .bg {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
  }
  .bg::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(transparent 30%, rgba(0, 0, 0, 0.85));
    transition: opacity 0.5s;
  }
  .idle .bg::after {
    opacity: 0.65;
  }
  .drag {
    position: absolute;
    inset: 0;
  }
  .top {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 3;
    display: flex;
    gap: 6px;
    transition: opacity 0.4s;
  }
  .mp-btn {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(8px);
  }
  .mp-btn:hover {
    background: rgba(0, 0, 0, 0.75);
  }
  .ui {
    position: relative;
    z-index: 2;
    padding: 12px;
    pointer-events: none;
  }
  .ui > * {
    pointer-events: auto;
  }
  .meta {
    transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1);
    margin-bottom: 8px;
  }
  .title {
    font-weight: 700;
    font-size: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artist {
    color: rgba(255, 255, 255, 0.78);
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .controls {
    transition: opacity 0.4s, transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
  }
  .row .ctrl {
    color: rgba(255, 255, 255, 0.85);
  }
  .row .ctrl.on {
    color: var(--accent);
  }
  .big {
    width: 40px;
    height: 40px;
    background: #fff;
    color: #000;
  }
  /* idle: controls fade, title & artist drop into their place */
  .idle .controls,
  .idle .top {
    opacity: 0;
    pointer-events: none;
  }
  .idle .controls {
    transform: translateY(12px);
  }
  .idle .meta {
    transform: translateY(var(--drop));
  }

  /* ------------------------------------------------ vinyl mode */
  .vinyl {
    justify-content: flex-start;
    background: transparent;
    --drop: 70px;
  }
  .record-wrap {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    padding: 18px 18px 6px;
  }
  .record {
    position: relative;
    height: min(100%, calc(100vw - 36px));
    aspect-ratio: 1;
    border-radius: 50%;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
    animation: spin 9s linear infinite;
    animation-play-state: paused;
  }
  .record.spinning {
    animation-play-state: running;
  }
  :global(.reduce-motion) .record {
    animation: none;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .grooves {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background:
      repeating-radial-gradient(circle at center, rgba(255, 255, 255, 0.045) 0 1px, transparent 1px 3px),
      radial-gradient(circle at center, #2a2a2a 0 34%, #0b0b0b 35%, #161616 62%, #070707 63%, #121212 92%, #050505 100%);
  }
  .label {
    position: absolute;
    inset: 31%;
    border-radius: 50%;
    background: #333 center / cover;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.15);
  }
  .hole {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 4.5%;
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: #0d0d0d;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.2);
  }
  /* light reflection: counter-rotates so it stays still while the record spins */
  .sheen {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(from 20deg, transparent 0deg, rgba(255, 255, 255, 0.13) 25deg, transparent 60deg, transparent 180deg, rgba(255, 255, 255, 0.1) 205deg, transparent 240deg);
    animation: spin 9s linear infinite reverse;
    animation-play-state: inherit;
    mask: radial-gradient(circle, transparent 33%, #000 34%);
  }
  .record.spinning .sheen {
    animation-play-state: running;
  }
  .vinyl .ui {
    text-align: center;
    padding: 4px 14px 12px;
  }
  .vinyl .title,
  .vinyl .artist {
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.85), 0 0 2px rgba(0, 0, 0, 0.9);
  }
  .vinyl .controls {
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(10px);
    border-radius: 14px;
    padding: 8px 10px 6px;
  }
  .vinyl .top .mp-btn {
    background: rgba(0, 0, 0, 0.6);
  }
</style>
