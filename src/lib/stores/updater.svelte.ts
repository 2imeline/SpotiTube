import { listen } from '@tauri-apps/api/event';
import { call, isTauri } from '../api/transport';
import { ui } from './ui.svelte';
import { isIOS } from '../native/platform';

export interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  notes: string;
  url: string;
  mode: 'installer' | 'msi' | 'portable';
}

const LAST_CHECK = 'st.updateChecked';

class Updater {
  info = $state.raw<UpdateInfo | null>(null);
  checking = $state(false);
  installing = $state(false);
  progress = $state(0); // 0..1
  error = $state<string | null>(null);
  version = $state('');
  available = $derived(!!this.info?.available);

  async init(auto: boolean) {
    if (!isTauri) return;
    import('@tauri-apps/api/app').then((m) => m.getVersion()).then((v) => (this.version = v)).catch(() => {});
    listen<{ downloaded: number; total: number }>('update-progress', (e) => {
      this.progress = e.payload.total ? e.payload.downloaded / e.payload.total : 0;
    });
    if (!auto) return;
    // quiet check shortly after start-up, at most every 6 hours
    const last = +(localStorage.getItem(LAST_CHECK) ?? 0);
    if (Date.now() - last < 6 * 3600_000) return;
    setTimeout(() => this.check(true), 6000);
  }

  async check(silent = false) {
    if (!isTauri) {
      if (!silent) ui.toast('Updates are only available in the desktop app');
      return;
    }
    this.checking = true;
    this.error = null;
    try {
      this.info = await call<UpdateInfo>('check_update');
      try {
        localStorage.setItem(LAST_CHECK, String(Date.now()));
      } catch {}
      if (this.info.available) ui.toast(isIOS ? `SpotiTube ${this.info.latest} is available — get it in Settings` : `SpotiTube ${this.info.latest} is available — click "Update" to install it`, 'info', 6000);
      else if (!silent) ui.toast(`You're up to date (version ${this.info.current})`);
    } catch (e: any) {
      this.error = String(e?.message ?? e);
      if (!silent) ui.error(this.error);
    } finally {
      this.checking = false;
    }
  }

  async install() {
    if (!this.info?.available || this.installing) return;
    if (isIOS) {
      // sideloaded apps can't replace themselves: hand the IPA to Safari / the sideloading app
      await call('install_update').catch((e) => ui.error(e));
      return;
    }
    const ok = await ui.ask<boolean>({
      kind: 'confirm',
      title: `Update to SpotiTube ${this.info.latest}?`,
      message: 'The update will download, SpotiTube will close for a few seconds while it installs, and then reopen automatically. Your settings, sign-in and queue are kept.',
      confirmLabel: 'Update now',
    });
    if (!ok) return;
    this.installing = true;
    this.progress = 0;
    this.error = null;
    try {
      await call('install_update');
    } catch (e: any) {
      this.error = String(e?.message ?? e);
      ui.error(this.error);
      this.installing = false;
    }
  }
}

export const updater = new Updater();
