<script lang="ts">
  import { settings, saveSettings, resetSettings, ACCENT_PRESETS, type Theme } from '../stores/settings.svelte';
  import { auth } from '../stores/auth.svelte';
  import { ui } from '../stores/ui.svelte';
  import { clearApiCache } from '../api/innertube';
  import { updateSolver } from '../player/streams';
  import ColorWheel from '../components/ColorWheel.svelte';
  import Icon from '../components/Icon.svelte';
  import { updater } from '../stores/updater.svelte';
  import { spotify } from '../stores/spotify.svelte';
  import { go, router } from '../stores/router.svelte';
  import { openExternal } from '../actions';
  import type { SpUser } from '../api/spotify';
  import { onMount } from 'svelte';
  import { isMobile, isIOS } from '../native/platform';
  import { call } from '../api/transport';

  const REDIRECT = 'http://127.0.0.1:43821/callback';
  async function copyLog() {
    try {
      const log = await call<string>('read_log');
      await navigator.clipboard.writeText(log || '(log is empty)');
      ui.toast('Log copied to clipboard');
    } catch (e) {
      ui.error(e);
    }
  }
  let spMe = $state.raw<SpUser | null>(null);
  $effect(() => {
    spotify.version;
    if (spotify.linked) spotify.loadMe().then((m) => (spMe = m), () => {});
    else spMe = null;
  });
  onMount(() => {
    // deep link: /settings?s=spotify
    const s = router.route.query.get('s');
    // after the main view has reset its scroll position
    if (s) setTimeout(() => document.getElementById(`${s}-settings`)?.scrollIntoView({ block: 'start' }), 150);
  });

  function set<K extends keyof typeof settings>(k: K, v: (typeof settings)[K]) {
    settings[k] = v;
    saveSettings();
  }

  const LANGS: [string, string][] = [['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'], ['pt', 'Português'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['tr', 'Türkçe'], ['ru', 'Русский'], ['ar', 'العربية'], ['hi', 'हिन्दी'], ['ja', '日本語'], ['ko', '한국어'], ['zh-CN', '中文 (简体)'], ['zh-TW', '中文 (繁體)']];
  const REGIONS = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'DK', 'FI', 'PL', 'PT', 'BR', 'MX', 'AR', 'IN', 'JP', 'KR', 'TR', 'RU', 'UA', 'AE', 'SA', 'EG', 'ZA', 'NG', 'ID', 'PH', 'VN', 'TH'];
  const regionName = (c: string) => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) ?? c;
    } catch {
      return c;
    }
  };

  let cookie = $state('');
  let showCookie = $state(false);
  let solverBusy = $state(false);

  async function saveCookie() {
    try {
      await auth.pasteCookies(cookie);
      cookie = '';
      showCookie = false;
      ui.toast('Signed in');
    } catch (e) {
      ui.error(e);
    }
  }
  async function updSolver() {
    solverBusy = true;
    try {
      const v = await updateSolver();
      ui.toast(`Stream decoder updated (${v})`);
    } catch (e) {
      ui.error(e);
    } finally {
      solverBusy = false;
    }
  }
  const themes: { id: Theme; name: string; desc: string }[] = [
    { id: 'spotify', name: 'Spotify', desc: 'Dark, modern, familiar' },
    { id: 'aero', name: 'Frutiger Aero', desc: 'Glossy Windows 7 glass, sky & bubbles' },
    { id: 'apple', name: 'Apple Music', desc: 'Clean, light or dark, like the Music app' },
  ];
</script>

<div class="view">
  <div class="view-pad settings">
    <h1 class="page-title" style="font-size:40px;margin-top:40px">Settings</h1>

    <h2>Account</h2>
    {#if auth.loggedIn}
      <div class="set-row">
        <div class="l" style="display:flex;align-items:center;gap:12px">
          {#if auth.account?.photo}<img src={auth.account.photo} alt="" style="width:48px;height:48px;border-radius:50%" />{/if}
          <div><div class="t">{auth.account?.name ?? 'Signed in'}</div><div class="d">{auth.account?.handle ?? 'Google account'}</div></div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="pill-btn outline" onclick={async () => { await auth.loadAccounts(); if (!auth.accounts.length) ui.toast('No other accounts found'); }}>Switch account</button>
          <button class="pill-btn outline" onclick={() => auth.logout()}>Log out</button>
        </div>
      </div>
      {#if auth.accounts.length}
        {#each auth.accounts as a}
          <div class="set-row" style="padding-left:16px">
            <div class="l" style="display:flex;align-items:center;gap:12px">
              {#if a.photo}<img src={a.photo} alt="" style="width:32px;height:32px;border-radius:50%" />{/if}
              <div><div class="t">{a.name}</div><div class="d">{a.handle ?? ''}</div></div>
            </div>
            {#if a.selected}<span style="color:var(--accent)">Current</span>{:else}<button class="pill-btn outline" onclick={() => auth.switchAccount(a)}>Use</button>{/if}
          </div>
        {/each}
      {/if}
    {:else}
      <div class="set-row">
        <div class="l"><div class="t">Sign in with Google</div><div class="d">Access your library, playlists, likes, history and recommendations.</div></div>
        <button class="pill-btn" onclick={() => auth.login()}>Log in</button>
      </div>
    {/if}
    <div class="set-row">
      <div class="l"><div class="t">Sign in with browser cookies</div><div class="d">Fallback if Google blocks the sign-in window: open music.youtube.com in your browser while signed in, open DevTools → Network, copy the <code>cookie</code> request header of any request and paste it here.</div></div>
      <button class="pill-btn outline" onclick={() => (showCookie = !showCookie)}>{showCookie ? 'Cancel' : 'Paste cookie'}</button>
    </div>
    {#if showCookie}
      <textarea class="input" bind:value={cookie} placeholder="SID=...; HSID=...; SAPISID=...; __Secure-3PAPISID=..." style="min-height:80px"></textarea>
      <div style="margin-top:8px"><button class="pill-btn" onclick={saveCookie} disabled={!cookie.trim()}>Sign in</button></div>
    {/if}

    <h2>Appearance</h2>
    <div class="theme-cards">
      {#each themes as t}
        <button class="theme-card" class:on={settings.theme === t.id} onclick={() => set('theme', t.id)}>
          <div class="preview {t.id}-preview">
            {#if t.id === 'apple'}
              <div style="position:absolute;inset:0;background:#fff;display:grid;grid-template-columns:28% 1fr;border:1px solid #ddd">
                <div style="background:#f2f2f4;border-right:1px solid #e3e3e3;padding:8px 6px;display:flex;flex-direction:column;gap:5px">
                  <div style="height:8px;border-radius:3px;background:#e2e2e5"></div>
                  {#each [1, 2, 3] as _}<div style="height:5px;width:70%;border-radius:2px;background:var(--accent);opacity:.75"></div>{/each}
                </div>
                <div style="padding:8px">
                  <div style="height:12px;border-radius:3px;background:#efeff1;margin:0 18% 10px"></div>
                  <div style="display:flex;gap:8px"><div style="width:42px;height:42px;border-radius:4px;background:linear-gradient(135deg,#ff9a8b,#ff6a88)"></div><div style="flex:1"><div style="height:6px;width:60%;background:#1d1d1f;border-radius:2px;margin:6px 0 4px"></div><div style="height:6px;width:40%;background:var(--accent);border-radius:2px"></div><div style="display:flex;gap:4px;margin-top:8px"><div style="width:24px;height:9px;border-radius:2px;background:var(--accent)"></div><div style="width:24px;height:9px;border-radius:2px;background:var(--accent)"></div></div></div></div>
                </div>
              </div>
            {:else if t.id === 'spotify'}
              <div style="position:absolute;inset:0;background:#000;padding:6px;display:grid;grid-template-columns:30% 1fr;gap:4px">
                <div style="background:#121212;border-radius:4px"></div>
                <div style="background:linear-gradient(#3a3a3a,#121212 70%);border-radius:4px;position:relative"><div style="position:absolute;right:8px;bottom:8px;width:22px;height:22px;border-radius:50%;background:var(--accent)"></div></div>
              </div>
            {:else}
              <div style="position:absolute;inset:0;background:radial-gradient(circle at 20% 110%,#7ee26b 0,#2fa24a 22%,transparent 40%),linear-gradient(#1a7bd6,#7fd0ff 60%,#d9f6ff);padding:8px;display:grid;grid-template-columns:30% 1fr;gap:6px">
                <div style="border-radius:6px;background:linear-gradient(rgba(255,255,255,.75),rgba(255,255,255,.35));border:1px solid rgba(255,255,255,.9);box-shadow:inset 0 1px 0 #fff"></div>
                <div style="border-radius:6px;background:linear-gradient(rgba(255,255,255,.65),rgba(255,255,255,.25));border:1px solid rgba(255,255,255,.9);position:relative"><div style="position:absolute;right:8px;bottom:8px;width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 50% 30%,#fff 0,var(--accent) 45%,var(--accent-dark));box-shadow:0 2px 6px rgba(0,0,0,.35)"></div></div>
              </div>
            {/if}
          </div>
          <div class="name">{t.name}</div>
          <div class="desc">{t.desc}</div>
        </button>
      {/each}
    </div>
    {#if settings.theme === 'apple'}
      <div class="set-row">
        <div class="l"><div class="t">Appearance</div><div class="d">Automatic follows Windows' light/dark mode.</div></div>
        <select class="input" value={settings.appleAppearance} onchange={(e) => set('appleAppearance', (e.currentTarget as HTMLSelectElement).value as any)}>
          <option value="auto">Automatic</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
    {/if}
    {#if settings.theme === 'aero'}
      <div class="set-row">
        <div class="l"><div class="t">Aero wallpaper</div><div class="d">Background scene behind the glass.</div></div>
        <select class="input" value={settings.aeroWallpaper} onchange={(e) => set('aeroWallpaper', (e.currentTarget as HTMLSelectElement).value as any)}>
          <option value="aurora">Aurora (Vista/7)</option>
          <option value="sky">Sky &amp; grass (Bliss)</option>
          <option value="bubbles">Aqua bubbles</option>
        </select>
      </div>
    {/if}
    <div class="set-row" style="align-items:flex-start">
      <div class="l"><div class="t">Accent color</div><div class="d">Used by both themes for buttons, highlights, progress bars and active items.</div></div>
    </div>
    <ColorWheel value={settings.accent} onchange={(hex) => set('accent', hex)}>
      <div class="swatches">
        {#each ACCENT_PRESETS as c}
          <button class="swatch" class:on={settings.accent.toLowerCase() === c} style="background:{c}" aria-label="Use {c}" onclick={() => set('accent', c)}></button>
        {/each}
      </div>
    </ColorWheel>
    {#if !isMobile}
    <div class="set-row">
      <div class="l"><div class="t">Zoom</div><div class="d">Scale the whole interface.</div></div>
      <select class="input" value={String(settings.zoom)} onchange={(e) => set('zoom', +(e.currentTarget as HTMLSelectElement).value)}>
        {#each [0.8, 0.9, 1, 1.1, 1.25, 1.5] as z}<option value={String(z)}>{Math.round(z * 100)}%</option>{/each}
      </select>
    </div>
    {/if}
    <div class="set-row">
      <div class="l"><div class="t">Reduce motion</div><div class="d">Disable animations and transitions.</div></div>
      <button class="toggle" class:on={settings.reduceMotion} aria-label="Reduce motion" onclick={() => set('reduceMotion', !settings.reduceMotion)}></button>
    </div>

    <h2>Playback</h2>
    <div class="set-row">
      <div class="l"><div class="t">Streaming quality</div><div class="d">High uses the best available audio (Opus ~160 kbps, or 256 kbps with Premium).</div></div>
      <select class="input" value={settings.quality} onchange={(e) => set('quality', (e.currentTarget as HTMLSelectElement).value as any)}>
        <option value="high">High</option>
        <option value="normal">Normal</option>
        <option value="low">Low (data saver)</option>
      </select>
    </div>
    <div class="set-row">
      <div class="l"><div class="t">Normalize volume</div><div class="d">Set the same volume level for all songs, like YouTube Music.</div></div>
      <button class="toggle" class:on={settings.normalize} aria-label="Normalize volume" onclick={() => set('normalize', !settings.normalize)}></button>
    </div>
    <div class="set-row">
      <div class="l"><div class="t">Autoplay</div><div class="d">Keep playing similar songs when your queue ends.</div></div>
      <button class="toggle" class:on={settings.autoplay} aria-label="Autoplay" onclick={() => set('autoplay', !settings.autoplay)}></button>
    </div>
    <div class="set-row">
      <div class="l"><div class="t">I have YouTube Music Premium</div><div class="d">Use the YouTube Music web client for streams first (Premium accounts get higher quality audio).</div></div>
      <button class="toggle" class:on={settings.premium} aria-label="Premium" onclick={() => set('premium', !settings.premium)}></button>
    </div>
    {#if !isMobile}
    <div class="set-row">
      <div class="l"><div class="t">Media keys</div><div class="d">Control playback with the keyboard's play/pause, next and previous keys.</div></div>
      <button class="toggle" class:on={settings.mediaKeys} aria-label="Media keys" onclick={() => set('mediaKeys', !settings.mediaKeys)}></button>
    </div>
    {/if}
    <div class="set-row">
      <div class="l"><div class="t">Synced lyrics from LRCLIB</div><div class="d">When YouTube Music has no time-synced lyrics, look them up on lrclib.net.</div></div>
      <button class="toggle" class:on={settings.lrclib} aria-label="LRCLIB" onclick={() => set('lrclib', !settings.lrclib)}></button>
    </div>

    {#if !isMobile}
    <h2>Discord</h2>
    <div class="set-row">
      <div class="l"><div class="t">Show what I'm listening to on Discord</div><div class="d">Rich presence with the song, artist, artwork and a live progress bar. The Discord desktop app must be running.</div></div>
      <button class="toggle" class:on={settings.discord} aria-label="Discord rich presence" onclick={() => set('discord', !settings.discord)}></button>
    </div>
    {#if settings.discord}
      <div class="set-row">
        <div class="l"><div class="t">Status text</div><div class="d">What your status line says next to "Listening to".</div></div>
        <select class="input" value={settings.discordShow} onchange={(e) => set('discordShow', (e.currentTarget as HTMLSelectElement).value as any)}>
          <option value="app">App name (Listening to YouTube Music)</option>
          <option value="artist">Artist (Listening to Radiohead)</option>
          <option value="title">Song (Listening to All I Need)</option>
        </select>
      </div>
      <div class="set-row">
        <div class="l"><div class="t">Show while paused</div><div class="d">Keep the status visible (without a progress bar) when playback is paused.</div></div>
        <button class="toggle" class:on={settings.discordWhenPaused} aria-label="Show while paused" onclick={() => set('discordWhenPaused', !settings.discordWhenPaused)}></button>
      </div>
      <div class="set-row">
        <div class="l"><div class="t">"Play on YouTube Music" button</div><div class="d">Lets friends open the song you're playing.</div></div>
        <button class="toggle" class:on={settings.discordButton} aria-label="Play button" onclick={() => set('discordButton', !settings.discordButton)}></button>
      </div>
      <div class="set-row">
        <div class="l"><div class="t">Custom Discord application ID</div><div class="d">Optional. The app's name is what shows after "Listening to" — create an application called e.g. "SpotiTube" at discord.com/developers and paste its Application ID here. Leave empty for "YouTube Music".</div></div>
        <input class="input" style="width:200px" placeholder="Application ID" value={settings.discordClientId} onchange={(e) => set('discordClientId', (e.currentTarget as HTMLInputElement).value.trim())} />
      </div>
    {/if}
    {/if}

    <h2 id="spotify-settings">Spotify</h2>
    {#if spotify.linked}
      <div class="set-row">
        <div class="l" style="display:flex;align-items:center;gap:12px">
          {#if spMe?.image}<img src={spMe.image} alt="" style="width:48px;height:48px;border-radius:50%" />{/if}
          <div><div class="t">{spMe?.name ?? 'Spotify connected'}</div><div class="d">Your playlists, profile and the people you follow show up on your profile page.</div></div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="pill-btn outline" onclick={() => go('/me')}>Open profile</button>
          <button class="pill-btn outline" onclick={() => spotify.disconnect()}>Disconnect</button>
        </div>
      </div>
    {:else}
      <div class="set-row">
        <div class="l">
          <div class="t">Link your Spotify account</div>
          <div class="d">Spotify only lets apps sign in through a developer app you own (free, takes a minute):</div>
          <ol class="sp-steps">
            <li>Open <a href="#/" onclick={(e) => { e.preventDefault(); openExternal('https://developer.spotify.com/dashboard'); }}>developer.spotify.com/dashboard</a> and click <b>Create app</b>.</li>
            <li>Any name and description. Add the Redirect URI <code>{REDIRECT}</code> <button class="link-btn" onclick={() => navigator.clipboard.writeText(REDIRECT).then(() => ui.toast('Copied'))}>copy</button></li>
            <li>Tick <b>Web API</b>, save, and paste the app's <b>Client ID</b> here.</li>
          </ol>
          <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
            <input class="input" style="width:280px" placeholder="Client ID" value={settings.spotifyClientId} oninput={(e) => set('spotifyClientId', (e.currentTarget as HTMLInputElement).value.trim())} />
            <button class="pill-btn" disabled={spotify.connecting || !settings.spotifyClientId} onclick={() => spotify.connect()}>{spotify.connecting ? 'Waiting…' : 'Connect'}</button>
          </div>
        </div>
      </div>
    {/if}
    <div class="set-row">
      <div class="l"><div class="t">Friends & profiles <span class="beta">Experimental</span></div><div class="d">Show your Spotify friends' activity and browse anyone's full profile. Spotify doesn't offer this to apps, so SpotiTube signs into the Spotify web player in a small window and uses its session. Unofficial: it can break whenever Spotify changes its site.</div></div>
      <button class="toggle" class:on={settings.spotifyFriends} aria-label="Spotify friends" onclick={() => set('spotifyFriends', !settings.spotifyFriends)}></button>
    </div>
    {#if settings.spotifyFriends}
      <div class="set-row">
        <div class="l"><div class="t">Spotify web session</div><div class="d">{settings.spotifyWeb ? 'Signed in. The session refreshes itself in the background.' : 'Sign in once with your Spotify account.'}</div></div>
        {#if settings.spotifyWeb}
          <button class="pill-btn outline" onclick={() => spotify.webLogout()}>Sign out</button>
        {:else}
          <button class="pill-btn" onclick={() => spotify.webConnect()}>Sign in to Spotify</button>
        {/if}
      </div>
    {/if}

    <h2>Language and region</h2>
    <div class="set-row">
      <div class="l"><div class="t">Content language</div><div class="d">Language for titles, recommendations and charts.</div></div>
      <select class="input" value={settings.hl} onchange={(e) => set('hl', (e.currentTarget as HTMLSelectElement).value)}>
        {#each LANGS as [c, n]}<option value={c}>{n}</option>{/each}
      </select>
    </div>
    <div class="set-row">
      <div class="l"><div class="t">Region</div><div class="d">Affects Home, Explore and chart content.</div></div>
      <select class="input" value={settings.gl} onchange={(e) => set('gl', (e.currentTarget as HTMLSelectElement).value)}>
        {#each REGIONS as c}<option value={c}>{regionName(c)}</option>{/each}
      </select>
    </div>

    <h2>Advanced</h2>
    <div class="set-row">
      <div class="l"><div class="t">Update stream decoder</div><div class="d">Downloads the latest signature solver from yt-dlp/ejs if playback suddenly stops working after a YouTube change.</div></div>
      <button class="pill-btn outline" onclick={updSolver} disabled={solverBusy}>{solverBusy ? 'Updating…' : 'Update'}</button>
    </div>
    <div class="set-row">
      <div class="l"><div class="t">Clear cache</div><div class="d">Reload pages from YouTube Music.</div></div>
      <button class="pill-btn outline" onclick={() => { clearApiCache(); ui.toast('Cache cleared'); }}>Clear</button>
    </div>
    <div class="set-row">
      <div class="l"><div class="t">Reset settings</div><div class="d">Restore the default theme, color and preferences.</div></div>
      <button class="pill-btn outline" onclick={resetSettings}>Reset</button>
    </div>

    <h2>Updates</h2>
    <div class="set-row">
      <div class="l">
        <div class="t">SpotiTube {updater.info?.current ?? updater.version}</div>
        <div class="d">
          {#if updater.installing}
            Downloading update… {Math.round(updater.progress * 100)}%
          {:else if updater.available}
            {#if isIOS}Version {updater.info?.latest} is available. Download the new IPA and install it with your sideloading app (your data is kept).{:else}Version {updater.info?.latest} is available. It installs in place and SpotiTube reopens by itself.{/if}
          {:else if updater.info}
            You're on the latest version.
          {:else}
            {#if isIOS}Check GitHub for a newer version of the iPhone app.{:else}Check GitHub for a newer version and install it without re-downloading anything yourself.{/if}
          {/if}
        </div>
        {#if updater.installing}
          <div style="height:4px;border-radius:2px;background:rgba(127,127,127,.3);margin-top:8px;overflow:hidden;max-width:320px"><div style="height:100%;width:{updater.progress * 100}%;background:var(--accent)"></div></div>
        {/if}
      </div>
      {#if updater.available}
        <button class="pill-btn accent" onclick={() => updater.install()} disabled={updater.installing}>{updater.installing ? 'Updating…' : isIOS ? 'Download' : 'Update now'}</button>
      {:else}
        <button class="pill-btn outline" onclick={() => updater.check()} disabled={updater.checking}>{updater.checking ? 'Checking…' : 'Check for updates'}</button>
      {/if}
    </div>
    {#if updater.available && updater.info?.notes}
      <div class="selectable" style="white-space:pre-line;color:var(--text-sub);font-size:13px;line-height:1.5;padding:4px 0 8px">{updater.info.notes}</div>
    {/if}
    <div class="set-row">
      <div class="l"><div class="t">Check for updates automatically</div><div class="d">Look for a new version when SpotiTube starts and show an "Update" button when one is available.</div></div>
      <button class="toggle" class:on={settings.autoUpdate} aria-label="Check for updates automatically" onclick={() => set('autoUpdate', !settings.autoUpdate)}></button>
    </div>

    <h2>About</h2>
    <div class="set-row">
      <div class="l"><div class="t">SpotiTube</div><div class="d">A lightweight native YouTube Music client. Not affiliated with Google, YouTube or Spotify.</div></div>
      <Icon name="info" size={20} />
    </div>
    <div class="set-row">
      <div class="l"><div class="t">Diagnostics</div><div class="d">If SpotiTube crashed or something broke, copy the log and paste it in your report. It contains errors only, no passwords or cookies.</div></div>
      <button class="pill-btn outline" onclick={copyLog}>Copy log</button>
    </div>
  </div>
</div>
