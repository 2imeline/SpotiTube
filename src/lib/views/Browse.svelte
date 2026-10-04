<script lang="ts">
  // Generic browse page: explore, charts, moods & genres, new releases,
  // "see all" pages, channels...
  import { browse, getCharts, CHART_COUNTRIES } from '../api/ytm';
  import type { BrowsePage, Shelf } from '../api/types';
  import ShelfView from '../components/Shelf.svelte';
  import Loading from '../components/Loading.svelte';
  import Img from '../components/Img.svelte';
  import { auth } from '../stores/auth.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import { router } from '../stores/router.svelte';

  let { browseId, params, title: fixedTitle, kind = 'browse' }: { browseId: string; params?: string; title?: string; kind?: 'browse' | 'charts' } = $props();
  let page = $state.raw<BrowsePage | null>(null);
  let shelves = $state.raw<Shelf[]>([]);
  let error = $state<string | null>(null);
  let country = $state(settings.gl || 'ZZ');
  let more: BrowsePage['more'];
  let loadingMore = $state(false);
  let sentinel: HTMLDivElement | undefined = $state();

  async function load() {
    error = null;
    page = null;
    try {
      const p = kind === 'charts' ? await getCharts(country) : await browse(browseId, params);
      page = p;
      shelves = p.shelves;
      more = p.more;
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }
  $effect(() => {
    browseId;
    params;
    country;
    auth.version;
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

  const title = $derived(fixedTitle ?? page?.header?.title ?? '');
  $effect(() => {
    if (title) ui.page = { path: router.route.path, title };
  });
  const regionName = (c: string) => {
    if (c === 'ZZ') return 'Global';
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) ?? c;
    } catch {
      return c;
    }
  };
</script>

<div class="view">
  <div class="view-bg" style="background:linear-gradient(rgba(var(--accent-rgb),.18),transparent);height:260px"></div>
  <div class="view-pad" style="padding-top:8px">
    {#if page?.header?.thumbnails?.length && !fixedTitle}
      <div style="display:flex;gap:24px;align-items:flex-end;padding-top:48px">
        <Img thumbs={page.header.thumbnails} size={180} class="ent-cover round" />
        <h1 class="ent-title">{title}</h1>
      </div>
    {:else if title}
      <h1 class="page-title" style="font-size:48px;margin-top:32px">{title}</h1>
    {/if}
    {#if kind === 'charts'}
      <div style="display:flex;align-items:center;gap:12px;margin:8px 0 0">
        <label for="country" style="color:var(--text-sub)">Region</label>
        <select id="country" class="input" style="width:auto" bind:value={country}>
          {#each CHART_COUNTRIES as c}<option value={c}>{regionName(c)}</option>{/each}
        </select>
      </div>
    {/if}
    {#if error}
      <Loading {error} retry={load} />
    {:else if !page}
      <Loading />
    {:else if !shelves.length}
      <div class="center-msg"><h2>Nothing here yet</h2></div>
    {:else}
      {#each shelves as s, i (i)}<ShelfView shelf={s} />{/each}
      <div bind:this={sentinel} class="load-more">{#if loadingMore}<span class="spinner"></span>{/if}</div>
    {/if}
  </div>
</div>
