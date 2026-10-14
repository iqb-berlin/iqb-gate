import { escapeHtml, jsonForScriptBlock } from '../html.js';

/** What the audit page says -- for the administrators of an installation, in German. */
const TEXTS = {
  title: 'iqb-gate · Zugriffe',
  heading: 'Zugriffe',
  hint: 'Alle geprüften Schreibzugriffe und die abgelehnten Lesezugriffe (GET), die neuesten zuerst. '
    + 'Ein Nutzer mit ✓ stammt aus einem Token, das das Gateway beim Anmeldedienst geprüft hat. Ohne ✓ stammt '
    + 'er ungeprüft aus dem Token der Anfrage; verlässlich ist er dann nur bei einem Status 2xx – dann hat die '
    + 'Anwendung das Token angenommen. Gleiche Ablehnungen von derselben Adresse innerhalb einer Minute stehen in '
    + 'einem Eintrag mit ihrer Anzahl; er zeigt Sitzung, Nutzer und Pfad der ersten, und nur nach dieser '
    + 'Sitzung lässt er sich suchen.',
  from: 'Von',
  to: 'Bis',
  session: 'Sitzung',
  limit: 'Anzahl',
  show: 'Anzeigen',
  columns: ['Zeit', 'Nutzer', 'Methode', 'Pfad', 'Regel', 'Status', 'Ergebnis', 'Signale', 'Sitzung'],
  /** Read by the page's script. */
  script: {
    outcomes: {
      'allowed': 'durchgelassen',
      'automation-detected': 'Automatisierung erkannt',
      'verification-required': 'Bestätigung verlangt'
    },
    userVerified: 'beim Anmeldedienst geprüft',
    userUnverified: 'ungeprüft',
    noSession: 'keine',
    noSessionHint: 'Die Anfrage brachte keine Sitzung mit.',
    loading: 'Lade …',
    entries: 'Einträge',
    loadFailed: 'Das Protokoll konnte nicht geladen werden'
  }
};

/**
 * The audit page at `/.iqb-gate/admin/`: a table of the checked writes and refused reads, read from
 * `/.iqb-gate/admin/audit` with the credentials the browser asked for. Everything that comes from
 * the log is put in as text, never as HTML: paths and user claims are what clients sent.
 */
export const AUDIT_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

export const AUDIT_PAGE = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(TEXTS.title)}</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; font-size: 14px; }
  body { margin: 16px; }
  h1 { font-size: 1.3rem; margin: 0 0 4px; }
  .hint { color: GrayText; margin: 0 0 12px; max-width: 70ch; }
  form { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: end; margin-bottom: 12px; }
  label { display: flex; flex-direction: column; gap: 2px; }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid color-mix(in srgb, CanvasText 15%, Canvas); }
  th { position: sticky; top: 0; background: Canvas; }
  td { vertical-align: top; }
  .path, .session { font-family: ui-monospace, monospace; word-break: break-all; }
  .outcome-allowed { color: green; }
  .outcome-automation-detected, .outcome-verification-required { color: #b3261e; }
  .blocking { font-weight: 600; }
  .status { margin: 8px 0; }
</style>
</head>
<body>
<h1>${escapeHtml(TEXTS.heading)}</h1>
<p class="hint">${escapeHtml(TEXTS.hint)}</p>
<form id="filter">
  <label>${escapeHtml(TEXTS.from)} <input type="date" name="from"></label>
  <label>${escapeHtml(TEXTS.to)} <input type="date" name="to"></label>
  <label>${escapeHtml(TEXTS.session)} <input type="text" name="session" size="26"></label>
  <label>${escapeHtml(TEXTS.limit)} <input type="number" name="limit" value="200" min="1" max="1000"></label>
  <button type="submit">${escapeHtml(TEXTS.show)}</button>
</form>
<p class="status" id="status"></p>
<div class="table-wrap">
<table>
  <thead><tr>
    ${TEXTS.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}
  </tr></thead>
  <tbody id="entries"></tbody>
</table>
</div>
<script>
  const TEXTS = ${jsonForScriptBlock(TEXTS.script)};
  const form = document.getElementById('filter');
  const status = document.getElementById('status');
  const body = document.getElementById('entries');

  function cell(text, className) {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function userCell(entry) {
    const td = cell(entry.user ? entry.user + (entry.userVerified ? ' \u2713' : '') : '–');
    if (entry.user) td.title = entry.userVerified ? TEXTS.userVerified : TEXTS.userUnverified;
    return td;
  }

  function signalsCell(entry) {
    const td = document.createElement('td');
    entry.blockingSignals.forEach(signal => {
      const span = document.createElement('span');
      span.className = 'blocking';
      span.textContent = signal + ' ';
      td.append(span);
    });
    td.append(document.createTextNode(entry.loggedSignals.join(' ')));
    return td;
  }

  function row(entry) {
    const tr = document.createElement('tr');
    const repeats = entry.repeated ? ' (+' + entry.repeated + ')' : '';
    const outcome = (TEXTS.outcomes[entry.outcome] || entry.outcome) + repeats;
    tr.append(
      cell(new Date(entry.createdAt).toLocaleString('de-DE')),
      userCell(entry),
      cell(entry.method),
      cell(entry.path, 'path'),
      cell(entry.rule),
      cell(String(entry.statusCode)),
      cell(outcome, 'outcome-' + entry.outcome),
      signalsCell(entry),
      cell(entry.sessionId ? entry.sessionId.slice(0, 8) : TEXTS.noSession, 'session')
    );
    tr.lastChild.title = entry.sessionId || TEXTS.noSessionHint;
    return tr;
  }

  /** A day picked in the form, as the moment it starts or ends here -- the table shows local times too. */
  function localBound(day, end) {
    const [year, month, date] = day.split('-').map(Number);
    return (end ? new Date(year, month - 1, date, 23, 59, 59, 999) : new Date(year, month - 1, date)).toISOString();
  }

  async function load() {
    const query = new URLSearchParams();
    new FormData(form).forEach((value, name) => {
      if (!value) return;
      query.set(name, name === 'from' || name === 'to' ? localBound(value, name === 'to') : value);
    });
    status.textContent = TEXTS.loading;
    try {
      const response = await fetch('audit?' + query, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Status ' + response.status);
      const entries = await response.json();
      body.replaceChildren(...entries.map(row));
      status.textContent = entries.length + ' ' + TEXTS.entries;
    } catch (error) {
      status.textContent = TEXTS.loadFailed + ' (' + error.message + ').';
    }
  }

  form.addEventListener('submit', event => { event.preventDefault(); load(); });
  load();
</script>
</body>
</html>
`;
