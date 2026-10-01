<script lang="ts">
  import { getLibrary, LIBRARY, type LibraryOrder } from '../api/ytm';
  import type { Card, Item, Paged, Track } from '../api/types';
  import TrackList from '../components/TrackList.svelte';
  import CardView from '../components/Card.svelte';
  import Loading from '../components/Loading.svelte';
  import { auth } from '../stores/auth.svelte';
  import { router, go } from '../stores/router.svelte';
  import { uploadFiles } from '../upload';

  let { mode = 'library' }: { mode?: 'library' | 'uploads' } = $props();

  const TABS: Record<string, [string, string][]> = {
    library: [
      ['playlists', 'Playlists'],
      ['songs', 'Songs'],
      ['albums', 'Albums'],
      ['artists', 'Artists'],
      ['subscriptions', 'Subscriptions'],
      ['podcasts', 'Podcasts'],
      ['channels', 'Channels'],
    ],
    uploads: [
      ['uploadSongs', 'Songs'],
      ['uploadAlbums', 'Albums'],
      ['uploadArtists', 'Artists'],
    ],
  };
  const tab = $derived(router.route.query.get('tab') ?? TABS[mode][0][0]);
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
      const p = await getLibrary((LIBRARY as any)[tab], order);
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
    auth.version;
    load();
  });
  async function loadMore() {
    if (!cont) return;
    const p = await cont();
    cont = p.continuation;
    items = [...items, ...p.items];
  }
  const tracks = $derived(items.filter((i): i is Track => i.kind === 'track'));
  const cards = $derived(items.filter((i): i is Card => i.kind === 'card'));
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
</script>

<input type="file" accept=".mp3,.m4a,.wma,.flac,.ogg,audio/*" multiple hidden bind:this={fileInput} onchange={() => { uploadFiles(fileInput.files); fileInput.value = ''; }} />

<div class="view">
  <div class="view-bg" style="background:linear-gradient(rgba(var(--accent-rgb),.2),transparent);height:240px"></div>
  <div class="view-pad">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding-top:40px">
      <h1 class="page-title" style="font-size:48px;margin:0">{mode === 'uploads' ? 'Uploads' : 'Your Library'}</h1>
      <div style="display:flex;gap:8px;align-items:center">
        {#if mode === 'uploads'}<button class="pill-btn" onclick={() => fileInput.click()}>Upload music</button>{/if}
        <select class="input" style="width:auto" bind:value={order} aria-label="Sort">
          <option value={undefined}>Recents</option>
          <option value="a_to_z">A–Z</option>
          <option value="z_to_a">Z–A</option>
          <option value="recently_added">Recently added</option>
        </select>
      </div>
    </div>
    <div class="chips" style="padding:20px 0 8px">
      {#each TABS[mode] as [k, label]}
        <button class="chip" class:active={tab === k} onclick={() => go(`/${mode}?tab=${k}`, true)}>{label}</button>
      {/each}
      {#if mode === 'library'}<button class="chip" onclick={() => go('/playlist/LM')}>Liked Music</button><button class="chip" onclick={() => go('/playlist/SE')}>Episodes for later</button><button class="chip" onclick={() => go('/uploads')}>Uploads</button>{/if}
    </div>
  </div>
  {#if !auth.loggedIn}
    <div class="center-msg"><h2>Sign in to see your library</h2><button class="pill-btn" onclick={() => auth.login()}>Log in</button></div>
  {:else if error}
    <Loading {error} retry={load} />
  {:else if !loaded}
    <Loading />
  {:else if !items.length}
    <div class="center-msg"><h2>Nothing here yet</h2><div>Things you save on YouTube Music show up here.</div></div>
  {:else if tracks.length >= cards.length}
    <TrackList {tracks} source={{ title: mode === 'uploads' ? 'Uploads' : 'Library songs', path: router.route.path }} loadMore={cont ? loadMore : undefined} ctx={{ onRemoved: load }} />
  {:else}
    <div class="view-pad">
      <div class="card-grid">{#each cards as c, i (i)}<CardView card={c} onRemoved={load} />{/each}</div>
      <div bind:this={sentinel} class="load-more"></div>
    </div>
  {/if}
</div>
