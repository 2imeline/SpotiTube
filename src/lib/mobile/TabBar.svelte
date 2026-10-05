<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { router, go } from '../stores/router.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import { newPlaylistDialog } from '../actions';
  import { tabsFor, type Tab } from './tabs';
  import { haptic } from '../native/ios.svelte';

  const tabs = $derived(tabsFor(settings.theme));
  // detail pages keep the tab they were opened from highlighted (like the apps)
  let current = $state('/');
  $effect(() => {
    const p = router.route.path.split('?')[0];
    const hit = tabs.find((t) => t.path && (t.path === p || (t.path !== '/' && p.startsWith(t.path))));
    if (hit) current = hit.path;
    else if (settings.theme === 'apple' && p === '/search') current = '/search';
  });

  function tap(t: Tab) {
    haptic('select');
    if (t.action === 'create') {
      ui.openMenu({ x: 0, y: 0 }, [
        { label: 'Playlist', icon: 'music', run: () => newPlaylistDialog() },
        { label: 'Import from Spotify', icon: 'spotify', run: () => go('/me') },
        { label: 'Upload music', icon: 'upload', run: () => go('/uploads') },
      ]);
      return;
    }
    if (current === t.path && router.route.path !== t.path) {
      // tapping the active tab pops back to its top
      go(t.path);
    } else if (current === t.path) {
      document.querySelector('.main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    } else go(t.path);
    current = t.path;
  }
</script>

<nav class="m-tabbar" aria-label="Tabs">
  <div class="m-tabs">
    {#each tabs as t}
      {@const on = !t.action && current === t.path}
      <button class="m-tab" class:on onclick={() => tap(t)} aria-label={t.label}>
        <span class="ic"><Icon name={on && t.activeIcon ? t.activeIcon : t.icon} size={settings.theme === 'apple' ? 24 : 26} /></span>
        <span class="lbl">{t.label}</span>
      </button>
    {/each}
  </div>
  {#if settings.theme === 'apple'}
    <button class="m-tab-search" class:on={current === '/search'} aria-label="Search" onclick={() => { current = '/search'; go('/search'); }}>
      <Icon name="search" size={22} />
    </button>
  {/if}
</nav>
