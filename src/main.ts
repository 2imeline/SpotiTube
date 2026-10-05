import './styles/app.css';
import './styles/aero.css';
import './styles/apple.css';
import './styles/mobile.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { applySettings, saveSettings } from './lib/stores/settings.svelte';
import { installErrorLogging } from './lib/util/log';

installErrorLogging();

applySettings();
saveSettings();
// Apple theme 'Automatic' appearance follows Windows light/dark mode live
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applySettings());

const app = mount(App, { target: document.getElementById('app')! });

if (import.meta.env.DEV) {
  // debugging hooks for development builds only
  Promise.all([import('./lib/stores/router.svelte'), import('./lib/stores/settings.svelte'), import('./lib/player/player.svelte'), import('./lib/stores/ui.svelte')]).then(
    ([r, s, p, u]) => ((window as any).__st = { go: r.go, settings: s.settings, saveSettings: s.saveSettings, player: p.player, ui: u.ui }),
  );
}
export default app;
