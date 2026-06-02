# Identity test fixture — Keycloak SAML + OIDC

Local IdP for verifying the corporate identity providers (ADR-040)
end-to-end without needing customer credentials.

## What this exercises

- ✅ OIDC issuer discovery, PKCE authorization-code flow, ID token
  validation, group-claim extraction, role mapping
- ✅ SAML SP metadata, SAMLRequest generation, signed-assertion
  validation, attribute extraction, group → role mapping
- ✅ `auth.config.json` end-to-end (file load → config translation
  → provider registration → live use)

Was directly responsible for surfacing three real bugs in the
ADR-040 implementation:
1. Missing `@fastify/formbody` registration (SAML ACS returned 415
   for any real browser POST)
2. OIDC callback dropped the `iss` query param when constructing
   the callback params (broke RFC 9207 issuer validation in
   openid-client v5)
3. `toIdentityConfig` dropped the `attributeMapping` /
   `wantAssertionsSigned` / `identifierFormat` fields when
   translating from `auth.config.json` shape to the legacy
   `IdentityConfig`, so SAML provider fell back to Azure-AD-style
   defaults regardless of operator config

## Setup

1. **Bring up Keycloak** alongside the running Gestalt stack:
   ```bash
   docker-compose -f fixtures/identity-test/docker-compose.yml up -d
   ```
   Wait ~20 seconds for Keycloak to import the realm. Verify:
   ```bash
   curl -sf http://localhost:8080/realms/gestalt-test | python3 -m json.tool
   ```

2. **Generate auth.config.json** with the live SAML cert:
   ```bash
   SAML_CERT=$(docker exec gestalt-server-1 curl -sf \
     http://gestalt-keycloak:8080/realms/gestalt-test/protocol/saml/descriptor \
     | grep -oE '<ds:X509Certificate>[^<]+</ds:X509Certificate>' \
     | head -1 | sed 's|<[^>]*>||g')
   sed "s|REPLACE_WITH_CERT.*|$SAML_CERT|" \
     fixtures/identity-test/auth.config.json.example > /tmp/auth.config.json
   docker cp /tmp/auth.config.json gestalt-server-1:/app/auth.config.json
   docker-compose restart server
   ```

3. **Confirm both providers register**:
   ```bash
   curl -sf http://localhost:3000/auth/providers
   # → {"providers":["saml","oidc","local"]}
   ```

## Test users

| Username | Password | Groups | Expected role |
|---|---|---|---|
| `alice` | `alice123` | `gestalt-admins` | `platform-admin` |
| `bob` | `bob123` | `users` | `user` |

## End-to-end smoke tests

Both scripts must run **inside the gestalt-server-1 container**
because they use docker DNS to reach `gestalt-keycloak:8080` —
running from the host would hit `localhost:8080` which gives
Keycloak a different hostname in the issuer claim (mismatch with
the discovered issuer).

```bash
# Install curl in the alpine-based gestalt-server image
docker exec -u root gestalt-server-1 apk add --no-cache curl

# Copy + run OIDC flow
docker cp fixtures/identity-test/oidc-flow.sh gestalt-server-1:/tmp/oidc-flow.sh
docker exec -u root gestalt-server-1 chmod +x /tmp/oidc-flow.sh
docker exec gestalt-server-1 /tmp/oidc-flow.sh
# Expected: 7 step lines ending with a JWT (len ~275)

# Copy + run SAML flow
docker cp fixtures/identity-test/saml-flow.sh gestalt-server-1:/tmp/saml-flow.sh
docker exec -u root gestalt-server-1 chmod +x /tmp/saml-flow.sh
docker exec gestalt-server-1 /tmp/saml-flow.sh
# Expected: same shape, JWT len ~275
```

After both succeed, the issued JWTs are in `/tmp/jwt.txt` (OIDC) and
`/tmp/saml-jwt.txt` (SAML) inside the container. Decode + verify
claims:

```bash
docker exec gestalt-server-1 cat /tmp/jwt.txt | python3 -c '
import sys, base64, json
parts = sys.stdin.read().strip().split(".")
def b64(s): return json.loads(base64.urlsafe_b64decode(s + "="*(4-len(s)%4)))
print(b64(parts[1]))
'
```

Expected payload (OIDC):
```
{'email': 'alice@gestalt-test.local', 'role': 'platform-admin',
 'provider': 'oidc', 'sub': '...', 'iat': ..., 'exp': ...}
```

Expected payload (SAML):
```
{'email': 'alice@gestalt-test.local', 'role': 'platform-admin',
 'provider': 'saml', 'sub': '...', 'iat': ..., 'exp': ...}
```

Confirm DB upserts:
```bash
docker exec gestalt-postgres-1 psql -U gestalt -d gestalt -c \
  "SELECT email, role, auth_provider, idp_groups FROM users WHERE email='alice@gestalt-test.local'"
# → 2 rows: one for 'oidc', one for 'saml', both with platform-admin role + gestalt-admins group
```

## Tear down

```bash
docker-compose -f fixtures/identity-test/docker-compose.yml down -v
docker exec gestalt-server-1 rm -f /app/auth.config.json
docker-compose restart server
```

## Inspect the Keycloak admin console

Optional — useful for debugging custom realm changes:

- URL: http://localhost:8080/admin/
- User: admin / admin
- Realm: gestalt-test (top-left dropdown)
- Clients: `gestalt-oidc` (OIDC), `http://localhost:3000` (SAML)
- Groups: `gestalt-admins`, `users`

## Why docker DNS instead of localhost

The OIDC issuer URL in tokens must match the URL the OIDC client
(gestalt server) discovered. Inside the gestalt-server-1 container,
the discovered issuer is `http://gestalt-keycloak:8080/realms/gestalt-test`
(docker DNS). If the user-agent (browser or curl from the host)
reaches Keycloak via `localhost:8080`, Keycloak's tokens claim that
hostname instead — mismatch, validation fails.

The smoke scripts run from inside the container so the user-agent
uses the docker hostname consistently. A real customer deployment
uses a single public hostname for both the OIDC client + the
end-user browser (e.g. `https://idp.company.com`), so this issue
doesn't apply outside the local-test environment.
