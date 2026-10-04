<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Img from '../components/Img.svelte';
  import VideoStage from '../components/VideoStage.svelte';
  import ShelfView from '../components/Shelf.svelte';
  import { player } from '../player/player.svelte';
  import { lyrics } from '../player/lyrics.svelte';
  import { library } from '../stores/library.svelte';
  import { ui } from '../stores/ui.svelte';
  import { go } from '../stores/router.svelte';
  import { trackMenu } from '../actions';
  import { getRelated } from '../api/ytm';
  import type { Shelf } from '../api/types';
  import { artistNames } from '../util/thumbs';
  import { tick } from 'svelte';

  const t = $derived(player.current);
  const tab = $derived(ui.rightPanel === 'lyrics' ? 'lyrics' : ui.rightPanel === 'related' ? 'related' : 'play');
  const liked = $derived(t ? library.likeOf(t) === 'LIKE' : false);

  $effect(() => {
    t?.videoId;
    if (tab === 'lyrics') lyrics.load();
  });
  let lyricBox: HTMLDivElement | undefined = $state();
  $effect(() => {
    const i = lyrics.active;
    if (tab !== 'lyrics' || i < 0 || !lyricBox) return;
    tick().then(() => (lyricBox?.querySelector(`[data-i="${i}"]`) as HTMLElement | null)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  });

  let related = $state.raw<Shelf[] | null>(null);
  let relatedFor = '';
  $effect(() => {
    const id = t?.videoId;
    if (tab !== 'related' || !id || relatedFor === id) return;
    relatedFor = id;
    related = null;
    player.loadTabs().then((tabs) => {
      if (tabs?.relatedId) getRelated(tabs.relatedId).then((s) => (related = s)).catch(() => (related = []));
      else related = [];
    });
  });

  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);
  let listEl: HTMLDivElement | undefined = $state();
  // keep the playing row in view
  $effect(() => {
    player.index;
    if (tab === 'play') tick().then(() => listEl?.querySelector('.qrow.cur')?.scrollIntoView({ block: 'nearest' }));
  });
</script>

<aside class="aero-list">
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === 'play'} class:on={tab === 'play'} onclick={() => (ui.rightPanel = 'queue')}>Now Playing</button>
    <button role="tab" aria-selected={tab === 'lyrics'} class:on={tab === 'lyrics'} onclick={() => (ui.rightPanel = 'lyrics')}>Lyrics</button>
    <button role="tab" aria-selected={tab === 'related'} class:on={tab === 'related'} onclick={() => (ui.rightPanel = 'related')}>Related</button>
    <button class="x" aria-label="Hide list pane" title="Hide list pane" onclick={() => (ui.rightPanel = 'none')}><Icon name="close" size={10} /></button>
  </div>

  {#if !t}
    <div class="empty">
      <div class="disc"></div>
      <p>Drag songs here… or just double-click anything to start playing.</p>
    </div>
  {:else if tab === 'play'}
    <div class="np">
      <div class="seg">
        <button class:on={!player.video} onclick={() => player.setVideo(false)}>Song</button>
        <button class:on={player.video} onclick={() => player.setVideo(true)}>Video</button>
      </div>
      {#if player.video && !ui.fullscreenPlayer}
        <div class="video"><VideoStage /></div>
      {:else}
        <div class="art-wrap"><Img thumbs={t.thumbnails} size={220} class="art" eager /></div>
      {/if}
      <div class="meta">
        <div class="ttl" title={t.title}>{t.title}</div>
        <div class="art-name">
          {#each t.artists as a, i}{#if i}{', '}{/if}{#if a.id}<a href="#/" onclick={(e) => { e.preventDefault(); go(`/artist/${a.id}`); }}>{a.name}</a>{:else}{a.name}{/if}{/each}
        </div>
        {#if t.album}<div class="alb">{#if t.album.id}<a href="#/" onclick={(e) => { e.preventDefault(); go(`/album/${t.album!.id}`); }}>{t.album.name}</a>{:else}{t.album.name}{/if}</div>{/if}
        {#if t.type !== 'episode'}
          <div class="stars">
            <button class:on={liked} title={liked ? 'Remove from Liked Music' : 'Like'} onclick={() => library.toggleLike(t)}><Icon name={liked ? 'heartFill' : 'heart'} size={14} /></button>
            <button class:on={library.likeOf(t) === 'DISLIKE'} title="Dislike" onclick={() => library.rate(t, library.likeOf(t) === 'DISLIKE' ? 'INDIFFERENT' : 'DISLIKE')}><Icon name="dislike" size={14} /></button>
          </div>
        {/if}
      </div>
    </div>
    <div class="qhead">
      <span>{player.source?.title ?? 'Now Playing'}</span>
      <span class="cnt">{player.queue.length} items</span>
      <button class="clear" onclick={() => player.clearUpcoming()} title="Clear upcoming songs">Clear list</button>
    </div>
    <div class="qlist" bind:this={listEl}>
      {#each player.queue.slice(0, 400) as q, i (q.qid)}
        <div
          class="qrow"
          class:cur={i === player.index}
          class:past={i < player.index}
          class:over={dragOver === i && dragFrom !== i}
          role="row"
          tabindex="-1"
          draggable="true"
          ondragstart={() => (dragFrom = i)}
          ondragover={(e) => { e.preventDefault(); dragOver = i; }}
          ondrop={() => { if (dragFrom != null && dragFrom !== i) player.move(dragFrom, i); dragFrom = dragOver = null; }}
          ondragend={() => (dragFrom = dragOver = null)}
          ondblclick={() => (i === player.index ? player.toggle() : player.jump(i))}
          oncontextmenu={(e) => ui.openMenu(e, trackMenu(q, { queueIndex: i === player.index ? undefined : i }), q)}
        >
          <span class="n">{#if i === player.index}<Icon name={player.playing ? 'volume' : 'pause'} size={11} />{:else}{i + 1}{/if}</span>
          <span class="qt"><span class="a">{q.title}</span><span class="b">{artistNames(q.artists)}</span></span>
          <span class="d">{q.duration ?? ''}</span>
        </div>
      {/each}
    </div>
  {:else if tab === 'lyrics'}
    <div class="lyr" class:unsynced={!lyrics.data?.lines} bind:this={lyricBox}>
      {#if lyrics.loading}
        <div class="empty"><span class="spinner lg"></span></div>
      {:else if lyrics.data?.lines}
        {#each lyrics.data.lines as l, i}
          <div class="line" class:active={i === lyrics.active} data-i={i} role="button" tabindex="0" onclick={() => player.seek(l.start)} onkeydown={() => {}}>{l.text || '♪'}</div>
        {/each}
      {:else if lyrics.data}
        <div class="plain selectable">{lyrics.data.text}</div>
      {:else}
        <div class="empty"><p>No lyrics available for this song.</p></div>
      {/if}
      {#if lyrics.data?.source}<div class="src">{lyrics.data.source}</div>{/if}
    </div>
  {:else}
    <div class="rel">
      {#if related === null}<div class="empty"><span class="spinner lg"></span></div>
      {:else if !related.length}<div class="empty"><p>Nothing related found.</p></div>
      {:else}{#each related as s}<ShelfView shelf={s} forceGrid />{/each}{/if}
    </div>
  {/if}
</aside>

<style>
  .aero-list {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: linear-gradient(#f7fbff, #e8f1fa);
    font-size: 12.5px;
    color: #1b2a3a;
  }
  .tabs {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    padding: 6px 6px 0;
    background: linear-gradient(#dfeaf6, #cbdcee);
    border-bottom: 1px solid #94afcc;
  }
  .tabs button[role='tab'] {
    padding: 5px 12px 4px;
    border: 1px solid #94afcc;
    border-bottom: 0;
    border-radius: 4px 4px 0 0;
    background: linear-gradient(#f4f8fc, #dbe6f2);
    color: #233a52;
    margin-bottom: -1px;
  }
  .tabs button[role='tab']:hover {
    background: linear-gradient(#ffffff, #e5f3fd);
  }
  .tabs button.on {
    background: #f7fbff;
    font-weight: 600;
    padding-bottom: 5px;
  }
  .tabs .x {
    margin-left: auto;
    align-self: center;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    color: #4d6a8a;
    border-radius: 3px;
    margin-bottom: 4px;
  }
  .tabs .x:hover {
    background: #e81123;
    color: #fff;
  }
  .np {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 12px 6px;
  }
  .seg {
    display: inline-flex;
    border: 1px solid #8eaacb;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 10px;
  }
  .seg button {
    padding: 2px 14px;
    font-size: 11.5px;
    background: linear-gradient(#fdfdfd, #e3ebf4);
    color: #233a52;
  }
  .seg button + button {
    border-left: 1px solid #8eaacb;
  }
  .seg button.on {
    background: linear-gradient(rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0) 50%), var(--accent);
    color: var(--on-accent);
  }
  .art-wrap {
    width: 200px;
    height: 200px;
    margin-bottom: 52px;
  }
  .art-wrap :global(.art) {
    width: 200px;
    height: 200px;
    object-fit: cover;
    border: 1px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 40, 90, 0.3), 0 6px 18px rgba(0, 30, 80, 0.35);
    -webkit-box-reflect: below 3px linear-gradient(transparent 62%, rgba(255, 255, 255, 0.45));
  }
  .video {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #000;
    border: 1px solid #6d8fb6;
    margin-bottom: 8px;
  }
  .meta {
    text-align: center;
    width: 100%;
  }
  .ttl {
    font-size: 17px;
    font-weight: 300;
    color: #082c52;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .art-name,
  .alb {
    color: #3e566e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta a:hover {
    text-decoration: underline;
    color: #1e5ea8;
  }
  .stars {
    display: flex;
    justify-content: center;
    gap: 6px;
    margin-top: 6px;
  }
  .stars button {
    width: 24px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 3px;
    color: #7d93aa;
  }
  .stars button:hover {
    background: #e3f2fd;
    box-shadow: inset 0 0 0 1px #b8d6fb;
  }
  .stars button.on {
    color: var(--accent-dark);
  }
  .qhead {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-top: 1px solid #c4d4e5;
    border-bottom: 1px solid #c4d4e5;
    background: linear-gradient(#ffffff, #eaf1f9);
    font-weight: 600;
    color: #1e3287;
  }
  .qhead span:first-child {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cnt {
    font-weight: 400;
    color: #5a7088;
    font-size: 11.5px;
  }
  .clear {
    color: #1e5ea8;
    font-size: 11.5px;
    font-weight: 400;
  }
  .clear:hover {
    text-decoration: underline;
  }
  .qlist {
    flex: 1;
    overflow-y: auto;
    background: #fff;
  }
  .qrow {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr) auto;
    align-items: center;
    gap: 4px;
    padding: 3px 8px 3px 4px;
    border: 1px solid transparent;
    cursor: default;
  }
  .qrow:nth-child(even) {
    background: #f4f8fc;
  }
  .qrow:hover {
    background: linear-gradient(#f5fbff, #e3f2fd);
    border-color: #b8d6fb;
  }
  .qrow.cur {
    background: linear-gradient(rgba(var(--accent-rgb), 0.14), rgba(var(--accent-rgb), 0.32));
    border-color: rgba(var(--accent-rgb), 0.7);
    font-weight: 600;
  }
  .qrow.past {
    color: #8696a7;
  }
  .qrow.over {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .n {
    text-align: right;
    color: #7d8fa2;
    font-size: 11px;
    display: flex;
    justify-content: flex-end;
    padding-right: 4px;
  }
  .qrow.cur .n {
    color: var(--accent-dark);
  }
  .qt {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .qt .a,
  .qt .b {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .qt .b {
    font-size: 11px;
    color: #5a7088;
    font-weight: 400;
  }
  .d {
    color: #5a7088;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .lyr,
  .rel {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
  }
  .line {
    font-size: 16px;
    line-height: 1.45;
    margin-bottom: 6px;
    color: rgba(12, 34, 56, 0.4);
    cursor: pointer;
    transition: color 0.2s;
  }
  .line.active {
    color: #0c2238;
    font-weight: 600;
    text-shadow: 0 0 12px rgba(var(--accent-rgb), 0.55);
  }
  .plain {
    white-space: pre-line;
    line-height: 1.6;
    font-size: 14px;
  }
  .src {
    margin-top: 18px;
    font-size: 11px;
    color: #6c7f93;
  }
  .rel :global(.card-grid) {
    grid-template-columns: repeat(2, 1fr);
  }
  .rel :global(.shelf-title) {
    font-size: 16px;
  }
  .rel :global(.quick-picks) {
    grid-auto-flow: row;
    grid-template-rows: none;
    grid-template-columns: 1fr;
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 24px;
    text-align: center;
    color: #5a7088;
  }
  .disc {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    background: radial-gradient(circle, #e7eef6 0 9%, #9fb3c8 9.5% 11%, transparent 11.5%), conic-gradient(from 30deg, #dfe8f2, #ffffff, #c9d7e6, #ffffff, #dfe8f2, #f4f8fc, #c9d7e6, #dfe8f2);
    border: 1px solid #a7bcd2;
    box-shadow: 0 6px 16px rgba(0, 30, 80, 0.25), inset 0 0 0 10px rgba(255, 255, 255, 0.35);
  }
</style>
