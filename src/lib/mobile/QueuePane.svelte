<script lang="ts">
  import { fly } from 'svelte/transition';
  import Icon from '../components/Icon.svelte';
  import Img from '../components/Img.svelte';
  import { player } from '../player/player.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import { trackMenu } from '../actions';
  import { artistNames } from '../util/thumbs';
  import { haptic } from '../native/ios.svelte';

  let { color = null }: { color?: string | null } = $props();
  const ROW = 64;
  const upNext = $derived(player.upNext.slice(0, 300));

  // drag a row by its handle to reorder
  let drag = $state<{ from: number; dy: number; to: number } | null>(null);
  let startY = 0;
  function down(e: PointerEvent, j: number) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startY = e.clientY;
    drag = { from: j, dy: 0, to: j };
    haptic('select');
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const dy = e.clientY - startY;
    const to = Math.max(0, Math.min(upNext.length - 1, drag.from + Math.round(dy / ROW)));
    if (to !== drag.to) haptic('select');
    drag = { ...drag, dy, to };
  }
  function up() {
    if (!drag) return;
    const { from, to } = drag;
    drag = null;
    if (from !== to) player.move(player.index + 1 + from, player.index + 1 + to);
  }
  function shiftFor(j: number) {
    if (!drag) return 0;
    if (j === drag.from) return drag.dy;
    if (drag.from < drag.to && j > drag.from && j <= drag.to) return -ROW;
    if (drag.from > drag.to && j < drag.from && j >= drag.to) return ROW;
    return 0;
  }
</script>

<div class="m-pane m-queue {settings.theme}" style="--np-color:{color ?? '#535353'}" transition:fly={{ y: 700, duration: 280 }}>
  <header class="m-pane-head">
    <button class="icon-btn" aria-label="Close queue" onclick={() => (ui.npPane = 'none')}><Icon name="chevronDown" size={26} /></button>
    <div class="ttl">{settings.theme === 'apple' ? 'Playing Next' : player.source?.title ?? 'Queue'}</div>
    <span style="width:40px"></span>
  </header>
  {#if settings.theme === 'apple'}
    <div class="m-q-toggles">
      <button class:on={player.shuffle} onclick={() => player.toggleShuffle()}><Icon name="shuffle" size={18} /></button>
      <button class:on={player.repeat !== 'off'} onclick={() => player.cycleRepeat()}><Icon name={player.repeat === 'one' ? 'repeatOne' : 'repeat'} size={18} /></button>
    </div>
  {/if}
  <div class="m-pane-body">
    {#if player.current}
      <div class="m-q-sec">Now playing</div>
      <div class="m-q-row current">
        <Img thumbs={player.current.thumbnails} size={96} />
        <div class="m"><div class="a">{player.current.title}</div><div class="b">{artistNames(player.current.artists)}</div></div>
        <button class="icon-btn" aria-label="More" onclick={(e) => ui.openMenu(e, trackMenu(player.current!), player.current)}><Icon name="more" size={20} /></button>
      </div>
    {/if}
    {#if upNext.length}
      <div class="m-q-sec row">
        <span>Next from: <b>{player.source?.title ?? 'Queue'}</b></span>
        <button class="m-link" onclick={() => player.clearUpcoming()}>Clear</button>
      </div>
      <div class="m-q-list" style="height:{upNext.length * ROW}px">
        {#each upNext as tr, j (tr.qid)}
          <div class="m-q-row" class:dragging={drag?.from === j} style="top:{j * ROW}px;transform:translateY({shiftFor(j)}px)" role="button" tabindex="0" onclick={() => player.jump(player.index + 1 + j)} onkeydown={() => {}}>
            <Img thumbs={tr.thumbnails} size={96} />
            <div class="m"><div class="a">{tr.title}</div><div class="b">{#if tr.explicit}<span class="ebadge">E</span> {/if}{artistNames(tr.artists)}</div></div>
            <button class="icon-btn" aria-label="More" onclick={(e) => { e.stopPropagation(); ui.openMenu(e, trackMenu(tr, { queueIndex: player.index + 1 + j }), tr); }}><Icon name="more" size={18} /></button>
            <span class="handle" role="button" tabindex="-1" aria-label="Reorder" onpointerdown={(e) => down(e, j)} onpointermove={move} onpointerup={up} onpointercancel={up} onclick={(e) => e.stopPropagation()} onkeydown={() => {}}><Icon name="drag" size={22} /></span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="m-q-empty">Nothing up next. {#if settings.autoplay}Autoplay will continue with similar songs.{/if}</div>
    {/if}
  </div>
  {#if settings.theme !== 'apple'}
    <footer class="m-q-foot">
      <button class:on={player.shuffle} onclick={() => player.toggleShuffle()}><Icon name="shuffle" size={22} /><span>Shuffle</span></button>
      <button class:on={player.repeat !== 'off'} onclick={() => player.cycleRepeat()}><Icon name={player.repeat === 'one' ? 'repeatOne' : 'repeat'} size={22} /><span>Repeat</span></button>
      <button class:on={!!player.sleepAt || player.sleepEndOfTrack} onclick={(e) => ui.openMenu(e, [...[15, 30, 45, 60].map((m) => ({ label: `${m} minutes`, run: () => player.setSleep(m) })), { label: 'End of track', run: () => player.setSleep('track') }, { label: 'Off', run: () => player.setSleep(null) }])}><Icon name="timer" size={22} /><span>Timer</span></button>
    </footer>
  {/if}
</div>
