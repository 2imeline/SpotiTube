<script lang="ts">
  import { getArtist, type ArtistPage } from '../api/ytm';
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
  import { bestThumb } from '../util/thumbs';
  import { dominantColor } from '../util/color';
  import { cardMenu } from '../actions';

  let { id }: { id: string } = $props();
  let data = $state.raw<ArtistPage | null>(null);
  let error = $state<string | null>(null);
  let color = $state<string | null>(null);
  let showAll = $state(false);
  let aboutOpen = $state(false);

  async function load() {
    error = null;
    data = null;
    showAll = false;
    try {
      data = await getArtist(id);
      dominantColor(bestThumb(data.header.thumbnails, 60)).then((c) => (color = c));
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }
  $effect(() => {
    id;
    auth.version;
    load();
  });

  const path = $derived(`/artist/${id}`);
  const isCurrent = $derived(player.source?.path === path);
  const channelId = $derived(data?.header.channelId ?? (id.startsWith('UC') ? id : undefined));
  const subscribed = $derived(channelId ? library.isSubscribed(channelId, data?.header.subscribed) : false);

  function play(shuffle = false) {
    if (isCurrent && !shuffle) return player.toggle();
    const h = data!.header;
    const ep = shuffle ? h.shuffle ?? h.radio : h.shuffle ?? h.radio;
    if (ep?.playlistId) player.playWatch({ playlistId: ep.playlistId, params: ep.params, shuffle }, { title: h.title, path });
    else player.playTracks(data!.topSongs, 0, { title: h.title, path }, { shuffle });
  }
  function radio() {
    const h = data!.header;
    if (h.radio?.playlistId) player.playWatch({ playlistId: h.radio.playlistId, params: h.radio.params }, { title: `${h.title} Radio`, path });
  }
  function more(e: MouseEvent) {
    const h = data!.header;
    const acts = cardMenu({ kind: 'card', type: 'artist', title: h.title, subtitle: '', thumbnails: h.thumbnails, browseId: channelId ?? id, menu: { radio: h.radio, shuffle: h.shuffle } });
    ui.openMenu(e, acts);
  }
</script>

<div class="view">
  {#if error}
    <Loading {error} retry={load} />
  {:else if !data}
    <Loading />
  {:else}
    {@const h = data.header}
    <StickyHead title={h.title} {color} playing={isCurrent && player.playing} onplay={() => play()} threshold={260} />
    <div class="artist-hero">
      <div class="bg" style="background-image:url('{bestThumb(h.banner ?? h.thumbnails, 1200)}');background-color:{color ?? '#333'}"></div>
      <div class="meta">
        <div class="verified"><span class="badge"><Icon name="check" size={14} /></span>Artist</div>
        <h1 class="ent-title selectable" style="margin:8px 0 12px;font-size:clamp(40px,7vw,96px)">{h.title}</h1>
        <div style="font-size:16px">{h.monthlyListeners ?? (h.subscribers ? `${h.subscribers} subscribers` : '')}</div>
      </div>
    </div>
    <div style="position:relative;background:linear-gradient({color ?? '#333'} -60%, var(--panel) 240px)">
      <div class="action-bar">
        <PlayButton size="lg" playing={isCurrent && player.playing} onclick={() => play()} />
        <button class="icon-btn" aria-label="Shuffle play" title="Shuffle play" onclick={() => play(true)}><Icon name="shuffle" size={28} /></button>
        {#if channelId}
          <button class="pill-btn outline" onclick={() => library.setSubscribed(channelId!, !subscribed)}>{subscribed ? 'Subscribed' : 'Subscribe'}</button>
        {/if}
        {#if h.radio}<button class="icon-btn" aria-label="Start radio" title="Start radio" onclick={radio}><Icon name="radio" size={24} /></button>{/if}
        <button class="icon-btn" aria-label="More options" onclick={more}><Icon name="more" size={28} /></button>
      </div>

      {#if data.topSongs.length}
        <div class="view-pad" style="padding-bottom:0"><h2 class="shelf-title" style="margin-bottom:16px">Popular</h2></div>
        <TrackList tracks={showAll ? data.topSongs : data.topSongs.slice(0, 5)} source={{ title: h.title, path }} showHead={false} showAlbum={false} />
        <div class="view-pad" style="padding-top:8px;padding-bottom:0;display:flex;gap:24px">
          {#if data.topSongs.length > 5}
            <button class="show-all" style="padding:8px 16px" onclick={() => (showAll = !showAll)}>{showAll ? 'Show less' : 'See more'}</button>
          {/if}
          {#if data.topSongsMore}
            <button class="show-all" style="padding:8px 16px" onclick={() => go(`/playlist/${data!.topSongsMore!.replace(/^VL/, '')}`)}>All songs</button>
          {/if}
        </div>
      {/if}

      <div class="view-pad">
        {#each data.shelves as s, i (i)}<ShelfView shelf={s} />{/each}

        {#if h.description}
          <section class="shelf">
            <h2 class="shelf-title" style="margin-bottom:16px">About</h2>
            <div class="about-card" role="button" tabindex="0" onclick={() => (aboutOpen = !aboutOpen)} onkeydown={() => {}}>
              <div class="img" style="background-image:url('{bestThumb(h.thumbnails, 700)}')"></div>
              <div class="body">
                {#if h.views}<div class="listeners">{h.views}</div>{/if}
                {#if h.subscribers}<div class="listeners" style="font-weight:400;font-size:14px;color:var(--text-sub)">{h.subscribers} subscribers</div>{/if}
                <p class="selectable" style={aboutOpen ? '-webkit-line-clamp:unset;white-space:pre-line' : ''}>{h.description}</p>
              </div>
            </div>
          </section>
        {/if}
      </div>
    </div>
  {/if}
</div>
