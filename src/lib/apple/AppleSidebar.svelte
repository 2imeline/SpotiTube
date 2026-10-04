<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Img from '../components/Img.svelte';
  import SearchBox from '../components/SearchBox.svelte';
  import { router, go } from '../stores/router.svelte';
  import { library } from '../stores/library.svelte';
  import { auth } from '../stores/auth.svelte';
  import { ui } from '../stores/ui.svelte';
  import { player } from '../player/player.svelte';
  import { cardRoute } from '../api/ytm';
  import { cardMenu, newPlaylistDialog, openAccountMenu, playCard } from '../actions';

  type Item = { label: string; icon: string; path: string };
  const apple: Item[] = [
    { label: 'Home', icon: 'homeFill', path: '/' },
    { label: 'New', icon: 'star', path: '/browse/FEmusic_new_releases' },
    { label: 'Radio', icon: 'radio', path: '/moods' },
    { label: 'Charts', icon: 'chart', path: '/charts' },
    { label: 'Browse', icon: 'explore', path: '/explore' },
  ];
  const lib: Item[] = [
    { label: 'Recently Played', icon: 'history', path: '/history' },
    { label: 'Artists', icon: 'artist', path: '/library?tab=subscriptions' },
    { label: 'Albums', icon: 'album', path: '/library?tab=albums' },
    { label: 'Songs', icon: 'music', path: '/library?tab=songs' },
    { label: 'Favorite Songs', icon: 'star', path: '/playlist/LM' },
    { label: 'Podcasts', icon: 'podcast', path: '/library?tab=podcasts' },
    { label: 'Uploads', icon: 'upload', path: '/uploads' },
  ];
  let showPlaylists = $state(true);
  const active = (p: string) => router.route.path === p;
  const playlists = $derived(library.playlists.filter((p) => p.browseId !== 'VLLM'));
</script>

<nav class="am-side" aria-label="Sidebar">
  <div class="drag" data-tauri-drag-region></div>
  <div class="am-search"><SearchBox variant="apple" placeholder="Search" /></div>
  <div class="scroll">
    <div class="sec">Apple Music</div>
    {#each apple as it}
      <button class="item" class:sel={active(it.path)} onclick={() => go(it.path)}><Icon name={it.icon} size={15} />{it.label}</button>
    {/each}
    <div class="sec">Library</div>
    {#each lib as it}
      <button class="item" class:sel={active(it.path)} onclick={() => go(it.path)}><Icon name={it.icon} size={15} />{it.label}</button>
    {/each}
    <div class="sec sec-row">
      <button class="sec-btn" onclick={() => (showPlaylists = !showPlaylists)}>Playlists <span class="chev" class:open={showPlaylists}>›</span></button>
      <button class="add" title="New Playlist" aria-label="New Playlist" onclick={() => newPlaylistDialog().then((id) => id && go(`/playlist/${id}`))}>+</button>
    </div>
    {#if showPlaylists}
      <button class="item" class:sel={active('/library?tab=playlists')} onclick={() => go('/library?tab=playlists')}><Icon name="grid" size={15} />All Playlists</button>
      {#each playlists as p (p.browseId)}
        {@const r = cardRoute(p) ?? ''}
        <button class="item pl" class:sel={active(r)} title={p.title} onclick={() => go(r)} ondblclick={() => playCard(p)} oncontextmenu={(e) => ui.openMenu(e, cardMenu(p), p)}>
          <Img thumbs={p.thumbnails} size={20} class="pl-art" />
          <span class="lbl">{p.title}</span>
          {#if player.source?.path === r && player.playing}<Icon name="volume" size={12} class="np" />{/if}
        </button>
      {/each}
    {/if}
  </div>
  <button class="acct" onclick={openAccountMenu}>
    {#if auth.account?.photo}<img src={auth.account.photo} alt="" />{:else}<span class="ph"><Icon name="user" size={14} /></span>{/if}
    <span class="nm">{auth.loggedIn ? auth.account?.name ?? 'Account' : 'Sign In'}</span>
    <span class="gear" role="button" tabindex="0" title="Settings" onclick={(e) => { e.stopPropagation(); go('/settings'); }} onkeydown={() => {}}><Icon name="settings" size={14} /></span>
  </button>
</nav>

<style>
  .am-side {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--am-side);
    border-right: 1px solid var(--am-sep);
    backdrop-filter: blur(30px) saturate(1.8);
    font-size: 13px;
  }
  .drag {
    height: 14px;
    flex-shrink: 0;
  }
  .am-search {
    padding: 8px 12px 10px;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0 10px 12px;
  }
  .sec {
    font-size: 11px;
    font-weight: 600;
    color: var(--am-text-3);
    padding: 14px 8px 4px;
  }
  .sec-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sec-btn {
    font: inherit;
    color: inherit;
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .chev {
    display: inline-block;
    transition: transform 0.15s;
    font-size: 13px;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .add {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    font-size: 15px;
    line-height: 1;
    color: var(--am-text-2);
  }
  .add:hover {
    background: var(--am-hover);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border-radius: 6px;
    color: var(--am-text);
    text-align: left;
    white-space: nowrap;
  }
  .item :global(.icon) {
    color: var(--accent);
  }
  .item:hover {
    background: var(--am-hover);
  }
  .item.sel {
    background: var(--am-selected);
  }
  .pl :global(.pl-art) {
    width: 20px;
    height: 20px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .pl .lbl {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .pl :global(.np) {
    color: var(--accent);
  }
  .acct {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 10px 10px;
    padding: 6px 8px;
    border-radius: 8px;
    color: var(--am-text);
    text-align: left;
  }
  .acct:hover {
    background: var(--am-hover);
  }
  .acct img,
  .acct .ph {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    display: grid;
    place-items: center;
    background: var(--am-fill);
    color: var(--am-text-2);
  }
  .nm {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gear {
    color: var(--am-text-2);
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
  }
  .gear:hover {
    background: var(--am-hover);
  }
</style>
