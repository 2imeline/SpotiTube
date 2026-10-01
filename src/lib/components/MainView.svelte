<script lang="ts">
  import { router } from '../stores/router.svelte';
  import { ui } from '../stores/ui.svelte';
  import Home from '../views/Home.svelte';
  import Search from '../views/Search.svelte';
  import Browse from '../views/Browse.svelte';
  import Artist from '../views/Artist.svelte';
  import Album from '../views/Album.svelte';
  import Playlist from '../views/Playlist.svelte';
  import Podcast from '../views/Podcast.svelte';
  import Library from '../views/Library.svelte';
  import History from '../views/History.svelte';
  import Lyrics from '../views/Lyrics.svelte';
  import Settings from '../views/Settings.svelte';
  import { tick } from 'svelte';

  let scroller: HTMLDivElement;
  const r = $derived(router.route);
  const key = $derived(router.pos + '|' + r.path);

  // save / restore scroll position per history entry
  let lastPos = -1;
  $effect(() => {
    const pos = router.pos;
    r.path;
    if (lastPos >= 0 && scroller) router.scroll.set(lastPos, scroller.scrollTop);
    lastPos = pos;
    const y = router.scroll.get(pos) ?? 0;
    tick().then(() => {
      scroller.scrollTop = 0;
      ui.scrollY = 0;
      if (y) setTimeout(() => (scroller.scrollTop = y), 250);
    });
  });
</script>

<main class="main-view">
  <div class="main-scroll" bind:this={scroller} onscroll={() => (ui.scrollY = scroller.scrollTop)}>
    {#key key}
      {#if r.name === 'home'}
        <Home />
      {:else if r.name === 'search'}
        <Search />
      {:else if r.name === 'explore'}
        <Browse browseId="FEmusic_explore" title="Explore" />
      {:else if r.name === 'charts'}
        <Browse browseId="FEmusic_charts" title="Charts" kind="charts" />
      {:else if r.name === 'moods'}
        <Browse browseId="FEmusic_moods_and_genres" title="Moods & genres" />
      {:else if r.name === 'mood'}
        <Browse browseId="FEmusic_moods_and_genres_category" params={r.params[0]} title={r.query.get('t') ?? undefined} />
      {:else if r.name === 'browse'}
        <Browse browseId={r.params[0]} params={r.query.get('p') ?? undefined} title={r.params[0] === 'FEmusic_new_releases' ? 'New releases' : undefined} />
      {:else if r.name === 'artist'}
        <Artist id={r.params[0]} />
      {:else if r.name === 'album'}
        <Album id={r.params[0]} />
      {:else if r.name === 'playlist'}
        <Playlist id={r.params[0]} />
      {:else if r.name === 'podcast'}
        <Podcast id={r.params[0]} />
      {:else if r.name === 'episode'}
        <Podcast id={r.params[0]} episode />
      {:else if r.name === 'library'}
        <Library />
      {:else if r.name === 'uploads'}
        <Library mode="uploads" />
      {:else if r.name === 'history'}
        <History />
      {:else if r.name === 'lyrics'}
        <Lyrics />
      {:else if r.name === 'settings'}
        <Settings />
      {:else}
        <div class="center-msg"><h2>Page not found</h2></div>
      {/if}
    {/key}
  </div>
</main>
