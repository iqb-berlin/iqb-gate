# Trying iqb-gate locally

A page that logs in with Keycloak and saves through the gateway: the OpenID Connect login of
`@iqb/gate-angular`, the token checked by `@iqb/gate-nest`, the ALTCHA challenge of the write gate,
and the audit log naming the writer as checked.

**Local only.** The realm allows plain http, lets scripts trade a password for a token (direct
grants, so that a token can be fetched with curl for a quick check) and knows a user with a
password everyone can read. Nothing here is a model for a server: for that, see
`packages/gateway/gate.example.yaml` and the main README.

| Part | Where |
|---|---|
| Keycloak (realm `iqb-demo`, client `iqb-gate-demo`, user `anna` / `anna` with the role `editor`) | http://localhost:8180 |
| `demo-api`: NestJS, the notes behind `OidcAuthGuard`, and the page | 127.0.0.1:3100 -- reached only through the gateway |
| the gateway in front of it (`gate.yaml`) | http://localhost:8088 |

```bash
npm ci && npm run build && npm run build:examples   # in the repository root
docker compose -p iqb-gate-demo -f examples/docker-compose.yaml up -d
node examples/demo-api/dist/main.js &
IQB_GATE_UPSTREAM=http://127.0.0.1:3100 IQB_GATE_HOST=127.0.0.1 IQB_GATE_PORT=8088 \
IQB_GATE_SECRET=$(openssl rand -hex 32) IQB_GATE_AUDIT_KEY=$(openssl rand -hex 32 | tee /tmp/iqb-gate-demo.key) \
IQB_GATE_AUDIT_FILE=/tmp/iqb-gate-demo.sqlite IQB_GATE_CONFIG=examples/gate.yaml \
node packages/gateway/dist/main.js
```

1. Open http://localhost:8088/, click **Anmelden**, and log in at Keycloak as `anna` / `anna`.
2. Write a note and click **Speichern**: the first save of the session asks for the ALTCHA challenge,
   then goes through ("Gespeichert von anna"). A second save goes through at once.
3. Open http://localhost:8088/.iqb-gate/admin/ -- any user name, the audit key from
   `/tmp/iqb-gate-demo.key` as password -- and find the save as **anna ✓**.

Only users with the realm role `editor` may use the notes; anyone else is logged in, but gets 403
(`userSync` in `demo-api/src/app.module.ts`). The issuer is written in three places that have to
agree: `gate.yaml`, `demo/src/main.ts`, `demo-api/src/app.module.ts`.
`docker compose -p iqb-gate-demo -f examples/docker-compose.yaml down` removes Keycloak again.
