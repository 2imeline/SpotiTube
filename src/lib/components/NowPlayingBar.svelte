<script lang="ts">
  import Icon from './Icon.svelte';
  import Img from './Img.svelte';
  import Slider from './Slider.svelte';
  import { player } from '../player/player.svelte';
  import { library } from '../stores/library.svelte';
  import { ui, type MenuAction } from '../stores/ui.svelte';
  import { go } from '../stores/router.svelte';
  import { fmtTime } from '../api/parse';
  import { trackMenu } from '../actions';

  let seeking = $state<number | null>(null);
  const t = $derived(player.current);
  const liked = $derived(t ? library.likeOf(t) === 'LIKE' : false);
  const dur = $derived(player.duration || t?.durationSec || 0);
  const volIcon = $derived(player.muted || player.volume === 0 ? 'mute' : player.volume < 0.5 ? 'volumeLow' : 'volume');

  function sleepMenu(e: MouseEvent) {
    const opts: MenuAction[] = [5, 15, 30, 45, 60, 90].map((m) => ({ label: `${m} minutes`, run: () => player.setSleep(m) }));
    opts.push({ label: 'End of track', run: () => player.setSleep('track') });
    if (player.sleepAt || player.sleepEndOfTrack) opts.unshift({ label: 'Turn off timer', run: () => player.setSleep(null) }, { label: '', divider: true });
    ui.openMenu(e, opts);
  }
  function rateMenu(e: MouseEvent) {
    ui.openMenu(e, [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => ({ label: (player.rate === r ? '✓ ' : '') + `${r}x`, run: () => player.setRate(r) })));
  }
</script>

<footer class="np-bar">
  <div class="np-left">
    {#if t}
      <button onclick={() => (ui.rightPanel = 'nowplaying')} aria-label="Now playing view" style="flex-shrink:0">
        <Img thumbs={t.thumbnails} size={56} class="art" />
      </button>
      <div class="info">
        <div class="np-title" role="link" tabindex="0" onclick={() => (t.album?.id ? go(`/album/${t.album.id}`) : (ui.rightPanel = 'nowplaying'))} onkeydown={() => {}} title={t.title}>{t.title}</div>
        <div class="np-artist">
          {#if t.explicit}<span class="ebadge" style="margin-right:4px">E</span>{/if}
          {#each t.artists as a, i}{#if i}{', '}{/if}{#if a.id}<a href="#/" onclick={(e) => { e.preventDefault(); go(t.type === 'episode' && a.id?.startsWith('MPSP') ? `/podcast/${a.id}` : `/artist/${a.id}`); }}>{a.name}</a>{:else}{a.name}{/if}{/each}
        </div>
      </div>
      {#if t.type !== 'episode'}
        <button class="ctrl" class:on={liked} style="margin-left:4px" aria-label={liked ? 'Remove from Liked Music' : 'Save to Liked Music'} title={liked ? 'Remove from Liked Music' : 'Save to Liked Music'} onclick={() => library.toggleLike(t)}>
          <Icon name={liked ? 'checkCircle' : 'addCircle'} size={16} />
        </button>
      {/if}
      <button class="ctrl" aria-label="More" title="More" onclick={(e) => ui.openMenu(e, trackMenu(t), t)}><Icon name="more" size={16} /></button>
    {/if}
  </div>

  <div class="np-center">
    <div class="np-controls">
      <button class="ctrl" class:on={player.shuffle} aria-label="Shuffle" title={player.shuffle ? 'Disable shuffle' : 'Enable shuffle'} onclick={() => player.toggleShuffle()}><Icon name="shuffle" size={16} /></button>
      <button class="ctrl" aria-label="Previous" title="Previous" onclick={() => player.previous()} disabled={!t}><Icon name="prev" size={16} /></button>
      <button class="ctrl-play" aria-label={player.playing ? 'Pause' : 'Play'} title={player.playing ? 'Pause' : 'Play'} onclick={() => player.toggle()} disabled={!t}>
        {#if player.loading && !player.playing}<span class="spinner"></span>{:else}<Icon name={player.playing ? 'pause' : 'play'} size={16} />{/if}
      </button>
      <button class="ctrl" aria-label="Next" title="Next" onclick={() => player.next()} disabled={!t}><Icon name="next" size={16} /></button>
      <button class="ctrl" class:on={player.repeat !== 'off'} aria-label="Repeat" title={player.repeat === 'off' ? 'Enable repeat' : player.repeat === 'all' ? 'Enable repeat one' : 'Disable repeat'} onclick={() => player.cycleRepeat()}>
        <Icon name={player.repeat === 'one' ? 'repeatOne' : 'repeat'} size={16} />
      </button>
    </div>
    <div class="np-progress">
      <span class="time">{fmtTime(seeking ?? player.time)}</span>
      <Slider value={seeking ?? player.time} max={dur} buffered={player.buffered} label="Seek" oninput={(v) => (seeking = v)} onchange={(v) => { seeking = null; player.seek(v); }} />
      <span class="time">{fmtTime(dur)}</span>
    </div>
  </div>

  <div class="np-right">
    {#if t?.type === 'episode'}
      <button class="ctrl" style="width:auto;padding:0 6px;font-size:12px;font-weight:700" title="Playback speed" onclick={rateMenu}>{player.rate}x</button>
    {/if}
    <button class="ctrl" class:on={player.sleepAt != null || player.sleepEndOfTrack} aria-label="Sleep timer" title="Sleep timer" onclick={sleepMenu}><Icon name="timer" size={16} /></button>
    <button class="ctrl" class:on={ui.rightPanel === 'nowplaying'} aria-label="Now playing view" title="Now playing view" onclick={() => ui.togglePanel('nowplaying')}><Icon name="nowPlaying" size={16} /></button>
    <button class="ctrl" class:on={ui.rightPanel === 'lyrics'} aria-label="Lyrics" title="Lyrics" onclick={() => ui.togglePanel('lyrics')}><Icon name="mic" size={16} /></button>
    <button class="ctrl" class:on={ui.rightPanel === 'queue'} aria-label="Queue" title="Queue" onclick={() => ui.togglePanel('queue')}><Icon name="queue" size={16} /></button>
    <button class="ctrl" class:on={player.video} aria-label="Video mode" title={player.video ? 'Switch to audio' : 'Switch to video'} onclick={() => player.setVideo(!player.video)}><Icon name="video" size={16} /></button>
    <button class="ctrl" aria-label={player.muted ? 'Unmute' : 'Mute'} title={player.muted ? 'Unmute' : 'Mute'} onclick={() => player.toggleMute()}><Icon name={volIcon} size={16} /></button>
    <div class="vol"><Slider value={player.muted ? 0 : player.volume} max={1} label="Volume" oninput={(v) => player.setVolume(v)} onchange={(v) => player.setVolume(v)} /></div>
    <button class="ctrl" aria-label="Mini player" title="Mini player" onclick={() => (ui.miniPlayer = true)}><Icon name="miniPlayer" size={16} /></button>
    <button class="ctrl" aria-label="Full screen" title="Full screen" onclick={() => (ui.fullscreenPlayer = true)}><Icon name="fullscreen" size={16} /></button>
  </div>
</footer>
