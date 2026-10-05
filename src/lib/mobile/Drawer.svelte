<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import Icon from '../components/Icon.svelte';
  import { ui } from '../stores/ui.svelte';
  import { auth } from '../stores/auth.svelte';
  import { spotify } from '../stores/spotify.svelte';
  import { updater } from '../stores/updater.svelte';
  import { settings } from '../stores/settings.svelte';
  import { go } from '../stores/router.svelte';

  function to(path: string) {
    ui.drawerOpen = false;
    go(path);
  }
  const items = $derived([
    { icon: 'user', label: 'Profile & friends', path: '/me' },
    { icon: 'history', label: 'Recents', path: '/history' },
    { icon: 'heart', label: 'Liked Music', path: '/playlist/LM' },
    { icon: 'upload', label: 'Uploads', path: '/uploads' },
    { icon: 'explore', label: 'Explore', path: '/explore' },
    { icon: 'chart', label: 'Charts', path: '/charts' },
    { icon: 'settings', label: settings.theme === 'apple' ? 'Settings' : 'Settings and privacy', path: '/settings' },
  ]);
</script>

{#if ui.drawerOpen}
  <div class="m-drawer-backdrop" role="presentation" transition:fade={{ duration: 200 }} onclick={() => (ui.drawerOpen = false)}></div>
  <aside class="m-drawer {settings.theme}" transition:fly={{ x: -340, duration: 260, opacity: 1 }}>
    <button class="m-drawer-profile" onclick={() => to('/me')}>
      {#if auth.account?.photo}<img src={auth.account.photo} alt="" />{:else}<span class="ph">{(auth.account?.name ?? spotify.me?.name ?? '?')[0]?.toUpperCase()}</span>{/if}
      <div>
        <div class="n">{auth.loggedIn ? (auth.account?.name ?? 'Google account') : 'Not signed in'}</div>
        <div class="s">View profile</div>
      </div>
    </button>
    <div class="m-drawer-sep"></div>
    {#if !auth.loggedIn}
      <button class="m-drawer-item" onclick={() => { ui.drawerOpen = false; auth.login(); }}><Icon name="user" size={22} /><span>Sign in with Google</span></button>
    {/if}
    {#each items as it}
      <button class="m-drawer-item" onclick={() => to(it.path)}><Icon name={it.icon} size={22} /><span>{it.label}</span></button>
    {/each}
    {#if updater.available}
      <button class="m-drawer-item accent" onclick={() => { ui.drawerOpen = false; updater.install(); }}><Icon name="download" size={22} /><span>Get SpotiTube {updater.info?.latest}</span></button>
    {/if}
    {#if auth.loggedIn}
      <button class="m-drawer-item" onclick={() => { ui.drawerOpen = false; auth.logout(); }}><Icon name="logout" size={22} /><span>Log out</span></button>
    {/if}
  </aside>
{/if}
