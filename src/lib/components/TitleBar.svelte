<script lang="ts">
  import Icon from './Icon.svelte';
  import SearchBox from './SearchBox.svelte';
  import WindowControls from './WindowControls.svelte';
  import { router, go } from '../stores/router.svelte';
  import { auth } from '../stores/auth.svelte';
  import { openAccountMenu } from '../actions';
  import { updater } from '../stores/updater.svelte';
</script>

<header class="titlebar">
  <div class="drag" data-tauri-drag-region></div>
  <div class="tb-logo" title="SpotiTube">
    <svg width="32" height="32" viewBox="0 0 512 512"><circle cx="256" cy="256" r="240" fill="var(--accent)" /><circle cx="256" cy="256" r="150" fill="none" stroke="#000" stroke-width="26" opacity=".85" /><path d="M215 180 L345 256 L215 332 Z" fill="#000" stroke="#000" stroke-width="18" stroke-linejoin="round" /></svg>
  </div>
  <div class="tb-nav">
    <button class="round-btn" aria-label="Go back" title="Go back" disabled={!router.canBack} onclick={() => router.back()}><Icon name="chevronLeft" /></button>
    <button class="round-btn" aria-label="Go forward" title="Go forward" disabled={!router.canForward} onclick={() => router.forward()}><Icon name="chevronRight" /></button>
  </div>

  <div class="tb-center">
    <button class="home-btn" class:active={router.route.name === 'home'} title="Home" aria-label="Home" onclick={() => go('/')}>
      <Icon name={router.route.name === 'home' ? 'homeFill' : 'home'} size={24} />
    </button>
    <SearchBox />
  </div>

  <div class="tb-right">
    {#if updater.available}
      <button class="pill-btn update-pill" title="Install SpotiTube {updater.info?.latest}" onclick={() => updater.install()} disabled={updater.installing}>
        <Icon name="download" size={14} />{updater.installing ? `Updating ${Math.round(updater.progress * 100)}%` : 'Update'}
      </button>
    {/if}
    {#if auth.ready && !auth.loggedIn}
      <button class="pill-btn ghost" onclick={() => go('/settings')}>Settings</button>
      <button class="pill-btn" onclick={() => auth.login()}>Log in</button>
    {/if}
    <button class="avatar-btn" aria-label="Account" title={auth.account?.name ?? 'Account'} onclick={openAccountMenu}>
      {#if auth.account?.photo}
        <img src={auth.account.photo} alt="" />
      {:else}
        <span class="avatar-fallback">{(auth.account?.name ?? '?')[0]?.toUpperCase()}</span>
      {/if}
    </button>
    <WindowControls />
  </div>
</header>
