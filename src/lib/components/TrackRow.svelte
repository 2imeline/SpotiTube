<script lang="ts">
  import type { Track } from '../api/types';
  import Icon from './Icon.svelte';
  import Img from './Img.svelte';
  import { go } from '../stores/router.svelte';
  import { library } from '../stores/library.svelte';
  import { ui } from '../stores/ui.svelte';
  import { player } from '../player/player.svelte';
  import { trackMenu, type TrackMenuContext } from '../actions';
  import { isMobile } from '../native/platform';

  let {
    track,
    n,
    showAlbum = true,
    showArt = true,
    current = false,
    selected = false,
    ctx = {},
    onplay,
    onselect,
  }: {
    track: Track;
    n: number;
    showAlbum?: boolean;
    showArt?: boolean;
    current?: boolean;
    selected?: boolean;
    ctx?: TrackMenuContext;
    onplay: () => void;
    onselect?: () => void;
  } = $props();

  const liked = $derived(library.likeOf(track) === 'LIKE');
  const menuOpen = $derived(!!ui.menu && ui.menu.owner === track);
  const unavailable = $derived(track.isAvailable === false);

  function menu(e: MouseEvent) {
    ui.openMenu(e, trackMenu(track, ctx), track);
  }
  function link(e: MouseEvent, path: string) {
    e.preventDefault();
    e.stopPropagation();
    go(path);
  }
</script>

<div
  class="track"
  class:current
  class:selected
  class:unavailable
  class:menu-open={menuOpen}
  role="row"
  tabindex="-1"
  ondblclick={() => !unavailable && onplay()}
  onclick={() => (isMobile ? !unavailable && onplay() : onselect?.())}
  oncontextmenu={menu}
  onkeydown={(e) => e.key === 'Enter' && onplay()}
>
  <div class="num">
    {#if track.rank}
      <span class="n rank">{track.rank}
        {#if track.trend === 'up'}<span class="trend-up" style="font-size:9px">▲</span>{:else if track.trend === 'down'}<span class="trend-down" style="font-size:9px">▼</span>{/if}
      </span>
    {:else if current && player.playing}
      <span class="n"><span class="eq"><span></span><span></span><span></span></span></span>
    {:else}
      <span class="n">{n}</span>
    {/if}
    <button aria-label={current && player.playing ? 'Pause' : 'Play'} onclick={(e) => { e.stopPropagation(); current ? player.toggle() : onplay(); }} disabled={unavailable}>
      <Icon name={current && player.playing ? 'pause' : 'play'} size={14} />
    </button>
  </div>
  <div class="t-main">
    {#if showArt}<Img thumbs={track.thumbnails} size={40} />{/if}
    <div class="t-text">
      <div class="t-title" title={track.title}>{track.title}</div>
      <div class="t-sub">
        {#if track.explicit}<span class="ebadge" title="Explicit">E</span>{/if}
        {#if track.type === 'video'}<Icon name="video" size={12} />{/if}
        <span class="t-artists">
          {#each track.artists as a, i}{#if i}{', '}{/if}{#if a.id}<a href="#/" onclick={(e) => link(e, track.type === 'episode' && a.id?.startsWith('MPSP') ? `/podcast/${a.id}` : `/artist/${a.id}`)}>{a.name}</a>{:else}{a.name}{/if}{/each}
          {#if !showAlbum && track.views}<span class="dot"></span>{track.views}{/if}
          {#if track.played}<span class="dot"></span>{track.played}{/if}
        </span>
      </div>
    </div>
  </div>
  {#if showAlbum}
    <div class="t-album">
      {#if track.album?.id}<a href="#/" onclick={(e) => link(e, `/album/${track.album!.id}`)}>{track.album.name}</a>{:else}{track.album?.name ?? track.views ?? ''}{/if}
    </div>
  {/if}
  <div class="t-end">
    {#if track.type !== 'episode'}
      <button class="hov" class:on={liked} aria-label={liked ? 'Remove from Liked Music' : 'Save to Liked Music'} title={liked ? 'Remove from Liked Music' : 'Save to Liked Music'} onclick={(e) => { e.stopPropagation(); library.toggleLike(track); }}>
        <Icon name={liked ? 'heartFill' : 'heart'} size={16} />
      </button>
    {/if}
    <span class="dur">{track.duration ?? ''}</span>
    <button class="hov" aria-label="More options" onclick={menu}><Icon name="more" size={16} /></button>
  </div>
</div>
