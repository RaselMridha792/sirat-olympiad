// The one browser driver for the page checks and the e2e test: a small Chrome DevTools Protocol client on Node's
// built-in WebSocket (Node 22), driving a locally installed Chrome or Edge, headless, with a throwaway profile.
// No dependencies. Each "context" is a separate cookie jar (like a private window), so one browser can hold a
// student session and an admin session at once.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('cdp: could not connect to the browser'));
  });
  let lastId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id !== undefined) {
      const call = pending.get(msg.id);
      pending.delete(msg.id);
      if (!call) return;
      if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`));
      else call.resolve(msg.result);
    } else for (const listener of listeners) listener(msg);
  };
  ws.onclose = () => {
    for (const call of pending.values()) call.reject(new Error('cdp: browser connection closed'));
    pending.clear();
  };
  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        lastId += 1;
        pending.set(lastId, { resolve, reject, method });
        ws.send(
          JSON.stringify({ id: lastId, method, params, ...(sessionId ? { sessionId } : {}) }),
        );
      });
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => ws.close(),
  };
}

/** Starts the browser. `close()` ends it and deletes the profile. */
export async function launchBrowser() {
  const executable = findBrowser();
  if (!executable) throw new Error('cdp: needs Chrome or Edge (set CHROME_PATH)');
  const profile = mkdtempSync(join(tmpdir(), 'sirat-cdp-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--lang=en-US',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    // GitHub's Ubuntu runners cannot start Chrome's sandbox (user namespaces are restricted).
    ...(process.env.CI ? ['--no-sandbox'] : []),
    'about:blank',
  ];
  const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('cdp: the browser did not start')), 30_000);
    child.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`cdp: the browser exited (${code})`));
    });
  });
  const conn = await connect(wsUrl);

  return {
    /** A separate cookie jar. */
    async newContext() {
      const { browserContextId } = await conn.send('Target.createBrowserContext', {
        disposeOnDetach: true,
      });
      return {
        id: browserContextId,
        newPage: () => openPage(conn, browserContextId),
        /** Sets a cookie for `url`'s host (host-only, like the API's cookies). */
        setCookie: (url, name, value, extra = {}) =>
          conn.send('Storage.setCookies', {
            browserContextId,
            cookies: [{ name, value, ...hostOf(url), httpOnly: true, sameSite: 'Lax', ...extra }],
          }),
        async cookies() {
          const { cookies } = await conn.send('Storage.getCookies', { browserContextId });
          return cookies;
        },
        /** Deletes every cookie called `name` (by setting it already expired, like a server would). */
        async deleteCookie(name) {
          const matching = (await this.cookies()).filter((c) => c.name === name);
          if (!matching.length) return;
          await conn.send('Storage.setCookies', {
            browserContextId,
            cookies: matching.map((c) => ({
              name,
              value: '',
              domain: c.domain,
              path: c.path,
              secure: c.secure,
              expires: 1,
            })),
          });
        },
        close: () => conn.send('Target.disposeBrowserContext', { browserContextId }),
      };
    },
    async close() {
      try {
        await conn.send('Browser.close');
      } catch {
        /* already gone */
      }
      conn.close();
      // Chrome keeps writing its profile until it has exited: wait for that (at most 5 s) before removing it.
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await Promise.race([exited, sleep(5_000)]);
      }
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (error) {
        // Best effort: a temporary profile left behind fails no check.
        console.warn(`cdp: could not remove the browser profile (${error.code ?? error.message})`);
      }
    },
  };
}

function hostOf(url) {
  const u = new URL(url);
  return { domain: u.hostname, path: '/', secure: u.protocol === 'https:' };
}

async function openPage(conn, browserContextId) {
  const { targetId } = await conn.send('Target.createTarget', {
    url: 'about:blank',
    browserContextId,
  });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => conn.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  const page = {
    send,
    /** Resolves with the params of the next matching event of this page. */
    waitForEvent(method, predicate = () => true, timeout = 30_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new Error(`cdp: timed out waiting for ${method}`));
        }, timeout);
        const off = conn.on((msg) => {
          if (msg.sessionId === sessionId && msg.method === method && predicate(msg.params)) {
            clearTimeout(timer);
            off();
            resolve(msg.params);
          }
        });
      });
    },
    /** Every event of this page, until the returned function is called. */
    onEvent(method, listener) {
      return conn.on((msg) => {
        if (msg.sessionId === sessionId && msg.method === method) listener(msg.params);
      });
    },
    /** Navigates and waits for the first load event (redirects and client navigations may follow). */
    async goto(url) {
      const loaded = page.waitForEvent('Page.loadEventFired');
      const { errorText } = await send('Page.navigate', { url });
      if (errorText) throw new Error(`cdp: navigation to ${url} failed: ${errorText}`);
      await loaded;
    },
    async evaluate(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails) {
        throw new Error(`cdp: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
      }
      return result.value;
    },
    /** Polls `expression` until it is truthy; returns its value. */
    async waitFor(expression, { timeout = 20_000, interval = 100 } = {}) {
      const end = Date.now() + timeout;
      for (;;) {
        try {
          const value = await page.evaluate(expression);
          if (value) return value;
        } catch {
          /* mid-navigation: the context is being replaced */
        }
        if (Date.now() > end) throw new Error(`cdp: timed out waiting for ${expression}`);
        await sleep(interval);
      }
    },
    url: () => page.evaluate('location.href'),
    html: () => page.evaluate('document.documentElement.outerHTML'),
    /** Waits until the page has loaded and stayed on one URL with no request in flight for `quietMs`. */
    async settle({ quietMs = 500, timeout = 20_000 } = {}) {
      let inFlight = 0;
      let lastChange = Date.now();
      const bump = (delta) => () => {
        inFlight = Math.max(0, inFlight + delta);
        lastChange = Date.now();
      };
      const offs = [
        page.onEvent('Network.requestWillBeSent', bump(1)),
        page.onEvent('Network.loadingFinished', bump(-1)),
        page.onEvent('Network.loadingFailed', bump(-1)),
        page.onEvent('Page.frameNavigated', bump(0)),
      ];
      try {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
          const ready = await page.evaluate('document.readyState').catch(() => 'loading');
          if (ready === 'complete' && inFlight === 0 && Date.now() - lastChange >= quietMs) return;
          await sleep(100);
        }
      } finally {
        for (const off of offs) off();
      }
    },
    close: () => conn.send('Target.closeTarget', { targetId }),
  };
  return page;
}

/** Logs in through the API (POST /api/auth/login) and returns the session cookies by name. */
export async function apiLogin(apiBase, email, password) {
  const res = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'sirat-web' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 204) throw new Error(`login for ${email} answered ${res.status}`);
  const cookies = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  if (!cookies.sirat_access) throw new Error(`login for ${email} set no access cookie`);
  return cookies;
}
