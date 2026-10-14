# The gateway behind Traefik

Traefik asks the gateway about every request to the application (ForwardAuth) and streams the
request to it itself once the gateway answers 200. The application is
[traefik/whoami](https://github.com/traefik/whoami): it answers with what it received.

**Local only:** Traefik's own self-signed certificate, the Docker socket in Traefik. With rootless
Docker, name its socket: `DOCKER_SOCKET=/run/user/$(id -u)/docker.sock`.

```bash
docker build -f packages/gateway/Dockerfile -t iqb-gate:local .   # in the repository root
IQB_GATE_SECRET=$(openssl rand -hex 32) IQB_GATE_AUDIT_KEY=$(openssl rand -hex 32 | tee /tmp/iqb-gate-traefik.key) \
  docker compose -p iqb-gate-traefik -f examples/traefik/docker-compose.yaml up -d
```

1. Open https://localhost:8443/ (accept the certificate): the page gate's interstitial, at that
   address, then whoami's answer.
2. `curl -k -X POST https://localhost:8443/api/notes` gets 403 from the gateway -- no browser
   report. With `-H 'x-client-signals: {}'` it gets 428 and a session cookie: the challenge comes
   first, see the main README.
3. `curl -k https://localhost:8443/whatever -H 'X-Forwarded-Uri: /.iqb-gate/x'` changes nothing:
   Traefik replaces what a client claims (`trustForwardHeader=false`).
4. https://localhost:8443/.iqb-gate/admin/ -- any user name, the key from
   `/tmp/iqb-gate-traefik.key` -- shows what was refused.

`docker compose -p iqb-gate-traefik -f examples/traefik/docker-compose.yaml down` removes it again.
