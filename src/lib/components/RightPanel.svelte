<script lang="ts">
  import Icon from './Icon.svelte';
  import Img from './Img.svelte';
  import VideoStage from './VideoStage.svelte';
  import ShelfView from './Shelf.svelte';
  import { player } from '../player/player.svelte';
  import { lyrics } from '../player/lyrics.svelte';
  import { library } from '../stores/library.svelte';
  import { ui } from '../stores/ui.svelte';
  import { go } from '../stores/router.svelte';
  import { trackMenu, showCredits } from '../actions';
  import { getArtist, getRelated } from '../api/ytm';
  import type { PageHeader, Shelf, Track } from '../api/types';
  import { artistNames, bestThumb } from '../util/thumbs';
  import { tick } from 'svelte';

  const t = $derived(player.current);
  const liked = $derived(t ? library.likeOf(t) === 'LIKE' : false);

  // ---- about the artist
  let artist = $state.raw<{ id: string; h: PageHeader } | null>(null);
  const artistCache = new Map<string, PageHeader>();
  $effect(() => {
    const id = t?.artists.find((a) => a.id?.startsWith('UC'))?.id;
    if (ui.rightPanel !== 'nowplaying' || !id) return;
    if (artist?.id === id) return;
    const hit = artistCache.get(id);
    if (hit) {
      artist = { id, h: hit };
      return;
    }
    getArtist(id)
      .then((a) => {
        artistCache.set(id, a.header);
        if (t?.artists.some((x) => x.id === id)) artist = { id, h: a.header };
      })
      .catch(() => {});
  });

  // ---- lyrics
  $effect(() => {
    t?.videoId;
    if (ui.rightPanel === 'lyrics') lyrics.load();
  });
  let lyricBox: HTMLDivElement | undefined = $state();
  $effect(() => {
    const i = lyrics.active;
    if (ui.rightPanel !== 'lyrics' || i < 0 || !lyricBox) return;
    tick().then(() => {
      const el = lyricBox?.querySelector(`[data-i="${i}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  });

  // ---- related
  let related = $state.raw<Shelf[] | null>(null);
  let relatedFor = '';
  $effect(() => {
    const id = t?.videoId;
    if (ui.rightPanel !== 'related' || !id || relatedFor === id) return;
    relatedFor = id;
    related = null;
    player.loadTabs().then((tabs) => {
      if (tabs?.relatedId) getRelated(tabs.relatedId).then((s) => (related = s)).catch(() => (related = []));
      else related = [];
    });
  });

  // ---- queue drag & drop
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);
  function drop(to: number) {
    if (dragFrom != null && dragFrom !== to) player.move(dragFrom, to);
    dragFrom = dragOver = null;
  }

  const titles: Record<string, string> = { nowplaying: '', queue: 'Queue', lyrics: 'Lyrics', related: 'Related' };
</script>

{#snippet qrow(tr: Track, i: number, current = false)}
  <div
    class="mini-row"
    class:current
    class:dragover={dragOver === i && dragFrom !== i}
    role="button"
    tabindex="0"
    draggable={!current}
    ondragstart={() => (dragFrom = i)}
    ondragover={(e) => { e.preventDefault(); dragOver = i; }}
    ondrop={() => drop(i)}
    ondragend={() => (dragFrom = dragOver = null)}
    onclick={() => (current ? player.toggle() : player.jump(i))}
    onkeydown={(e) => e.key === 'Enter' && player.jump(i)}
    oncontextmenu={(e) => ui.openMenu(e, trackMenu(tr, { queueIndex: current ? undefined : i }), tr)}
  >
    <Img thumbs={tr.thumbnails} size={48} />
    <div class="m">
      <div class="a">{tr.title}</div>
      <div class="b">{#if tr.explicit}<span class="ebadge">E</span> {/if}{artistNames(tr.artists)}</div>
    </div>
    <button class="icon-btn more" aria-label="More" onclick={(e) => { e.stopPropagation(); ui.openMenu(e, trackMenu(tr, { queueIndex: current ? undefined : i }), tr); }}><Icon name="more" /></button>
  </div>
{/snippet}

<aside class="right-panel">
  <div class="rp-head">
    {#if ui.rightPanel === 'nowplaying'}
      <span class="t" role="link" tabindex="0" onclick={() => player.source?.path && go(player.source.path)} onkeydown={() => {}}>{player.source?.title ?? 'Now playing'}</span>
    {:else}
      <div class="seg" role="tablist">
        {#each ['queue', 'lyrics', 'related'] as p}
          <button role="tab" aria-selected={ui.rightPanel === p} class:on={ui.rightPanel === p} onclick={() => (ui.rightPanel = p as any)}>{titles[p]}</button>
        {/each}
      </div>
    {/if}
    <div style="display:flex;gap:4px">
      {#if ui.rightPanel === 'nowplaying' && t}
        <button class="icon-btn" aria-label="More" onclick={(e) => ui.openMenu(e, trackMenu(t), t)}><Icon name="more" /></button>
      {/if}
      <button class="icon-btn" aria-label="Close" onclick={() => (ui.rightPanel = 'none')}><Icon name="close" size={16} /></button>
    </div>
  </div>

  <div class="rp-body">
    {#if !t}
      <div class="center-msg" style="min-height:40vh"><Icon name="music" size={48} /><div>Play something to see it here</div></div>
    {:else if ui.rightPanel === 'nowplaying'}
      <div style="display:flex;justify-content:center;margin-top:4px">
        <div class="seg">
          <button class:on={!player.video} onclick={() => player.setVideo(false)}>Song</button>
          <button class:on={player.video} onclick={() => player.setVideo(true)}>Video</button>
        </div>
      </div>
      {#if player.video && !ui.fullscreenPlayer}
        <div class="rp-video"><VideoStage /></div>
      {:else}
        <Img thumbs={t.thumbnails} size={320} class="rp-art" eager />
      {/if}
      <div class="rp-title-row">
        <div class="rp-title" role="link" tabindex="0" onclick={() => t.album?.id && go(`/album/${t.album.id}`)} onkeydown={() => {}} title={t.title}>{t.title}</div>
        {#if t.type !== 'episode'}
          <button class="icon-btn" class:active={liked} aria-label="Like" onclick={() => library.toggleLike(t)}><Icon name={liked ? 'checkCircle' : 'addCircle'} size={20} /></button>
        {/if}
      </div>
      <div class="rp-artist">
        {#each t.artists as a, i}{#if i}{', '}{/if}{#if a.id}<a href="#/" onclick={(e) => { e.preventDefault(); go(`/artist/${a.id}`); }}>{a.name}</a>{:else}{a.name}{/if}{/each}
      </div>

      {#if artist}
        <div class="rp-card" role="button" tabindex="0" style="cursor:pointer" onclick={() => go(`/artist/${artist!.id}`)} onkeydown={() => {}}>
          <div style="position:relative;height:200px;background:center/cover url('{bestThumb(artist.h.banner ?? artist.h.thumbnails, 400)}')">
            <div style="position:absolute;left:16px;top:16px;font-weight:700;text-shadow:0 1px 6px rgba(0,0,0,.6)">About the artist</div>
          </div>
          <div class="bd" style="padding-top:16px">
            <div style="color:var(--text);font-weight:700;font-size:16px">{artist.h.title}</div>
            {#if artist.h.monthlyListeners || artist.h.subscribers}<div style="margin:4px 0 8px">{artist.h.monthlyListeners ? artist.h.monthlyListeners : `${artist.h.subscribers} subscribers`}</div>{/if}
            {#if artist.h.description}<div style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;line-height:1.5">{artist.h.description}</div>{/if}
            {#if artist.h.channelId}
              {@const sub = library.isSubscribed(artist.h.channelId, artist.h.subscribed)}
              <button class="pill-btn outline" style="margin-top:12px" onclick={(e) => { e.stopPropagation(); library.setSubscribed(artist!.h.channelId!, !sub); }}>{sub ? 'Subscribed' : 'Subscribe'}</button>
            {/if}
          </div>
        </div>
      {/if}

      {#if t.menu?.creditsId}
        <div class="rp-card">
          <div class="hd"><span>Credits</span><button class="show-all" onclick={() => showCredits(t.menu!.creditsId!, t.title)}>Show all</button></div>
          <div class="bd">{artistNames(t.artists)}<div style="font-size:13px">Main artist</div></div>
        </div>
      {/if}

      {#if player.upNext.length}
        <div class="rp-card">
          <div class="hd"><span>Next in queue</span><button class="show-all" onclick={() => (ui.rightPanel = 'queue')}>Open queue</button></div>
          <div style="padding:0 8px 8px">{@render qrow(player.upNext[0], player.index + 1)}</div>
        </div>
      {/if}
    {:else if ui.rightPanel === 'queue'}
      <div class="queue-section">Now playing</div>
      {@render qrow(t, player.index, true)}
      {#if player.upNext.length}
        <div class="queue-section" style="display:flex;justify-content:space-between;align-items:center">
          <span>Next {#if player.source}<small>from: {player.source.title}</small>{/if}</span>
          <button class="show-all" onclick={() => player.clearUpcoming()}>Clear queue</button>
        </div>
        {#each player.upNext.slice(0, 200) as tr, j (tr.qid)}
          {@render qrow(tr, player.index + 1 + j)}
        {/each}
      {/if}
    {:else if ui.rightPanel === 'lyrics'}
      {#if lyrics.loading}
        <div class="center-msg" style="min-height:30vh"><span class="spinner lg"></span></div>
      {:else if lyrics.data}
        <div class="rp-lyrics" class:unsynced={!lyrics.data.lines} bind:this={lyricBox}>
          {#if lyrics.data.lines}
            {#each lyrics.data.lines as l, i}
              <div class="line" class:active={i === lyrics.active} data-i={i} role="button" tabindex="0" onclick={() => player.seek(l.start)} onkeydown={() => {}}>{l.text || '♪'}</div>
            {/each}
          {:else}
            <div class="selectable" style="white-space:pre-line;font-size:18px;font-weight:600;line-height:1.6">{lyrics.data.text}</div>
          {/if}
          {#if lyrics.data.source}<div class="lyrics-src" style="font-size:12px">{lyrics.data.source}</div>{/if}
          <button class="pill-btn outline" style="margin-top:16px" onclick={() => go('/lyrics')}>Open full screen lyrics</button>
        </div>
      {:else}
        <div class="center-msg" style="min-height:30vh"><Icon name="mic" size={40} /><div>No lyrics available for this track</div></div>
      {/if}
    {:else if ui.rightPanel === 'related'}
      {#if related === null}
        <div class="center-msg" style="min-height:30vh"><span class="spinner lg"></span></div>
      {:else if !related.length}
        <div class="center-msg" style="min-height:30vh">Nothing related found</div>
      {:else}
        <div class="rp-related">
          {#each related as s}<ShelfView shelf={s} forceGrid />{/each}
        </div>
      {/if}
    {/if}
  </div>
</aside>

<style>
  .rp-related :global(.card-grid) {
    grid-template-columns: repeat(2, 1fr);
  }
  .rp-related :global(.shelf-title) {
    font-size: 18px;
  }
  .rp-related :global(.quick-picks) {
    grid-auto-flow: row;
    grid-template-rows: none;
    grid-template-columns: 1fr;
  }
</style>
