<script lang="ts">
  import { ui } from '../stores/ui.svelte';
  import PlayButton from './PlayButton.svelte';
  let { title, color, playing = false, onplay, threshold = 300 }: { title: string; color?: string | null; playing?: boolean; onplay?: () => void; threshold?: number } = $props();
  const show = $derived(ui.scrollY > threshold);
</script>

<div class="sticky-head" class:show style="background:{show ? `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)), ${color ?? '#333'}` : 'transparent'}">
  {#if onplay}<PlayButton {playing} onclick={onplay} />{/if}
  <span class="st-title">{title}</span>
</div>
