<script lang="ts">
  import { ui } from '../stores/ui.svelte';
  import { router } from '../stores/router.svelte';
  import PlayButton from './PlayButton.svelte';
  import Icon from './Icon.svelte';
  import { isMobile } from '../native/platform';
  import { onMount } from 'svelte';
  let { title, color, playing = false, onplay, threshold = 300 }: { title: string; color?: string | null; playing?: boolean; onplay?: () => void; threshold?: number } = $props();
  const show = $derived(ui.scrollY > (isMobile ? Math.min(threshold, 220) : threshold));
  onMount(() => {
    if (!isMobile) return;
    ui.pageBar++;
    return () => ui.pageBar--;
  });
</script>

{#if isMobile}
  <div class="m-pagebar" class:show style="--bar-color:{color ?? '#333'}">
    <button class="m-pagebar-back" aria-label="Back" onclick={() => router.back()}><Icon name="chevronLeft" size={24} /></button>
    <span class="m-pagebar-title">{title}</span>
    <span style="width:40px"></span>
  </div>
{:else}
<div class="sticky-head" class:show style="background:{show ? `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)), ${color ?? '#333'}` : 'transparent'}">
  {#if onplay}<PlayButton {playing} onclick={onplay} />{/if}
  <span class="st-title">{title}</span>
</div>
{/if}
