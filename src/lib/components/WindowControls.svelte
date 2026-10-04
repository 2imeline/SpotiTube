<script lang="ts">
  import Icon from './Icon.svelte';
  import { isTauri } from '../api/transport';
  import { player } from '../player/player.svelte';

  let maximized = $state(false);
  const win = isTauri ? import('@tauri-apps/api/window').then((m) => m.getCurrentWindow()) : null;
  win?.then(async (w) => {
    maximized = await w.isMaximized();
    w.onResized(async () => (maximized = await w.isMaximized()));
  });
</script>

{#if isTauri}
  <div class="win-controls">
    <button aria-label="Minimize" onclick={async () => (await win)?.minimize()}><Icon name="winMin" size={16} /></button>
    <button aria-label="Maximize" onclick={async () => (await win)?.toggleMaximize()}><Icon name={maximized ? 'winRestore' : 'winMax'} size={16} /></button>
    <button class="close" aria-label="Close" onclick={async () => { player.save(); (await win)?.close(); }}><Icon name="winClose" size={16} /></button>
  </div>
{/if}
