<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Img from '../components/Img.svelte';
  import Slider from '../components/Slider.svelte';
  import { player } from '../player/player.svelte';
  import { library } from '../stores/library.svelte';
  import { ui, type MenuAction } from '../stores/ui.svelte';
  import { go } from '../stores/router.svelte';
  import { fmtTime } from '../api/parse';
  import { trackMenu } from '../actions';
  import { artistNames } from '../util/thumbs';

  let seeking = $state<number | null>(null);
  const t = $derived(player.current);
  const dur = $derived(player.duration || t?.durationSec || 0);
  const liked = $derived(t ? library.likeOf(t) === 'LIKE' : false);
  const volIcon = $derived(player.muted || player.volume === 0 ? 'mute' : player.volume < 0.5 ? 'volumeLow' : 'volume');

  function sleepMenu(e: MouseEvent) {
    const opts: MenuAction[] = [5, 15, 30, 45, 60, 90].map((m) => ({ label: `${m} minutes`, run: () => player.setSleep(m) }));
    opts.push({ label: 'End of track', run: () => player.setSleep('track') });
    if (player.sleepAt || player.sleepEndOfTrack) opts.unshift({ label: 'Turn off timer', run: () => player.setSleep(null) }, { label: '', divider: true });
    ui.openMenu(e, opts);
  }
</script>

<footer class="aero-transport">
  <div class="seek">
    <span class="tm">{fmtTime(seeking ?? player.time)}</span>
    <Slider value={seeking ?? player.time} max={dur} buffered={player.buffered} label="Seek" oninput={(v) => (seeking = v)} onchange={(v) => { seeking = null; player.seek(v); }} />
    <span class="tm">{fmtTime(dur)}</span>
  </div>
  <div class="row">
    <div class="now">
      {#if t}
        <button class="thumb" onclick={() => (ui.rightPanel = 'queue')} title="Show Now Playing list"><Img thumbs={t.thumbnails} size={44} /></button>
        <div class="txt">
          <div class="a" title={t.title}>{t.title}</div>
          <div class="b">{artistNames(t.artists)}{#if t.album} — {t.album.name}{/if}</div>
        </div>
      {:else}
        <div class="txt"><div class="b">Nothing playing</div></div>
      {/if}
    </div>

    <div class="cluster">
      <button class="glass sm" class:on={player.shuffle} aria-label="Shuffle" title={player.shuffle ? 'Turn shuffle off' : 'Turn shuffle on'} onclick={() => player.toggleShuffle()}><Icon name="shuffle" size={13} /></button>
      <button class="glass sm" class:on={player.repeat !== 'off'} aria-label="Repeat" title={player.repeat === 'off' ? 'Turn repeat on' : player.repeat === 'all' ? 'Repeat one' : 'Turn repeat off'} onclick={() => player.cycleRepeat()}><Icon name={player.repeat === 'one' ? 'repeatOne' : 'repeat'} size={13} /></button>
      <span class="divider"></span>
      <button class="glass sm" aria-label="Stop" title="Stop" onclick={() => { player.pause(); player.seek(0); }} disabled={!t}><span class="stop-sq"></span></button>
      <div class="capsule">
        <button class="cap-btn l" aria-label="Previous" title="Previous" onclick={() => player.previous()} disabled={!t}><Icon name="prev" size={13} /></button>
        <button class="orb" aria-label={player.playing ? 'Pause' : 'Play'} title={player.playing ? 'Pause' : 'Play'} onclick={() => player.toggle()} disabled={!t}>
          {#if player.loading && !player.playing}<span class="spinner"></span>{:else}<Icon name={player.playing ? 'pause' : 'play'} size={20} />{/if}
        </button>
        <button class="cap-btn r" aria-label="Next" title="Next" onclick={() => player.next()} disabled={!t}><Icon name="next" size={13} /></button>
      </div>
      <button class="glass sm" aria-label={player.muted ? 'Unmute' : 'Mute'} title={player.muted ? 'Unmute' : 'Mute'} onclick={() => player.toggleMute()}><Icon name={volIcon} size={13} /></button>
      <div class="vol"><Slider value={player.muted ? 0 : player.volume} max={1} label="Volume" oninput={(v) => player.setVolume(v)} onchange={(v) => player.setVolume(v)} /></div>
    </div>

    <div class="tools">
      {#if t && t.type !== 'episode'}
        <button class="tool" class:on={liked} title={liked ? 'Remove from Liked Music' : 'Like'} onclick={() => library.toggleLike(t)}><Icon name={liked ? 'heartFill' : 'heart'} size={14} /></button>
      {/if}
      {#if t}<button class="tool" title="More" onclick={(e) => ui.openMenu(e, trackMenu(t), t)}><Icon name="more" size={14} /></button>{/if}
      <button class="tool" class:on={player.sleepAt != null || player.sleepEndOfTrack} title="Sleep timer" onclick={sleepMenu}><Icon name="timer" size={14} /></button>
      <button class="tool" class:on={player.video} title="Video" onclick={() => player.setVideo(!player.video)}><Icon name="video" size={14} /></button>
      <button class="tool" class:on={ui.rightPanel === 'lyrics'} title="Lyrics" onclick={() => (ui.rightPanel = ui.rightPanel === 'lyrics' ? 'none' : 'lyrics')}><Icon name="mic" size={14} /></button>
      <button class="tool" class:on={ui.rightPanel !== 'none'} title="List pane" onclick={() => (ui.rightPanel = ui.rightPanel === 'none' ? 'queue' : 'none')}><Icon name="queue" size={14} /></button>
      <button class="tool" title="Lyrics page" onclick={() => go('/lyrics')}><Icon name="lyrics" size={14} /></button>
      <button class="tool" title="Mini player" onclick={() => (ui.miniPlayer = true)}><Icon name="miniPlayer" size={14} /></button>
      <button class="tool" title="Switch to Now Playing (full screen)" onclick={() => (ui.fullscreenPlayer = true)}><Icon name="fullscreen" size={14} /></button>
    </div>
  </div>
</footer>

<style>
  .aero-transport {
    color: #fff;
    border: 1px solid #000;
    border-radius: 0 0 6px 6px;
    background: linear-gradient(rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.04) 46%, rgba(0, 0, 0, 0) 50%, rgba(80, 160, 255, 0.12) 100%), linear-gradient(#2b3a4c, #0e1622 55%, #04070c);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), inset 0 0 0 1px rgba(255, 255, 255, 0.06), 0 4px 18px rgba(0, 10, 30, 0.55);
    padding: 4px 12px 8px;
  }
  .seek {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    color: #a9c3dd;
    font-variant-numeric: tabular-nums;
  }
  .tm {
    min-width: 38px;
    text-align: center;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(160px, 1fr) auto minmax(160px, 1fr);
    align-items: center;
    gap: 16px;
    margin-top: 2px;
  }
  .now {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .thumb {
    flex-shrink: 0;
  }
  .thumb :global(img),
  .thumb :global(.ph) {
    width: 44px;
    height: 44px;
    object-fit: cover;
    border: 1px solid rgba(255, 255, 255, 0.6);
    box-shadow: 0 0 0 1px #000, 0 0 10px rgba(110, 190, 255, 0.35);
  }
  .txt {
    min-width: 0;
  }
  .txt .a {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 0 8px rgba(120, 200, 255, 0.9);
  }
  .txt .b {
    font-size: 11.5px;
    color: #a9c3dd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cluster {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .divider {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: linear-gradient(transparent, rgba(255, 255, 255, 0.3), transparent);
  }
  .glass {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #d7e8f8;
    border: 1px solid rgba(0, 0, 0, 0.9);
    background: radial-gradient(circle at 50% 18%, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 55%), linear-gradient(#3d4f63, #121b26);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 1px 0 rgba(255, 255, 255, 0.1);
  }
  .glass:hover:not(:disabled) {
    color: #fff;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2), 0 0 8px rgba(110, 200, 255, 0.9);
  }
  .glass.on {
    color: #fff;
    background: radial-gradient(circle at 50% 18%, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0) 55%), radial-gradient(circle at 50% 120%, var(--accent-hover), var(--accent) 45%, var(--accent-deep));
    box-shadow: 0 0 9px rgba(var(--accent-rgb), 0.9);
  }
  .stop-sq {
    width: 9px;
    height: 9px;
    background: currentColor;
    border-radius: 1px;
  }
  .capsule {
    position: relative;
    display: flex;
    align-items: center;
    height: 30px;
    margin: 0 6px;
    border-radius: 15px;
    border: 1px solid #000;
    background: radial-gradient(ellipse at 50% 0%, rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0) 60%), linear-gradient(#3d4f63, #0f1720);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  }
  .cap-btn {
    width: 40px;
    height: 28px;
    display: grid;
    place-items: center;
    color: #d7e8f8;
  }
  .cap-btn.l {
    padding-right: 10px;
  }
  .cap-btn.r {
    padding-left: 10px;
  }
  .cap-btn:hover:not(:disabled) {
    color: #fff;
    filter: drop-shadow(0 0 5px rgba(120, 210, 255, 1));
  }
  /* the WMP orb */
  .orb {
    width: 52px;
    height: 52px;
    margin: -12px -6px;
    position: relative;
    z-index: 1;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    border: 1px solid #000;
    background: radial-gradient(circle at 50% 18%, rgba(255, 255, 255, 0.95) 0, rgba(255, 255, 255, 0.35) 26%, rgba(255, 255, 255, 0) 48%), radial-gradient(circle at 50% 115%, var(--accent-hover) 0, var(--accent) 40%, var(--accent-deep) 100%);
    box-shadow: inset 0 -4px 10px rgba(255, 255, 255, 0.35), inset 0 1px 1px #fff, 0 0 0 3px rgba(0, 0, 0, 0.55), 0 0 18px rgba(var(--accent-rgb), 0.75);
    transition: box-shadow 0.2s;
  }
  .orb :global(.icon) {
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8));
  }
  .orb:hover:not(:disabled) {
    box-shadow: inset 0 -4px 10px rgba(255, 255, 255, 0.5), inset 0 1px 1px #fff, 0 0 0 3px rgba(0, 0, 0, 0.55), 0 0 28px rgba(var(--accent-rgb), 1);
  }
  .orb:disabled {
    opacity: 1;
    filter: saturate(0.4) brightness(0.8);
  }
  .vol {
    width: 90px;
  }
  .tools {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 2px;
  }
  .tool {
    width: 26px;
    height: 24px;
    display: grid;
    place-items: center;
    border-radius: 3px;
    color: #b9d0e6;
  }
  .tool:hover {
    color: #fff;
    background: linear-gradient(rgba(255, 255, 255, 0.25), rgba(255, 255, 255, 0.05));
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  }
  .tool.on {
    color: var(--accent-hover);
    filter: drop-shadow(0 0 4px rgba(var(--accent-rgb), 0.9));
  }
  /* trackbars in the dark strip */
  .aero-transport :global(.slider .track-bg) {
    height: 5px;
    background: linear-gradient(#000, #2d3b4b);
    box-shadow: inset 0 1px 2px #000, 0 1px 0 rgba(255, 255, 255, 0.15);
  }
</style>
