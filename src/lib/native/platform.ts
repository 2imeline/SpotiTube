// Platform detection: the iOS app injects __SPOTITUBE_PLATFORM__ before any script runs.
const w = typeof window !== 'undefined' ? (window as any) : {};

export const isIOS = w.__SPOTITUBE_PLATFORM__ === 'ios';

function forcedMobile(): boolean {
  try {
    return new URLSearchParams(location.search).has('mobile') || localStorage.getItem('st.forceMobile') === '1';
  } catch {
    return false;
  }
}

/** phone layout: the iOS app, or `?mobile` for development in a browser */
export const isMobile = isIOS || forcedMobile();
export const isAutotest = !!w.__SPOTITUBE_AUTOTEST__ || (typeof location !== 'undefined' && location.search.includes('autotest'));
