import type { Theme } from '../stores/settings.svelte';

export interface Tab {
  path: string;
  label: string;
  icon: string;
  activeIcon?: string;
  action?: 'create';
}

export function tabsFor(theme: Theme): Tab[] {
  if (theme === 'apple')
    return [
      { path: '/', label: 'Home', icon: 'home', activeIcon: 'homeFill' },
      { path: '/explore', label: 'New', icon: 'sparkle' },
      { path: '/moods', label: 'Radio', icon: 'radio' },
      { path: '/library', label: 'Library', icon: 'library' },
    ];
  if (theme === 'aero')
    return [
      { path: '/', label: 'Home', icon: 'home', activeIcon: 'homeFill' },
      { path: '/explore', label: 'Explore', icon: 'explore' },
      { path: '/search', label: 'Search', icon: 'search' },
      { path: '/library', label: 'Library', icon: 'library' },
      { path: '/settings', label: 'Options', icon: 'settings' },
    ];
  return [
    { path: '/', label: 'Home', icon: 'home', activeIcon: 'homeFill' },
    { path: '/search', label: 'Search', icon: 'search' },
    { path: '/library', label: 'Your Library', icon: 'library' },
    { path: '', label: 'Create', icon: 'plus', action: 'create' },
  ];
}

const ROOTS = ['/', '/search', '/library', '/explore', '/moods', '/settings'];

/** a tab's top page (no back button) */
export function isTabRoot(path: string, theme: Theme) {
  const p = path.split('?')[0];
  if (p === '/search') return true;
  if (p === '/library') return theme !== 'apple' || !path.includes('tab=');
  if (p === '/settings') return theme === 'aero';
  return ROOTS.includes(p) && (p !== '/explore' && p !== '/moods' ? true : theme !== 'spotify');
}
