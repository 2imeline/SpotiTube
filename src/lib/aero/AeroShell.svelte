<script lang="ts">
  // Frutiger Aero / Windows 7 shell, modelled on Windows Media Player 12:
  // glass caption + command bar, navigation tree, content, list pane, transport.
  import AeroCaption from './AeroCaption.svelte';
  import AeroNav from './AeroNav.svelte';
  import AeroListPane from './AeroListPane.svelte';
  import AeroTransport from './AeroTransport.svelte';
  import MainView from '../components/MainView.svelte';
  import { ui } from '../stores/ui.svelte';
</script>

<div class="aero-window" oncontextmenu={(e) => e.preventDefault()} role="application">
  <AeroCaption />
  <div class="aero-body" class:no-list={ui.rightPanel === 'none'} class:no-nav={ui.sidebarCollapsed}>
    <AeroNav />
    <div class="aero-content"><MainView /></div>
    {#if ui.rightPanel !== 'none'}<AeroListPane />{/if}
  </div>
  <AeroTransport />
</div>

<style>
  .aero-window {
    height: 100vh;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    padding: 0 8px 8px;
    gap: 0;
  }
  .aero-body {
    display: grid;
    grid-template-columns: 232px minmax(0, 1fr) 300px;
    min-height: 0;
    border: 1px solid rgba(0, 20, 50, 0.55);
    border-bottom: 0;
    border-radius: 6px 6px 0 0;
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.45);
    background: #fff;
  }
  .aero-body.no-list {
    grid-template-columns: 232px minmax(0, 1fr);
  }
  .aero-body.no-nav {
    grid-template-columns: 0 minmax(0, 1fr) 300px;
  }
  .aero-body.no-nav.no-list {
    grid-template-columns: 0 minmax(0, 1fr);
  }
  .aero-content {
    min-width: 0;
    min-height: 0;
    display: flex;
    border-left: 1px solid #c5d5e6;
    border-right: 1px solid #c5d5e6;
  }
  .aero-content :global(.main-view) {
    flex: 1;
    border-radius: 0 !important;
    border: 0 !important;
    box-shadow: none !important;
    background: linear-gradient(#ffffff, #f6fafe 600px) !important;
    backdrop-filter: none !important;
  }
  @media (max-width: 1100px) {
    .aero-body,
    .aero-body.no-list {
      grid-template-columns: 200px minmax(0, 1fr);
    }
    .aero-body :global(.aero-list) {
      display: none;
    }
  }
</style>
