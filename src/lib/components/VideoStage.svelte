<script lang="ts">
  import { onMount } from 'svelte';
  import { player } from '../player/player.svelte';
  import { call } from '../api/transport';
  let host: HTMLDivElement;
  onMount(() => {
    if (player.native) {
      // iPhone: the native video layer is positioned over this box
      let last = '';
      let raf = 0;
      const tick = () => {
        const r = host.getBoundingClientRect();
        const radius = parseFloat(getComputedStyle(host).borderRadius) || 0;
        const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
        if (key !== last) {
          last = key;
          call('video_rect', { x: r.left, y: r.top, w: r.width, h: r.height, radius }).catch(() => {});
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(raf);
        call('video_rect', {}).catch(() => {});
      };
    }
    const el = player.el;
    if (!el) return;
    host.appendChild(el);
    return () => {
      if (el.parentElement === host) document.getElementById('media-host')?.appendChild(el);
    };
  });
</script>

<div class="video-stage" bind:this={host}></div>

<style>
  .video-stage {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
  }
  .video-stage :global(video) {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }
</style>
