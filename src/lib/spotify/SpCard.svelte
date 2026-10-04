<script lang="ts">
  import Img from '../components/Img.svelte';
  import PlayButton from '../components/PlayButton.svelte';
  import SourceTag from './SourceTag.svelte';

  let {
    title,
    image,
    sub,
    round = false,
    source = 'spotify',
    onopen,
    onplay,
    playing = false,
  }: { title: string; image?: string; sub?: string; round?: boolean; source?: 'spotify' | 'ytm'; onopen: () => void; onplay?: () => void; playing?: boolean } = $props();
</script>

<div class="card sp-card" class:round role="button" tabindex="0" onclick={onopen} onkeydown={(e) => e.key === 'Enter' && onopen()}>
  <div class="card-img">
    <Img thumbs={image ? [{ url: image }] : []} size={180} icon={round ? 'user' : 'music'} />
    {#if onplay}
      <div class="card-play" class:visible={playing}>
        <PlayButton {playing} onclick={onplay} />
      </div>
    {/if}
  </div>
  <div class="card-title" {title}>{title}</div>
  <div class="card-sub">
    {#if sub}<span class="sp-sub">{sub}</span>{/if}
    <SourceTag {source} />
  </div>
</div>
