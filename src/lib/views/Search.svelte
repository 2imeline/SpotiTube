<script lang="ts">
  import { search, getMoodsAndGenres, type SearchFilter, type SearchResult } from '../api/ytm';
  import type { Card, Item, Paged, Shelf, Track } from '../api/types';
  import ShelfView from '../components/Shelf.svelte';
  import CardView from '../components/Card.svelte';
  import TrackList from '../components/TrackList.svelte';
  import Img from '../components/Img.svelte';
  import PlayButton from '../components/PlayButton.svelte';
  import Loading from '../components/Loading.svelte';
  import { router, go } from '../stores/router.svelte';
  import { openCard, playCard, itemMenu } from '../actions';
  import { player } from '../player/player.svelte';
  import { auth } from '../stores/auth.svelte';
  import { artistNames } from '../util/thumbs';

  const FILTERS: [SearchFilter | '', string][] = [
    ['', 'All'],
    ['songs', 'Songs'],
    ['videos', 'Videos'],
    ['albums', 'Albums'],
    ['artists', 'Artists'],
    ['community_playlists', 'Community playlists'],
    ['featured_playlists', 'Featured playlists'],
    ['podcasts', 'Podcasts'],
    ['episodes', 'Episodes'],
    ['profiles', 'Profiles'],
  ];

  const q = $derived(router.route.query.get('q') ?? '');
  const f = $derived((router.route.query.get('f') ?? '') as SearchFilter | '');
  let res = $state.raw<SearchResult | null>(null);
  let items = $state.raw<Item[]>([]);
  let cont = $state.raw<Paged['continuation']>(undefined);
  let error = $state<string | null>(null);
  let browse = $state.raw<Shelf[] | null>(null);
  const PALETTE = ['#e13300', '#1e3264', '#e8115b', '#148a08', '#bc5900', '#8d67ab', '#477d95', '#503750', '#ba5d07', '#0d73ec', '#af2896', '#27856a', '#e91429', '#777777', '#509bf5', '#dc148c'];

  async function load() {
    error = null;
    res = null;
    if (!q) return;
    try {
      const r = await search(q, f || undefined);
      res = r;
      items = r.list?.items ?? [];
      cont = r.list?.continuation;
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }
  $effect(() => {
    q;
    f;
    auth.version;
    load();
  });
  $effect(() => {
    if (!q && !browse) getMoodsAndGenres().then((p) => (browse = p.shelves)).catch(() => (browse = []));
  });

  function setFilter(v: string) {
    go(`/search?q=${encodeURIComponent(q)}${v ? '&f=' + v : ''}`, true);
  }

  const top = $derived(res?.shelves.find((s) => s.text === 'top'));
  const topItem = $derived(top?.items[0]);
  const songs = $derived.by(() => {
    const s = res?.shelves.find((x) => x !== top && x.layout === 'tracks' && x.items.some((i) => i.kind === 'track' && i.type === 'song'));
    return (s?.items.filter((i): i is Track => i.kind === 'track') ?? []).slice(0, 4);
  });
  const TITLE_FILTER: Record<string, SearchFilter> = {
    songs: 'songs', videos: 'videos', albums: 'albums', artists: 'artists', 'community playlists': 'community_playlists',
    'featured playlists': 'featured_playlists', podcasts: 'podcasts', episodes: 'episodes', profiles: 'profiles',
  };
  const rest = $derived(
    (res?.shelves ?? [])
      .filter((s) => s !== top && !(songs.length && s.items.includes(songs[0])))
      .map((s) => {
        const fk = TITLE_FILTER[s.title.toLowerCase()];
        return fk && !s.more ? { ...s, more: { browseId: '__search__', params: `${q}\u0000${fk}` } } : s;
      }),
  );
  const listTracks = $derived(items.filter((i): i is Track => i.kind === 'track'));
  const listCards = $derived(items.filter((i): i is Card => i.kind === 'card'));

  async function loadMore() {
    if (!cont) return;
    const p = await cont();
    cont = p.continuation;
    items = [...items, ...p.items];
  }
  function playTop() {
    const it = topItem!;
    if (it.kind === 'track') player.playTrack(it, { title: it.title });
    else playCard(it);
  }
</script>

<div class="view">
  <div class="view-pad" style="padding-top:16px">
    {#if !q}
      <h2 class="page-title" style="font-size:24px">Browse all</h2>
      {#if !browse}
        <div class="mood-grid">{#each Array(12) as _}<div class="skeleton" style="aspect-ratio:1.6"></div>{/each}</div>
      {:else}
        {#each browse as s, si}
          {#if s.title}<h3 style="font-size:20px;margin:28px 0 14px">{s.title}</h3>{/if}
          <div class="mood-grid">
            {#each s.items as m, i}
              {@const c = m as Card}
              <div class="mood-tile" role="button" tabindex="0" style="background:{c.color ?? PALETTE[(i + si * 5) % PALETTE.length]}" onclick={() => openCard(c)} onkeydown={(e) => e.key === 'Enter' && openCard(c)}>{c.title}</div>
            {/each}
          </div>
        {/each}
      {/if}
    {:else}
      <div class="chips" style="padding:0 0 8px;position:sticky;top:0;z-index:5;background:var(--panel);margin:0 -24px;padding:8px 24px">
        {#each FILTERS as [k, label]}
          <button class="chip" class:active={f === k} onclick={() => setFilter(k)}>{label}</button>
        {/each}
      </div>
      {#if res?.correction}
        <p style="color:var(--text-sub)">Did you mean: <a href="#/" style="color:var(--text);font-weight:700;text-decoration:underline" onclick={(e) => { e.preventDefault(); go(`/search?q=${encodeURIComponent(res!.correction!.query)}`, true); }}>{res.correction.text}</a></p>
      {/if}
      {#if error}
        <Loading {error} retry={load} />
      {:else if !res}
        <div class="center-msg" style="min-height:30vh"><span class="spinner lg"></span></div>
      {:else if f}
        {#if listTracks.length}
          <TrackList tracks={listTracks} source={{ title: `Search: ${q}` }} showAlbum={f === 'songs'} {loadMore} onplay={(i) => player.playTrack(listTracks[i], { title: q })} />
        {:else if listCards.length}
          <div class="card-grid" style="margin-top:8px">{#each listCards as c, i (i)}<CardView card={c} />{/each}</div>
          {#if cont}<div class="load-more"><button class="pill-btn outline" onclick={loadMore}>Load more</button></div>{/if}
        {:else}
          <div class="center-msg"><h2>No results found for "{q}"</h2><div>Please make sure your words are spelled correctly, or use fewer or different keywords.</div></div>
        {/if}
      {:else if !res.shelves.length}
        <div class="center-msg"><h2>No results found for "{q}"</h2><div>Please make sure your words are spelled correctly, or use fewer or different keywords.</div></div>
      {:else}
        {#if topItem}
          <div class="search-top" style="margin-top:16px">
            <section>
              <h2 class="shelf-title" style="margin-bottom:12px">Top result</h2>
              <div class="top-result" class:round={topItem.kind === 'card' && topItem.type === 'artist'} role="button" tabindex="0" onclick={() => (topItem.kind === 'track' ? playTop() : openCard(topItem))} onkeydown={() => {}} oncontextmenu={(e) => itemMenu(topItem, e)}>
                <Img thumbs={topItem.thumbnails} size={92} eager icon={topItem.kind === 'card' && topItem.type === 'artist' ? 'user' : 'music'} />
                <div class="tt">{topItem.title}</div>
                <div class="ts">
                  <span class="tag">{topItem.kind === 'track' ? (topItem.type === 'video' ? 'Video' : 'Song') : topItem.type[0].toUpperCase() + topItem.type.slice(1)}</span>
                  {#if topItem.kind === 'track'}{artistNames(topItem.artists)}{:else if topItem.artists?.length}{artistNames(topItem.artists)}{/if}
                </div>
                <PlayButton onclick={playTop} playing={topItem.kind === 'track' && player.current?.videoId === topItem.videoId && player.playing} />
              </div>
            </section>
            {#if songs.length}
              <section>
                <h2 class="shelf-title" style="margin-bottom:12px">Songs</h2>
                <TrackList tracks={songs} compact showHead={false} showAlbum={false} onplay={(i) => player.playTrack(songs[i], { title: q })} />
              </section>
            {:else if top && top.items.length > 1}
              <section>
                <h2 class="shelf-title" style="margin-bottom:12px">More</h2>
                <TrackList tracks={top.items.slice(1).filter((i): i is Track => i.kind === 'track').slice(0, 4)} compact showHead={false} showAlbum={false} />
              </section>
            {/if}
          </div>
        {/if}
        {#each rest as s, i (i)}<ShelfView shelf={s} />{/each}
      {/if}
    {/if}
  </div>
</div>
