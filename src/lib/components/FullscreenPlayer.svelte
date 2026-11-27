<script lang="ts">
  import Icon from './Icon.svelte';
  import Img from './Img.svelte';
  import Slider from './Slider.svelte';
  import VideoStage from './VideoStage.svelte';
  import Visualizer from './Visualizer.svelte';
  import { player } from '../player/player.svelte';
  import { lyrics } from '../player/lyrics.svelte';
  import { library } from '../stores/library.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import { fmtTime } from '../api/parse';
  import { artistNames, bestThumb } from '../util/thumbs';
  import { palette, type RGB } from '../util/color';
  import { isTauri } from '../api/transport';
  import { onMount, tick } from 'svelte';

  const t = $derived(player.current);
  let seeking = $state<number | null>(null);
  const dur = $derived(player.duration || t?.durationSec || 0);
  const liked = $derived(t ? library.likeOf(t) === 'LIKE' : false);

  // lyrics panel: on by default, remembered
  let showLyrics = $state(localStorage.getItem('st.npLyrics') !== '0');
  function toggleLyrics() {
    showLyrics = !showLyrics;
    try {
      localStorage.setItem('st.npLyrics', showLyrics ? '1' : '0');
    } catch {}
  }

  let colors = $state.raw<RGB[]>([]);
  let analyser = $state.raw<AnalyserNode | null>(null);
  let stage: HTMLDivElement | undefined = $state();
  let box: HTMLDivElement | undefined = $state();

  onMount(() => {
    let win: any;
    if (isTauri)
      import('@tauri-apps/api/window').then(async (m) => {
        win = m.getCurrentWindow();
        await win.setFullscreen(true);
      });
    return () => win?.setFullscreen(false);
  });

  // the audio tap needs a loaded stream: (re)try once something plays
  $effect(() => {
    if (player.playing && !analyser) player.analyser().then((a) => (analyser = a));
  });
  $effect(() => {
    const id = t?.videoId;
    palette(bestThumb(t?.thumbnails, 120)).then((p) => p && t?.videoId === id && (colors = p));
  });
  $effect(() => {
    t?.videoId;
    if (showLyrics) lyrics.load();
  });
  // keep the sung line a little above the middle of the panel
  $effect(() => {
    const i = lyrics.active;
    if (!showLyrics || i < 0 || !box) return;
    tick().then(() => {
      const el = box?.querySelector<HTMLElement>(`[data-i="${i}"]`);
      if (el && box) box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.38, behavior: 'smooth' });
    });
  });

  const glow = $derived(colors[0] ? colors[0].join(',') : '255,255,255');
  const onbeat = (v: number) => stage?.style.setProperty('--beat', v.toFixed(3));
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (ui.fullscreenPlayer = false)} />

<div class="fs-player">
  <Visualizer {colors} {analyser} playing={player.playing} still={settings.reduceMotion} {onbeat} />
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

  <div class="np-main">
    {#if player.video}
      <div class="fs-video"><VideoStage /></div>
    {:else if t}
      <div class="np-stage" class:lyrics={showLyrics} bind:this={stage} style="--glow:{glow}">
        <div class="np-left">
          <div class="np-cover">
            <Img thumbs={t.thumbnails} size={544} class="cover" eager />
          </div>
          <div class="np-meta">
            <div class="np-text">
              <div class="np-title" title={t.title}>{t.title}</div>
              <div class="np-artist">{artistNames(t.artists)}</div>
              {#if t.album}<div class="np-album">{t.album.name}</div>{/if}
            </div>
            <button class="np-mic" class:on={showLyrics} aria-pressed={showLyrics} aria-label="Lyrics" title={showLyrics ? 'Hide lyrics' : 'Show lyrics'} onclick={toggleLyrics}>
              <Icon name="mic" size={20} />
            </button>
          </div>
        </div>
        <div class="np-lyr-col" aria-hidden={!showLyrics}>
          {#if lyrics.loading}
            <div class="np-note"><span class="spinner"></span></div>
          {:else if !lyrics.data}
            <div class="np-note">Lyrics unavailable</div>
          {:else}
            <div class="np-lyrics" class:unsynced={!lyrics.data.lines} bind:this={box}>
              {#if lyrics.data.lines}
                {#each lyrics.data.lines as l, i}
                  <p class="ln" class:active={i === lyrics.active} class:past={i < lyrics.active} data-i={i} role="presentation" onclick={() => player.seek(l.start)}>{l.text || '♪'}</p>
                {/each}
              {:else}
                {#each lyrics.data.text.split('\n') as l}
                  <p class="ln">{l || ' '}</p>
                {/each}
              {/if}
              {#if lyrics.data.source}<div class="np-src">{lyrics.data.source}</div>{/if}
            </div>
          {/if}
        </div>
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

<style>
  .np-main {
    flex: 1;
    min-height: 0;
    position: relative;
    z-index: 2;
    display: grid;
    place-items: center;
    padding: 0 64px 24px;
  }
  /* cover column + lyrics column of the same width; without lyrics the
     second column folds to nothing and the cover glides to the centre */
  .np-stage {
    --s: min(46vh, 30vw, 520px);
    --beat: 0;
    display: grid;
    grid-template-columns: var(--s) 0px;
    column-gap: 0px;
    transition:
      grid-template-columns 0.55s cubic-bezier(0.22, 1, 0.36, 1),
      column-gap 0.55s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .np-stage.lyrics {
    grid-template-columns: var(--s) calc(var(--s) * 1.25);
    column-gap: clamp(48px, 7vw, 120px);
  }
  .np-left {
    width: var(--s);
    min-width: 0;
  }
  .np-cover {
    position: relative;
    width: var(--s);
    aspect-ratio: 1;
  }
  /* a halo in the cover's colour that breathes with the music */
  .np-cover::before {
    content: '';
    position: absolute;
    inset: 6%;
    border-radius: 24px;
    background: rgb(var(--glow));
    filter: blur(48px);
    opacity: calc(0.28 + 0.32 * var(--beat));
    transform: scale(calc(1 + 0.06 * var(--beat)));
  }
  .np-cover :global(.cover) {
    position: relative;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 10px;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  }
  .np-meta {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 24px;
  }
  .np-text {
    flex: 1;
    min-width: 0;
  }
  .np-text > div {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .np-title {
    font-size: clamp(20px, 1.9vw, 28px);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  .np-artist {
    font-size: clamp(15px, 1.2vw, 18px);
    color: rgba(255, 255, 255, 0.78);
    margin-top: 4px;
  }
  .np-album {
    font-size: clamp(13px, 1vw, 15px);
    color: rgba(255, 255, 255, 0.5);
    margin-top: 2px;
  }
  .np-mic {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.14);
    transition: background 0.2s, color 0.2s, transform 0.15s;
  }
  .np-mic:hover {
    background: rgba(255, 255, 255, 0.18);
    transform: scale(1.05);
  }
  .np-mic.on {
    background: #fff;
    color: #000;
  }

  /* same height as cover + text: the column takes the row's height, the
     panel fills it without adding its own, scrolls inside and fades at the edges */
  .np-lyr-col {
    position: relative;
    min-width: 0;
    opacity: 0;
    transition: opacity 0.35s;
  }
  .np-lyrics {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    scrollbar-width: none;
    mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
    padding: calc(var(--s) * 0.42) 0;
  }
  .np-lyrics::-webkit-scrollbar {
    display: none;
  }
  .np-stage.lyrics .np-lyr-col {
    opacity: 1;
    transition-delay: 0.2s;
  }
  .np-stage:not(.lyrics) .np-lyr-col {
    pointer-events: none;
    visibility: hidden;
    transition: opacity 0.2s, visibility 0s 0.2s;
  }
  .ln {
    margin: 0 0 14px;
    font-size: clamp(20px, 2vw, 30px);
    font-weight: 800;
    line-height: 1.3;
    letter-spacing: -0.01em;
    color: rgba(255, 255, 255, 0.32);
    cursor: pointer;
    transform-origin: left center;
    transition: color 0.35s, transform 0.35s, opacity 0.35s;
  }
  .ln.past {
    color: rgba(255, 255, 255, 0.5);
  }
  .ln.active {
    color: #fff;
    transform: scale(1.03);
  }
  .ln:hover {
    color: rgba(255, 255, 255, 0.85);
  }
  .unsynced .ln {
    color: rgba(255, 255, 255, 0.85);
    font-size: clamp(17px, 1.5vw, 22px);
    font-weight: 700;
    cursor: default;
  }
  .np-note {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.45);
    font-size: 15px;
    font-weight: 500;
  }
  .np-src {
    margin-top: 24px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
  }
</style>
