<script lang="ts">
  import { onMount } from 'svelte';
  import { player } from '../player/player.svelte';
  let host: HTMLDivElement;
  onMount(() => {
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
