<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Img from '../components/Img.svelte';
  import { router, go } from '../stores/router.svelte';
  import { auth } from '../stores/auth.svelte';
  import { library } from '../stores/library.svelte';
  import { ui } from '../stores/ui.svelte';
  import { player } from '../player/player.svelte';
  import { cardRoute } from '../api/ytm';
  import { cardMenu, newPlaylistDialog, openAccountMenu, playCard } from '../actions';

  let open = $state<Record<string, boolean>>({ music: true, library: true, playlists: true });
  type Item = { label: string; icon: string; path: string; color: string };
  const music: Item[] = [
    { label: 'Home', icon: 'homeFill', path: '/', color: '#2c8be0' },
    { label: 'Explore', icon: 'explore', path: '/explore', color: '#1fa37a' },
    { label: 'Charts', icon: 'chart', path: '/charts', color: '#e07b1f' },
    { label: 'Moods & genres', icon: 'star', path: '/moods', color: '#c23ec9' },
    { label: 'New releases', icon: 'album', path: '/browse/FEmusic_new_releases', color: '#d9364d' },
  ];
  const lib: Item[] = [
    { label: 'Liked Music', icon: 'heartFill', path: '/playlist/LM', color: '#e0336b' },
    { label: 'Playlists', icon: 'list', path: '/library?tab=playlists', color: '#2c8be0' },
    { label: 'Songs', icon: 'music', path: '/library?tab=songs', color: '#3aa23a' },
    { label: 'Albums', icon: 'album', path: '/library?tab=albums', color: '#6b5bd6' },
    { label: 'Artists', icon: 'artist', path: '/library?tab=subscriptions', color: '#d18a12' },
    { label: 'Podcasts', icon: 'podcast', path: '/library?tab=podcasts', color: '#8a3fbf' },
    { label: 'History', icon: 'history', path: '/history', color: '#4a7a9c' },
    { label: 'Uploads', icon: 'upload', path: '/uploads', color: '#c25a2a' },
  ];
  const active = (p: string) => router.route.path === p || (p !== '/' && router.route.path.startsWith(p + '?'));
  const playlists = $derived(library.playlists.filter((p) => p.browseId !== 'VLLM'));
</script>

<nav class="aero-nav" aria-label="Navigation">
  <button class="user-tile" onclick={openAccountMenu} title="Account">
    <span class="frame">
      {#if auth.account?.photo}<img src={auth.account.photo} alt="" />{:else}<Icon name="user" size={26} />{/if}
    </span>
    <span class="who">
      <span class="name">{auth.loggedIn ? auth.account?.name ?? 'Signed in' : 'Not signed in'}</span>
      <span class="sub">{auth.loggedIn ? 'Account options ▾' : 'Click to sign in'}</span>
    </span>
  </button>

  <div class="tree">
    {#snippet group(key: string, title: string, items: Item[])}
      <button class="grp" onclick={() => (open[key] = !open[key])} aria-expanded={open[key]}>
        <span class="tw" class:open={open[key]}>▷</span>{title}
      </button>
      {#if open[key]}
        {#each items as it}
          <button class="node" class:sel={active(it.path)} onclick={() => go(it.path)}>
            <span class="ico" style="--c:{it.color}"><Icon name={it.icon} size={12} /></span>{it.label}
          </button>
        {/each}
      {/if}
    {/snippet}

    {@render group('music', 'Music', music)}
    {@render group('library', 'Library', lib)}

    <button class="grp" onclick={() => (open.playlists = !open.playlists)} aria-expanded={open.playlists}>
      <span class="tw" class:open={open.playlists}>▷</span>Playlists
      <span class="grp-add" role="button" tabindex="0" title="Create playlist" onclick={(e) => { e.stopPropagation(); newPlaylistDialog().then((id) => id && go(`/playlist/${id}`)); }} onkeydown={() => {}}>＋</span>
    </button>
    {#if open.playlists}
      {#if !auth.loggedIn}
        <div class="hint">Sign in to see your playlists</div>
      {/if}
      {#each playlists as p (p.browseId)}
        {@const r = cardRoute(p) ?? ''}
        <button
          class="node pl"
          class:sel={router.route.path === r}
          class:playing={player.source?.path === r}
          onclick={() => go(r)}
          ondblclick={() => playCard(p)}
          oncontextmenu={(e) => ui.openMenu(e, cardMenu(p), p)}
          title={p.title}
        >
          <Img thumbs={p.thumbnails} size={18} class="pl-thumb" />{p.title}
          {#if player.source?.path === r && player.playing}<span class="np-dot"><Icon name="volume" size={11} /></span>{/if}
        </button>
      {/each}
    {/if}
  </div>

  <div class="nav-foot">
    <button class="node" class:sel={router.route.name === 'settings'} onclick={() => go('/settings')}>
      <span class="ico" style="--c:#5b6b7c"><Icon name="settings" size={12} /></span>Options
    </button>
  </div>
</nav>

<style>
  .aero-nav {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background: linear-gradient(90deg, #f3f8fd, #e9f1fa);
    font-size: 12.5px;
    color: #1b2a3a;
  }
  .user-tile {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 10px 10px 12px;
    text-align: left;
    background: linear-gradient(#ffffff, #e7f0fa);
    border-bottom: 1px solid #c9d8e8;
  }
  .user-tile:hover {
    background: linear-gradient(#f4fbff, #d6ebfb);
  }
  /* Windows 7 start-menu user picture frame */
  .frame {
    width: 44px;
    height: 44px;
    border-radius: 6px;
    padding: 3px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    color: #6a86a3;
    background: linear-gradient(#fdfdfd, #c9d9ea 50%, #a9c1da 51%, #e4eef8);
    border: 1px solid #6e8bab;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.8), 0 2px 5px rgba(0, 30, 70, 0.3);
  }
  .frame img {
    width: 100%;
    height: 100%;
    border-radius: 3px;
    object-fit: cover;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .who .name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .who .sub {
    color: #4d6a8a;
    font-size: 11.5px;
  }
  .tree {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0 12px;
  }
  .grp {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 7px 10px 3px 6px;
    color: #1e3287;
    font-size: 12.5px;
    text-align: left;
  }
  .grp:hover {
    color: #3c7fb1;
  }
  .tw {
    display: inline-block;
    width: 14px;
    font-size: 9px;
    color: #6d7f92;
    transition: transform 0.15s;
  }
  .tw.open {
    transform: rotate(45deg);
    color: #262626;
  }
  .grp-add {
    margin-left: auto;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border-radius: 3px;
    color: #2e5f8f;
    font-size: 13px;
  }
  .grp-add:hover {
    background: #d6ebfb;
    box-shadow: inset 0 0 0 1px #8bbde6;
  }
  .node {
    display: flex;
    align-items: center;
    gap: 7px;
    width: calc(100% - 12px);
    margin: 0 6px;
    padding: 3px 6px 3px 22px;
    min-height: 24px;
    border: 1px solid transparent;
    border-radius: 3px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .node:hover {
    background: linear-gradient(#f5fbff, #e3f2fd);
    border-color: #b8d6fb;
  }
  .node.sel {
    background: linear-gradient(rgba(var(--accent-rgb), 0.12), rgba(var(--accent-rgb), 0.3));
    border-color: rgba(var(--accent-rgb), 0.75);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6);
  }
  .node.playing {
    font-weight: 600;
    color: var(--accent-deep);
  }
  .ico {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    color: #fff;
    background: linear-gradient(rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 55%), var(--c);
    border: 1px solid rgba(0, 0, 0, 0.25);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }
  .ico :global(.icon) {
    filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.35));
  }
  .pl {
    padding-left: 22px;
  }
  .pl :global(.pl-thumb) {
    width: 18px;
    height: 18px;
    border-radius: 2px;
    object-fit: cover;
    flex-shrink: 0;
    border: 1px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
  }
  .np-dot {
    margin-left: auto;
    color: var(--accent-dark);
  }
  .hint {
    color: #6c7f93;
    padding: 4px 28px;
    font-style: italic;
  }
  .nav-foot {
    border-top: 1px solid #c9d8e8;
    padding: 6px 0;
    background: linear-gradient(#eef5fc, #e1ecf8);
  }
</style>
