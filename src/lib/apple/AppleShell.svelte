<script lang="ts">
  // Apple Music (macOS Music / Apple Music for Windows) style shell.
  import AppleSidebar from './AppleSidebar.svelte';
  import AppleToolbar from './AppleToolbar.svelte';
  import ApplePanel from './ApplePanel.svelte';
  import MainView from '../components/MainView.svelte';
  import { ui } from '../stores/ui.svelte';
  import { router } from '../stores/router.svelte';
  import Icon from '../components/Icon.svelte';
  const panel = $derived(ui.rightPanel === 'queue' || ui.rightPanel === 'lyrics');
</script>

<div class="am-window" oncontextmenu={(e) => e.preventDefault()} role="application">
  <AppleSidebar />
  <div class="am-main">
    <AppleToolbar />
    <div class="am-body">
      <div class="am-content">
        <div class="am-nav">
          <button aria-label="Back" title="Back" disabled={!router.canBack} onclick={() => router.back()}><Icon name="chevronLeft" size={13} /></button>
          <button aria-label="Forward" title="Forward" disabled={!router.canForward} onclick={() => router.forward()}><Icon name="chevronRight" size={13} /></button>
        </div>
        <MainView />
      </div>
      {#if panel}<ApplePanel />{/if}
    </div>
  </div>
</div>

<style>
  .am-window {
    height: 100vh;
    display: grid;
    grid-template-columns: 250px minmax(0, 1fr);
    background: var(--am-bg);
    color: var(--am-text);
    overflow: clip;
  }
  .am-main {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }
  .am-body {
    display: flex;
    min-height: 0;
    position: relative;
  }
  .am-content {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .am-content {
    position: relative;
  }
  .am-nav {
    position: absolute;
    top: 12px;
    left: 16px;
    z-index: 6;
    display: flex;
    gap: 4px;
  }
  .am-nav button {
    width: 26px;
    height: 24px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    color: var(--am-text-2);
    background: var(--am-fill);
    backdrop-filter: blur(20px);
  }
  .am-nav button:hover:not(:disabled) {
    color: var(--am-text);
  }
  .am-nav button:disabled {
    opacity: 0.35;
  }
  .am-content :global(.main-view) {
    flex: 1;
    border-radius: 0;
    background: var(--am-bg);
  }
</style>
