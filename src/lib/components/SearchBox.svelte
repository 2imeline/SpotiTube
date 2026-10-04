<script lang="ts">
  import Icon from './Icon.svelte';
  import Img from './Img.svelte';
  import { router, go } from '../stores/router.svelte';
  import { searchSuggestions, removeSearchSuggestion, cardRoute, type Suggestions } from '../api/ytm';
  import { player } from '../player/player.svelte';
  import { artistNames } from '../util/thumbs';
  import type { Item } from '../api/types';

  let { placeholder = 'What do you want to play?', variant = 'spotify' }: { placeholder?: string; variant?: 'spotify' | 'aero' | 'apple' } = $props();

  let q = $state('');
  let focused = $state(false);
  let sugg = $state.raw<Suggestions | null>(null);
  let sel = $state(-1);
  let input: HTMLInputElement;
  let timer: ReturnType<typeof setTimeout>;
  // keep the box in sync with the route
  $effect(() => {
    if (router.route.name === 'search' && !focused) q = router.route.query.get('q') ?? '';
    if (router.route.name !== 'search' && !focused) q = '';
  });

  function onInput() {
    clearTimeout(timer);
    sel = -1;
    const v = q;
    if (!v.trim()) {
      sugg = null;
      if (router.route.name === 'search') go('/search', true);
      return;
    }
    timer = setTimeout(async () => {
      try {
        const s = await searchSuggestions(v);
        if (q === v) sugg = s;
      } catch {
        sugg = null;
      }
    }, 160);
  }

  function submit(text = q) {
    if (!text.trim()) return;
    q = text;
    sugg = null;
    input.blur();
    const f = router.route.name === 'search' ? router.route.query.get('f') : null;
    go(`/search?q=${encodeURIComponent(text)}${f ? '&f=' + f : ''}`, router.route.name === 'search');
  }

  function openItem(i: Item) {
    sugg = null;
    input.blur();
    if (i.kind === 'track') player.playTrack(i);
    else {
      const r = cardRoute(i);
      if (r) go(r);
    }
  }

  const rows = $derived([...(sugg?.queries ?? []).map((x) => ({ q: x })), ...(sugg?.items ?? []).map((x) => ({ i: x }))]);

  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      sel = Math.min(rows.length - 1, sel + 1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      sel = Math.max(-1, sel - 1);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const r = rows[sel];
      if (r && 'q' in r) submit(r.q!.text);
      else if (r && 'i' in r) openItem(r.i!);
      else submit();
    } else if (e.key === 'Escape') {
      sugg = null;
      input.blur();
    }
  }
</script>

<div class="searchbox {variant}" style="position:relative">
  {#if variant === 'apple'}<Icon name="search" size={13} />{:else if variant !== 'aero'}<Icon name="search" size={24} />{/if}
  <input
    bind:this={input}
    bind:value={q}
    {placeholder}
    spellcheck="false"
    oninput={onInput}
    onkeydown={key}
    onfocus={() => {
      focused = true;
      if (router.route.name !== 'search') go('/search');
      if (q) onInput();
    }}
    onblur={() => setTimeout(() => ((focused = false), (sugg = null)), 150)}
  />
  {#if q}
    <button class="icon-btn" style="width:24px;height:24px" aria-label="Clear search" onclick={() => { q = ''; sugg = null; go('/search', true); input.focus(); }}><Icon name="close" size={16} /></button>
  {/if}
  {#if variant === 'aero'}
    <button class="search-go" aria-label="Search" onclick={() => submit()}><Icon name="search" size={16} /></button>
  {:else if variant === 'spotify'}
    <span class="divider"></span>
    <button class="icon-btn" style="width:28px;height:28px" title="Browse" aria-label="Browse" onclick={() => go('/explore')}><Icon name="explore" size={22} /></button>
  {/if}
  {#if sugg && focused && rows.length}
    <div class="suggest" role="listbox">
      {#each rows as r, i}
        {#if 'q' in r && r.q}
          <div class="row" class:sel={sel === i} role="option" aria-selected={sel === i} tabindex="-1" onmousedown={(e) => { e.preventDefault(); submit(r.q!.text); }}>
            <Icon name={r.q.fromHistory ? 'history' : 'search'} size={16} />
            <span>{r.q.text}</span>
            {#if r.q.fromHistory && r.q.token}
              <button class="x icon-btn" style="width:24px;height:24px" aria-label="Remove from history" onmousedown={(e) => { e.preventDefault(); e.stopPropagation(); removeSearchSuggestion(r.q!.token!); sugg = sugg ? { ...sugg, queries: sugg.queries.filter((x) => x !== r.q) } : null; }}><Icon name="close" size={12} /></button>
            {/if}
          </div>
        {:else if 'i' in r && r.i}
          {@const it = r.i}
          <div class="row" class:sel={sel === i} role="option" aria-selected={sel === i} tabindex="-1" onmousedown={(e) => { e.preventDefault(); openItem(it); }}>
            <Img thumbs={it.thumbnails} size={40} class={it.kind === 'card' && it.type === 'artist' ? 'round' : ''} />
            <div style="min-width:0">
              <div>{it.title}</div>
              <div class="sub">{it.kind === 'track' ? `${it.type === 'video' ? 'Video' : 'Song'} • ${artistNames(it.artists)}` : it.subtitle || it.type}</div>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>