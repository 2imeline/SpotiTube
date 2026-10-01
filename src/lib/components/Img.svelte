<script lang="ts">
  import type { Thumb } from '../api/types';
  import { bestThumb } from '../util/thumbs';
  import Icon from './Icon.svelte';
  let { thumbs, size = 200, class: cls = '', alt = '', icon = 'music', eager = false }: { thumbs?: Thumb[]; size?: number; class?: string; alt?: string; icon?: string; eager?: boolean } = $props();
  let failed = $state(false);
  const src = $derived(bestThumb(thumbs, size));
  $effect(() => {
    src;
    failed = false;
  });
</script>

{#if src && !failed}
  <img class={cls} {src} {alt} loading={eager ? 'eager' : 'lazy'} decoding="async" draggable="false" onerror={() => (failed = true)} />
{:else}
  <div class="ph {cls}" style="display:grid;place-items:center;color:var(--text-mute);background:var(--elev-2)"><Icon name={icon} size={Math.max(16, Math.min(64, size / 3))} /></div>
{/if}
