# iqb-gate

A security gateway for the IQB applications -- studio-lite, Testcenter and coding-box. It sits in
front of an application as a reverse proxy and will offer, step by step:

1. **a transparent proxy** -- streaming, WebSockets, server-sent events, timeouts per path *(done)*
2. **ALTCHA for writes** -- saves matched by path rules come only from people: proof-of-work,
   client signals, a burst limit and an audit log, plus the Angular library `@iqb/gate-angular`
3. **a page gate** in the manner of Anubis -- a proof-of-work page before the application loads
4. **OpenID Connect** -- login in the browser, Bearer tokens checked against the provider's JWKS
   (`@iqb/gate-nest` for NestJS backends)

The gateway owns the paths below `/.iqb-gate/`; everything else goes to the application.

## Packages

| Package | What it is |
|---|---|
| `packages/gateway` | the reverse proxy (Node 24, Fastify), shipped as a Docker image |

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
| `IQB_GATE_CONFIG` | -- | path of a YAML file with the timeouts, see `packages/gateway/gate.example.yaml` |

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

**Keep the application unreachable around the gateway:** publish no ports of the application's
containers, and route every path of the host through the gateway.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```
