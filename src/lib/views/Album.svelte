<script lang="ts">
  import { getAlbum, type AlbumPage } from '../api/ytm';
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
  import { cardMenu } from '../actions';
  import type { Card } from '../api/types';

  let { id }: { id: string } = $props();
  let data = $state.raw<AlbumPage | null>(null);
  let error = $state<string | null>(null);
  let color = $state<string | null>(null);

  async function load() {
    error = null;
    data = null;
    try {
      data = await getAlbum(id);
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }
  $effect(() => {
    id;
    auth.version;
    load();
  });

  const path = $derived(`/album/${id}`);
  const isCurrent = $derived(player.source?.path === path);
  const pid = $derived(data?.header.audioPlaylistId);
  const saved = $derived(pid ? library.isSaved(pid, data?.header.saved) : false);
  const totalSec = $derived(data?.tracks.reduce((a, t) => a + (t.durationSec ?? 0), 0) ?? 0);
  function play(shuffle = false) {
    if (isCurrent && !shuffle) return player.toggle();
    player.playTracks(data!.tracks, 0, { title: data!.header.title, path }, { shuffle });
  }
  function more(e: MouseEvent) {
    const h = data!.header;
    const card: Card = { kind: 'card', type: 'album', title: h.title, subtitle: '', thumbnails: h.thumbnails, browseId: id, playlistId: pid, artists: h.artists, menu: { radio: h.radio, shuffle: h.shuffle, inLibrary: saved } };
    ui.openMenu(e, cardMenu(card));
  }
  function fmtDur(s: number) {
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${h} hr ${m} min` : `${m} min`;
  }
</script>

<div class="view">
  {#if error}
    <Loading {error} retry={load} />
  {:else if !data}
    <Loading />
  {:else}
    {@const h = data.header}
    <StickyHead title={h.title} {color} playing={isCurrent && player.playing} onplay={() => play()} />
    <EntityHeader type={h.type ?? 'Album'} title={h.title} thumbs={h.thumbnails} bind:color>
      {#snippet meta()}
        {#each h.artists ?? [] as a, i}{#if i}<span>, </span>{/if}{#if a.id}<a href="#/" onclick={(e) => { e.preventDefault(); go(`/artist/${a.id}`); }}>{a.name}</a>{:else}<b>{a.name}</b>{/if}{/each}
        {#if h.year}<span class="dot"></span><span>{h.year}</span>{/if}
        <span class="dot"></span><span>{data?.tracks.length ?? 0} songs, {fmtDur(totalSec)}</span>
        {#if h.explicit}<span class="ebadge" style="margin-left:6px">E</span>{/if}
      {/snippet}
    </EntityHeader>
    <div style="position:relative;background:linear-gradient(rgba(0,0,0,.6), var(--panel) 240px)">
      <div class="action-bar">
        <PlayButton size="lg" playing={isCurrent && player.playing} onclick={() => play()} />
        <button class="icon-btn" aria-label="Shuffle play" title="Shuffle play" onclick={() => play(true)}><Icon name="shuffle" size={28} /></button>
        {#if pid}
          <button class="icon-btn" class:on={saved} aria-label={saved ? 'Remove from Your Library' : 'Save to Your Library'} title={saved ? 'Remove from Your Library' : 'Save to Your Library'} onclick={() => library.setSaved(pid!, !saved)}>
            <Icon name={saved ? 'checkCircle' : 'addCircle'} size={28} />
          </button>
        {/if}
        <button class="icon-btn" aria-label="More options" onclick={more}><Icon name="more" size={28} /></button>
      </div>
      <TrackList tracks={data.tracks} source={{ title: h.title, path }} showAlbum={false} showArt={false} useTrackNumbers />
      {#if h.description}
        <div class="view-pad"><p class="selectable" style="color:var(--text-sub);white-space:pre-line;line-height:1.6;max-width:820px;margin-top:32px">{h.description}</p></div>
      {/if}
      <div class="view-pad">
        {#each data.shelves as s, i (i)}<ShelfView shelf={s} />{/each}
      </div>
    </div>
  {/if}
</div>
