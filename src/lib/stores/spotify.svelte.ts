// Linked Spotify account state.
import { listen } from '@tauri-apps/api/event';
import { call, isTauri } from '../api/transport';
import { getMe, spStatus, type SpUser } from '../api/spotify';
import { settings, saveSettings } from './settings.svelte';
import { ui } from './ui.svelte';

class SpotifyStore {
  /** official OAuth link */
  linked = $state(false);
  /** experimental web-player session (friend activity) */
  web = $derived(settings.spotifyFriends && settings.spotifyWeb);
  me = $state<SpUser | null>(null);
  /** bumps when the account changes so pages reload */
  version = $state(0);
  connecting = $state(false);

  get available() {
    return this.linked || this.web;
  }

  async init() {
    if (!isTauri) return;
    await listen<string | null>('spotify-changed', (e) => {
      this.connecting = false;
      if (e.payload) ui.toast(e.payload, 'error', 6000);
      this.refresh(true);
    });
    // sent after an interactive sign-in (true) or sign-out (false)
    await listen<boolean>('spotify-web-changed', (e) => {
      const was = settings.spotifyWeb;
      settings.spotifyWeb = e.payload;
      saveSettings();
      if (e.payload) ui.toast('Signed in to Spotify');
      if (e.payload || was) this.refresh(true);
    });
    await this.refresh();
  }

  async refresh(changed = false) {
    try {
      const s = await spStatus();
      this.linked = s.linked;
    } catch {
      this.linked = false;
    }
    if (changed) {
      this.me = null;
      this.version++;
    }
  }

  /** your Spotify profile (loaded on demand: the web session may need a hidden window) */
  async loadMe(): Promise<SpUser | null> {
    if (this.me) return this.me;
    if (!this.available) return null;
    this.me = await getMe(this.linked ? 'oauth' : 'web');
    return this.me;
  }

  async connect() {
    const id = settings.spotifyClientId.trim();
    if (!id) return ui.toast('Paste your Spotify Client ID first (see the steps above)');
    try {
      this.connecting = true;
      await call('spotify_login', { clientId: id });
    } catch (e) {
      this.connecting = false;
      ui.error(e);
    }
  }

  async disconnect() {
    await call('spotify_logout').catch(() => {});
  }

  async webConnect() {
    if (!settings.spotifyFriends) {
      settings.spotifyFriends = true;
      saveSettings();
    }
    await call('spotify_web_connect').catch((e) => ui.error(e));
  }

  async webLogout() {
    await call('spotify_web_logout').catch(() => {});
    if (settings.spotifyWeb) {
      settings.spotifyWeb = false;
      saveSettings();
      this.refresh(true);
    }
  }
}

export const spotify = new SpotifyStore();
