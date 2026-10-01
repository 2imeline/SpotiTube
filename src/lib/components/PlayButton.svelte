<script lang="ts">
  import Icon from './Icon.svelte';
  let { playing = false, size = 'md', onclick, class: cls = '', label = 'Play' }: { playing?: boolean; size?: 'sm' | 'md' | 'lg'; onclick: (e: MouseEvent) => void; class?: string; label?: string } = $props();
  const px = $derived(size === 'lg' ? 24 : size === 'sm' ? 16 : 20);
</script>

<button class="play-btn {size} {cls}" aria-label={playing ? 'Pause' : label} title={playing ? 'Pause' : label} onclick={(e) => { e.stopPropagation(); onclick(e); }}>
  <Icon name={playing ? 'pause' : 'play'} size={px} />
</button>
