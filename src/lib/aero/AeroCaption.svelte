<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import SearchBox from '../components/SearchBox.svelte';
  import WindowControls from '../components/WindowControls.svelte';
  import { router, go } from '../stores/router.svelte';
  import { ui } from '../stores/ui.svelte';
  import { player } from '../player/player.svelte';
  import { artistNames } from '../util/thumbs';
  import { updater } from '../stores/updater.svelte';

  type Crumb = { label: string; path?: string };
  const LIB_TABS: Record<string, string> = {
    playlists: 'Playlists', songs: 'Songs', albums: 'Albums', artists: 'Artists', subscriptions: 'Subscriptions',
    podcasts: 'Podcasts', channels: 'Channels', uploadSongs: 'Songs', uploadAlbums: 'Albums', uploadArtists: 'Artists',
  };

  const crumbs = $derived.by((): Crumb[] => {
    const r = router.route;
    const title = ui.page?.path === r.path ? ui.page.title : '';
    const c: Crumb[] = [];
    switch (r.name) {
      case 'home': c.push({ label: 'Home', path: '/' }); break;
      case 'search': c.push({ label: 'Search', path: '/search' }); if (r.query.get('q')) c.push({ label: `"${r.query.get('q')}"` }); break;
      case 'explore': c.push({ label: 'Explore', path: '/explore' }); break;
      case 'charts': c.push({ label: 'Explore', path: '/explore' }, { label: 'Charts' }); break;
      case 'moods': c.push({ label: 'Explore', path: '/explore' }, { label: 'Moods & genres' }); break;
      case 'mood': c.push({ label: 'Explore', path: '/explore' }, { label: 'Moods & genres', path: '/moods' }, { label: r.query.get('t') ?? title }); break;
      case 'browse': c.push({ label: 'Explore', path: '/explore' }, { label: title || 'Browse' }); break;
      case 'artist': c.push({ label: 'Artists', path: '/library?tab=subscriptions' }, { label: title || '…' }); break;
      case 'album': c.push({ label: 'Albums', path: '/library?tab=albums' }, { label: title || '…' }); break;
      case 'playlist':
        if (r.params[0] === 'LM') c.push({ label: 'Library', path: '/library' }, { label: 'Liked Music' });
        else c.push({ label: 'Playlists', path: '/library?tab=playlists' }, { label: title || '…' });
        break;
      case 'podcast': c.push({ label: 'Podcasts', path: '/library?tab=podcasts' }, { label: title || '…' }); break;
      case 'episode': c.push({ label: 'Podcasts', path: '/library?tab=podcasts' }, { label: title || 'Episode' }); break;
      case 'library': c.push({ label: 'Library', path: '/library' }, { label: LIB_TABS[r.query.get('tab') ?? 'playlists'] ?? '' }); break;
      case 'uploads': c.push({ label: 'Library', path: '/library' }, { label: 'Uploads', path: '/uploads' }, { label: LIB_TABS[r.query.get('tab') ?? 'uploadSongs'] }); break;
      case 'history': c.push({ label: 'Library', path: '/library' }, { label: 'History' }); break;
      case 'lyrics': c.push({ label: 'Now Playing' }, { label: 'Lyrics' }); break;
      case 'settings': c.push({ label: 'Options' }); break;
      case 'me': c.push({ label: 'Profile & friends' }); break;
      case 'sp-user': c.push({ label: 'Profile & friends', path: '/me' }, { label: title ? `${title} (Spotify)` : '…' }); break;
      case 'sp-playlist': c.push({ label: 'Profile & friends', path: '/me' }, { label: title ? `${title} (Spotify)` : '…' }); break;
      default: c.push({ label: r.name });
    }
    return c.filter((x) => x.label);
  });
  const t = $derived(player.current);
</script>

<header class="aero-caption">
  <div class="cap-row" data-tauri-drag-region>
    <div class="orb-logo" data-tauri-drag-region>
      <svg width="22" height="22" viewBox="0 0 512 512"><path d="M190 140 L370 256 L190 372 Z" fill="#fff" /></svg>
    </div>
    <div class="cap-title" data-tauri-drag-region>
      SpotiTube{#if t}<span class="cap-np">{' — '}{t.title}{t.artists.length ? ` – ${artistNames(t.artists)}` : ''}</span>{/if}
    </div>
    <WindowControls />
  </div>
  <div class="cmd-row">
    <div class="nav-capsule">
      <button class="nav-orb back" aria-label="Back" title="Back" disabled={!router.canBack} onclick={() => router.back()}><Icon name="chevronLeft" size={16} /></button>
      <button class="nav-orb fwd" aria-label="Forward" title="Forward" disabled={!router.canForward} onclick={() => router.forward()}><Icon name="chevronRight" size={14} /></button>
    </div>
    <nav class="address" aria-label="Location">
      <span class="addr-icon"><Icon name="music" size={16} /></span>
      <button class="crumb root" onclick={() => go('/')}>SpotiTube</button>
      {#each crumbs as c, i}
        <span class="sep">▸</span>
        {#if c.path && i < crumbs.length - 1}
          <button class="crumb" onclick={() => go(c.path!)}>{c.label}</button>
        {:else}
          <span class="crumb cur" title={c.label}>{c.label}</span>
        {/if}
      {/each}
      <span class="addr-fill" data-tauri-drag-region></span>
    </nav>
    {#if updater.available}
      <button class="aero-update" title="Install SpotiTube {updater.info?.latest}" onclick={() => updater.install()} disabled={updater.installing}>
        <span class="shield"><Icon name="download" size={11} /></span>{updater.installing ? `Installing… ${Math.round(updater.progress * 100)}%` : `Update to ${updater.info?.latest}`}
      </button>
    {/if}
    <div class="aero-search"><SearchBox variant="aero" placeholder="Search YouTube Music" /></div>
  </div>
</header>

<style>
  .aero-caption {
    color: #000;
    position: relative;
    z-index: 5;
  }
  .cap-row {
    display: flex;
    align-items: center;
    height: 32px;
    gap: 8px;
    padding-left: 4px;
  }
  .orb-logo {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: radial-gradient(circle at 50% 25%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0) 55%), radial-gradient(circle at 50% 120%, var(--accent-hover), var(--accent) 45%, var(--accent-deep));
    border: 1px solid rgba(0, 0, 0, 0.5);
    box-shadow: 0 0 6px rgba(var(--accent-rgb), 0.8);
  }
  .orb-logo svg {
    width: 12px;
    height: 12px;
    margin-left: 2px;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6));
  }
  .cap-title {
    flex: 1;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* Windows 7 caption text "glow" */
    text-shadow: 0 0 10px #fff, 0 0 10px #fff, 0 0 16px rgba(255, 255, 255, 0.9);
    color: #000;
  }
  .cap-np {
    opacity: 0.8;
  }
  .cmd-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0 6px;
  }
  .nav-capsule {
    display: flex;
    align-items: center;
    height: 30px;
    padding: 0 6px 0 0;
    border-radius: 16px;
    background: linear-gradient(rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0.05) 50%, rgba(0, 0, 0, 0.12) 51%, rgba(255, 255, 255, 0.2));
    border: 1px solid rgba(0, 25, 60, 0.45);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }
  .nav-orb {
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    border: 1px solid rgba(0, 25, 60, 0.75);
    background: radial-gradient(circle at 50% 20%, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0) 52%), radial-gradient(circle at 50% 110%, #8fd8ff, #2a8ee0 45%, #0f4f9c);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3), 0 1px 3px rgba(0, 0, 0, 0.4);
    transition: filter 0.15s;
  }
  .nav-orb :global(.icon) {
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.7));
  }
  .nav-orb.back {
    width: 30px;
    height: 30px;
    margin-left: -1px;
  }
  .nav-orb.fwd {
    width: 24px;
    height: 24px;
    margin-left: 3px;
  }
  .nav-orb:hover:not(:disabled) {
    filter: brightness(1.15) drop-shadow(0 0 5px rgba(120, 210, 255, 0.95));
  }
  .nav-orb:disabled {
    opacity: 1;
    filter: grayscale(1) brightness(1.1);
  }
  .address {
    flex: 1;
    min-width: 0;
    height: 26px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(40, 70, 110, 0.6);
    border-radius: 2px;
    box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.5);
    font-size: 12.5px;
  }
  .addr-icon {
    color: var(--accent-dark);
    margin: 0 4px 0 2px;
  }
  .crumb {
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 2px;
    color: #000;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 280px;
  }
  button.crumb:hover {
    background: linear-gradient(#f2faff, #cde8fb);
    border-color: #79b4e2;
  }
  .crumb.cur {
    font-weight: 600;
  }
  .sep {
    color: #4a5d73;
    font-size: 10px;
  }
  .addr-fill {
    flex: 1;
    align-self: stretch;
  }
  .aero-update {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px 0 6px;
    border-radius: 3px;
    font-size: 12px;
    color: #000;
    border: 1px solid #7a9cc6;
    background: linear-gradient(#fdfdfd, #e9f3fd 49%, #d2e6fb 50%, #e8f3fe);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.8), 0 0 8px rgba(255, 210, 60, 0.75);
    white-space: nowrap;
  }
  .aero-update:hover {
    border-color: #3c7fb1;
    background: linear-gradient(#f2faff, #d9f0fd 49%, #bee6fd 50%, #a7d9f5);
  }
  /* Windows Update-style shield */
  .shield {
    width: 16px;
    height: 16px;
    border-radius: 3px 3px 8px 8px;
    display: grid;
    place-items: center;
    color: #fff;
    background: linear-gradient(90deg, #2a7de1 50%, #f5b915 50%);
    border: 1px solid rgba(0, 0, 0, 0.35);
  }
  .aero-search {
    width: 280px;
    flex-shrink: 0;
  }
</style>
