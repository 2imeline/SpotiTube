<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Img from '../components/Img.svelte';
  import WindowControls from '../components/WindowControls.svelte';
  import { player } from '../player/player.svelte';
  import { library } from '../stores/library.svelte';
  import { ui } from '../stores/ui.svelte';
  import { go, router } from '../stores/router.svelte';
  import { updater } from '../stores/updater.svelte';
  import { fmtTime } from '../api/parse';
  import { trackMenu } from '../actions';
  import { artistNames } from '../util/thumbs';

  const t = $derived(player.current);
  const dur = $derived(player.duration || t?.durationSec || 0);
  const liked = $derived(t ? library.likeOf(t) === 'LIKE' : false);
  let seek = $state<number | null>(null);
  let bar: HTMLDivElement | undefined = $state();
  let volBar: HTMLDivElement | undefined = $state();
  const pos = $derived(seek ?? player.time);

  function scrub(e: PointerEvent) {
    if (!bar || !dur) return;
    const el = bar;
    el.setPointerCapture(e.pointerId);
    const at = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * dur;
    };
    seek = at(e);
    const mv = (ev: PointerEvent) => (seek = at(ev));
    const up = (ev: PointerEvent) => {
      player.seek(at(ev));
      seek = null;
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  }
  function vol(e: PointerEvent) {
    if (!volBar) return;
    const el = volBar;
    el.setPointerCapture(e.pointerId);
    const set = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      player.setVolume(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)));
    };
    set(e);
    const up = () => {
      el.removeEventListener('pointermove', set);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', set);
    el.addEventListener('pointerup', up);
  }
  const v = $derived(player.muted ? 0 : player.volume);
</script>

<header class="am-toolbar" data-tauri-drag-region>
  <div class="transport">
    <button class="tb sm" class:on={player.shuffle} aria-label="Shuffle" title="Shuffle" onclick={() => player.toggleShuffle()}><Icon name="shuffle" size={14} /></button>
    <button class="tb" aria-label="Previous" title="Previous" onclick={() => player.previous()} disabled={!t}><Icon name="rew" size={20} /></button>
    <button class="tb play" aria-label={player.playing ? 'Pause' : 'Play'} title={player.playing ? 'Pause' : 'Play'} onclick={() => player.toggle()} disabled={!t}>
      <Icon name={player.playing ? 'pauseSolid' : 'playSolid'} size={24} />
    </button>
    <button class="tb" aria-label="Next" title="Next" onclick={() => player.next()} disabled={!t}><Icon name="fwd" size={20} /></button>
    <button class="tb sm" class:on={player.repeat !== 'off'} aria-label="Repeat" title="Repeat" onclick={() => player.cycleRepeat()}><Icon name={player.repeat === 'one' ? 'repeatOne' : 'repeat'} size={14} /></button>
  </div>

  <div class="lcd" class:empty={!t}>
    {#if t}
      <button class="lcd-art" onclick={() => (ui.fullscreenPlayer = true)} title="Full screen"><Img thumbs={t.thumbnails} size={48} /></button>
      <div class="lcd-mid">
        <div class="lcd-text">
          <div class="l1">
            {#if t.explicit}<span class="e">E</span>{/if}
            <span class="tt" role="link" tabindex="0" onclick={() => t.album?.id && go(`/album/${t.album.id}`)} onkeydown={() => {}}>{t.title}</span>
          </div>
          <div class="l2">
            {#each t.artists as a, i}{#if i}{', '}{/if}{#if a.id}<a href="#/" onclick={(e) => { e.preventDefault(); go(`/artist/${a.id}`); }}>{a.name}</a>{:else}{a.name}{/if}{/each}{#if t.album}{' — '}{#if t.album.id}<a href="#/" onclick={(e) => { e.preventDefault(); go(`/album/${t.album!.id}`); }}>{t.album.name}</a>{:else}{t.album.name}{/if}{/if}
          </div>
        </div>
        <div class="times"><span>{fmtTime(pos)}</span><span>-{fmtTime(Math.max(0, dur - pos))}</span></div>
        <div class="prog" bind:this={bar} onpointerdown={scrub} role="slider" tabindex="0" aria-label="Seek" aria-valuenow={Math.round(pos)} aria-valuemax={Math.round(dur)}>
          <div class="fill" style="width:{dur ? (pos / dur) * 100 : 0}%"></div>
        </div>
      </div>
      <div class="lcd-actions">
        {#if t.type !== 'episode'}
          <button class="mini" class:on={liked} title={liked ? 'Unfavorite' : 'Favorite'} onclick={() => library.toggleLike(t)}><Icon name={liked ? 'star' : 'star'} size={12} /></button>
        {/if}
        <button class="mini" title="More" onclick={(e) => ui.openMenu(e, trackMenu(t), t)}><Icon name="more" size={14} /></button>
      </div>
    {:else}
      <div class="apple-mark">
        <svg width="22" height="22" viewBox="0 0 512 512"><circle cx="256" cy="256" r="240" fill="var(--accent)" /><path d="M210 168 L350 256 L210 344 Z" fill="#fff" /></svg>
      </div>
    {/if}
  </div>

  <div class="right">
    <div class="volume">
      <Icon name="mute" size={12} />
      <div class="vbar" bind:this={volBar} onpointerdown={vol} role="slider" tabindex="0" aria-label="Volume" aria-valuenow={Math.round(v * 100)}>
        <div class="vfill" style="width:{v * 100}%"></div>
        <div class="vknob" style="left:{v * 100}%"></div>
      </div>
      <Icon name="volume" size={14} />
    </div>
    <button class="tb sm" class:on={ui.rightPanel === 'lyrics'} aria-label="Lyrics" title="Lyrics" onclick={() => ui.togglePanel('lyrics')}><Icon name="quote" size={16} /></button>
    <button class="tb sm" class:on={ui.rightPanel === 'queue'} aria-label="Playing Next" title="Playing Next" onclick={() => ui.togglePanel('queue')}><Icon name="upnext" size={16} /></button>
    {#if updater.available}
      <button class="upd" onclick={() => updater.install()} disabled={updater.installing}>{updater.installing ? `Updating ${Math.round(updater.progress * 100)}%` : 'Update'}</button>
    {/if}
    <WindowControls />
  </div>
</header>

<style>
  .am-toolbar {
    height: 56px;
    display: grid;
    grid-template-columns: 1fr minmax(320px, 620px) 1fr;
    align-items: center;
    gap: 16px;
    padding: 0 0 0 20px;
    border-bottom: 1px solid var(--am-sep);
    background: var(--am-bar);
    backdrop-filter: blur(30px) saturate(1.8);
    position: relative;
    z-index: 3;
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 14px;
    justify-self: end;
  }
  .tb {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--am-text-2);
  }
  .tb:hover:not(:disabled) {
    color: var(--am-text);
  }
  .tb.play {
    color: var(--am-text);
  }
  .tb.sm {
    width: 26px;
    height: 26px;
  }
  .tb.on {
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.12);
  }
  .tb:disabled {
    opacity: 0.35;
  }
  .lcd {
    height: 44px;
    display: flex;
    align-items: stretch;
    border-radius: 6px;
    border: 1px solid var(--am-sep);
    background: var(--am-lcd);
    overflow: hidden;
    min-width: 0;
  }
  .lcd.empty {
    justify-content: center;
    align-items: center;
  }
  .apple-mark {
    opacity: 0.9;
  }
  .lcd-art {
    flex-shrink: 0;
    width: 44px;
  }
  .lcd-art :global(img),
  .lcd-art :global(.ph) {
    width: 44px;
    height: 44px;
    object-fit: cover;
  }
  .lcd-mid {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 12px;
  }
  .lcd-text {
    text-align: center;
    line-height: 1.25;
    margin-top: -3px;
  }
  .l1 {
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--am-text);
  }
  .l1 .tt:hover,
  .l2 a:hover {
    text-decoration: underline;
    cursor: pointer;
  }
  .e {
    display: inline-grid;
    place-items: center;
    width: 12px;
    height: 12px;
    font-size: 8px;
    font-weight: 700;
    border-radius: 2px;
    background: var(--am-text-3);
    color: var(--am-bg);
    margin-right: 4px;
    vertical-align: 1px;
  }
  .l2 {
    font-size: 12px;
    color: var(--am-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .times {
    position: absolute;
    left: 6px;
    right: 6px;
    bottom: 3px;
    display: flex;
    justify-content: space-between;
    font-size: 9.5px;
    color: var(--am-text-2);
    font-variant-numeric: tabular-nums;
    opacity: 0;
    transition: opacity 0.15s;
    pointer-events: none;
  }
  .lcd:hover .times {
    opacity: 1;
  }
  .prog {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 9px;
    display: flex;
    align-items: flex-end;
    cursor: pointer;
  }
  .prog::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: var(--am-fill);
  }
  .fill {
    position: relative;
    height: 3px;
    background: var(--am-text-2);
  }
  .lcd:hover .prog::before,
  .lcd:hover .fill {
    height: 4px;
  }
  .lcd-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: 6px;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .lcd:hover .lcd-actions {
    opacity: 1;
  }
  .mini {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--am-text-2);
  }
  .mini:hover {
    background: var(--am-hover);
  }
  .mini.on {
    color: var(--accent);
  }
  .right {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-self: stretch;
    justify-content: flex-end;
    align-self: stretch;
  }
  .right > :global(.win-controls) {
    align-self: flex-start;
  }
  .volume {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--am-text-2);
  }
  .vbar {
    position: relative;
    width: 80px;
    height: 16px;
    display: flex;
    align-items: center;
    cursor: pointer;
  }
  .vbar::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 4px;
    border-radius: 2px;
    background: var(--am-fill);
  }
  .vfill {
    position: relative;
    height: 4px;
    border-radius: 2px;
    background: var(--am-text-2);
  }
  .vknob {
    position: absolute;
    width: 14px;
    height: 14px;
    margin-left: -7px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.25), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .upd {
    height: 24px;
    padding: 0 10px;
    border-radius: 6px;
    background: var(--accent);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
  }
</style>
