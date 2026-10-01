<script lang="ts">
  import { onMount } from 'svelte';
  import TitleBar from './lib/components/TitleBar.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import MainView from './lib/components/MainView.svelte';
  import NowPlayingBar from './lib/components/NowPlayingBar.svelte';
  import RightPanel from './lib/components/RightPanel.svelte';
  import ContextMenu from './lib/components/ContextMenu.svelte';
  import Dialog from './lib/components/Dialog.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import FullscreenPlayer from './lib/components/FullscreenPlayer.svelte';
  import MiniPlayer from './lib/components/MiniPlayer.svelte';
  import AeroBackdrop from './lib/components/AeroBackdrop.svelte';
  import { ui } from './lib/stores/ui.svelte';
  import { router, go } from './lib/stores/router.svelte';
  import { settings } from './lib/stores/settings.svelte';
  import { auth } from './lib/stores/auth.svelte';
  import { library } from './lib/stores/library.svelte';
  import { player } from './lib/player/player.svelte';

  let sidebarW = $state(+(localStorage.getItem('st.sidebarW') ?? 300) || 300);
  let rightW = $state(+(localStorage.getItem('st.rightW') ?? 320) || 320);
  let dragging = $state<'l' | 'r' | null>(null);

  onMount(() => {
    player.init();
    auth.init().then(() => library.refresh());
  });

  // refresh library when the account changes
  let lastVersion = 0;
  $effect(() => {
    if (auth.version !== lastVersion) {
      lastVersion = auth.version;
      if (auth.ready) library.refresh();
    }
  });

  function startDrag(side: 'l' | 'r', e: PointerEvent) {
    dragging = side;
    const startX = e.clientX;
    const start = side === 'l' ? sidebarW : rightW;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (side === 'l') {
        const w = start + dx;
        if (w < 180) ui.sidebarCollapsed = true;
        else {
          ui.sidebarCollapsed = false;
          sidebarW = Math.min(480, Math.max(260, w));
        }
      } else rightW = Math.min(480, Math.max(280, start - dx));
    };
    const up = () => {
      dragging = null;
      localStorage.setItem('st.sidebarW', String(sidebarW));
      localStorage.setItem('st.rightW', String(rightW));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function keys(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (e.ctrlKey && (e.key === 'k' || e.key === 'l')) {
      e.preventDefault();
      go('/search');
      setTimeout(() => (document.querySelector('.searchbox input') as HTMLInputElement)?.focus(), 30);
      return;
    }
    if (typing) return;
    if (e.code === 'Space') {
      e.preventDefault();
      player.toggle();
    } else if (e.ctrlKey && e.key === 'ArrowRight') player.next();
    else if (e.ctrlKey && e.key === 'ArrowLeft') player.previous();
    else if (e.ctrlKey && e.key === 'ArrowUp') {
      e.preventDefault();
      player.setVolume(player.volume + 0.1);
    } else if (e.ctrlKey && e.key === 'ArrowDown') {
      e.preventDefault();
      player.setVolume(player.volume - 0.1);
    } else if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      player.toggleShuffle();
    } else if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      player.cycleRepeat();
    } else if (e.altKey && e.key === 'ArrowLeft') router.back();
    else if (e.altKey && e.key === 'ArrowRight') router.forward();
    else if (e.shiftKey && e.key === 'ArrowRight') player.seek(player.time + 5);
    else if (e.shiftKey && e.key === 'ArrowLeft') player.seek(player.time - 5);
    else if (e.ctrlKey && e.key === ',') go('/settings');
  }
</script>

<svelte:window onkeydown={keys} onmouseup={(e) => { if (e.button === 3) router.back(); if (e.button === 4) router.forward(); }} />

{#if settings.theme === 'aero'}<AeroBackdrop />{/if}

{#if ui.miniPlayer}
  <div class="app mini"><MiniPlayer /></div>
{:else}
  <div
    class="app"
    class:collapsed={ui.sidebarCollapsed}
    class:no-right={ui.rightPanel === 'none'}
    style="--sidebar-w:{ui.sidebarCollapsed ? 72 : sidebarW}px;--right-w:{rightW}px"
    oncontextmenu={(e) => e.preventDefault()}
    role="application"
  >
    <TitleBar />
    <div style="position:relative;grid-row:2;min-height:0;display:flex">
      <Sidebar />
      <div class="resize-handle" class:dragging={dragging === 'l'} role="separator" aria-orientation="vertical" onpointerdown={(e) => startDrag('l', e)}></div>
    </div>
    <MainView />
    {#if ui.rightPanel !== 'none'}
      <div style="position:relative;grid-row:2;min-height:0;display:flex">
        <div class="resize-handle left" class:dragging={dragging === 'r'} role="separator" aria-orientation="vertical" onpointerdown={(e) => startDrag('r', e)}></div>
        <RightPanel />
      </div>
    {/if}
    <NowPlayingBar />
  </div>
{/if}

{#if ui.fullscreenPlayer}<FullscreenPlayer />{/if}
<ContextMenu />
<Dialog />
<Toasts />
