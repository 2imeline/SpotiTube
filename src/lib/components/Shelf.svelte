<script lang="ts">
  import type { Card as CardT, Item, Shelf, Track } from '../api/types';
  import CardView from './Card.svelte';
  import Icon from './Icon.svelte';
  import Img from './Img.svelte';
  import { go } from '../stores/router.svelte';
  import { player } from '../player/player.svelte';
  import { ui } from '../stores/ui.svelte';
  import { trackMenu, openCard, endpointRoute } from '../actions';
  import { artistNames } from '../util/thumbs';

  let { shelf, forceGrid = false }: { shelf: Shelf; forceGrid?: boolean } = $props();
  let row: HTMLDivElement | undefined = $state();
  let expanded = $state(false);

  const asCard = (i: Item): CardT =>
    i.kind === 'card'
      ? i
      : { kind: 'card', type: i.type, title: i.title, subtitle: artistNames(i.artists), thumbnails: i.thumbnails, videoId: i.videoId, track: i, artists: i.artists, wide: i.type === 'video' };

  const more = $derived(endpointRoute(shelf.more));
  const allMoods = $derived(shelf.items.length > 0 && shelf.items.every((i) => i.kind === 'card' && i.type === 'mood'));
  const wide = $derived(shelf.items.filter((i) => (i.kind === 'card' && i.wide) || (i.kind === 'track' && i.type === 'video')).length > shelf.items.length / 2);
  const tracks = $derived(shelf.items.filter((i): i is Track => i.kind === 'track'));

  function scroll(dir: number) {
    row?.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: 'smooth' });
  }
</script>

<section class="shelf">
  {#if shelf.title}
    <div class="shelf-head">
      <div>
        {#if shelf.strapline}<div class="strap">{shelf.strapline}</div>{/if}
        <h2 class="shelf-title" class:link={!!more}>
          {#if more}<a href="#/" onclick={(e) => { e.preventDefault(); go(more!); }}>{shelf.title}</a>{:else}{shelf.title}{/if}
        </h2>
      </div>
      {#if more}
        <a class="show-all" href="#/" onclick={(e) => { e.preventDefault(); go(more!); }}>Show all</a>
      {:else if (shelf.layout === 'cards' && shelf.items.length > 7 && !forceGrid) || (shelf.layout === 'tracks' && tracks.length > 8)}
        <button class="show-all" onclick={() => (expanded = !expanded)}>{expanded ? 'Show less' : 'Show all'}</button>
      {/if}
    </div>
  {/if}

  {#if shelf.layout === 'text'}
    <p class="selectable" style="color:var(--text-sub);line-height:1.6;white-space:pre-line;max-width:800px">{shelf.text}</p>
  {:else if allMoods}
    <div class="mood-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
      {#each shelf.items as m}
        {@const c = m as CardT}
        <div class="mood-chip" style="--c:{c.color ?? 'var(--accent)'}" role="button" tabindex="0" onclick={() => openCard(c)} onkeydown={(e) => e.key === 'Enter' && openCard(c)}>{c.title}</div>
      {/each}
    </div>
  {:else if shelf.layout === 'tracks' && tracks.length}
    <div class="quick-picks" class:expanded>
      {#each expanded ? tracks : tracks.slice(0, 16) as t (t.videoId + t.title)}
        <div
          class="mini-row"
          class:current={player.current?.videoId === t.videoId}
          role="button"
          tabindex="0"
          onclick={() => player.playTrack(t, { title: shelf.title })}
          onkeydown={(e) => e.key === 'Enter' && player.playTrack(t)}
          oncontextmenu={(e) => ui.openMenu(e, trackMenu(t), t)}
        >
          <Img thumbs={t.thumbnails} size={48} />
          <div class="m">
            <div class="a">{t.title}</div>
            <div class="b">{#if t.explicit}<span class="ebadge">E</span> {/if}{artistNames(t.artists)}{#if t.album} • {t.album.name}{/if}</div>
          </div>
          <button class="icon-btn more" aria-label="More" onclick={(e) => ui.openMenu(e, trackMenu(t), t)}><Icon name="more" /></button>
        </div>
      {/each}
    </div>
  {:else if shelf.layout === 'grid' || forceGrid || expanded}
    <div class="card-grid" class:wide>
      {#each shelf.items as it, i (i)}<CardView card={asCard(it)} />{/each}
    </div>
  {:else}
    <div class="shelf-scroller">
      <button class="shelf-arrow l" aria-label="Scroll left" onclick={() => scroll(-1)}><Icon name="chevronLeft" /></button>
      <div class="shelf-row" class:wide bind:this={row}>
        {#each shelf.items as it, i (i)}<CardView card={asCard(it)} />{/each}
      </div>
      <button class="shelf-arrow r" aria-label="Scroll right" onclick={() => scroll(1)}><Icon name="chevronRight" /></button>
    </div>
  {/if}
</section>

<style>
  .quick-picks {
    display: grid;
    grid-template-rows: repeat(4, auto);
    grid-auto-flow: column;
    grid-auto-columns: minmax(280px, 1fr);
    gap: 0 8px;
    overflow-x: auto;
    margin: 0 -8px;
    scrollbar-width: none;
  }
  .quick-picks::-webkit-scrollbar {
    display: none;
  }
  .quick-picks.expanded {
    grid-template-rows: none;
    grid-auto-flow: row;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  }
  .card-grid.wide {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  }
</style>
