import type { Item, Track, Card } from '../api/types';
import { logError } from '../util/log';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface MenuAction {
  label: string;
  icon?: string;
  run?: () => void;
  submenu?: () => MenuAction[] | Promise<MenuAction[]>;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  actions: MenuAction[];
  owner?: unknown;
}

export interface DialogState {
  kind: 'prompt' | 'confirm' | 'playlist' | 'credits' | 'info';
  title: string;
  message?: string;
  fields?: { key: string; label: string; value: string; multiline?: boolean; options?: string[] }[];
  confirmLabel?: string;
  data?: any;
  resolve: (v: any) => void;
}

class UI {
  toasts = $state<Toast[]>([]);
  menu = $state.raw<ContextMenuState | null>(null);
  dialog = $state.raw<DialogState | null>(null);
  rightPanel = $state<'none' | 'queue' | 'lyrics' | 'nowplaying' | 'related'>('nowplaying');
  sidebarCollapsed = $state(false);
  fullscreenPlayer = $state(false);
  miniPlayer = $state(false);
  scrollY = $state(0);
  /** title of the page currently shown (used by the Aero breadcrumb) */
  page = $state<{ path: string; title: string } | null>(null);
  private n = 0;

  toast(text: string, kind: Toast['kind'] = 'info', ms = 3200) {
    const id = ++this.n;
    this.toasts = [...this.toasts.slice(-3), { id, text, kind }];
    setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), ms);
  }
  error(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('ui', e);
    this.toast(msg, 'error', 5000);
  }
  openMenu(e: MouseEvent | { x: number; y: number }, actions: MenuAction[], owner?: unknown) {
    if ('preventDefault' in e) {
      e.preventDefault();
      e.stopPropagation();
    }
    this.menu = { x: (e as any).clientX ?? e.x, y: (e as any).clientY ?? e.y, actions, owner };
  }
  closeMenu() {
    this.menu = null;
  }
  ask<T = any>(d: Omit<DialogState, 'resolve'>): Promise<T | null> {
    return new Promise((resolve) => {
      this.dialog = { ...d, resolve: (v: any) => { this.dialog = null; resolve(v); } } as DialogState;
    });
  }
  togglePanel(p: UI['rightPanel']) {
    this.rightPanel = this.rightPanel === p ? 'none' : p;
  }
}

export const ui = new UI();
export type { Item, Track, Card };
