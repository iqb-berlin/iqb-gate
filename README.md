# iqb-gate

A security gateway for the IQB applications -- studio-lite, Testcenter and coding-box. It sits in
front of an application as a reverse proxy and will offer, step by step:

1. **a transparent proxy** -- streaming, WebSockets, server-sent events, timeouts per path *(done)*
2. **ALTCHA for writes** -- saves matched by path rules come only from people: proof-of-work,
   client signals, a burst limit and an audit log, plus the Angular library `@iqb/gate-angular`
   *(done)*
3. **a page gate** in the manner of Anubis -- a proof-of-work page before the application loads
4. **OpenID Connect** -- login in the browser, Bearer tokens checked against the provider's JWKS
   (`@iqb/gate-nest` for NestJS backends)

The gateway owns the paths below `/.iqb-gate/`; everything else goes to the application.

## Packages

| Package | What it is |
|---|---|
| `packages/gateway` | the reverse proxy (Node 24, Fastify), shipped as a Docker image |
| `packages/protocol` | what the gateway and the browser agree on: header, paths, status codes, types |
| `packages/angular` | `@iqb/gate-angular`: the browser half for Angular 20 and 21 applications |

## Running the gateway

```bash
docker build -f packages/gateway/Dockerfile -t iqb-gate:local .
docker run -p 8088:8080 -e IQB_GATE_UPSTREAM=http://frontend:8080 iqb-gate:local
```

| Variable | Default | Meaning |
|---|---|---|
| `IQB_GATE_UPSTREAM` | -- (required) | origin of the application, e.g. `http://frontend:8080` |
| `IQB_GATE_PORT` | `8080` | port the gateway listens on |
| `IQB_GATE_HOST` | `0.0.0.0` | address the gateway listens on |
| `IQB_GATE_TRUST_PROXY` | `false` | `true`, or a comma-separated list of addresses/CIDRs, when a proxy such as Traefik sits in front and its `X-Forwarded-*` is to be believed |
| `IQB_GATE_CONFIG` | -- | path of a YAML file with timeouts and write rules, see `packages/gateway/gate.example.yaml` |
| `IQB_GATE_ENFORCE` | `on` | `off` checks no write -- for test runs with Cypress, which the check would keep out |
| `IQB_GATE_SECRET` | -- (required with write rules) | at least 32 characters; signs the session cookie and the challenges |
| `IQB_GATE_AUDIT_KEY` | -- | at least 32 characters; without it there is no audit page |
| `IQB_GATE_AUDIT_FILE` | `/var/lib/iqb-gate/audit.sqlite` | the audit log (SQLite); the image declares the directory a volume |
| `IQB_GATE_AUDIT_RETENTION_DAYS` | `90` | how long audit entries are kept |

**Timeouts** are the time the application may stay silent -- like nginx's `proxy_read_timeout` --
not a limit on the whole transfer: an upload that keeps moving may take as long as it needs. A
request gets the timeout of the longest prefix its path lies in (`/api/upload` covers
`/api/upload/x`, not `/api/uploads`). When the application stays silent longer, the client gets
504; when it cannot be reached, 502. The configuration file is checked strictly: an unknown key or
a wrong shape stops the gateway at start instead of falling back to a default.

**Bodies are streamed** in both directions, never buffered and never limited by the gateway; the
application keeps its own limits. The gateway neither retries a request nor limits the number of
parallel connections to the application: what the application answers, the client gets.

**Headers:** the application gets `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`, on
HTTP requests and WebSocket handshakes alike. What a client claims about its origin (`Forwarded`,
`X-Real-IP`, `X-Forwarded-*`) is believed only from a proxy named in `IQB_GATE_TRUST_PROXY`;
from anyone else it is replaced by the address that connected. Headers named `X-Iqb-Gate-*` are
reserved for the gateway; a client's are dropped.

**Health:** `GET /.iqb-gate/health` answers `{"status":"ok"}`. The image's `HEALTHCHECK` asks it on
the configured host and port.

**Stopping:** on `SIGTERM` the gateway stops accepting requests and gives open ones 8 seconds --
below Docker's default of 10 -- before it cuts them.

## Writes only from people

Writes (POST, PUT, PATCH, DELETE) whose path matches a rule in `writeGate.rules` go through only
when they come from a person:

1. **The browser's report** (`x-client-signals`, sent by `@iqb/gate-angular`): a browser that says it
   is automated (`navigator.webdriver`, headless) or a client that sends no report is answered **403**
   `automation-detected`. Input dispatched by a script asks for a fresh challenge instead -- password
   managers do that too.
2. **A solved challenge:** the session (the gateway's cookie `iqb-gate-session`, `__Host-` and `Secure`
   over HTTPS) has to have solved an ALTCHA proof-of-work. Until then the write is answered **428**
   `human-verification-required`; the library then fetches `GET /.iqb-gate/challenge`, lets the
   person tick the box, hands the solution in at `POST /.iqb-gate/verify` and repeats the write. A
   challenge costs the gateway a key derivation: it is handed out only to a session the gateway
   started (with a 428), and to one client address at most 30 times a minute (429 beyond).
3. **A burst limit:** more than `burst.limit` writes within `burst.windowSeconds` ask for a new
   challenge.

Rules are regular expressions, matched without regard to case and against the path as sent and as
the application reads it (decoded, `//` and `./` resolved), so `/API/%61dmin` does not slip past a
rule for `/api/admin`. An exemption has to match both. `bearerPrefix` exempts script tokens that the
application checks itself. The report is the client's word: a script written to fake it and to
solve the proof-of-work gets through, slowed down by the burst limit; the audit log is what remains
against it.

**Audit log:** every checked write is recorded once its answer is final -- time, session, the writer
named by `writeGate.userClaim` from the Bearer JWT (unverified: trustworthy only with a 2xx status,
when the application accepted the token), method, path without the query, rule, status (499 when
the client left), outcome and observations. Identical rejections within a minute -- same session,
writer, rule, outcome and observations, whatever the path -- are folded into one entry with their
count, also those of a client that keeps no cookie, so a script in a loop cannot flood the log. Read it at `/.iqb-gate/admin/` (the audit key as password, any user name) or as JSON
at `/.iqb-gate/admin/audit?from=&to=&session=&limit=` (the key as Bearer token).

**Keep the application unreachable around the gateway:** publish no ports of the application's
containers, and route every path of the host through the gateway.

## In an Angular application

`@iqb/gate-angular` sends the browser's report with every write to its own origin and, when the
gateway answers 428, shows the ALTCHA challenge in a Material dialog and repeats the write. It is
built with Angular 20 in partial compilation, so Angular 20 and 21 applications can use it.

```typescript
bootstrapApplication(AppComponent, {
  providers: [
    provideIqbGate({
      // optional: the application's own texts instead of the library's German ones, asked for
      // whenever the dialog opens -- e.g. from ngx-translate
      texts: () => {
        const translate = inject(TranslateService);
        return { title: translate.instant('human-verification.title') };
      }
    }),
    // after the interceptor that adds the token, so that a repeated write carries it as well
    provideHttpClient(withInterceptors([authInterceptor, iqbGateInterceptor]))
  ]
});
```

Applications that register interceptors as classes use `IqbGateInterceptor` with
`HTTP_INTERCEPTORS` instead. `isAutomationDetected(error)` recognises the gateway's 403, for a
message of the application's own. Requests to other origins (an identity provider) and to the
gateway's own paths are left untouched. The widget (`altcha`) is loaded only when a challenge is
due; the page needs `worker-src 'self' blob:` in its Content Security Policy.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```
