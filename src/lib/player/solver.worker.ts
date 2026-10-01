// Runs yt-dlp's EJS challenge solver (signature + "n" throttling param)
// against the YouTube player JS. Lives in a short-lived worker so the heavy
// AST work never stays resident in memory.
import * as meriyah from 'meriyah';
import * as astring from 'astring';
import bundledCore from './vendor/yt.solver.core.js?raw';

type Input =
  | { type: 'player'; player: string; requests: { type: 'n' | 'sig'; challenges: string[] }[]; output_preprocessed?: boolean }
  | { type: 'preprocessed'; preprocessed_player: string; requests: { type: 'n' | 'sig'; challenges: string[] }[] };

let jsc: ((input: Input) => any) | null = null;
let jscSource = '';

function load(core?: string) {
  const src = core || bundledCore;
  if (jsc && jscSource === src) return jsc;
  jsc = new Function('meriyah', 'astring', `${src}\n;return jsc;`)(meriyah, astring);
  jscSource = src;
  return jsc!;
}

self.onmessage = (e: MessageEvent<{ id: number; input: Input; core?: string }>) => {
  const { id, input, core } = e.data;
  try {
    let solver: (i: Input) => any;
    try {
      solver = load(core);
    } catch {
      solver = load();
    }
    const output = solver(input);
    (self as any).postMessage({ id, output });
  } catch (err) {
    (self as any).postMessage({ id, error: String((err as any)?.message ?? err) });
  }
};
