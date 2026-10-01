<script lang="ts">
  import { player } from '../player/player.svelte';
  import { lyrics } from '../player/lyrics.svelte';
  import { dominantColor } from '../util/color';
  import { bestThumb } from '../util/thumbs';
  import { tick } from 'svelte';

  let color = $state<string | null>(null);
  let box: HTMLDivElement | undefined = $state();
  $effect(() => {
    player.current?.videoId;
    lyrics.load();
    dominantColor(bestThumb(player.current?.thumbnails, 60)).then((c) => (color = c));
  });
  $effect(() => {
    const i = lyrics.active;
    if (i < 0 || !box) return;
    tick().then(() => box?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  });
</script>

<div class="lyrics-view" class:unsynced={!lyrics.data?.lines} style="background:{color ?? '#535353'}" bind:this={box}>
  {#if !player.current}
    <div class="line" style="color:#fff">Play a song to see its lyrics.</div>
  {:else if lyrics.loading}
    <div class="spinner lg" style="color:#fff"></div>
  {:else if !lyrics.data}
    <div class="line" style="color:#fff">Looks like we don't have the lyrics for this song.</div>
  {:else if lyrics.data.lines}
    {#each lyrics.data.lines as l, i}
      <p class="line" class:active={i === lyrics.active} class:past={i < lyrics.active} data-i={i} role="presentation" onclick={() => player.seek(l.start)}>{l.text || '♪'}</p>
    {/each}
    {#if lyrics.data.source}<div class="lyrics-src">{lyrics.data.source}</div>{/if}
  {:else}
    {#each lyrics.data.text.split('\n') as l}
      <p class="line selectable">{l || ' '}</p>
    {/each}
    {#if lyrics.data.source}<div class="lyrics-src">{lyrics.data.source}</div>{/if}
  {/if}
</div>
