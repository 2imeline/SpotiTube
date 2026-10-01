<script lang="ts">
  import Icon from './Icon.svelte';
  import Img from './Img.svelte';
  import Slider from './Slider.svelte';
  import VideoStage from './VideoStage.svelte';
  import { player } from '../player/player.svelte';
  import { lyrics } from '../player/lyrics.svelte';
  import { library } from '../stores/library.svelte';
  import { ui } from '../stores/ui.svelte';
  import { fmtTime } from '../api/parse';
  import { artistNames, bestThumb } from '../util/thumbs';
  import { isTauri } from '../api/transport';
  import { onMount } from 'svelte';

  const t = $derived(player.current);
  let seeking = $state<number | null>(null);
  let showLyrics = $state(false);
  const dur = $derived(player.duration || t?.durationSec || 0);
  const liked = $derived(t ? library.likeOf(t) === 'LIKE' : false);

  onMount(() => {
    let win: any;
    if (isTauri)
      import('@tauri-apps/api/window').then(async (m) => {
        win = m.getCurrentWindow();
        await win.setFullscreen(true);
      });
    return () => win?.setFullscreen(false);
  });
  $effect(() => {
    t?.videoId;
    if (showLyrics) lyrics.load();
  });
  const line = $derived(lyrics.data?.lines && lyrics.active >= 0 ? lyrics.data.lines[lyrics.active].text : '');
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (ui.fullscreenPlayer = false)} />

<div class="fs-player">
  <div class="fs-bg" style="background-image:url('{bestThumb(t?.thumbnails, 300)}')"></div>
  <div class="fs-top">
    <div style="display:flex;align-items:center;gap:12px">
      <div class="tb-logo"><svg width="28" height="28" viewBox="0 0 512 512"><circle cx="256" cy="256" r="240" fill="var(--accent)" /><path d="M215 180 L345 256 L215 332 Z" fill="#000" /></svg></div>
      <div>
        <div style="font-size:12px;opacity:.7;text-transform:uppercase;letter-spacing:.1em">Playing from</div>
        <div style="font-weight:700">{player.source?.title ?? 'Queue'}</div>
      </div>
    </div>
    <button class="round-btn" aria-label="Exit full screen" onclick={() => (ui.fullscreenPlayer = false)}><Icon name="exitFullscreen" /></button>
  </div>
  <div class="fs-main">
    {#if player.video}
      <div class="fs-video"><VideoStage /></div>
    {:else if t}
      <Img thumbs={t.thumbnails} size={500} class="cover" eager />
      <div class="fs-meta" style="flex:1;min-width:0">
        {#if showLyrics && line}<div style="font-size:clamp(24px,3.4vw,44px);font-weight:800;margin-bottom:24px;max-width:900px">{line}</div>{/if}
        <div class="tt">{t.title}</div>
        <div class="aa">{artistNames(t.artists)}{#if t.album} — {t.album.name}{/if}</div>
      </div>
    {/if}
  </div>
  <div class="fs-bottom">
    <div class="np-progress" style="margin-bottom:12px;color:rgba(255,255,255,.8)">
      <span class="time">{fmtTime(seeking ?? player.time)}</span>
      <Slider value={seeking ?? player.time} max={dur} buffered={player.buffered} label="Seek" oninput={(v) => (seeking = v)} onchange={(v) => { seeking = null; player.seek(v); }} />
      <span class="time">{fmtTime(dur)}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center">
      <div style="display:flex;gap:8px">
        {#if t && t.type !== 'episode'}<button class="ctrl" class:on={liked} aria-label="Like" onclick={() => t && library.toggleLike(t)}><Icon name={liked ? 'heartFill' : 'heart'} size={20} /></button>{/if}
        <button class="ctrl" class:on={showLyrics} aria-label="Lyrics" title="Lyrics" onclick={() => (showLyrics = !showLyrics)}><Icon name="mic" size={20} /></button>
        <button class="ctrl" class:on={player.video} aria-label="Video" title="Video" onclick={() => player.setVideo(!player.video)}><Icon name="video" size={20} /></button>
      </div>
      <div class="np-controls" style="gap:24px">
        <button class="ctrl" class:on={player.shuffle} aria-label="Shuffle" onclick={() => player.toggleShuffle()}><Icon name="shuffle" size={20} /></button>
        <button class="ctrl" aria-label="Previous" onclick={() => player.previous()}><Icon name="prev" size={24} /></button>
        <button class="ctrl-play" aria-label={player.playing ? 'Pause' : 'Play'} onclick={() => player.toggle()}><Icon name={player.playing ? 'pause' : 'play'} size={24} /></button>
        <button class="ctrl" aria-label="Next" onclick={() => player.next()}><Icon name="next" size={24} /></button>
        <button class="ctrl" class:on={player.repeat !== 'off'} aria-label="Repeat" onclick={() => player.cycleRepeat()}><Icon name={player.repeat === 'one' ? 'repeatOne' : 'repeat'} size={20} /></button>
      </div>
      <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px">
        <button class="ctrl" aria-label="Mute" onclick={() => player.toggleMute()}><Icon name={player.muted ? 'mute' : 'volume'} size={20} /></button>
        <div style="width:120px"><Slider value={player.muted ? 0 : player.volume} max={1} label="Volume" oninput={(v) => player.setVolume(v)} onchange={(v) => player.setVolume(v)} /></div>
      </div>
    </div>
  </div>
</div>
