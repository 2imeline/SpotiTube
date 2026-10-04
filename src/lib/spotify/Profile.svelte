<script lang="ts">
  import { ago, getFollowing, getFriendActivity, getMyPlaylists, getProfile, parseUserLink, type SpFriend, type SpPlaylist, type SpUser } from '../api/spotify';
  import EntityHeader from '../components/EntityHeader.svelte';
  import StickyHead from '../components/StickyHead.svelte';
  import Img from '../components/Img.svelte';
  import Icon from '../components/Icon.svelte';
  import SourceTag from './SourceTag.svelte';
  import SpCard from './SpCard.svelte';
  import { auth } from '../stores/auth.svelte';
  import { library } from '../stores/library.svelte';
  import { spotify } from '../stores/spotify.svelte';
  import { go } from '../stores/router.svelte';
  import { ui } from '../stores/ui.svelte';
  import { player } from '../player/player.svelte';
  import { playPlaylist } from '../actions';
  import { playSpPlaylist, spTrack } from './play';
  import { bestThumb } from '../util/thumbs';
  import { onMount } from 'svelte';

  let color = $state<string | null>(null);
  let me = $state.raw<SpUser | null>(null);
  let friends = $state.raw<SpFriend[] | null>(null);
  let friendsError = $state<string | null>(null);
  let following = $state.raw<SpUser[]>([]);
  let playlists = $state.raw<SpPlaylist[] | null>(null);
  let spError = $state<string | null>(null);
  let link = $state('');
  let loadingFriends = $state(false);

  async function loadSpotify() {
    me = null;
    friends = null;
    following = [];
    playlists = null;
    spError = friendsError = null;
    if (!spotify.available) return;
    try {
      me = await spotify.loadMe();
    } catch (e: any) {
      spError = e?.message ?? String(e);
    }
    if (spotify.web) loadFriends();
    if (!me) return;
    if (spotify.web) getFollowing(me.id).then((r) => (following = r), () => {});
    try {
      playlists = spotify.linked ? await getMyPlaylists() : (await getProfile(me.id, true)).playlists;
    } catch (e: any) {
      spError = e?.message ?? String(e);
      playlists = [];
    }
  }
  async function loadFriends() {
    loadingFriends = true;
    try {
      friends = await getFriendActivity();
      friendsError = null;
    } catch (e: any) {
      friendsError = e?.message ?? String(e);
    } finally {
      loadingFriends = false;
    }
  }
  $effect(() => {
    spotify.version;
    spotify.available;
    loadSpotify();
  });
  onMount(() => {
    // friend activity is live: refresh it while the page is open
    const t = setInterval(() => spotify.web && !document.hidden && loadFriends(), 60_000);
    return () => clearInterval(t);
  });

  const name = $derived(auth.account?.name ?? me?.name ?? 'Your profile');
  const photo = $derived(auth.account?.photo ?? me?.image);
  const ytPlaylists = $derived(library.owned.filter((c) => c.browseId?.startsWith('VL')));

  function openLink() {
    const id = parseUserLink(link);
    if (!id) return ui.toast('Paste a Spotify profile link, e.g. open.spotify.com/user/…');
    link = '';
    go(`/sp-user/${encodeURIComponent(id)}`);
  }
  function playFriend(f: SpFriend) {
    if (!f.track) return;
    player.playTracks([spTrack(f.track)], 0, { title: `${f.user.name} on Spotify`, path: `/sp-user/${encodeURIComponent(f.user.id)}` });
  }
  function openContext(f: SpFriend) {
    const uri = f.track?.context?.uri ?? '';
    const [, kind, id] = uri.split(':');
    if (kind === 'playlist') go(`/sp-playlist/${id}`);
    else if (kind === 'user') go(`/sp-user/${encodeURIComponent(id)}`);
    else go(`/search?q=${encodeURIComponent(f.track?.context?.name ?? '')}`);
  }
  const live = (f: SpFriend) => Date.now() - f.timestamp < 10 * 60_000;
</script>

<div class="view">
  <StickyHead title={name} {color} />
  <EntityHeader type="Profile" title={name} thumbs={photo ? [{ url: photo }] : []} round bind:color>
    {#snippet meta()}
      {#if auth.loggedIn}<SourceTag source="ytm" label={auth.account?.handle ?? 'YouTube Music'} />{/if}
      {#if me}{#if auth.loggedIn}<span class="dot"></span>{/if}<SourceTag source="spotify" label={me.name} />{/if}
      {#if me?.followers != null}<span class="dot"></span><span>{me.followers.toLocaleString()} followers on Spotify</span>{/if}
    {/snippet}
  </EntityHeader>

  <div style="position:relative;background:linear-gradient(rgba(0,0,0,.6), var(--panel) 240px)">
    <div class="view-pad profile-page">
      <!-- linked accounts -->
      <section class="shelf">
        <div class="shelf-head"><h2 class="shelf-title">Accounts</h2></div>
        <div class="acct-tiles">
          <div class="acct-tile">
            <Img thumbs={auth.account?.photo ? [{ url: auth.account.photo }] : []} size={56} class="round" icon="user" />
            <div class="m">
              <div class="a">{auth.loggedIn ? (auth.account?.name ?? 'Google account') : 'YouTube Music'}</div>
              <SourceTag source="ytm" label={auth.loggedIn ? 'YouTube Music' : 'Not signed in'} />
            </div>
            {#if !auth.loggedIn}<button class="pill-btn" onclick={() => auth.login()}>Sign in</button>{/if}
          </div>
          <div class="acct-tile">
            <Img thumbs={me?.image ? [{ url: me.image }] : []} size={56} class="round" icon="user" />
            <div class="m">
              <div class="a">{me?.name ?? 'Spotify'}</div>
              <SourceTag source="spotify" label={spotify.linked && spotify.web ? 'Spotify · linked + friends' : spotify.linked ? 'Spotify · linked' : spotify.web ? 'Spotify · web session' : 'Not connected'} />
            </div>
            {#if me}
              <button class="pill-btn outline" onclick={() => go(`/sp-user/${encodeURIComponent(me!.id)}`)}>View</button>
            {:else if !spotify.available}
              <button class="pill-btn" onclick={() => go('/settings?s=spotify')}>Connect</button>
            {/if}
          </div>
        </div>
        {#if spError}<p class="sp-note err">Spotify: {spError}</p>{/if}
      </section>

      <!-- friends -->
      <section class="shelf">
        <div class="shelf-head">
          <h2 class="shelf-title">Friend activity</h2>
          {#if spotify.web}<button class="icon-btn" aria-label="Refresh" title="Refresh" onclick={loadFriends} disabled={loadingFriends}><Icon name="repeat" size={18} /></button>{/if}
        </div>
        {#if !spotify.web}
          <div class="friends-cta">
            <Icon name="spotify" size={40} />
            <div>
              <div class="a">See what your Spotify friends are listening to</div>
              <div class="b">Spotify doesn't offer friends to other apps, so this signs into the Spotify web player in a small window and reads your friend feed from there. It's unofficial and may stop working if Spotify changes things.</div>
            </div>
            <button class="pill-btn" onclick={() => spotify.webConnect()}>Show my friends</button>
          </div>
        {:else if friendsError && !friends}
          <p class="sp-note err">Couldn't load friend activity: {friendsError}</p>
        {:else if !friends}
          <div class="sp-note"><span class="spinner"></span> Loading friends…</div>
        {:else if !friends.length}
          <p class="sp-note">No friend activity yet. Follow friends on Spotify and they show up here (they need "Share my listening activity" turned on).</p>
        {:else}
          <div class="friend-list">
            {#each friends as f (f.user.id)}
              <div class="friend-row">
                <button class="f-avatar" onclick={() => go(`/sp-user/${encodeURIComponent(f.user.id)}`)} aria-label="Open {f.user.name}'s profile">
                  {#if f.user.image}<img src={f.user.image} alt="" />{:else}<span>{f.user.name.slice(0, 1).toUpperCase()}</span>{/if}
                  {#if live(f)}<i class="live" title="Listening now"></i>{/if}
                </button>
                <div class="f-main">
                  <div class="f-top">
                    <a href="#/" class="f-name" onclick={(e) => { e.preventDefault(); go(`/sp-user/${encodeURIComponent(f.user.id)}`); }}>{f.user.name}</a>
                    <span class="f-time">{live(f) ? 'Listening now' : ago(f.timestamp)}</span>
                  </div>
                  {#if f.track}
                    <div class="f-track">
                      <a href="#/" onclick={(e) => { e.preventDefault(); playFriend(f); }} title="Play">{f.track.name}</a>
                      <span> • {f.track.artist}</span>
                    </div>
                    {#if f.track.context}
                      <a href="#/" class="f-ctx" onclick={(e) => { e.preventDefault(); openContext(f); }}><Icon name="music" size={12} /> {f.track.context.name}</a>
                    {/if}
                  {/if}
                  <div class="f-src"><SourceTag source="spotify" label="Friend on Spotify" /></div>
                </div>
                {#if f.track?.image}
                  <button class="f-art" onclick={() => playFriend(f)} aria-label="Play {f.track.name}"><img src={f.track.image} alt="" /><Icon name="play" size={18} /></button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </section>

      {#if following.length}
        <section class="shelf">
          <div class="shelf-head"><h2 class="shelf-title">People you follow</h2></div>
          <div class="card-grid">
            {#each following as u (u.id)}
              <SpCard round title={u.name} image={u.image} sub="Profile" onopen={() => go(`/sp-user/${encodeURIComponent(u.id)}`)} />
            {/each}
          </div>
        </section>
      {/if}

      {#if playlists?.length}
        <section class="shelf">
          <div class="shelf-head"><h2 class="shelf-title">Your Spotify playlists</h2></div>
          <div class="card-grid">
            {#each playlists as p (p.id)}
              <SpCard
                title={p.name}
                image={p.image}
                sub={p.owner && p.owner !== me?.name ? `By ${p.owner}` : p.tracks != null ? `${p.tracks} songs` : 'Playlist'}
                onopen={() => go(`/sp-playlist/${p.id}`)}
                onplay={() => playSpPlaylist(p.id, p.name)}
                playing={player.source?.path === `/sp-playlist/${p.id}` && player.playing}
              />
            {/each}
          </div>
        </section>
      {/if}

      {#if ytPlaylists.length}
        <section class="shelf">
          <div class="shelf-head"><h2 class="shelf-title">Your YouTube Music playlists</h2></div>
          <div class="card-grid">
            {#each ytPlaylists as c (c.browseId)}
              {@const id = c.browseId!.slice(2)}
              <SpCard
                source="ytm"
                title={c.title}
                image={bestThumb(c.thumbnails, 300)}
                sub={c.subtitle || 'Playlist'}
                onopen={() => go(`/playlist/${id}`)}
                onplay={() => (player.source?.path === `/playlist/${id}` ? player.toggle() : playPlaylist(id, false, { title: c.title, path: `/playlist/${id}` }))}
                playing={player.source?.path === `/playlist/${id}` && player.playing}
              />
            {/each}
          </div>
        </section>
      {/if}

      {#if spotify.available}
        <section class="shelf">
          <div class="shelf-head"><h2 class="shelf-title">Open a Spotify profile</h2></div>
          <form class="open-link" onsubmit={(e) => { e.preventDefault(); openLink(); }}>
            <input class="input" bind:value={link} placeholder="https://open.spotify.com/user/…" />
            <button class="pill-btn" type="submit" disabled={!link.trim()}>Open</button>
          </form>
          <p class="sp-note">In Spotify: open someone's profile → ⋯ → Share → Copy link to profile.</p>
        </section>
      {/if}
    </div>
  </div>
</div>
