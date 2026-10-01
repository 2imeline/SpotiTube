<script lang="ts">
  import Icon from './Icon.svelte';
  import Img from './Img.svelte';
  import { library } from '../stores/library.svelte';
  import { auth } from '../stores/auth.svelte';
  import { ui } from '../stores/ui.svelte';
  import { go, router } from '../stores/router.svelte';
  import { player } from '../player/player.svelte';
  import { cardMenu, newPlaylistDialog, playCard } from '../actions';
  import { cardRoute, getLibrary, loadAll, LIBRARY, type LibraryOrder } from '../api/ytm';
  import type { Card } from '../api/types';
  import { uploadFiles } from '../upload';

  type Tab = 'playlists' | 'albums' | 'artists' | 'podcasts';
  let tab = $state<Tab>('playlists');
  let order = $state<LibraryOrder>(undefined);
  let filter = $state('');
  let searching = $state(false);
  let other = $state.raw<Card[]>([]);
  let loading = $state(false);
  let fileInput: HTMLInputElement;

  const sources: Record<Exclude<Tab, 'playlists'>, string> = { albums: LIBRARY.albums, artists: LIBRARY.subscriptions, podcasts: LIBRARY.podcasts };

  $effect(() => {
    const t = tab;
    const o = order;
    auth.version;
    if (t === 'playlists') return;
    if (!auth.loggedIn) {
      other = [];
      return;
    }
    loading = true;
    getLibrary(sources[t], o)
      .then((p) => loadAll(p, 500))
      .then((items) => (other = items.filter((i): i is Card => i.kind === 'card')))
      .catch((e) => ui.error(e))
      .finally(() => (loading = false));
  });

  const base = $derived(tab === 'playlists' ? library.playlists : other);
  const list = $derived.by(() => {
    let l = base;
    if (tab === 'playlists' && order === 'a_to_z') l = [...l].sort((a, b) => a.title.localeCompare(b.title));
    if (tab === 'playlists' && order === 'z_to_a') l = [...l].sort((a, b) => b.title.localeCompare(a.title));
    const f = filter.trim().toLowerCase();
    if (f) l = l.filter((c) => c.title.toLowerCase().includes(f) || c.subtitle.toLowerCase().includes(f));
    return l;
  });

  function createMenu(e: MouseEvent) {
    ui.openMenu(e, [
      { label: 'Create a new playlist', icon: 'plus', run: () => newPlaylistDialog().then((id) => id && go(`/playlist/${id}`)) },
      { label: 'Upload music', icon: 'upload', run: () => (auth.loggedIn ? fileInput.click() : ui.toast('Sign in to upload music')) },
    ]);
  }

  function sortMenu(e: MouseEvent) {
    const opt = (label: string, v: LibraryOrder) => ({ label: (order === v ? '✓ ' : '') + label, run: () => (order = v) });
    ui.openMenu(e, [opt('Recents', undefined), opt('Alphabetical', 'a_to_z'), opt('Reverse alphabetical', 'z_to_a'), opt('Recently added', 'recently_added')]);
  }

  const kindLabel = (c: Card) => {
    if (c.type === 'artist' || c.type === 'profile') return 'Artist';
    if (c.browseId === 'VLLM') return `Playlist • Auto playlist`;
    return c.subtitle;
  };
  const isPlaying = (c: Card) => !!player.source?.path && player.source.path === cardRoute(c);
  const isActive = (c: Card) => router.route.path === cardRoute(c);
</script>

<input type="file" accept=".mp3,.m4a,.wma,.flac,.ogg,audio/*" multiple hidden bind:this={fileInput} onchange={() => { uploadFiles(fileInput.files); fileInput.value = ''; }} />

<nav class="sidebar" aria-label="Your Library">
  <div class="lib-header">
    <button class="lib-title" title={ui.sidebarCollapsed ? 'Expand Your Library' : 'Collapse Your Library'} onclick={() => (ui.sidebarCollapsed = !ui.sidebarCollapsed)}>
      <Icon name="library" size={24} />{#if !ui.sidebarCollapsed}<span>Your Library</span>{/if}
    </button>
    {#if !ui.sidebarCollapsed}
      <button class="create-btn" onclick={createMenu} title="Create playlist or upload"><Icon name="plus" size={16} />Create</button>
    {/if}
  </div>

  {#if !ui.sidebarCollapsed}
    <div class="chips">
      {#each [['playlists', 'Playlists'], ['albums', 'Albums'], ['artists', 'Artists'], ['podcasts', 'Podcasts']] as [k, label]}
        <button class="chip" class:active={tab === k} onclick={() => (tab = tab === k && k !== 'playlists' ? 'playlists' : (k as Tab))}>{label}</button>
      {/each}
    </div>
    <div class="lib-tools">
      <div class="lib-search" class:open={searching}>
        <button class="icon-btn" style="width:28px;height:28px" aria-label="Search in Your Library" onclick={() => (searching = !searching)}><Icon name="search" size={16} /></button>
        {#if searching}
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={filter} placeholder="Search in Your Library" autofocus onblur={() => !filter && (searching = false)} />
        {/if}
      </div>
      <button class="sort-btn" onclick={sortMenu}>{order === 'a_to_z' ? 'Alphabetical' : order === 'z_to_a' ? 'Z–A' : order === 'recently_added' ? 'Recently added' : 'Recents'}<Icon name="list" size={14} /></button>
    </div>
  {/if}

  <div class="lib-list">
    {#if !auth.loggedIn && auth.ready}
      {#if !ui.sidebarCollapsed}
        <div class="lib-empty">
          <h4>Sign in to see your library</h4>
          <p>Your playlists, liked songs, albums and subscriptions from YouTube Music appear here.</p>
          <button class="pill-btn" onclick={() => auth.login()}>Log in</button>
        </div>
      {/if}
    {:else}
      {#if tab === 'playlists' && !filter}
        <div class="lib-item" class:active={router.route.name === 'history'} role="button" tabindex="0" title="Listening history" onclick={() => go('/history')} onkeydown={(e) => e.key === 'Enter' && go('/history')}>
          <div class="thumb saved-art"><Icon name="history" size={22} /></div>
          {#if !ui.sidebarCollapsed}<div class="meta"><div class="name">History</div><div class="sub">Recently played</div></div>{/if}
        </div>
        <div class="lib-item" class:active={router.route.name === 'uploads'} role="button" tabindex="0" title="Uploads" onclick={() => go('/uploads')} onkeydown={(e) => e.key === 'Enter' && go('/uploads')}>
          <div class="thumb" style="display:grid;place-items:center;background:linear-gradient(135deg,#e8115b,#f59b23)"><Icon name="upload" size={22} /></div>
          {#if !ui.sidebarCollapsed}<div class="meta"><div class="name">Uploads</div><div class="sub">Your uploaded music</div></div>{/if}
        </div>
      {/if}
      {#if loading && tab !== 'playlists'}
        {#each Array(6) as _}<div class="lib-item"><div class="thumb skeleton"></div>{#if !ui.sidebarCollapsed}<div class="meta"><div class="skeleton" style="height:14px;width:70%"></div><div class="skeleton" style="height:12px;width:40%;margin-top:6px"></div></div>{/if}</div>{/each}
      {/if}
      {#each list as c (c.browseId ?? c.playlistId ?? c.title)}
        {@const round = c.type === 'artist' || c.type === 'profile'}
        <div
          class="lib-item"
          class:playing={isPlaying(c)}
          class:active={isActive(c)}
          role="button"
          tabindex="0"
          title={c.title}
          onclick={() => { const r = cardRoute(c); if (r) go(r); }}
          ondblclick={() => playCard(c)}
          onkeydown={(e) => e.key === 'Enter' && playCard(c)}
          oncontextmenu={(e) => ui.openMenu(e, cardMenu(c), c)}
        >
          {#if c.browseId === 'VLLM'}
            <div class="thumb liked-art"><Icon name="heartFill" size={20} /></div>
          {:else}
            <Img thumbs={c.thumbnails} size={48} class="thumb {round ? 'round' : ''}" icon={round ? 'user' : 'music'} />
          {/if}
          {#if !ui.sidebarCollapsed}
            <div class="meta">
              <div class="name">{c.browseId === 'VLLM' ? 'Liked Music' : c.title}</div>
              <div class="sub">{#if c.menu?.pinned}<Icon name="pin" size={12} />{/if}{kindLabel(c)}</div>
            </div>
            {#if isPlaying(c) && player.playing}<Icon name="volume" size={16} class="accent-ico" />{/if}
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</nav>

<style>
  :global(.accent-ico) {
    color: var(--accent);
  }
</style>
