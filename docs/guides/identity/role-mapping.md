# Role mapping — IdP groups → platform roles

How AD / IdP group memberships translate into Gestalt's two-tier
role model (platform-admin / user) plus per-project roles.

ADR references: ADR-024 (provider priority), ADR-026 (PlatformUser
shadow record), ADR-040 (auth.config.json schema), and the
user-management session that introduced the two-tier model.

---

## The two role tiers

Gestalt has two distinct authorisation layers:

1. **Platform role** — `'platform-admin' | 'user'`. Stored on
   `users.role`. Controls access to platform-wide functions (admin
   surface, creating new projects, managing other users).
   Assigned by IdP group mapping at login time.
2. **Project role** — `'project-admin' | 'editor' | 'reader'`.
   Stored on `project_memberships.role` per (user, project) pair.
   Controls per-project work (submitting intents, editing
   HARNESS.json, reading the audit trail). Assigned manually by
   project-admins or platform-admins; NOT derived from IdP groups
   today.

## Platform role assignment

When a user signs in via SAML / OIDC / Kerberos, the AuthManager:

1. Receives a `VerifiedIdentity { groups: string[] }` from the
   provider
2. Calls `resolveRole(identity)` which checks each `groups` entry
   against `roleMapping.platformAdmin` in `auth.config.json`
3. Returns `'platform-admin'` if ANY group matches; otherwise
   returns `roleMapping.defaultRole` (default: `'user'`)

The resolved role is written to `users.role` on the user's
PlatformUser shadow record — re-evaluated on every login, so AD
group changes take effect on the next sign-in.

## auth.config.json

```json
{
  "providers": {
    /* ... */
  },
  "roleMapping": {
    "platformAdmin": ["Gestalt-Admins", "Domain Admins"],
    "defaultRole": "user"
  }
}
```

| Field | Purpose |
|---|---|
| `platformAdmin` | List of group names (string match). Membership in ANY of these groups grants platform-admin role. |
| `defaultRole` | Role assigned when no platformAdmin group matched. `"user"` is the standard value — denies platform-admin but lets the user sign in. Set to omit (or `null` in legacy HARNESS shape) to deny sign-in entirely when no group matches. |

## Provider-specific group conventions

| Provider | Group source | Notes |
|---|---|---|
| Kerberos | none today | Kerberos tickets carry user identity only — group membership requires an LDAP query (out of scope for the ADR-040 initial implementation). Use UPN-based `platformAdmin` lists OR add an LDAP layer in a future enhancement. |
| SAML | the SAML attribute named in `attributeMapping.groups` | Most IdPs ship group names (`Gestalt-Admins`). Azure AD's SAML mode often ships group IDs (GUIDs) by default — match against IDs OR configure the IdP to release names. |
| OIDC | the ID-token claim named in `groupsClaim` | Azure AD OIDC ships group IDs by default — same options as SAML. |
| local | none | Local users have no groups; role comes from `users.role` set at user creation. |

## Adding the first platform-admin via IdP

The first user to sign in successfully via IdP becomes a platform-
admin ONLY IF their groups include a `platformAdmin` entry. The
`gestalt init-admin` CLI command (which writes a local-auth admin
row) is the recommended bootstrap path for IdP-protected
deployments — once the first admin exists, they can grant
platform-admin to additional users via `gestalt users role
<email> platform-admin`.

## Testing

Verify the resolved role on first login by querying:

```sql
SELECT email, role, idp_groups
FROM users
WHERE email = 'newuser@company.com'
ORDER BY created_at DESC LIMIT 1;
```

`idp_groups` is the raw group list from the IdP — useful for
debugging when a user expected platform-admin but got `user`.

## Per-project roles

Per-project roles are set via the dashboard's Admin view OR the
`gestalt users assign / unassign` CLI commands. They are NOT
derived from IdP groups. If your team wants AD-group-driven
per-project access, the recommended pattern is:

1. Define one AD group per Gestalt project + role combination
   (e.g. `Gestalt-MyProject-Editor`, `Gestalt-MyProject-Admin`)
2. Add a small sync script that runs `gestalt users assign /
   unassign` based on AD group membership

A native AD-to-project-role sync layer is a future enhancement.
