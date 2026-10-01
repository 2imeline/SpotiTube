<script lang="ts">
  import { getPlaylist, editPlaylist, deletePlaylist, getAlbumBrowseId, type PlaylistPage } from '../api/ytm';
  import EntityHeader from '../components/EntityHeader.svelte';
  import StickyHead from '../components/StickyHead.svelte';
  import TrackList from '../components/TrackList.svelte';
  import ShelfView from '../components/Shelf.svelte';
  import Loading from '../components/Loading.svelte';
  import PlayButton from '../components/PlayButton.svelte';
  import Icon from '../components/Icon.svelte';
  import { player } from '../player/player.svelte';
  import { library } from '../stores/library.svelte';
  import { ui } from '../stores/ui.svelte';
  import { go } from '../stores/router.svelte';
  import { auth } from '../stores/auth.svelte';
  import { cardMenu, newPlaylistDialog } from '../actions';
  import type { Card, Shelf, Track } from '../api/types';

  let { id }: { id: string } = $props();
  let data = $state.raw<PlaylistPage | null>(null);
  let tracks = $state.raw<Track[]>([]);
  let related = $state.raw<Shelf[]>([]);
  let error = $state<string | null>(null);
  let color = $state<string | null>(null);
  let filter = $state('');
  let more = $state.raw<PlaylistPage['more']>(undefined);

  async function load() {
    error = null;
    data = null;
    related = [];
    try {
      // OLAK audio playlists are albums: show the album page
      if (id.startsWith('OLAK')) {
        const b = await getAlbumBrowseId(id).catch(() => null);
        if (b) return go(`/album/${b}`, true);
      }
      const p = await getPlaylist(id);
      data = p;
      tracks = p.tracks;
      more = p.more;
      p.related?.().then((r) => (related = r)).catch(() => {});
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }
  $effect(() => {
    id;
    auth.version;
    load();
  });

  async function loadMore() {
    if (!more) return;
    const p = await more();
    more = p.continuation;
    tracks = [...tracks, ...p.items];
  }

  const path = $derived(`/playlist/${id}`);
  const isCurrent = $derived(player.source?.path === path);
  const isLiked = $derived(id === 'LM');
  const owned = $derived(!!data?.header.owned);
  const saved = $derived(library.isSaved(id, data?.header.saved));
  const shown = $derived(filter ? tracks.filter((t) => (t.title + ' ' + t.artists.map((a) => a.name).join(' ') + ' ' + (t.album?.name ?? '')).toLowerCase().includes(filter.toLowerCase())) : tracks);

  async function play(shuffle = false) {
    if (isCurrent && !shuffle) return player.toggle();
    // full list for small playlists; otherwise let YouTube Music stream the queue
    if (!more || tracks.length >= 200) player.playTracks(tracks, 0, { title: data!.header.title, path }, { shuffle });
    else player.playWatch({ playlistId: id, shuffle }, { title: data!.header.title, path });
  }

  async function edit() {
    const h = data!.header;
    const r = await ui.ask<Record<string, string>>({
      kind: 'prompt',
      title: 'Edit details',
      confirmLabel: 'Save',
      fields: [
        { key: 'title', label: 'Name', value: h.title },
        { key: 'description', label: 'Description', value: h.description ?? '', multiline: true },
        { key: 'privacy', label: 'Privacy', value: h.privacy ?? 'PRIVATE', options: ['PRIVATE', 'UNLISTED', 'PUBLIC'] },
      ],
    });
    if (!r) return;
    try {
      await editPlaylist(id, { title: r.title, description: r.description, privacy: r.privacy as any });
      ui.toast('Playlist updated');
      load();
      library.refresh();
    } catch (e) {
      ui.error(e);
    }
  }

  function moreMenu(e: MouseEvent) {
    const h = data!.header;
    const card: Card = { kind: 'card', type: 'playlist', title: h.title, subtitle: '', thumbnails: h.thumbnails, browseId: 'VL' + id, playlistId: id, menu: { editablePlaylistId: owned ? id : undefined, radio: h.radio, shuffle: h.shuffle, inLibrary: saved } };
    const actions = cardMenu(card, { onRemoved: () => go('/') });
    if (owned) actions.unshift({ label: 'Edit details', icon: 'edit', run: edit }, { label: '', divider: true });
    actions.push({ label: 'Make a copy', icon: 'copy', run: () => newPlaylistDialog(undefined, id) });
    ui.openMenu(e, actions);
  }

  async function onRemoved() {
    // refresh list after removing a track
    try {
      const p = await getPlaylist(id);
      tracks = p.tracks;
      more = p.more;
    } catch {}
  }

  // reorder tracks in owned playlists via drag & drop (Spotify-like)
  async function moveTrack(from: number, to: number) {
    const a = tracks[from], b = tracks[to];
    if (!a?.menu?.setVideoId) return;
    const next = [...tracks];
    next.splice(from, 1);
    next.splice(to, 0, a);
    tracks = next;
    try {
      const successor = next[to + 1]?.menu?.setVideoId;
      await editPlaylist(id, { moveItem: [a.menu.setVideoId, successor] });
    } catch (e) {
      ui.error(e);
      onRemoved();
    }
    void b;
  }
</script>

<div class="view">
  {#if error}
    <Loading {error} retry={load} />
  {:else if !data}
    <Loading />
  {:else}
    {@const h = data.header}
    <StickyHead title={isLiked ? 'Liked Music' : h.title} {color} playing={isCurrent && player.playing} onplay={() => play()} />
    <EntityHeader type={isLiked ? 'Auto playlist' : h.privacy ? `${h.privacy[0]}${h.privacy.slice(1).toLowerCase()} playlist` : 'Playlist'} title={isLiked ? 'Liked Music' : h.title} thumbs={h.thumbnails} description={h.description} bind:color>
      {#snippet cover()}
        {#if isLiked}
          <div class="ent-cover liked-art" style="display:grid;place-items:center"><Icon name="heartFill" size={80} /></div>
        {:else}
          <button style="all:unset;cursor:{owned ? 'pointer' : 'default'}" onclick={() => owned && edit()} aria-label="Edit details">
            <img class="ent-cover" src={h.thumbnails.length ? h.thumbnails[h.thumbnails.length - 1].url : ''} alt="" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
          </button>
        {/if}
      {/snippet}
      {#snippet meta()}
        {#if h.author}{#if h.author.id}<a href="#/" onclick={(e) => { e.preventDefault(); go(`/artist/${h.author!.id}`); }}>{h.author.name}</a>{:else}<b>{h.author.name}</b>{/if}{:else if isLiked && auth.account}<b>{auth.account.name}</b>{/if}
        {#if h.collaborators}<b>{h.collaborators}</b>{/if}
        {#if h.views}<span class="dot"></span><span>{h.views}</span>{/if}
        {#if h.year}<span class="dot"></span><span>{h.year}</span>{/if}
        <span class="dot"></span><span>{h.trackCount ?? `${tracks.length} songs`}{h.duration ? `, ${h.duration}` : ''}</span>
      {/snippet}
    </EntityHeader>
    <div style="position:relative;background:linear-gradient(rgba(0,0,0,.6), var(--panel) 240px)">
      <div class="action-bar">
        <PlayButton size="lg" playing={isCurrent && player.playing} onclick={() => play()} />
        <button class="icon-btn" aria-label="Shuffle play" title="Shuffle play" onclick={() => play(true)}><Icon name="shuffle" size={28} /></button>
        {#if !owned && !isLiked && id !== 'SE'}
          <button class="icon-btn" class:on={saved} aria-label={saved ? 'Remove from Your Library' : 'Save to Your Library'} title={saved ? 'Remove from Your Library' : 'Save to Your Library'} onclick={() => library.setSaved(id, !saved)}>
            <Icon name={saved ? 'checkCircle' : 'addCircle'} size={28} />
          </button>
        {/if}
        <button class="icon-btn" aria-label="More options" onclick={moreMenu}><Icon name="more" size={28} /></button>
        <span class="spacer"></span>
        <div class="lib-search open" style="background:transparent">
          <Icon name="search" size={16} />
          <input bind:value={filter} placeholder="Find in playlist" style="width:160px" />
        </div>
      </div>
      {#if tracks.length}
        <TrackList tracks={shown} source={{ title: isLiked ? 'Liked Music' : h.title, path }} ctx={{ playlistId: owned ? id : undefined, onRemoved }} loadMore={more && !filter ? loadMore : undefined} />
      {:else}
        <div class="center-msg" style="min-height:20vh"><div>This playlist is empty. Find songs to add with search.</div><button class="pill-btn" onclick={() => go('/search')}>Find songs</button></div>
      {/if}
      <div class="view-pad">
        {#each related as s, i (i)}<ShelfView shelf={s} />{/each}
      </div>
    </div>
  {/if}
</div>
