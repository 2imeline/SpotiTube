<script lang="ts">
  import { getPodcast, getEpisode, type PlaylistPage } from '../api/ytm';
  import EntityHeader from '../components/EntityHeader.svelte';
  import StickyHead from '../components/StickyHead.svelte';
  import TrackList from '../components/TrackList.svelte';
  import Loading from '../components/Loading.svelte';
  import PlayButton from '../components/PlayButton.svelte';
  import Icon from '../components/Icon.svelte';
  import { player } from '../player/player.svelte';
  import { library } from '../stores/library.svelte';
  import { go } from '../stores/router.svelte';
  import { auth } from '../stores/auth.svelte';
  import type { PageHeader, Track } from '../api/types';

  let { id, episode = false }: { id: string; episode?: boolean } = $props();
  let pod = $state.raw<(PlaylistPage & { browseId: string }) | null>(null);
  let ep = $state.raw<{ header: PageHeader; description: string; videoId: string } | null>(null);
  let tracks = $state.raw<Track[]>([]);
  let error = $state<string | null>(null);
  let color = $state<string | null>(null);
  let more = $state.raw<PlaylistPage['more']>(undefined);

  async function load() {
    error = null;
    pod = null;
    ep = null;
    try {
      if (episode) ep = await getEpisode(id);
      else {
        pod = await getPodcast(id);
        tracks = pod.tracks;
        more = pod.more;
      }
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }
  $effect(() => {
    id;
    episode;
    auth.version;
    load();
  });
  async function loadMore() {
    if (!more) return;
    const p = await more();
    more = p.continuation;
    tracks = [...tracks, ...p.items];
  }
  const path = $derived(episode ? `/episode/${id}` : `/podcast/${id}`);
  const isCurrent = $derived(player.source?.path === path);
  const h = $derived(pod?.header ?? ep?.header);
  const pid = $derived(pod ? pod.browseId.replace(/^MPSP/, '') : undefined);
  const saved = $derived(pid ? library.isSaved(pid, pod?.header.saved) : false);

  function play() {
    if (isCurrent) return player.toggle();
    if (pod) player.playTracks(tracks, 0, { title: pod.header.title, path });
    else if (ep) player.playTrack({ kind: 'track', videoId: ep.videoId, title: ep.header.title, artists: ep.header.author ? [ep.header.author] : [], thumbnails: ep.header.thumbnails, type: 'episode', isAvailable: true }, { title: ep.header.title, path });
  }
</script>

<div class="view">
  {#if error}
    <Loading {error} retry={load} />
  {:else if !h}
    <Loading />
  {:else}
    <StickyHead title={h.title} {color} playing={isCurrent && player.playing} onplay={play} />
    <EntityHeader type={episode ? 'Podcast episode' : 'Podcast'} title={h.title} thumbs={h.thumbnails} bind:color>
      {#snippet meta()}
        {#if h.author}{#if h.author.id}<a href="#/" onclick={(e) => { e.preventDefault(); go(h.author!.id!.startsWith('MPSP') ? `/podcast/${h.author!.id}` : `/artist/${h.author!.id}`); }}>{h.author.name}</a>{:else}<b>{h.author.name}</b>{/if}{/if}
        {#if h.subtitle && episode}<span class="dot"></span><span>{h.subtitle}</span>{/if}
      {/snippet}
    </EntityHeader>
    <div style="position:relative;background:linear-gradient(rgba(0,0,0,.6), var(--panel) 240px)">
      <div class="action-bar">
        <PlayButton size="lg" playing={isCurrent && player.playing} onclick={play} />
        {#if pid}
          <button class="pill-btn outline" onclick={() => library.setSaved(pid!, !saved)}>{saved ? 'Following' : 'Follow'}</button>
        {/if}
      </div>
      <div class="view-pad">
        {#if h.description || ep?.description}
          <h2 class="shelf-title" style="margin-bottom:12px">{episode ? 'Episode description' : 'About'}</h2>
          <p class="selectable" style="color:var(--text-sub);white-space:pre-line;line-height:1.6;max-width:820px">{ep?.description || h.description}</p>
        {/if}
      </div>
      {#if pod}
        <div class="view-pad" style="padding-bottom:0"><h2 class="shelf-title">All episodes</h2></div>
        <TrackList tracks={tracks} source={{ title: pod.header.title, path }} showAlbum={false} loadMore={more ? loadMore : undefined} />
      {/if}
    </div>
  {/if}
</div>
