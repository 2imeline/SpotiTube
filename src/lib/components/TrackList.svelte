<script lang="ts">
  import type { Track } from '../api/types';
  import TrackRow from './TrackRow.svelte';
  import Icon from './Icon.svelte';
  import { player, type QueueSource } from '../player/player.svelte';
  import type { TrackMenuContext } from '../actions';
  import { onMount } from 'svelte';

  let {
    tracks,
    source,
    showAlbum = true,
    showArt = true,
    showHead = true,
    compact = false,
    ctx = {},
    numberFrom = 1,
    useTrackNumbers = false,
    onplay,
    loadMore,
    onmove,
  }: {
    tracks: Track[];
    source?: QueueSource;
    showAlbum?: boolean;
    showArt?: boolean;
    showHead?: boolean;
    compact?: boolean;
    ctx?: TrackMenuContext;
    numberFrom?: number;
    useTrackNumbers?: boolean;
    onplay?: (index: number) => void;
    loadMore?: () => Promise<void>;
    /** enables drag & drop reordering */
    onmove?: (from: number, to: number) => void;
  } = $props();
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);

  const ROW = 56;
  const VIRTUAL_MIN = 150;
  let listEl: HTMLDivElement;
  let start = $state(0);
  let end = $state(80);
  let selected = $state(-1);
  let loadingMore = $state(false);
  let sentinel: HTMLDivElement | undefined = $state();
  const virtual = $derived(tracks.length > VIRTUAL_MIN);

  function play(i: number) {
    if (onplay) onplay(i);
    else player.playTracks(tracks, i, source);
  }

  function isCurrent(t: Track) {
    const c = player.current;
    return !!c && c.videoId === t.videoId && (!source?.path || !player.source?.path || player.source.path === source.path);
  }

  onMount(() => {
    const scroller = listEl.closest('.main-scroll, .rp-body') as HTMLElement | null;
    if (!scroller) return;
    const update = () => {
      if (!virtual) return;
      const top = listEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const first = Math.floor(-top / ROW);
      const count = Math.ceil(scroller.clientHeight / ROW);
      start = Math.max(0, first - 15);
      end = Math.min(tracks.length, first + count + 15);
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', update);
      ro.disconnect();
    };
  });

  $effect(() => {
    if (!sentinel || !loadMore) return;
    const io = new IntersectionObserver(async (entries) => {
      if (entries[0].isIntersecting && !loadingMore && loadMore) {
        loadingMore = true;
        try {
          await loadMore();
        } finally {
          loadingMore = false;
        }
      }
    }, { rootMargin: '600px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  const visible = $derived(virtual ? tracks.slice(start, end) : tracks);
  const offset = $derived(virtual ? start : 0);
</script>

<div class="tracklist" class:no-album={!showAlbum} class:compact bind:this={listEl} role="grid">
  {#if showHead}
    <div class="tl-head">
      <span>#</span>
      <span>Title</span>
      {#if showAlbum}<span>Album</span>{/if}
      <span class="r"><Icon name="clock" size={16} /></span>
    </div>
  {/if}
  {#if virtual}<div style="height:{start * ROW}px"></div>{/if}
  {#each visible as t, i (t.qid ?? `${t.videoId}-${i + offset}`)}
    <div
      class="drag-wrap"
      class:drop-target={dragOver === i + offset && dragFrom !== i + offset}
      draggable={!!onmove}
      role="presentation"
      ondragstart={(e) => { dragFrom = i + offset; e.dataTransfer?.setData('text/plain', String(i + offset)); }}
      ondragover={(e) => { if (dragFrom != null) { e.preventDefault(); dragOver = i + offset; } }}
      ondrop={(e) => { e.preventDefault(); if (dragFrom != null && dragFrom !== i + offset) onmove?.(dragFrom, i + offset); dragFrom = dragOver = null; }}
      ondragend={() => (dragFrom = dragOver = null)}
    >
    <TrackRow
      track={t}
      n={useTrackNumbers && t.trackNumber ? t.trackNumber : i + offset + numberFrom}
      {showAlbum}
      {showArt}
      {ctx}
      current={isCurrent(t)}
      selected={selected === i + offset}
      onselect={() => (selected = i + offset)}
      onplay={() => play(i + offset)}
    />
    </div>
  {/each}
  {#if virtual}<div style="height:{Math.max(0, tracks.length - end) * ROW}px"></div>{/if}
  {#if loadMore}
    <div bind:this={sentinel} class="load-more">{#if loadingMore}<span class="spinner"></span>{/if}</div>
  {/if}
</div>

<style>
  .drag-wrap.drop-target {
    box-shadow: inset 0 2px 0 var(--accent);
  }
</style>
