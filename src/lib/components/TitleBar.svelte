<script lang="ts">
  import Icon from './Icon.svelte';
  import Img from './Img.svelte';
  import { router, go } from '../stores/router.svelte';
  import { auth } from '../stores/auth.svelte';
  import { ui, type MenuAction } from '../stores/ui.svelte';
  import { isTauri } from '../api/transport';
  import { searchSuggestions, removeSearchSuggestion, cardRoute, type Suggestions } from '../api/ytm';
  import { player } from '../player/player.svelte';
  import { artistNames } from '../util/thumbs';
  import type { Item } from '../api/types';

  let q = $state('');
  let focused = $state(false);
  let sugg = $state.raw<Suggestions | null>(null);
  let sel = $state(-1);
  let input: HTMLInputElement;
  let timer: ReturnType<typeof setTimeout>;
  let maximized = $state(false);

  const win = isTauri ? import('@tauri-apps/api/window').then((m) => m.getCurrentWindow()) : null;
  win?.then(async (w) => {
    maximized = await w.isMaximized();
    w.onResized(async () => (maximized = await w.isMaximized()));
  });

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

  function accountMenu(e: MouseEvent) {
    const actions: MenuAction[] = [];
    if (auth.loggedIn) {
      actions.push({ label: auth.account?.name ?? 'Account', icon: 'user', disabled: true });
      actions.push({
        label: 'Switch account',
        icon: 'user',
        submenu: async () => {
          await auth.loadAccounts();
          if (!auth.accounts.length) return [{ label: 'No other accounts', disabled: true }];
          return auth.accounts.map((a) => ({ label: (a.selected ? '✓ ' : '') + a.name + (a.handle ? ` (${a.handle})` : ''), run: () => auth.switchAccount(a) }));
        },
      });
      actions.push({ label: '', divider: true });
    }
    actions.push({ label: 'Settings', icon: 'settings', run: () => go('/settings') });
    actions.push({ label: 'Listening history', icon: 'history', run: () => go('/history') });
    actions.push({ label: '', divider: true });
    if (auth.loggedIn) actions.push({ label: 'Log out', icon: 'logout', run: () => auth.logout() });
    else actions.push({ label: 'Sign in with Google', icon: 'user', run: () => auth.login() });
    ui.openMenu(e, actions);
  }

  export function focusSearch() {
    input?.focus();
  }
</script>

<header class="titlebar">
  <div class="drag" data-tauri-drag-region></div>
  <div class="tb-logo" title="SpotiTube">
    <svg width="32" height="32" viewBox="0 0 512 512"><circle cx="256" cy="256" r="240" fill="var(--accent)" /><circle cx="256" cy="256" r="150" fill="none" stroke="#000" stroke-width="26" opacity=".85" /><path d="M215 180 L345 256 L215 332 Z" fill="#000" stroke="#000" stroke-width="18" stroke-linejoin="round" /></svg>
  </div>
  <div class="tb-nav">
    <button class="round-btn" aria-label="Go back" title="Go back" disabled={!router.canBack} onclick={() => router.back()}><Icon name="chevronLeft" /></button>
    <button class="round-btn" aria-label="Go forward" title="Go forward" disabled={!router.canForward} onclick={() => router.forward()}><Icon name="chevronRight" /></button>
  </div>

  <div class="tb-center">
    <button class="home-btn" class:active={router.route.name === 'home'} title="Home" aria-label="Home" onclick={() => go('/')}>
      <Icon name={router.route.name === 'home' ? 'homeFill' : 'home'} size={24} />
    </button>
    <div class="searchbox" style="position:relative">
      <Icon name="search" size={24} />
      <input
        bind:this={input}
        bind:value={q}
        placeholder="What do you want to play?"
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
      <span class="divider"></span>
      <button class="icon-btn" style="width:28px;height:28px" title="Browse" aria-label="Browse" onclick={() => go('/explore')}><Icon name="explore" size={22} /></button>
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
  </div>

  <div class="tb-right">
    {#if auth.ready && !auth.loggedIn}
      <button class="pill-btn ghost" onclick={() => go('/settings')}>Settings</button>
      <button class="pill-btn" onclick={() => auth.login()}>Log in</button>
    {/if}
    <button class="avatar-btn" aria-label="Account" title={auth.account?.name ?? 'Account'} onclick={accountMenu}>
      {#if auth.account?.photo}
        <img src={auth.account.photo} alt="" />
      {:else}
        <span class="avatar-fallback">{(auth.account?.name ?? '?')[0]?.toUpperCase()}</span>
      {/if}
    </button>
    {#if isTauri}
      <div class="win-controls">
        <button aria-label="Minimize" onclick={async () => (await win)?.minimize()}><Icon name="winMin" size={16} /></button>
        <button aria-label="Maximize" onclick={async () => (await win)?.toggleMaximize()}><Icon name={maximized ? 'winRestore' : 'winMax'} size={16} /></button>
        <button class="close" aria-label="Close" onclick={async () => { player.save(); (await win)?.close(); }}><Icon name="winClose" size={16} /></button>
      </div>
    {/if}
  </div>
</header>
