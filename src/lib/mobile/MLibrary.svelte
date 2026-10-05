<script lang="ts">
  // Phone "Your Library": Spotify-style list with filter chips, or the Apple
  // Music category list. Desktop keeps its grid view.
  import { getLibrary, LIBRARY, type LibraryOrder } from '../api/ytm';
  import type { Card, Item, Paged, Track } from '../api/types';
  import TrackList from '../components/TrackList.svelte';
  import Img from '../components/Img.svelte';
  import Icon from '../components/Icon.svelte';
  import PageHead from './PageHead.svelte';
  import { auth } from '../stores/auth.svelte';
  import { router, go } from '../stores/router.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import { openCard, cardMenu, newPlaylistDialog } from '../actions';
  import { uploadFiles } from '../upload';

  let { mode = 'library' }: { mode?: 'library' | 'uploads' } = $props();

  const CHIPS: Record<string, [string, string][]> = {
    library: [
      ['playlists', 'Playlists'],
      ['albums', 'Albums'],
      ['subscriptions', 'Artists'],
      ['songs', 'Songs'],
      ['podcasts', 'Podcasts'],
    ],
    uploads: [
      ['uploadSongs', 'Songs'],
      ['uploadAlbums', 'Albums'],
      ['uploadArtists', 'Artists'],
    ],
  };
  const APPLE_CATS: [string, string, string][] = [
    ['playlists', 'Playlists', 'list'],
    ['subscriptions', 'Artists', 'artist'],
    ['albums', 'Albums', 'album'],
    ['songs', 'Songs', 'music'],
    ['podcasts', 'Podcasts', 'podcast'],
  ];
  const appleRoot = $derived(settings.theme === 'apple' && mode === 'library' && !router.route.query.get('tab'));
  const tab = $derived(router.route.query.get('tab') ?? CHIPS[mode][0][0]);
  let order = $state<LibraryOrder>(undefined);
  let items = $state.raw<Item[]>([]);
  let cont = $state.raw<Paged['continuation']>(undefined);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let fileInput: HTMLInputElement;

  async function load() {
    loaded = false;
    error = null;
    items = [];
    if (!auth.loggedIn) return;
    try {
      const key = appleRoot ? 'albums' : tab;
      const p = await getLibrary((LIBRARY as any)[key], appleRoot ? 'recently_added' : order);
      items = p.items;
      cont = p.continuation;
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
    loaded = true;
  }
  $effect(() => {
    tab;
    order;
    appleRoot;
    auth.version;
    load();
  });
  async function loadMore() {
    if (!cont) return;
    const p = await cont();
    cont = p.continuation;
    items = [...items, ...p.items];
  }
  let sentinel: HTMLDivElement | undefined = $state();
  let busy = false;
  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver(async (en) => {
      if (en[0].isIntersecting && cont && !busy) {
        busy = true;
        await loadMore().catch(() => {});
        busy = false;
      }
    }, { rootMargin: '600px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  const tracks = $derived(items.filter((i): i is Track => i.kind === 'track'));
  const cards = $derived(items.filter((i): i is Card => i.kind === 'card' && i.browseId !== 'VLLM' && i.browseId !== 'VLSE'));
  const typeLabel: Record<string, string> = { album: 'Album', single: 'Single', ep: 'EP', playlist: 'Playlist', artist: 'Artist', profile: 'Profile', podcast: 'Podcast' };
  const orderLabel: Record<string, string> = { '': 'Recents', a_to_z: 'Alphabetical', z_to_a: 'Z–A', recently_added: 'Recently added' };

  function sortMenu(e: MouseEvent) {
    ui.openMenu(e, (['', 'recently_added', 'a_to_z', 'z_to_a'] as const).map((k) => ({ label: (order ?? '') === k ? `✓ ${orderLabel[k]}` : orderLabel[k], run: () => (order = (k || undefined) as LibraryOrder) })));
  }
  function setTab(k: string) {
    go(`/${mode}?tab=${k}`, true);
  }
</script>

<input type="file" accept=".mp3,.m4a,.wma,.flac,.ogg,audio/*" multiple hidden bind:this={fileInput} onchange={() => { uploadFiles(fileInput.files); fileInput.value = ''; }} />

<div class="view m-lib">
  {#if appleRoot}
    <PageHead title="Library" large />
    <div class="m-lib-cats">
      {#each APPLE_CATS as [k, label, icon]}
        <button class="m-lib-cat" onclick={() => go(`/library?tab=${k}`)}><Icon name={icon} size={22} /><span>{label}</span><Icon name="chevronRight" size={16} /></button>
      {/each}
      <button class="m-lib-cat" onclick={() => go('/playlist/LM')}><Icon name="starFill" size={22} /><span>Favorite Songs</span><Icon name="chevronRight" size={16} /></button>
      <button class="m-lib-cat" onclick={() => go('/uploads')}><Icon name="upload" size={22} /><span>Uploads</span><Icon name="chevronRight" size={16} /></button>
      <button class="m-lib-cat" onclick={() => go('/me')}><Icon name="user" size={22} /><span>Profile &amp; Friends</span><Icon name="chevronRight" size={16} /></button>
    </div>
    {#if auth.loggedIn && cards.length}
      <h2 class="m-section-title">Recently Added</h2>
      <div class="m-grid">
        {#each cards.slice(0, 24) as c, i (i)}
          <button class="m-grid-item" onclick={() => openCard(c)}>
            <Img thumbs={c.thumbnails} size={300} />
            <div class="t">{c.title}</div>
            <div class="s">{c.subtitle}</div>
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    {#if settings.theme === 'apple'}
      <div class="m-apple-sub"><h1 class="m-head-title">{CHIPS.library.find((c) => c[0] === tab)?.[1] ?? 'Uploads'}</h1></div>
    {:else}
      <PageHead title={mode === 'uploads' ? 'Uploads' : 'Your Library'}>
        {#snippet actions()}
          <button class="icon-btn" aria-label="Search" onclick={() => go('/search')}><Icon name="search" size={24} /></button>
          <button class="icon-btn" aria-label={mode === 'uploads' ? 'Upload' : 'Create playlist'} onclick={() => (mode === 'uploads' ? fileInput.click() : newPlaylistDialog())}><Icon name="plus" size={26} /></button>
        {/snippet}
      </PageHead>
      <div class="chips m-chips">
        {#each CHIPS[mode] as [k, label]}
          <button class="chip" class:active={tab === k} onclick={() => setTab(k)}>{label}</button>
        {/each}
        {#if mode === 'library'}<button class="chip" onclick={() => go('/uploads')}>Uploads</button>{/if}
      </div>
    {/if}
    {#if !auth.loggedIn}
      <div class="center-msg"><h2>Sign in to see your library</h2><div>Your playlists, saved albums, artists and songs from YouTube Music.</div><button class="pill-btn" onclick={() => auth.login()}>Sign in</button></div>
    {:else}
      <div class="m-sort">
        <button onclick={sortMenu}><Icon name="sort" size={14} /> {orderLabel[order ?? '']}</button>
      </div>
      {#if mode === 'library' && tab === 'playlists'}
        <button class="m-row" onclick={() => go('/playlist/LM')}>
          <div class="m-row-art liked-art"><Icon name="heartFill" size={24} /></div>
          <div class="m-row-text"><div class="t">Liked Music</div><div class="s"><Icon name="pinFill" size={12} /> Playlist • Auto playlist</div></div>
        </button>
        <button class="m-row" onclick={() => go('/playlist/SE')}>
          <div class="m-row-art episodes-art"><Icon name="podcast" size={24} /></div>
          <div class="m-row-text"><div class="t">Episodes for later</div><div class="s"><Icon name="pinFill" size={12} /> Saved episodes</div></div>
        </button>
      {/if}
      {#if error}
        <div class="center-msg"><div>{error}</div><button class="pill-btn" onclick={load}>Try again</button></div>
      {:else if !loaded}
        {#each Array(6) as _}<div class="m-row skeleton-row"><div class="m-row-art skeleton"></div><div class="m-row-text"><div class="skeleton" style="height:14px;width:60%"></div><div class="skeleton" style="height:12px;width:40%;margin-top:8px"></div></div></div>{/each}
      {:else if tracks.length > cards.length}
        <TrackList {tracks} source={{ title: mode === 'uploads' ? 'Uploads' : 'Library songs', path: router.route.path }} loadMore={cont ? loadMore : undefined} ctx={{ onRemoved: load }} />
      {:else if !cards.length}
        <div class="center-msg"><h2>Nothing here yet</h2><div>Things you save on YouTube Music show up here.</div></div>
      {:else}
        {#each cards as c, i (i)}
          {@const round = c.type === 'artist' || c.type === 'profile'}
          <div class="m-row" role="button" tabindex="0" onclick={() => openCard(c)} onkeydown={(e) => e.key === 'Enter' && openCard(c)}>
            <Img thumbs={c.thumbnails} size={128} class="m-row-art {round ? 'round' : ''}" icon={round ? 'user' : 'music'} />
            <div class="m-row-text">
              <div class="t">{c.title}</div>
              <div class="s">{typeLabel[c.type] ?? ''}{c.subtitle ? ` • ${c.subtitle}` : ''}</div>
            </div>
            <button class="icon-btn" aria-label="More" onclick={(e) => { e.stopPropagation(); ui.openMenu(e, cardMenu(c, { onRemoved: load }), c); }}><Icon name="more" size={20} /></button>
          </div>
        {/each}
        <div bind:this={sentinel} class="load-more"></div>
      {/if}
    {/if}
  {/if}
</div>
