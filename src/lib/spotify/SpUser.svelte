<script lang="ts">
  import { getProfile, getFollowing, type SpProfile, type SpUser } from '../api/spotify';
  import EntityHeader from '../components/EntityHeader.svelte';
  import StickyHead from '../components/StickyHead.svelte';
  import Loading from '../components/Loading.svelte';
  import Icon from '../components/Icon.svelte';
  import SourceTag from './SourceTag.svelte';
  import SpCard from './SpCard.svelte';
  import { player } from '../player/player.svelte';
  import { go } from '../stores/router.svelte';
  import { spotify } from '../stores/spotify.svelte';
  import { ui } from '../stores/ui.svelte';
  import { openExternal } from '../actions';
  import { playSpPlaylist } from './play';

  let { id }: { id: string } = $props();
  let data = $state.raw<SpProfile | null>(null);
  let following = $state.raw<SpUser[]>([]);
  let followers = $state.raw<SpUser[]>([]);
  let error = $state<string | null>(null);
  let color = $state<string | null>(null);
  let showAll = $state(false);

  async function load() {
    error = null;
    data = null;
    following = followers = [];
    try {
      data = await getProfile(id, spotify.web);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      error = spotify.available ? (spotify.web ? msg : `${msg}. Spotify only shows other people's profiles to apps in some cases: turn on "Friends & profiles" in Settings → Spotify for full profiles.`) : 'Connect Spotify in Settings to browse profiles.';
      return;
    }
    if (spotify.web) {
      getFollowing(id, 'following').then((r) => (following = r), () => {});
      getFollowing(id, 'followers').then((r) => (followers = r), () => {});
    }
  }
  $effect(() => {
    id;
    spotify.version;
    load();
  });

  const isMe = $derived(spotify.me?.id === id);
  const playlists = $derived(data ? (showAll ? data.playlists : data.playlists.slice(0, 14)) : []);
</script>

{#snippet people(title: string, list: SpUser[])}
  {#if list.length}
    <section class="shelf">
      <div class="shelf-head"><h2 class="shelf-title">{title}</h2></div>
      <div class="card-grid">
        {#each list as u (u.id)}
          <SpCard round title={u.name} image={u.image} sub="Profile" onopen={() => go(`/sp-user/${encodeURIComponent(u.id)}`)} />
        {/each}
      </div>
    </section>
  {/if}
{/snippet}

<div class="view">
  {#if error}
    <Loading {error} retry={load} />
  {:else if !data}
    <Loading />
  {:else}
    {@const u = data.user}
    {@const count = data.playlistCount ?? data.playlists.length}
    <StickyHead title={u.name} {color} />
    <EntityHeader type="Profile" title={u.name} thumbs={u.image ? [{ url: u.image }] : []} round bind:color>
      {#snippet meta()}
        <SourceTag source="spotify" label={isMe ? 'Your Spotify profile' : 'Spotify'} />
        {#if count}<span class="dot"></span><span>{count} public playlists</span>{/if}
        {#if u.followers != null}<span class="dot"></span><span>{u.followers.toLocaleString()} followers</span>{/if}
        {#if u.following != null}<span class="dot"></span><span>{u.following.toLocaleString()} following</span>{/if}
      {/snippet}
    </EntityHeader>
    <div style="position:relative;background:linear-gradient(rgba(0,0,0,.6), var(--panel) 240px)">
      <div class="action-bar">
        <button class="pill-btn outline with-icon" onclick={() => openExternal(u.url)}><Icon name="spotify" size={16} /> Open in Spotify</button>
        <button class="icon-btn" aria-label="More options" onclick={(e) => ui.openMenu(e, [{ label: 'Copy profile link', icon: 'copy', run: () => navigator.clipboard.writeText(u.url).then(() => ui.toast('Link copied to clipboard')) }])}><Icon name="more" size={28} /></button>
      </div>
      <div class="view-pad">
        {#if data.playlists.length}
          <section class="shelf">
            <div class="shelf-head">
              <h2 class="shelf-title">Public playlists</h2>
              {#if data.playlists.length > 14}<button class="show-all" onclick={() => (showAll = !showAll)}>{showAll ? 'Show less' : 'Show all'}</button>{/if}
            </div>
            <div class="card-grid">
              {#each playlists as p (p.id)}
                <SpCard
                  title={p.name}
                  image={p.image}
                  sub={p.tracks != null ? `${p.tracks} songs` : p.owner ? `By ${p.owner}` : 'Playlist'}
                  onopen={() => go(`/sp-playlist/${p.id}`)}
                  onplay={() => playSpPlaylist(p.id, p.name)}
                  playing={player.source?.path === `/sp-playlist/${p.id}` && player.playing}
                />
              {/each}
            </div>
          </section>
        {:else}
          <p class="sp-note">{u.name} has no public playlists.</p>
        {/if}
        {#if data.artists.length}
          <section class="shelf">
            <div class="shelf-head"><h2 class="shelf-title">Recently played artists</h2></div>
            <div class="card-grid">
              {#each data.artists as a (a.id)}
                <SpCard round title={a.name} image={a.image} sub="Artist" onopen={() => go(`/search?q=${encodeURIComponent(a.name)}`)} />
              {/each}
            </div>
          </section>
        {/if}
        {@render people('Following', following)}
        {@render people('Followers', followers)}
      </div>
    </div>
  {/if}
</div>
