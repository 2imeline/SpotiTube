<script lang="ts">
  import { fly } from 'svelte/transition';
  import { tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import Slider from '../components/Slider.svelte';
  import { player } from '../player/player.svelte';
  import { lyrics } from '../player/lyrics.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import { artistNames, bestThumb } from '../util/thumbs';

  let { color = null }: { color?: string | null } = $props();
  let box: HTMLDivElement | undefined = $state();
  let userScrolled = 0;

  $effect(() => {
    player.current?.videoId;
    lyrics.load();
  });
  $effect(() => {
    const i = lyrics.active;
    if (i < 0 || !box || Date.now() - userScrolled < 3000) return;
    tick().then(() => {
      const el = box?.querySelector(`[data-i="${i}"]`) as HTMLElement | null;
      if (el && box) box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.3, behavior: 'smooth' });
    });
  });
  function fmt(s: number) {
    if (!isFinite(s)) s = 0;
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }
  const t = $derived(player.current);
</script>

<div class="m-pane m-lyrics {settings.theme}" style="--np-color:{color ?? '#535353'}" transition:fly={{ y: 700, duration: 280 }}>
  {#if settings.theme === 'apple' && t}<div class="m-np-blur" style="background-image:url('{bestThumb(t.thumbnails, 120)}')"></div>{/if}
  <header class="m-pane-head">
    <button class="icon-btn" aria-label="Close lyrics" onclick={() => (ui.npPane = 'none')}><Icon name="chevronDown" size={26} /></button>
    <div class="ttl">
      <div>{t?.title ?? ''}</div>
      <div class="sub">{t ? artistNames(t.artists) : ''}</div>
    </div>
    <span style="width:40px"></span>
  </header>
  <div class="m-lyrics-body" role="region" aria-label="Lyrics" bind:this={box} ontouchmove={() => (userScrolled = Date.now())}>
    {#if lyrics.loading}
      <div class="m-ly-msg"><span class="spinner lg"></span></div>
    {:else if lyrics.data?.lines?.length}
      {#each lyrics.data.lines as l, i}
        <div class="m-ly-line" class:active={i === lyrics.active} class:past={i < lyrics.active} data-i={i} role="button" tabindex="0" onclick={() => player.seek(l.start)} onkeydown={() => {}}>{l.text || '♪'}</div>
      {/each}
      {#if lyrics.data.source}<div class="m-ly-src">{lyrics.data.source}</div>{/if}
    {:else if lyrics.data?.text}
      <div class="m-ly-plain">{lyrics.data.text}</div>
      {#if lyrics.data.source}<div class="m-ly-src">{lyrics.data.source}</div>{/if}
    {:else}
      <div class="m-ly-msg"><Icon name="mic" size={40} /><div>No lyrics for this song</div></div>
    {/if}
  </div>
  <footer class="m-ly-foot">
    <Slider value={player.time} max={player.duration || 1} label="Seek" onchange={(v) => player.seek(v)} />
    <div class="row">
      <span>{fmt(player.time)}</span>
      <button class="c-play" aria-label={player.playing ? 'Pause' : 'Play'} onclick={() => player.toggle()}><Icon name={player.playing ? 'pause' : 'play'} size={24} /></button>
      <span>{fmt(player.duration)}</span>
    </div>
  </footer>
</div>
