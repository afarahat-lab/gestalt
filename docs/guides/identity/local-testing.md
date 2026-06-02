# Local identity testing — Keycloak fixture

Exercise the SAML + OIDC providers (ADR-040) end-to-end without
needing customer IdP credentials. Useful for:

- Verifying provider changes after touching
  `packages/server/src/auth/providers/`
- Smoke-testing a new attribute-mapping configuration
- Reproducing customer IdP issues against a local realm

The Kerberos provider isn't exercised here — it requires a real
Active Directory + keytab. Stage-1 (no-regression) only.

## Prerequisites

The main Gestalt stack must be up:

```bash
docker-compose up -d
```

## 1 — Bring up the Keycloak fixture

```bash
docker-compose -f fixtures/identity-test/docker-compose.yml up -d
```

Wait ~20 seconds for the realm to import. Verify:

```bash
curl -sf http://localhost:8080/realms/gestalt-test | python3 -c '
import json, sys
print("realm:", json.load(sys.stdin)["realm"])
'
# → realm: gestalt-test
```

Realm contents:

| Resource | Detail |
|---|---|
| OIDC client | `gestalt-oidc` / secret `gestalt-oidc-secret` / PKCE / `groups` claim mapper |
| SAML client | entity ID `http://localhost:3000` / signed assertions / `email` + `displayName` + `groups` attributes |
| Users | `alice/alice123` in `gestalt-admins`; `bob/bob123` in `users` |

## 2 — Write `auth.config.json` with the live SAML cert

Keycloak regenerates its signing key when the container is
recreated, so the cert must be fetched live:

```bash
SAML_CERT=$(docker exec gestalt-server-1 curl -sf \
  http://gestalt-keycloak:8080/realms/gestalt-test/protocol/saml/descriptor \
  | grep -oE '<ds:X509Certificate>[^<]+</ds:X509Certificate>' \
  | head -1 | sed 's|<[^>]*>||g')

sed "s|REPLACE_WITH_CERT.*|$SAML_CERT|" \
    fixtures/identity-test/auth.config.json.example > /tmp/auth.config.json

docker cp /tmp/auth.config.json gestalt-server-1:/app/auth.config.json
docker-compose restart server
sleep 6
```

Confirm both providers register:

```bash
curl -sf http://localhost:3000/auth/providers
# → {"providers":["saml","oidc","local"]}
```

## 3 — Run the smoke tests

Both scripts run **inside the gestalt-server-1 container** so
they use docker DNS (`gestalt-keycloak:8080`) consistently —
running from the host would resolve to `localhost:8080` and
Keycloak would claim a different issuer URL in tokens.

```bash
# Install curl in the alpine-based gestalt-server image (one-time)
docker exec -u root gestalt-server-1 apk add --no-cache curl

# OIDC: 7-step PKCE flow
docker cp fixtures/identity-test/oidc-flow.sh gestalt-server-1:/tmp/oidc-flow.sh
docker exec -u root gestalt-server-1 chmod +x /tmp/oidc-flow.sh
docker exec gestalt-server-1 /tmp/oidc-flow.sh

# SAML: assertion + signature validation
docker cp fixtures/identity-test/saml-flow.sh gestalt-server-1:/tmp/saml-flow.sh
docker exec -u root gestalt-server-1 chmod +x /tmp/saml-flow.sh
docker exec gestalt-server-1 /tmp/saml-flow.sh
```

Each script prints 7 step lines and ends with a JWT (~275 chars).
Decode the JWT to confirm the role mapping:

```bash
docker exec gestalt-server-1 cat /tmp/jwt.txt | python3 -c '
import sys, base64, json
parts = sys.stdin.read().strip().split(".")
b64 = lambda s: json.loads(base64.urlsafe_b64decode(s + "="*(4-len(s)%4)))
print(b64(parts[1]))
'
```

Expected payload for alice (both providers):

```python
{'email': 'alice@gestalt-test.local',
 'role': 'platform-admin',          # resolved from gestalt-admins group
 'provider': 'oidc',                # or 'saml'
 'sub': '...',
 'iat': ..., 'exp': ...}
```

Confirm DB shadow user upsert:

```bash
docker exec gestalt-postgres-1 psql -U gestalt -d gestalt -c \
  "SELECT email, role, auth_provider, idp_groups
   FROM users WHERE email='alice@gestalt-test.local'"
```

Two rows expected — one per provider (the PlatformUser shadow
record is keyed by `(idp_subject, auth_provider)`, so OIDC and
SAML logins for the same email create separate rows).

## 4 — Test the unhappy path

```bash
# bob is in 'users' group, not 'gestalt-admins' → should resolve to role 'user'
docker exec gestalt-server-1 sed -i 's|alice|bob|g; s|alice123|bob123|g' /tmp/oidc-flow.sh
docker exec gestalt-server-1 /tmp/oidc-flow.sh
# JWT payload should show role: 'user', not platform-admin
```

## Tear down

```bash
docker-compose -f fixtures/identity-test/docker-compose.yml down -v
docker exec gestalt-server-1 rm -f /app/auth.config.json
docker-compose restart server
sleep 5

# Confirm we're back to local-only
curl -sf http://localhost:3000/auth/providers
# → {"providers":["local"]}
```

## Keycloak admin console (optional)

Useful for editing the realm (e.g. adding a custom claim, changing
the SAML signing algorithm) without rebuilding the fixture:

- URL: <http://localhost:8080/admin/>
- Credentials: `admin` / `admin`
- Realm: select `gestalt-test` from the top-left dropdown
- Clients → `gestalt-oidc` (OIDC) or `http://localhost:3000` (SAML)
- Users → `alice` or `bob`

## Troubleshooting

| Symptom | Cause |
|---|---|
| `OIDC issuer discovery failed` on server restart | Keycloak isn't up yet, or the docker network name doesn't match. Confirm `docker exec gestalt-server-1 curl -sf http://gestalt-keycloak:8080/realms/gestalt-test` returns the realm JSON |
| `SAML validation failed: Invalid document signature` | The SAML cert in `auth.config.json` is stale — Keycloak regenerated it on recreate. Re-fetch via Step 2 |
| `Unsupported Media Type: application/x-www-form-urlencoded` on SAML callback | `@fastify/formbody` plugin not registered. Should be present since 2026-06-02; if missing, re-pull main |
| `iss mismatch, expected ..., got ...` on OIDC callback | The flow was driven from the host (`localhost:8080`) but the gestalt server discovered `gestalt-keycloak:8080`. Run smoke from inside the container |
| `OIDC callback exchange failed: iss missing from the response` | The OIDC callback handler is dropping the `iss` query param. Should be fixed since 2026-06-02; if seen, re-pull main |

## See also

- [`fixtures/identity-test/README.md`](../../../fixtures/identity-test/README.md) — fixture internals + the three bugs the initial Keycloak verification surfaced
- [`oidc.md`](./oidc.md), [`saml.md`](./saml.md) — provider-specific configuration guides
- [`role-mapping.md`](./role-mapping.md) — how groups become platform roles
