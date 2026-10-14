import { GATE_PREFIX } from '@iqb/gate-protocol';
import { escapeHtml, jsonForScriptBlock } from '../html.js';
import type { PageTexts } from './page-texts.js';

export const PAGE_CHALLENGE_PATH = `${GATE_PREFIX}/page-challenge`;
export const PASS_PATH = `${GATE_PREFIX}/pass`;
export const WIDGET_SCRIPT_PATH = `${GATE_PREFIX}/static/altcha.js`;
export const PAGE_GATE_SCRIPT_PATH = `${GATE_PREFIX}/static/page-gate.js`;

/** The widget without its logo and footer link; it starts when the page's script says so. */
const WIDGET_CONFIGURATION = JSON.stringify({ hideLogo: true, hideFooter: true });

/**
 * The interstitial runs the gateway's own scripts and nothing else. The widget computes in workers
 * it creates from blobs, and puts its styles inline.
 */
export const INTERSTITIAL_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

const PAGE_STYLE = `
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
  main { max-width: 32rem; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
  h1 { font-size: 1.4rem; margin: 0; }
  p { margin: 0; line-height: 1.5; }
`;

/** The id of the data block with the status line's texts, which the page and its script share. */
const TEXTS_ID = 'iqb-gate-texts';

/**
 * The page a browser gets instead of the one it asked for, until it holds a pass: the ALTCHA
 * widget solves a challenge by itself, the page hands the solution in and reloads -- the same URL,
 * with its query and its hash, so that the application starts as it would have. The scripts carry
 * their version in the URL, so that they can be cached for good; the texts of the status line
 * therefore travel with the page, as data its script reads (no script runs from the page itself).
 */
export function interstitialPage(widgetVersion: string, scriptVersion: string, texts: PageTexts): string {
  const statusTexts = {
    cookiesBlocked: texts.cookiesBlocked, loading: texts.loading, verified: texts.verified, failed: texts.failed
  };
  return `<!doctype html>
<html lang="${escapeHtml(texts.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(texts.title)}</title>
<style>${PAGE_STYLE}</style>
<script id="${TEXTS_ID}" type="application/json">${jsonForScriptBlock(statusTexts)}</script>
<script src="${WIDGET_SCRIPT_PATH}?v=${widgetVersion}" defer></script>
<script src="${PAGE_GATE_SCRIPT_PATH}?v=${scriptVersion}" defer></script>
</head>
<body>
<main>
  <h1>${escapeHtml(texts.title)}</h1>
  <p>${escapeHtml(texts.intro)}</p>
  <altcha-widget id="iqb-gate-widget" challenge="${PAGE_CHALLENGE_PATH}" auto="off"
                 configuration='${WIDGET_CONFIGURATION}'></altcha-widget>
  <p id="iqb-gate-status" role="status"></p>
  <button id="iqb-gate-continue" type="button" hidden>${escapeHtml(texts.continue)}</button>
  <noscript><p>${escapeHtml(texts.noscript)}</p></noscript>
</main>
</body>
</html>
`;
}

/**
 * Starts the widget, hands its solution in and reloads. It remembers the reload for a minute: a
 * browser that comes back to the interstitial right after it did not keep the pass -- cookies
 * blocked -- and would otherwise solve, reload and solve again without end, using up the challenges
 * of everyone behind the same address. Where nothing can be remembered, the person reloads.
 */
export const PAGE_GATE_SCRIPT = `(() => {
  const KEY = 'iqb-gate-reloaded-at';
  const texts = JSON.parse(document.getElementById('${TEXTS_ID}').textContent);
  const widget = document.getElementById('iqb-gate-widget');
  const status = document.getElementById('iqb-gate-status');
  const proceed = document.getElementById('iqb-gate-continue');
  const remembered = () => {
    try {
      return Number(sessionStorage.getItem(KEY) || 0);
    } catch (error) {
      return null;
    }
  };
  const remember = () => {
    try {
      sessionStorage.setItem(KEY, String(Date.now()));
      return true;
    } catch (error) {
      return false;
    }
  };
  const last = remembered();
  if (last !== null && Date.now() - last < 60000) {
    try { sessionStorage.removeItem(KEY); } catch (error) { /* nothing to forget */ }
    status.textContent = texts.cookiesBlocked;
    return;
  }
  widget.addEventListener('verified', async event => {
    status.textContent = texts.loading;
    try {
      const response = await fetch('${PASS_PATH}', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: event.detail.payload }),
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error(String(response.status));
      if (remember()) {
        location.reload();
      } else {
        status.textContent = texts.verified;
        proceed.hidden = false;
        proceed.addEventListener('click', () => location.reload());
      }
    } catch (error) {
      status.textContent = texts.failed;
    }
  });
  customElements.whenDefined('altcha-widget').then(() => widget.verify());
})();
`;

/** The page a client gets that the policy keeps out. */
export function deniedPage(texts: PageTexts): string {
  return `<!doctype html>
<html lang="${escapeHtml(texts.lang)}">
<head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${escapeHtml(texts.deniedTitle)}</title></head>
<body><p>${escapeHtml(texts.denied)}</p></body>
</html>
`;
}
