<script lang="ts">
  // Top of a tab page on the phone: avatar (opens the drawer) + title.
  import type { Snippet } from 'svelte';
  import { ui } from '../stores/ui.svelte';
  import { auth } from '../stores/auth.svelte';
  import { spotify } from '../stores/spotify.svelte';

  let { title = '', actions, large = false }: { title?: string; actions?: Snippet; large?: boolean } = $props();
</script>

<header class="m-head" class:large>
  <button class="m-avatar" aria-label="Profile and settings" onclick={() => (ui.drawerOpen = true)}>
    {#if auth.account?.photo}<img src={auth.account.photo} alt="" />{:else if spotify.me?.image}<img src={spotify.me.image} alt="" />{:else}<span>{(auth.account?.name ?? spotify.me?.name ?? 'S')[0]?.toUpperCase()}</span>{/if}
  </button>
  {#if title}<h1 class="m-head-title">{title}</h1>{/if}
  {#if actions}<div class="m-head-actions">{@render actions()}</div>{/if}
</header>
