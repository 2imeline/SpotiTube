<script lang="ts">
  import type { SpPlaylistPage } from '../api/spotify';
  import EntityHeader from '../components/EntityHeader.svelte';
  import StickyHead from '../components/StickyHead.svelte';
  import TrackList from '../components/TrackList.svelte';
  import Loading from '../components/Loading.svelte';
  import PlayButton from '../components/PlayButton.svelte';
  import Icon from '../components/Icon.svelte';
  import SourceTag from './SourceTag.svelte';
  import { player } from '../player/player.svelte';
  import { ui } from '../stores/ui.svelte';
  import { go } from '../stores/router.svelte';
  import { spotify } from '../stores/spotify.svelte';
  import { copySpotifyPlaylist, openExternal } from '../actions';
  import { loadSpPlaylist } from './play';

  let { id }: { id: string } = $props();
  let data = $state.raw<SpPlaylistPage | null>(null);
  let error = $state<string | null>(null);
  let color = $state<string | null>(null);
  let filter = $state('');

  async function load() {
    error = null;
    data = null;
    try {
      data = await loadSpPlaylist(id);
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }
  $effect(() => {
    id;
    spotify.version;
    load();
  });

  const path = $derived(`/sp-playlist/${id}`);
  const isCurrent = $derived(player.source?.path === path);
  const tracks = $derived(data?.tracks ?? []);
  const shown = $derived(filter ? tracks.filter((t) => (t.title + ' ' + t.artists.map((a) => a.name).join(' ') + ' ' + (t.album?.name ?? '')).toLowerCase().includes(filter.toLowerCase())) : tracks);
  const totalSec = $derived(tracks.reduce((n, t) => n + (t.durationSec ?? 0), 0));
  const length = $derived(totalSec > 3600 ? `${Math.floor(totalSec / 3600)} hr ${Math.round((totalSec % 3600) / 60)} min` : `${Math.round(totalSec / 60)} min`);

  function play(shuffle = false) {
    if (isCurrent && !shuffle) return player.toggle();
    player.playTracks(tracks, 0, { title: data!.playlist.name, path }, { shuffle });
  }
  function shuffleClick() {
    if (isCurrent || player.shuffle) player.toggleShuffle();
    else play(true);
  }
  function moreMenu(e: MouseEvent) {
    const url = `https://open.spotify.com/playlist/${id}`;
    ui.openMenu(e, [
      { label: 'Copy to YouTube Music', icon: 'plus', run: () => copySpotifyPlaylist(data!.playlist.name, tracks) },
      { label: 'Add to queue', icon: 'queue', run: () => player.addToQueue(tracks) },
      { label: '', divider: true },
      { label: 'Open in Spotify', icon: 'share', run: () => openExternal(url) },
      { label: 'Copy Spotify link', icon: 'copy', run: () => navigator.clipboard.writeText(url).then(() => ui.toast('Link copied to clipboard')) },
    ]);
  }
</script>

<div class="view">
  {#if error}
    <Loading {error} retry={load} />
  {:else if !data}
    <Loading />
  {:else}
    {@const p = data.playlist}
    <StickyHead title={p.name} {color} playing={isCurrent && player.playing} onplay={() => play()} />
    <EntityHeader type="Playlist" title={p.name} thumbs={p.image ? [{ url: p.image }] : []} description={p.description} bind:color>
      {#snippet meta()}
        <SourceTag source="spotify" />
        {#if p.owner}<span class="dot"></span>{#if p.ownerId}<a href="#/" onclick={(e) => { e.preventDefault(); go(`/sp-user/${encodeURIComponent(p.ownerId!)}`); }}>{p.owner}</a>{:else}<b>{p.owner}</b>{/if}{/if}
        {#if p.followers}<span class="dot"></span><span>{p.followers.toLocaleString()} saves</span>{/if}
        <span class="dot"></span><span>{tracks.length || p.tracks || 0} songs{totalSec ? `, ${length}` : ''}</span>
      {/snippet}
    </EntityHeader>
    <div style="position:relative;background:linear-gradient(rgba(0,0,0,.6), var(--panel) 240px)">
      <div class="action-bar">
        <PlayButton size="lg" playing={isCurrent && player.playing} onclick={() => play()} />
        <button class="icon-btn shuffle-btn" class:on={player.shuffle} aria-label={player.shuffle ? 'Disable shuffle' : 'Shuffle play'} title={player.shuffle ? 'Disable shuffle' : 'Shuffle play'} onclick={shuffleClick}><Icon name="shuffle" size={28} /></button>
        <button class="icon-btn" aria-label="Copy to YouTube Music" title="Copy to YouTube Music" onclick={() => copySpotifyPlaylist(p.name, tracks)}><Icon name="addCircle" size={28} /></button>
        <button class="icon-btn" aria-label="More options" onclick={moreMenu}><Icon name="more" size={28} /></button>
        <span class="spacer"></span>
        <div class="lib-search open" style="background:transparent">
          <Icon name="search" size={16} />
          <input bind:value={filter} placeholder="Find in playlist" style="width:160px" />
        </div>
      </div>
      <p class="sp-note">Songs play from YouTube Music: each one is matched by title, artist and length when it comes up.</p>
      {#if tracks.length}
        <TrackList tracks={shown} source={{ title: p.name, path }} />
      {:else}
        <div class="center-msg" style="min-height:20vh">
          {#if data.hidden}
            <div style="max-width:520px">Spotify only shows linked apps the songs of playlists you own or collaborate on. Turn on <b>Friends &amp; profiles</b> to see the songs in other people's playlists.</div>
            <button class="pill-btn" onclick={() => go('/settings?s=spotify')}>Open Spotify settings</button>
          {:else if p.tracks}
            <div style="max-width:520px">Spotify didn't return the songs of this playlist ({p.tracks} songs). Try again in a moment.</div>
            <button class="pill-btn" onclick={load}>Retry</button>
          {:else}
            <div>This playlist is empty.</div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
