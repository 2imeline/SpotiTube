// SpotiTube iOS bridge: gives the shared web app the same `__TAURI_INTERNALS__`
// IPC surface it uses on the desktop, backed by native Swift commands.
(() => {
  if (window.__TAURI_INTERNALS__) return;
  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;

  const post = (cmd, args) =>
    handler.postMessage({ cmd, args: JSON.stringify(args == null ? {} : args) }).then(
      (r) => (r == null || r === '' ? null : JSON.parse(r)),
      (e) => {
        // Tauri rejects with the command's error string
        throw (e && e.message) || String(e);
      },
    );

  const callbacks = new Map();
  let nextCb = 1;
  const listeners = new Map(); // event -> Map(listenerId -> callbackId)
  let nextListener = 1;

  function transformCallback(cb, once) {
    const id = nextCb++;
    callbacks.set(id, (payload) => {
      if (once) callbacks.delete(id);
      return cb && cb(payload);
    });
    return id;
  }

  function b64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function emit(event, payload) {
    const m = listeners.get(event);
    if (!m) return;
    for (const [id, cb] of m) {
      const f = callbacks.get(cb);
      if (f) {
        try {
          f({ event, id, payload });
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  async function invoke(cmd, args, options) {
    args = args == null ? {} : args;
    switch (cmd) {
      case 'plugin:event|listen': {
        const id = nextListener++;
        let m = listeners.get(args.event);
        if (!m) listeners.set(args.event, (m = new Map()));
        m.set(id, args.handler);
        return id;
      }
      case 'plugin:event|unlisten':
        listeners.get(args.event)?.delete(args.eventId);
        return null;
      case 'plugin:event|emit':
      case 'plugin:event|emit_to':
        emit(args.event, args.payload);
        return null;
      case 'plugin:app|version':
        return window.__SPOTITUBE_VERSION__;
    }
    // window / dpi plugins have no meaning on iPhone
    if (cmd.startsWith('plugin:')) return null;
    if (args instanceof Uint8Array || args instanceof ArrayBuffer) {
      args = { __raw: b64(args), headers: (options && options.headers) || {} };
    }
    return post(cmd, args);
  }

  window.__nativeEmit = emit;
  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback: (id) => callbacks.delete(id),
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event, id) => listeners.get(event)?.delete(id),
  };
})();
