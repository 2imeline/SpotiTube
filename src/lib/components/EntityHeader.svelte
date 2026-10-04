<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Thumb } from '../api/types';
  import Img from './Img.svelte';
  import { dominantColor } from '../util/color';
  import { bestThumb } from '../util/thumbs';
  import { ui } from '../stores/ui.svelte';
  import { router } from '../stores/router.svelte';

  let {
    type,
    title,
    thumbs,
    round = false,
    description,
    color = $bindable<string | null>(null),
    meta,
    cover,
  }: { type?: string; title: string; thumbs?: Thumb[]; round?: boolean; description?: string; color?: string | null; meta?: Snippet; cover?: Snippet } = $props();

  $effect(() => {
    ui.page = { path: router.route.path, title };
  });
  $effect(() => {
    const u = bestThumb(thumbs, 60);
    dominantColor(u).then((c) => (color = c ?? 'rgb(83,83,83)'));
  });
</script>

<div class="view-bg" style="background:linear-gradient({color ?? 'rgb(83,83,83)'} 0%, {color ?? 'rgb(83,83,83)'} 40%, transparent 100%);height:460px;opacity:.85"></div>
<div class="ent-header">
  {#if cover}{@render cover()}{:else}<Img {thumbs} size={232} class="ent-cover {round ? 'round' : ''}" eager icon={round ? 'user' : 'music'} />{/if}
  <div class="ent-meta">
    {#if type}<div class="ent-type">{type}</div>{/if}
    <h1 class="ent-title selectable" class:long={title.length > 26}>{title}</h1>
    {#if description}<div class="ent-desc selectable">{description}</div>{/if}
    {#if meta}<div class="ent-line">{@render meta()}</div>{/if}
  </div>
</div>
