import { invoke } from '@tauri-apps/api/core';
import { ui } from './stores/ui.svelte';
import { isTauri } from './api/transport';
import { clearApiCache } from './api/innertube';

const OK = ['mp3', 'm4a', 'wma', 'flac', 'ogg'];

export async function uploadFiles(files: FileList | null) {
  if (!files?.length) return;
  if (!isTauri) return ui.toast('Uploading requires the desktop app');
  for (const f of Array.from(files)) {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!OK.includes(ext)) {
      ui.toast(`${f.name}: unsupported file type (${OK.join(', ')})`, 'error');
      continue;
    }
    if (f.size > 300 * 1024 * 1024) {
      ui.toast(`${f.name} is larger than 300 MB`, 'error');
      continue;
    }
    ui.toast(`Uploading ${f.name}…`);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      await invoke('upload_song', buf, { headers: { 'x-filename': encodeURIComponent(f.name) } });
      ui.toast(`Uploaded ${f.name}. It may take a few minutes to process.`);
    } catch (e) {
      ui.error(`${f.name}: ${e}`);
    }
  }
  clearApiCache();
}
