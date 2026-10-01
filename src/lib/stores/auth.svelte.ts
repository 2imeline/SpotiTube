import { call, isTauri } from '../api/transport';
import { apiConfig, clearApiCache } from '../api/innertube';
import { getAccountInfo, getAccounts } from '../api/ytm';
import { streamPrefs } from '../player/streams';
import type { Account } from '../api/types';
import { listen } from '@tauri-apps/api/event';

class Auth {
  loggedIn = $state(false);
  ready = $state(false);
  account = $state<Account | null>(null);
  accounts = $state<Account[]>([]);
  version = $state(0); // bumps on account change so views reload

  async init() {
    try {
      const brand = localStorage.getItem('st.brand');
      if (brand) apiConfig.onBehalfOfUser = brand;
    } catch {}
    if (isTauri) {
      await listen<boolean>('auth-changed', () => this.refresh());
    }
    await this.refresh();
  }

  async refresh() {
    try {
      const s = isTauri ? await call<{ logged_in: boolean }>('auth_status') : { logged_in: false };
      this.loggedIn = s.logged_in;
    } catch {
      this.loggedIn = false;
    }
    streamPrefs.loggedIn = this.loggedIn;
    clearApiCache();
    this.account = this.loggedIn ? await getAccountInfo() : null;
    if (this.loggedIn && !this.account) {
      // cookie expired / invalid
      this.account = { name: 'Google account' };
    }
    this.ready = true;
    this.version++;
  }

  async loadAccounts() {
    this.accounts = this.loggedIn ? await getAccounts() : [];
  }

  login() {
    return call('login');
  }

  async logout() {
    await call('logout');
    this.setBrand(undefined);
  }

  async pasteCookies(cookie: string) {
    await call('set_cookies', { cookie });
  }

  async switchAccount(a: Account) {
    if (a.authUser != null) await call('set_auth_user', { index: a.authUser });
    this.setBrand(a.brandId);
    await this.refresh();
  }

  private setBrand(id?: string) {
    apiConfig.onBehalfOfUser = id;
    try {
      id ? localStorage.setItem('st.brand', id) : localStorage.removeItem('st.brand');
    } catch {}
  }
}

export const auth = new Auth();
