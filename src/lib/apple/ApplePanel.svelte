<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Img from '../components/Img.svelte';
  import { player } from '../player/player.svelte';
  import { lyrics } from '../player/lyrics.svelte';
  import { ui } from '../stores/ui.svelte';
  import { trackMenu } from '../actions';
  import { artistNames, bestThumb } from '../util/thumbs';
  import { tick } from 'svelte';
  import type { Track } from '../api/types';

  let tab = $state<'next' | 'history'>('next');
  const t = $derived(player.current);
  const history = $derived(player.queue.slice(0, Math.max(0, player.index)).reverse());

  $effect(() => {
    t?.videoId;
    if (ui.rightPanel === 'lyrics') lyrics.load();
  });
  let box: HTMLDivElement | undefined = $state();
  $effect(() => {
    const i = lyrics.active;
    if (ui.rightPanel !== 'lyrics' || i < 0 || !box) return;
    tick().then(() => (box?.querySelector(`[data-i="${i}"]`) as HTMLElement | null)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  });
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);
</script>

{#snippet row(q: Track, idx: number, draggable: boolean)}
  <div
    class="qrow"
    class:over={dragOver === idx && dragFrom !== idx}
    role="row"
    tabindex="-1"
    {draggable}
    ondragstart={() => (dragFrom = idx)}
    ondragover={(e) => { if (draggable) { e.preventDefault(); dragOver = idx; } }}
    ondrop={() => { if (dragFrom != null && dragFrom !== idx) player.move(dragFrom, idx); dragFrom = dragOver = null; }}
    ondragend={() => (dragFrom = dragOver = null)}
    ondblclick={() => player.jump(idx)}
    oncontextmenu={(e) => ui.openMenu(e, trackMenu(q, { queueIndex: idx }), q)}
  >
    <div class="art"><Img thumbs={q.thumbnails} size={40} /><button class="pl" aria-label="Play" onclick={() => player.jump(idx)}><Icon name="playSolid" size={14} /></button></div>
    <div class="m"><div class="a">{q.title}</div><div class="b">{artistNames(q.artists)}</div></div>
    <button class="more" aria-label="More" onclick={(e) => ui.openMenu(e, trackMenu(q, { queueIndex: idx }), q)}><Icon name="more" size={14} /></button>
  </div>
{/snippet}

<aside class="am-panel" class:lyr={ui.rightPanel === 'lyrics'}>
  {#if ui.rightPanel === 'lyrics'}
    <div class="lyr-bg" style="background-image:url('{bestThumb(t?.thumbnails, 300)}')"></div>
    <div class="lyr-body" class:unsynced={!lyrics.data?.lines} bind:this={box}>
      {#if !t}
        <div class="msg">Lyrics will appear here when you play a song.</div>
      {:else if lyrics.loading}
        <div class="msg"><span class="spinner lg"></span></div>
      {:else if lyrics.data?.lines}
        {#each lyrics.data.lines as l, i}
          <p class="line" class:active={i === lyrics.active} class:past={i < lyrics.active} data-i={i} role="presentation" onclick={() => player.seek(l.start)}>{l.text || '•••'}</p>
        {/each}
        {#if lyrics.data.source}<div class="src">{lyrics.data.source}</div>{/if}
      {:else if lyrics.data}
        <div class="plain selectable">{lyrics.data.text}</div>
        {#if lyrics.data.source}<div class="src">{lyrics.data.source}</div>{/if}
      {:else}
        <div class="msg">Lyrics aren't available for this song.</div>
      {/if}
    </div>
  {:else}
    <div class="seg">
      <button class:on={tab === 'next'} onclick={() => (tab = 'next')}>Playing Next</button>
      <button class:on={tab === 'history'} onclick={() => (tab = 'history')}>History</button>
    </div>
    <div class="list">
      {#if tab === 'next'}
        {#if t}
          <div class="now">
            <Img thumbs={t.thumbnails} size={48} />
            <div class="m"><div class="a">{t.title}</div><div class="b">{artistNames(t.artists)}</div></div>
          </div>
        {/if}
        <div class="hd">
          <div>
            <div class="h">Playing Next</div>
            {#if player.source}<div class="sub">From {player.source.title}</div>{/if}
          </div>
          {#if player.upNext.length}<button class="clear" onclick={() => player.clearUpcoming()}>Clear</button>{/if}
        </div>
        {#each player.upNext.slice(0, 200) as q, j (q.qid)}
          {@render row(q, player.index + 1 + j, true)}
        {:else}
          <div class="msg">No songs are playing next.</div>
        {/each}
        {#if player.repeat !== 'off' || player.shuffle}
          <div class="flags">{#if player.shuffle}<span><Icon name="shuffle" size={11} /> Shuffle</span>{/if}{#if player.repeat !== 'off'}<span><Icon name="repeat" size={11} /> Repeat</span>{/if}</div>
        {/if}
      {:else}
        {#each history as q (q.qid)}
          {@render row(q, player.queue.indexOf(q), false)}
        {:else}
          <div class="msg">Songs you play will appear here.</div>
        {/each}
      {/if}
    </div>
  {/if}
</aside>

<style>
  .am-panel {
    width: 320px;
    flex-shrink: 0;
    border-left: 1px solid var(--am-sep);
    background: var(--am-side);
    backdrop-filter: blur(30px) saturate(1.8);
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
    overflow: hidden;
    font-size: 13px;
  }
  .seg {
    display: flex;
    margin: 14px 16px 8px;
    padding: 2px;
    border-radius: 7px;
    background: var(--am-fill);
  }
  .seg button {
    flex: 1;
    height: 22px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 500;
    color: var(--am-text);
  }
  .seg button.on {
    background: var(--am-seg-on);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15), 0 0 0 0.5px rgba(0, 0, 0, 0.06);
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 16px;
  }
  .now {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px;
    margin-bottom: 4px;
  }
  .now :global(img),
  .now :global(.ph) {
    width: 48px;
    height: 48px;
    border-radius: 5px;
    object-fit: cover;
  }
  .hd {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding: 10px 8px 6px;
    border-top: 1px solid var(--am-sep);
  }
  .h {
    font-size: 15px;
    font-weight: 700;
  }
  .sub {
    color: var(--am-text-2);
    font-size: 12px;
    margin-top: 2px;
  }
  .clear {
    color: var(--accent);
    font-size: 13px;
  }
  .qrow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 6px;
  }
  .qrow:hover {
    background: var(--am-hover);
  }
  .qrow.over {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .art {
    position: relative;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
  }
  .art :global(img),
  .art :global(.ph) {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
  }
  .pl {
    position: absolute;
    inset: 0;
    display: none;
    place-items: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.45);
    border-radius: 4px;
  }
  .qrow:hover .pl {
    display: grid;
  }
  .m {
    flex: 1;
    min-width: 0;
  }
  .a,
  .b {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .b {
    color: var(--am-text-2);
    font-size: 12px;
  }
  .more {
    color: var(--accent);
    opacity: 0;
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
  }
  .qrow:hover .more {
    opacity: 1;
  }
  .flags {
    display: flex;
    gap: 12px;
    justify-content: center;
    color: var(--am-text-2);
    font-size: 11px;
    padding-top: 12px;
  }
  .flags span {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .msg {
    color: var(--am-text-2);
    text-align: center;
    padding: 40px 16px;
  }
  /* lyrics */
  .am-panel.lyr {
    background: #222;
    color: #fff;
  }
  .lyr-bg {
    position: absolute;
    inset: -40px;
    background-size: cover;
    background-position: center;
    filter: blur(50px) saturate(1.6) brightness(0.6);
    transform: scale(1.3);
  }
  .lyr-body {
    position: relative;
    flex: 1;
    overflow-y: auto;
    padding: 40px 26px 120px;
  }
  .line {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.25;
    margin: 0 0 18px;
    color: rgba(255, 255, 255, 0.35);
    cursor: pointer;
    transition: color 0.25s, transform 0.25s;
    transform-origin: left center;
    filter: blur(0.3px);
  }
  .line.active {
    color: #fff;
    filter: none;
    transform: scale(1.02);
  }
  .line:hover {
    color: rgba(255, 255, 255, 0.7);
  }
  .plain {
    white-space: pre-line;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.5;
  }
  .src {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.55);
    margin-top: 24px;
  }
  .lyr .msg {
    color: rgba(255, 255, 255, 0.7);
  }
</style>
