<script lang="ts">
  import { getHome } from '../api/ytm';
  import type { BrowsePage, Card, Chip, Shelf } from '../api/types';
  import ShelfView from '../components/Shelf.svelte';
  import Loading from '../components/Loading.svelte';
  import Img from '../components/Img.svelte';
  import PlayButton from '../components/PlayButton.svelte';
  import { auth } from '../stores/auth.svelte';
  import { library } from '../stores/library.svelte';
  import { playCard, openCard } from '../actions';
  import { cardRoute } from '../api/ytm';
  import { player } from '../player/player.svelte';
  import { ui } from '../stores/ui.svelte';
  import { cardMenu } from '../actions';
  import { isMobile } from '../native/platform';
  import { settings } from '../stores/settings.svelte';
  import PageHead from '../mobile/PageHead.svelte';

  let page = $state.raw<BrowsePage | null>(null);
  let shelves = $state.raw<Shelf[]>([]);
  let chips = $state.raw<Chip[]>([]);
  let chip = $state<string | undefined>(undefined);
  let error = $state<string | null>(null);
  let more: BrowsePage['more'];
  let loadingMore = $state(false);
  let sentinel: HTMLDivElement | undefined = $state();

  async function load() {
    error = null;
    try {
      const p = await getHome(chip);
      page = p;
      shelves = p.shelves;
      if (!chip || !chips.length) chips = p.chips ?? [];
      more = p.more;
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }
  $effect(() => {
    auth.version;
    chip;
    load();
  });

  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver(async (en) => {
      if (!en[0].isIntersecting || loadingMore || !more) return;
      loadingMore = true;
      try {
        const r = await more();
        more = r.more;
        shelves = [...shelves, ...r.shelves];
      } catch {
        more = undefined;
      } finally {
        loadingMore = false;
      }
    }, { rootMargin: '800px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // Spotify-style quick tiles: library playlists when signed in, else first shelf
  const tiles = $derived.by((): Card[] => {
    const lib = library.playlists.slice(0, 8);
    if (lib.length >= 4) return lib;
    const isTile = (i: any): i is Card => i.kind === 'card' && i.type !== 'mood';
    const first = shelves.find((s) => s.items.filter(isTile).length >= 4);
    return (first?.items.filter(isTile) ?? []).slice(0, 8);
  });
</script>

<div class="view">
  <div class="view-bg" style="background:linear-gradient(rgba(var(--accent-rgb),.22),transparent);height:280px"></div>
  <div class="view-pad" style="padding-top:12px">
    {#if isMobile && settings.theme !== 'spotify'}<PageHead title="Home" large={settings.theme === 'apple'} />{/if}
    {#if chips.length || (isMobile && settings.theme === 'spotify')}
      <div class="chips m-home-chips" style="padding:8px 0 0">
        {#if isMobile && settings.theme === 'spotify'}<PageHead />{/if}
        <button class="chip" class:active={!chip} onclick={() => (chip = undefined)}>All</button>
        {#each chips as c}
          <button class="chip" class:active={chip === c.params} onclick={() => (chip = chip === c.params ? undefined : c.params)}>{c.title}</button>
        {/each}
      </div>
    {/if}
    {#if !page && !error}
      <Loading />
    {:else if error}
      <Loading {error} retry={load} />
    {:else}
      {#if !chip}
        <h1 class="greeting">{greeting}{auth.account?.name && auth.loggedIn ? `, ${auth.account.name.split(' ')[0]}` : ''}</h1>
        {#if tiles.length}
          <div class="quick-grid">
            {#each tiles as c}
              <div class="quick-tile" role="button" tabindex="0" onclick={() => openCard(c)} onkeydown={(e) => e.key === 'Enter' && openCard(c)} oncontextmenu={(e) => ui.openMenu(e, cardMenu(c), c)}>
                {#if c.browseId === 'VLLM'}
                  <div class="ph liked-art"><svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M5.21 1.57a6.76 6.76 0 0 1 6.79 1.85 6.76 6.76 0 0 1 9.53 9.53l-9.53 9.53-9.53-9.53A6.76 6.76 0 0 1 5.21 1.57z" /></svg></div>
                {:else}
                  <Img thumbs={c.thumbnails} size={64} />
                {/if}
                <div class="t">{c.browseId === 'VLLM' ? 'Liked Music' : c.title}</div>
                <PlayButton playing={player.playing && player.source?.path === cardRoute(c)} onclick={() => (player.source?.path === cardRoute(c) ? player.toggle() : playCard(c))} />
              </div>
            {/each}
          </div>
        {/if}
      {/if}
      {#each shelves as s, i (i)}<ShelfView shelf={s} />{/each}
      <div bind:this={sentinel} class="load-more">{#if loadingMore}<span class="spinner"></span>{/if}</div>
    {/if}
  </div>
</div>
