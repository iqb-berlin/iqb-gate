# iqb-gate

A security gateway for the IQB applications -- studio-lite, Testcenter and coding-box. It sits in
front of an application as a reverse proxy and will offer, step by step:

1. **a transparent proxy** -- streaming, WebSockets, server-sent events, timeouts and upstreams per path *(done)*
2. **ALTCHA for writes** -- saves matched by path rules come only from people: proof-of-work,
   client signals, a burst limit and an audit log, plus the Angular library `@iqb/gate-angular`
   *(done)*
3. **a page gate** in the manner of Anubis -- a proof-of-work page before the application loads *(done)*
4. **reads only from people** -- API reads matched by path rules only from a person's browser, with the
   challenge of the same session and a read limit *(done)*
5. **OpenID Connect** -- login in the browser, Bearer tokens checked against the provider's JWKS
   (`@iqb/gate-oidc`, `@iqb/gate-nest` for NestJS backends, `provideIqbOidc` in the browser) *(done)*

The gateway owns the paths below `/.iqb-gate/`; everything else goes to the application.

## Packages

| Package | What it is |
|---|---|
| `packages/gateway` | the reverse proxy (Node 24, Fastify), shipped as a Docker image |
| `packages/protocol` | what the gateway and the browser agree on: header, paths, status codes, types (ES modules and CommonJS) |
| `packages/oidc` | `@iqb/gate-oidc`: checks OpenID Connect access tokens against the provider's keys (Node) |
| `packages/nest` | `@iqb/gate-nest`: the same for NestJS backends -- a module, a guard, a parameter decorator |
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
| `IQB_GATE_TRUST_PROXY` | `false` | the proxies in front (Traefik) whose `X-Forwarded-*` is believed, as comma-separated addresses or CIDRs, e.g. `172.16.0.0/12`; `true` is refused, as it would believe any client's `X-Forwarded-For` |
| `IQB_GATE_CONFIG` | -- | path of a YAML file with upstreams per path, timeouts, write and read rules, see `packages/gateway/gate.example.yaml` |
| `IQB_GATE_ENFORCE` | `on` | `off` switches off every gate -- for test runs with Cypress, which they would keep out |
| `IQB_GATE_RULES_OFF` | -- | names of write rules to switch off, comma-separated, e.g. `workspace`; their writes pass unchecked and no rule further down takes them. A name no rule has stops the gateway at start |
| `IQB_GATE_READ_RULES_OFF` | -- | the same for read rules (`readGate.rules`), independent of the write rules |
| `IQB_GATE_SECRET` | -- (required with write or read rules or the page gate) | at least 32 characters; signs cookies, passes and challenges |
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
   started (with a 428), and to one client address at most `challenges.perAddressAndMinute` times a
   minute (120 by default, 429 beyond).
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
the client left), outcome and observations. Identical rejections within a minute -- same client
address, rule, outcome and observations, and the same person where the gateway verified one -- are
folded into one entry with their count, whatever the path, session or unverified name. A script in a
loop that fetches a fresh cookie or makes up a name for every request cannot flood the log; people
behind one school address who are refused alike in the same minute share an entry.
Refused reads go into the same log (see below). Read it at `/.iqb-gate/admin/` (the audit key as
password, any user name) or as JSON at `/.iqb-gate/admin/audit?from=&to=&session=&limit=` (the key as
Bearer token). The SQLite table is `audit`; a log file from before reads were checked has its
`write_audit` renamed at start, keeping its entries -- an older gateway cannot read it afterwards.

## Reads only from people

Reads (GET, HEAD) whose path matches a rule in `readGate.rules` go through only when they come from
a person's browser -- an agent or a script that was handed a token cannot read the data:

1. **The browser's report**, as for writes: a browser that says it is automated, or a client that
   sends no report, is answered **403** `automation-detected`. Input dispatched by a script and the
   time since the last input say nothing about a read and are not held against it.
2. **A solved challenge of the session:** the same session state as for writes, so the challenge of
   the login counts for every read after it -- a person solves one challenge per session, not one per
   page. Until then **428**, and the library asks for the challenge as for a write.
3. **A read limit** (`readGate.limit`, 600 reads within 60 seconds by default): a session that reads
   faster than a person loses its verification, for its writes as well.

Rules, exemptions (`path`, `bearerPrefix`; no method) and `IQB_GATE_READ_RULES_OFF` work as for
writes. Public reads that a page makes before the login, and files that something else than the
application's HTTP client loads (a script tag in an embedded module), need an exemption: they carry
no report. A refused read is written to the audit log, folded like a refused write; a read let
through is not -- a person reads hundreds of times an hour. Checking a read costs the gateway a
header parse and a look into its memory, no key derivation.

## Checking OpenID Connect tokens

`@iqb/gate-oidc` checks the access tokens of one provider, framework-free, for the gateway and for
backends:

```typescript
const verifier = new OidcVerifier({ issuer: 'https://login.example.org/realms/iqb', clientId: 'studio' });
const identity = await verifier.verify(token); // OidcIdentity, or null for any token that does not hold
```

It finds the provider's keys through its discovery document (or `jwksUri`), keeps them and fetches
them again for an unknown key id; it accepts asymmetric signatures only (no `none`, no shared
secrets) and checks the issuer, the expiry (a token without one is refused), that it is an access
token -- Keycloak's `typ`, the header type, and no claim only ID tokens carry (`at_hash`, `c_hash`) --
and, when given, that the client is named in `aud` or as `azp`, and the `audience`. With a provider
other than Keycloak, configure `audience` (the API's own): its ID tokens name the client in `aud` as
well, so `clientId` alone cannot tell them from access tokens. `identity` holds issuer, subject, a username (`preferred_username`, else
e-mail, else subject), e-mail, names and roles (Keycloak's realm and client roles). It never throws
for a bad token; `onRejected` hears why.

In a NestJS backend (Nest 11), `@iqb/gate-nest` does it for the routes:

```typescript
@Module({
  imports: [
    IqbOidcModule.forRootAsync({
      imports: [ConfigModule, UsersModule],
      inject: [ConfigService, UsersService],
      useFactory: (config: ConfigService, users: UsersService) => ({
        issuer: config.getOrThrow('OIDC_ISSUER'),
        clientId: config.getOrThrow('OIDC_CLIENT_ID'),
        // the application's own user: found or created by issuer and subject; null keeps the person out
        userSync: { sync: identity => users.syncOidcUser(identity) }
      })
    })
  ]
})
export class AppModule {}

@UseGuards(OidcAuthGuard)
@Get('me')
me(@OidcIdentity() identity: OidcIdentityData, @Req() request: { user: User }) { ... }
```

`OidcAuthGuard` answers 401 for a request without a valid token of the provider, and 403 for a
person the `userSync` does not take -- known, but not let in, so that the browser does not take it
for an expired login. Alike in every module and as global guard, as the module sets both up itself. `@OidcIdentity()` refuses a route the guard did not check. Only HTTP requests are let in. An
application that checks further tokens of its own in one strategy (coding-box: workspace tokens)
injects the verifier as `OIDC_VERIFIER` there. The package is CommonJS, as Nest applications are,
and needs Node 22.12 or later.

With an `oidc` section in its configuration, the gateway checks the Bearer token of every checked
write that way and names the person in the audit log, marked as checked. It never decides about the
write because of the token -- the application does.

## Pages only for browsers that do the work

With `pageGate.enabled`, a browser that opens a page over HTTPS gets, instead of the page, a short
interstitial: the ALTCHA widget (served by the gateway itself) solves a proof-of-work without a click,
the page exchanges the solution at `POST /.iqb-gate/pass` for a pass cookie
(`__Host-iqb-gate-pass`, signed, bound to the browser's User-Agent, `passDays` long) and reloads --
the same URL with its query and hash, so a login redirect (`?code=&state=`) carries on. A person
waits about a second, once a week; a scraper that opens pages by the thousand pays for every one.

- **Only navigations** (`Sec-Fetch-Mode: navigate`, or `Accept: text/html` from clients that do not
  say): API calls, assets, WebSockets and frames pass untouched -- they need the application's own
  login anyway.
- **Only over HTTPS**, as the widget needs a secure context: over plain HTTP everything passes, so local
  setups keep working. The gateway learns of HTTPS from the proxy in front that ends TLS, so the page
  gate requires `IQB_GATE_TRUST_PROXY` to name it.
- **A policy** (`pageGate.policy`) lets the first matching rule `allow`, `deny` (403) or `challenge`,
  by User-Agent and path; see `gate.example.yaml`. `deny` applies to every request, not only to
  pages -- a crawler need not ask for HTML. A rule's path matches the path as sent and as the
  application reads it: `allow` needs both, `deny` and `challenge` either.
- **A browser that does not keep the pass** (cookies blocked) is told so after one reload, instead of
  solving and reloading without end.
- **Challenges** cost the gateway a key derivation and go to one client address at most
  `challengesPerAddressAndMinute` times (120 by default -- a class behind one school address).
  They are signed for the page gate alone: a solution counts neither twice nor for the write gate.
- **Monitoring** that fetches pages with `Accept: text/html` needs an `allow` rule, or uses
  `/.iqb-gate/health`.

**Keep the application unreachable around the gateway:** publish no ports of the application's
containers, and route every path of the host through the gateway.

## In an Angular application

`@iqb/gate-angular` sends the browser's report with every request to its own origin and, when the
gateway answers 428, shows the ALTCHA challenge in a Material dialog and repeats the request. When the
gateway refuses the browser as automated, or asks again right after a solved challenge, a dialog of
its own says so (`GateRefusalNoticeService`, one for all requests refused at once); a challenge the
person cancelled is not announced. It is built with Angular 20 in partial compilation, so Angular 20
and 21 applications can use it.

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

**Logging in with OpenID Connect** -- as coding-box does with Keycloak, for any provider:

```typescript
provideIqbOidc({
  issuer: 'https://login.example.org/realms/iqb',
  clientId: 'studio',          // a public client with the code flow and PKCE
  apiUrls: ['/api/']           // the access token goes to these, and nowhere else
}),
provideHttpClient(withInterceptors([...iqbOidcInterceptors(), iqbGateInterceptor]))
```

The browser logs in with the code flow and PKCE (`IqbOidcService.login()`), keeps the tokens and
renews them with the refresh token; at the start of the application it takes over a login it comes
back from (`?code=&state=`), and starts logged out should the provider fail or not answer within
10 seconds. Each API URL has to end with `/`, so that the token cannot leak to a host that only
begins alike.

When an API refuses the token a request carried, the session is renewed once -- one renewal for all
requests refused at once -- and the request repeated. Should that not help, the browser goes to the
login, at most once in 30 seconds (kept across the page change, so an API that keeps refusing cannot
send it back and forth), and comes back to the page it was on. A request whose 401 the application
answers itself (a password it asks for) carries `IQB_OIDC_OWN_UNAUTHORIZED` in its `HttpContext` and
keeps its 401. `IqbOidcService` gives `isAuthenticated$`, `identity$` (subject, username, e-mail, and
the realm roles of the access token -- for the view; what they allow, the backend decides),
`login()` and `logout()`, which drops the tokens and ends the provider's session even if they cannot
be revoked. Built on `angular-auth-oidc-client`; the application needs `@angular/router`. The
backends check the token with `@iqb/gate-nest` or `@iqb/gate-oidc`.

Applications that register interceptors as classes use `IqbGateInterceptor` with
`HTTP_INTERCEPTORS` instead. `isGateRefusal(error)` tells an error the gateway caused -- the
library has already said why -- so that the application leaves it out of its own error display;
`gateRefusalOf(error)` and `isAutomationDetected(error)` name it. `@iqb/gate-protocol` ships CommonJS
beside its ES modules, so Jest loads it without a `transformIgnorePatterns` entry. Requests to other origins (an identity provider) and to the
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
