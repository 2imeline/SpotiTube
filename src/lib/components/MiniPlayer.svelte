<script lang="ts">
  import Icon from './Icon.svelte';
  import Slider from './Slider.svelte';
  import { player } from '../player/player.svelte';
  import { library } from '../stores/library.svelte';
  import { ui } from '../stores/ui.svelte';
  import { artistNames, bestThumb } from '../util/thumbs';
  import { isTauri } from '../api/transport';
  import { onMount } from 'svelte';

  const t = $derived(player.current);
  const liked = $derived(t ? library.likeOf(t) === 'LIKE' : false);

  onMount(() => {
    if (!isTauri) return;
    let prev: { w: number; h: number } | null = null;
    let w: any;
    (async () => {
      const m = await import('@tauri-apps/api/window');
      const d = await import('@tauri-apps/api/dpi');
      w = m.getCurrentWindow();
      const size = await w.innerSize();
      const f = await w.scaleFactor();
      prev = { w: size.width / f, h: size.height / f };
      if (await w.isMaximized()) await w.unmaximize();
      await w.setMinSize(new d.LogicalSize(260, 260));
      await w.setSize(new d.LogicalSize(320, 320));
      await w.setAlwaysOnTop(true);
    })();
    return async () => {
      if (!w) return;
      const d = await import('@tauri-apps/api/dpi');
      await w.setAlwaysOnTop(false);
      if (prev) await w.setSize(new d.LogicalSize(Math.max(820, prev.w), Math.max(560, prev.h)));
      await w.setMinSize(new d.LogicalSize(820, 560));
    };
  });
</script>

<div class="mini-player">
  <div class="bg" style="background-image:url('{bestThumb(t?.thumbnails, 400)}')"></div>
  <div class="drag" data-tauri-drag-region></div>
  <div style="position:absolute;top:8px;right:8px;z-index:2">
    <button class="round-btn" aria-label="Exit mini player" title="Exit mini player" onclick={() => (ui.miniPlayer = false)}><Icon name="expand" size={16} /></button>
  </div>
  <div class="ui">
    <div style="font-weight:700;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{t?.title ?? 'Nothing playing'}</div>
    <div style="color:rgba(255,255,255,.75);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:8px">{artistNames(t?.artists)}</div>
    <Slider value={player.time} max={player.duration || 1} label="Seek" onchange={(v) => player.seek(v)} />
    <div class="np-controls" style="justify-content:space-between;margin-top:8px">
      <button class="ctrl" class:on={liked} aria-label="Like" onclick={() => t && library.toggleLike(t)}><Icon name={liked ? 'heartFill' : 'heart'} size={16} /></button>
      <button class="ctrl" aria-label="Previous" onclick={() => player.previous()}><Icon name="prev" size={18} /></button>
      <button class="ctrl-play" style="width:40px;height:40px" aria-label="Play/Pause" onclick={() => player.toggle()}><Icon name={player.playing ? 'pause' : 'play'} size={18} /></button>
      <button class="ctrl" aria-label="Next" onclick={() => player.next()}><Icon name="next" size={18} /></button>
      <button class="ctrl" class:on={player.shuffle} aria-label="Shuffle" onclick={() => player.toggleShuffle()}><Icon name="shuffle" size={16} /></button>
    </div>
  </div>
</div>
