import './styles/app.css';
import './styles/aero.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { applySettings, saveSettings } from './lib/stores/settings.svelte';

applySettings();
saveSettings();

const app = mount(App, { target: document.getElementById('app')! });

if (import.meta.env.DEV) {
  // debugging hooks for development builds only
  Promise.all([import('./lib/stores/router.svelte'), import('./lib/stores/settings.svelte'), import('./lib/player/player.svelte'), import('./lib/stores/ui.svelte')]).then(
    ([r, s, p, u]) => ((window as any).__st = { go: r.go, settings: s.settings, saveSettings: s.saveSettings, player: p.player, ui: u.ui }),
  );
}
export default app;
