// Minimal in-memory router with Spotify-style back/forward history.
export interface Route {
  path: string;
  name: string;
  params: string[];
  query: URLSearchParams;
}

function parse(path: string): Route {
  const [p, q = ''] = path.split('?');
  const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
  return { path, name: parts[0] ?? 'home', params: parts.slice(1), query: new URLSearchParams(q) };
}

class Router {
  stack = $state<string[]>(['/']);
  pos = $state(0);
  route = $derived(parse(this.stack[this.pos]));
  canBack = $derived(this.pos > 0);
  canForward = $derived(this.pos < this.stack.length - 1);
  scroll = new Map<number, number>();

  go(path: string, replace = false) {
    if (path === this.stack[this.pos] && !replace) return;
    if (replace) {
      this.stack[this.pos] = path;
      return;
    }
    this.stack = [...this.stack.slice(0, this.pos + 1), path].slice(-60);
    this.pos = this.stack.length - 1;
  }
  back() {
    if (this.canBack) this.pos--;
  }
  forward() {
    if (this.canForward) this.pos++;
  }
}

export const router = new Router();
export const go = (p: string, replace = false) => router.go(p, replace);
