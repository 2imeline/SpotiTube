// Svelte action: long-press (touch) opens a context menu, like iOS apps.
import { isMobile } from '../native/platform';

export function longpress(node: HTMLElement, handler: (e: MouseEvent) => void) {
  if (!isMobile) return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let x = 0;
  let y = 0;
  let fired = false;
  let fn = handler;
  const start = (e: TouchEvent) => {
    fired = false;
    const t = e.touches[0];
    x = t.clientX;
    y = t.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => {
      fired = true;
      import('../native/ios.svelte').then((m) => m.haptic('medium')).catch(() => {});
      fn(new MouseEvent('contextmenu', { clientX: x, clientY: y }));
    }, 480);
  };
  const move = (e: TouchEvent) => {
    const t = e.touches[0];
    if (Math.abs(t.clientX - x) > 8 || Math.abs(t.clientY - y) > 8) clearTimeout(timer);
  };
  const end = (e: TouchEvent) => {
    clearTimeout(timer);
    // swallow the click that follows a long press
    if (fired) e.preventDefault();
  };
  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchmove', move, { passive: true });
  node.addEventListener('touchend', end);
  node.addEventListener('touchcancel', end);
  return {
    update(h: (e: MouseEvent) => void) {
      fn = h;
    },
    destroy() {
      clearTimeout(timer);
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', end);
    },
  };
}
