// The one browser driver for the page checks and the e2e test: a small Chrome DevTools Protocol client on Node's
// built-in WebSocket (Node 22), driving a locally installed Chrome or Edge, headless, with a throwaway profile.
// No dependencies. Each "context" is a separate cookie jar (like a private window), so one browser can hold a
// student session and an admin session at once.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextCode } from './totp.mjs';

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

/** A busy CI runner can take longer than 30 s to start Chrome (seen once in CI's docker job, after the stack build). */
const START_TIMEOUT_MS = process.env.CI ? 90_000 : 30_000;

/** The end of Chrome's own output, on one line: it names why a start failed. */
const lastOutput = (text) =>
  text.trim()
    ? JSON.stringify(text.trim().split(/\r?\n/).slice(-8).join(' | ').slice(-800))
    : '(none)';

/**
 * Starts Chrome on a new profile: its DevTools URL, the child and the profile. A start that fails is stopped and its
 * profile removed, and the error carries the end of Chrome's output.
 */
async function startBrowser(executable) {
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
  let output = '';
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      const fail = (why) =>
        reject(new Error(`cdp: the browser ${why}; its last output: ${lastOutput(output)}`));
      const timer = setTimeout(
        () => fail(`did not start within ${START_TIMEOUT_MS / 1000} s`),
        START_TIMEOUT_MS,
      );
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
        fail(`exited (${code})`);
      });
    });
    return { wsUrl, child, profile };
  } catch (error) {
    child.kill();
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* best effort: a profile left behind fails no check */
    }
    throw error;
  }
}

/** Starts the browser (one more try on a new profile if the first start fails). `close()` ends it and deletes the profile. */
export async function launchBrowser() {
  const executable = findBrowser();
  if (!executable) throw new Error('cdp: needs Chrome or Edge (set CHROME_PATH)');
  let started;
  try {
    started = await startBrowser(executable);
  } catch (error) {
    console.warn(`${error.message}; starting it once more`);
    started = await startBrowser(executable);
  }
  const { wsUrl, child, profile } = started;
  const conn = await connect(wsUrl);
  // Content-Security-Policy, seen by every page: the violations (enforced or Report-Only) and which documents carried
  // nginx's page policy. e2e.mjs and e2e-exam.mjs check both once at the end (cspReport below, LAUNCH-PLAN §3).
  const cspViolations = [];
  const cspDocuments = []; // { origin, path, hasPolicy } for every http(s) document
  const onDocument = (doc) => cspDocuments.push(doc);

  return {
    /** The CSP violations recorded so far, across every page of this browser. */
    cspViolations: () => [...cspViolations],
    /** How many documents (of `origin`, or all) carried the page CSP, and the paths of those that did not. */
    cspDocuments: (origin) => {
      const docs = cspDocuments.filter((d) => !origin || d.origin === origin);
      return {
        withPolicy: docs.filter((d) => d.hasPolicy).length,
        withoutPolicy: docs.filter((d) => !d.hasPolicy).map((d) => d.path),
      };
    },
    /** A separate cookie jar. */
    async newContext() {
      const { browserContextId } = await conn.send('Target.createBrowserContext', {
        disposeOnDetach: true,
      });
      return {
        id: browserContextId,
        newPage: () => openPage(conn, browserContextId, (v) => cspViolations.push(v), onDocument),
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

const CSP_BINDING = '__siratCspViolation';

/**
 * The end-of-run CSP verdict for e2e scripts. It fails when a document of the site (`base`) lacked nginx's page
 * policy, when none had it (a run against a bare Next or an nginx without security-headers.conf would otherwise pass
 * without testing anything), or when any violation was seen.
 */
export function cspReport(browser, base) {
  const violations = browser.cspViolations();
  // Only the site's own documents must carry it: a payment gateway page is another origin with its own headers.
  const { withPolicy, withoutPolicy } = browser.cspDocuments(
    base ? new URL(base).origin : undefined,
  );
  if (withPolicy === 0) {
    return {
      ok: false,
      line: "  FAIL  no document carried the page Content-Security-Policy (not behind nginx's site?)",
    };
  }
  if (withoutPolicy.length) {
    return {
      ok: false,
      line: `  FAIL  ${withoutPolicy.length} documents without the page Content-Security-Policy: ${JSON.stringify(withoutPolicy.slice(0, 5))}`,
    };
  }
  if (violations.length) {
    return {
      ok: false,
      line: `  FAIL  ${violations.length} Content-Security-Policy violations: ${JSON.stringify(violations.slice(0, 5))}`,
    };
  }
  return {
    ok: true,
    line: `  ok    the page Content-Security-Policy on all ${withPolicy} documents, no violations`,
  };
}

/** nginx's page policy: the Report-Only header, or an enforced one with script/default rules (Next's own header has only frame-ancestors). */
function hasPagePolicy(headers) {
  const lower = Object.fromEntries(
    Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );
  if ('content-security-policy-report-only' in lower) return true;
  const enforced = lower['content-security-policy'] ?? '';
  return enforced.includes('script-src') || enforced.includes('default-src');
}

async function openPage(conn, browserContextId, onCspViolation = () => {}, onDocument = () => {}) {
  const { targetId } = await conn.send('Target.createTarget', {
    url: 'about:blank',
    browserContextId,
  });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => conn.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  // Each new document reports its CSP violations through a binding, before any page script runs.
  await send('Runtime.addBinding', { name: CSP_BINDING });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `document.addEventListener('securitypolicyviolation', (e) => {
      try {
        ${CSP_BINDING}(JSON.stringify({ directive: e.violatedDirective, blocked: e.blockedURI,
          source: e.sourceFile, line: e.lineNumber, page: location.pathname }));
      } catch {}
    });`,
  });
  conn.on((msg) => {
    if (
      msg.sessionId === sessionId &&
      msg.method === 'Runtime.bindingCalled' &&
      msg.params.name === CSP_BINDING
    ) {
      try {
        onCspViolation(JSON.parse(msg.params.payload));
      } catch {
        onCspViolation({ directive: 'unreadable report' });
      }
    }
    if (
      msg.sessionId === sessionId &&
      msg.method === 'Network.responseReceived' &&
      msg.params.type === 'Document' &&
      /^https?:/.test(msg.params.response.url)
    ) {
      const url = new URL(msg.params.response.url);
      onDocument({
        origin: url.origin,
        path: url.pathname,
        hasPolicy: hasPagePolicy(msg.params.response.headers),
      });
    }
  });

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

/** The cookies a response sets, by name. */
function cookiesOf(res) {
  const cookies = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return cookies;
}

const AUTH_HEADERS = { 'content-type': 'application/json', 'x-requested-with': 'sirat-web' };

/**
 * Logs in through the API (POST /api/auth/login) and returns the session cookies by name. `secret` is a staff
 * password, or `{ participantId }` for a student or ambassador (they have no password). An admin or manager with
 * two-factor login gets a challenge instead (200 { twoFactorRequired }): the code step follows with the account's
 * secret from apps/web/.e2e-totp.json (lib/totp.mjs; `pnpm --filter @sirat/web e2e:2fa-enrol` writes it).
 */
export async function apiLogin(apiBase, email, secret) {
  const credential = typeof secret === 'object' ? secret : { password: secret };
  const res = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email, ...credential }),
  });
  let cookies;
  if (res.status === 200 && (await res.json().catch(() => null))?.twoFactorRequired) {
    const challenge = cookiesOf(res).sirat_2fa;
    if (!challenge) throw new Error(`login for ${email} set no two-factor challenge cookie`);
    const verify = await fetch(`${apiBase}/api/auth/2fa/verify`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, cookie: `sirat_2fa=${challenge}` },
      body: JSON.stringify({ code: await nextCode(email) }),
    });
    if (verify.status !== 204)
      throw new Error(`the code step for ${email} answered ${verify.status}`);
    cookies = cookiesOf(verify);
  } else if (res.status === 204) {
    cookies = cookiesOf(res);
  } else {
    throw new Error(`login for ${email} answered ${res.status}`);
  }
  if (!cookies.sirat_access) throw new Error(`login for ${email} set no access cookie`);
  return cookies;
}
