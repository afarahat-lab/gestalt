# Local identity testing — Keycloak fixture

The repo ships a Keycloak-backed test fixture under
`fixtures/identity-test/` that lets you exercise OIDC + SAML
end-to-end without needing customer IdP credentials.

Use cases:

- Verify the ADR-040 implementation after touching any of the
  three provider files (`packages/server/src/auth/providers/`)
- Smoke-test a new attribute-mapping configuration before rolling
  it out to a customer
- Reproduce IdP-side issues reported by customers (the realm
  config is editable via the Keycloak admin console)

See [`fixtures/identity-test/README.md`](../../../fixtures/identity-test/README.md)
for setup, smoke-test scripts, and tear-down. The README also
documents the three real bugs the fixture surfaced during its
initial Keycloak verification — useful reference for future
provider work.

## Test users

| Username | Password | Groups | Expected platform role |
|---|---|---|---|
| `alice` | `alice123` | `gestalt-admins` | `platform-admin` |
| `bob` | `bob123` | `users` | `user` |

## Quick smoke (assumes the fixture is already up)

```bash
docker exec gestalt-server-1 /tmp/oidc-flow.sh
docker exec gestalt-server-1 /tmp/saml-flow.sh
```

Both should print `Server callback response: HTTP/1.1 302 Found`
and a JWT (~275 chars) in their final lines.
