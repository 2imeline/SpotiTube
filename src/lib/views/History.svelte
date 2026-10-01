<script lang="ts">
  import { getHistory } from '../api/ytm';
  import type { Track } from '../api/types';
  import TrackList from '../components/TrackList.svelte';
  import Loading from '../components/Loading.svelte';
  import { auth } from '../stores/auth.svelte';

  let tracks = $state.raw<Track[] | null>(null);
  let error = $state<string | null>(null);
  async function load() {
    error = null;
    tracks = null;
    if (!auth.loggedIn) return (tracks = []);
    try {
      tracks = await getHistory();
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }
  $effect(() => {
    auth.version;
    load();
  });
  const groups = $derived.by(() => {
    const g: { title: string; items: Track[] }[] = [];
    for (const t of tracks ?? []) {
      const k = t.played ?? '';
      if (!g.length || g[g.length - 1].title !== k) g.push({ title: k, items: [] });
      g[g.length - 1].items.push(t);
    }
    return g;
  });
</script>

<div class="view">
  <div class="view-bg" style="background:linear-gradient(rgba(var(--accent-rgb),.2),transparent);height:240px"></div>
  <div class="view-pad" style="padding-top:40px"><h1 class="page-title" style="font-size:48px">History</h1></div>
  {#if !auth.loggedIn}
    <div class="center-msg"><h2>Sign in to see your listening history</h2><button class="pill-btn" onclick={() => auth.login()}>Log in</button></div>
  {:else if error}
    <Loading {error} retry={load} />
  {:else if !tracks}
    <Loading />
  {:else if !tracks.length}
    <div class="center-msg"><h2>No history yet</h2></div>
  {:else}
    {#each groups as g, gi (gi)}
      <div class="view-pad" style="padding-bottom:4px"><h2 class="shelf-title" style="margin:16px 0 8px">{g.title}</h2></div>
      <TrackList tracks={g.items} source={{ title: 'History', path: '/history' }} showHead={gi === 0} ctx={{ onRemoved: load }} />
    {/each}
  {/if}
</div>
