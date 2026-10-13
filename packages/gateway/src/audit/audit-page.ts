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
<title>iqb-gate · Zugriffe</title>
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
<h1>Zugriffe</h1>
<p class="hint">Alle geprüften Schreibzugriffe und die abgelehnten Lesezugriffe (GET), die neuesten zuerst.
Ein Nutzer mit &#10003; stammt aus einem Token,
das das Gateway beim Anmeldedienst geprüft hat. Ohne &#10003; stammt er ungeprüft aus dem Token der Anfrage;
verlässlich ist er dann nur bei einem Status 2xx &ndash; dann hat die Anwendung das Token angenommen.</p>
<form id="filter">
  <label>Von <input type="date" name="from"></label>
  <label>Bis <input type="date" name="to"></label>
  <label>Sitzung <input type="text" name="session" size="26"></label>
  <label>Anzahl <input type="number" name="limit" value="200" min="1" max="1000"></label>
  <button type="submit">Anzeigen</button>
</form>
<p class="status" id="status"></p>
<div class="table-wrap">
<table>
  <thead><tr>
    <th>Zeit</th><th>Nutzer</th><th>Methode</th><th>Pfad</th><th>Regel</th><th>Status</th>
    <th>Ergebnis</th><th>Signale</th><th>Sitzung</th>
  </tr></thead>
  <tbody id="entries"></tbody>
</table>
</div>
<script>
  const OUTCOMES = {
    'allowed': 'durchgelassen',
    'automation-detected': 'Automatisierung erkannt',
    'verification-required': 'Bestätigung verlangt'
  };
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
    if (entry.user) td.title = entry.userVerified ? 'beim Anmeldedienst geprüft' : 'ungeprüft';
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
    const outcome = (OUTCOMES[entry.outcome] || entry.outcome) + (entry.repeated ? ' (+' + entry.repeated + ')' : '');
    tr.append(
      cell(new Date(entry.createdAt).toLocaleString('de-DE')),
      userCell(entry),
      cell(entry.method),
      cell(entry.path, 'path'),
      cell(entry.rule),
      cell(String(entry.statusCode)),
      cell(outcome, 'outcome-' + entry.outcome),
      signalsCell(entry),
      cell(entry.sessionId ? entry.sessionId.slice(0, 8) : 'keine', 'session')
    );
    tr.lastChild.title = entry.sessionId || 'Die Anfrage brachte keine Sitzung mit.';
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
    status.textContent = 'Lade …';
    try {
      const response = await fetch('audit?' + query, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Status ' + response.status);
      const entries = await response.json();
      body.replaceChildren(...entries.map(row));
      status.textContent = entries.length + ' Einträge';
    } catch (error) {
      status.textContent = 'Das Protokoll konnte nicht geladen werden (' + error.message + ').';
    }
  }

  form.addEventListener('submit', event => { event.preventDefault(); load(); });
  load();
</script>
</body>
</html>
`;
