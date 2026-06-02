# Windows Kerberos SSO — Identity Integration Guide

This guide walks your IT team through configuring seamless Windows single
sign-on for Gestalt. Once configured, domain-joined Windows users
open the dashboard and are authenticated automatically — no login screen.

**Audience:** Active Directory administrator + Gestalt server administrator

> **ADR-040 update (2026-06).** New deployments configure identity
> in a dedicated `auth.config.json` mounted at `/etc/gestalt/`.
> The earlier HARNESS.json `identity` block continues to work for
> back-compat but is no longer the recommended path. See the
> auth.config.json example below; see also
> [role-mapping.md](./role-mapping.md) for AD group → platform role
> configuration.

---

## How it works

```
1. User opens https://gestalt.company.com on a domain-joined Windows machine
2. Browser detects Negotiate authentication challenge from server
3. Browser presents Kerberos ticket from the user's Windows login session
4. Server validates the ticket against Active Directory
5. User's AD group memberships are looked up via LDAP
6. Platform role is assigned based on group mapping
7. Dashboard loads — user never saw a login prompt
```

---

## Prerequisites

- [ ] Active Directory domain functional level: Windows Server 2012 R2 or higher
- [ ] Gestalt server is joined to the domain, OR has network access to the KDC
- [ ] A dedicated service account in AD for Gestalt
- [ ] DNS A record for the Gestalt server hostname

---

## Step 1 — Create a service account in Active Directory

Create a dedicated domain account for the Gestalt service.
**Do not use an existing account.**

```
Account name: gestaltsvc
Password: <strong password, does not expire>
Account type: Service account (no interactive login required)
Password never expires: Yes
```

In Active Directory Users and Computers:
1. Right-click domain → New → User
2. First name: Gestalt, Last name: Service, User logon name: `gestaltsvc`
3. Set a strong password, check "Password never expires"
4. Uncheck "User must change password at next logon"

---

## Step 2 — Register the Service Principal Name (SPN)

**This is the critical step.** Without the SPN, Kerberos authentication will not work.

Run on a domain controller (or any machine with AD admin rights):

```powershell
# Replace values with your actual hostname and service account
setspn -A HTTP/gestalt.company.com COMPANY\gestaltsvc
setspn -A HTTP/gestalt COMPANY\gestaltsvc

# Verify the SPN was registered
setspn -L COMPANY\gestaltsvc
# Expected output:
# Registered ServicePrincipalNames for CN=Gestalt Service,...:
#   HTTP/gestalt.company.com
#   HTTP/gestalt
```

**If the server uses a non-standard port (not 443):**

```powershell
setspn -A HTTP/gestalt.company.com:8443 COMPANY\gestaltsvc
```

**Troubleshooting SPN registration:**

```powershell
# Check for duplicate SPNs (will cause auth failures)
setspn -X

# If duplicate exists, delete and re-register
setspn -D HTTP/gestalt.company.com COMPANY\gestaltsvc
setspn -A HTTP/gestalt.company.com COMPANY\gestaltsvc
```

---

## Step 3 — Create a keytab file

The keytab allows the Gestalt server to validate Kerberos tickets without
needing the service account password at runtime.

Run on a domain controller:

```powershell
# Windows Server 2012 R2 and later
ktpass -princ HTTP/gestalt.company.com@COMPANY.COM `
       -mapuser COMPANY\gestaltsvc `
       -crypto AES256-SHA1 `
       -ptype KRB5_NT_PRINCIPAL `
       -pass <service-account-password> `
       -out gestalt.keytab

# Verify the keytab
klist -k gestalt.keytab
```

Copy `gestalt.keytab` to the Gestalt server:

```bash
# On Gestalt server
mkdir -p /etc/gestalt/krb5
# Copy keytab file here — use scp or your organisation's secure file transfer
chmod 600 /etc/gestalt/krb5/gestalt.keytab
chown <gestalt-service-user>:root /etc/gestalt/krb5/gestalt.keytab
```

---

## Step 4 — Configure Kerberos on the Gestalt server

Create `/etc/krb5.conf` on the server:

```ini
[libdefaults]
    default_realm = COMPANY.COM
    dns_lookup_realm = false
    dns_lookup_kdc = true
    ticket_lifetime = 24h
    forwardable = true

[realms]
    COMPANY.COM = {
        kdc = dc01.company.com
        kdc = dc02.company.com       # add more DCs for redundancy
        admin_server = dc01.company.com
        default_domain = company.com
    }

[domain_realm]
    .company.com = COMPANY.COM
    company.com = COMPANY.COM
```

Test the Kerberos configuration:

```bash
# Test ticket acquisition (should succeed without password prompt if on domain)
kinit gestaltsvc@COMPANY.COM

# Verify
klist
```

---

## Step 5 — Configure LDAP for group lookup

Gestalt needs to look up the user's AD group memberships to assign platform roles.

In `.env`:

```bash
LDAP_URL=ldaps://dc01.company.com:636
LDAP_BIND_DN=CN=gestaltsvc,OU=Service Accounts,DC=company,DC=com
LDAP_BIND_PASSWORD=<service-account-password>
LDAP_BASE_DN=DC=company,DC=com
LDAP_USER_SEARCH_FILTER=(userPrincipalName={0})
LDAP_GROUP_ATTRIBUTE=memberOf
```

**Using LDAPS (recommended):**

Export the Active Directory root CA certificate and place it on the server:

```bash
# Place AD CA certificate
/etc/gestalt/certs/ad-ca.crt

# In .env
LDAP_CA_CERT_PATH=/etc/gestalt/certs/ad-ca.crt
```

---

## Step 6 — Create AD groups for role mapping

Create three AD security groups for Gestalt access control:

| Group name | Platform role | Who should be a member |
|---|---|---|
| `Gestalt-Admins` | admin | Platform administrators |
| `Gestalt-Operators` | operator | Developers who submit intents |
| `Gestalt-Viewers` | viewer | Stakeholders who monitor progress |

In Active Directory Users and Computers:
1. Create each group as a Security group in an appropriate OU
2. Add users to the relevant groups
3. Allow up to 15 minutes for group membership to propagate

---

## Step 7 — Create auth.config.json (ADR-040)

Mount `auth.config.json` at `/etc/gestalt/auth.config.json` via
docker-compose. The container also needs the keytab + the
`KRB5_KTNAME` env var:

```json
{
  "providers": {
    "kerberos": {
      "enabled": true,
      "realm": "COMPANY.COM",
      "serviceAccount": "HTTP/gestalt.company.com@COMPANY.COM",
      "keytabPath": "/etc/gestalt/krb5.keytab"
    }
  },
  "roleMapping": {
    "platformAdmin": ["Gestalt-Admins"],
    "defaultRole": "user"
  },
  "sessionTtlMinutes": 480
}
```

```yaml
# docker-compose.yml — uncomment the volume mounts the platform ships:
services:
  server:
    volumes:
      - ./auth.config.json:/etc/gestalt/auth.config.json:ro
      - ./krb5.keytab:/etc/gestalt/krb5.keytab:ro
    environment:
      - KRB5_KTNAME=/etc/gestalt/krb5.keytab
```

> **Legacy HARNESS.json path** (continues to work for back-compat —
> the loader reads `auth.config.json` first, falls through to
> HARNESS.json `identity` only if no auth-config file is found):
>
> ```json
> "identity": {
>   "providers": [
>     {
>       "type": "windows-kerberos",
>       "enabled": true,
>       "spn": "HTTP/gestalt.company.com",
>       "realm": "COMPANY.COM",
>       "kdcHostname": "dc01.company.com"
>     }
>   ],
>   "roleMapping": [
>     { "idpGroup": "Gestalt-Admins", "platformRole": "platform-admin" }
>   ],
>   "defaultRole": "user",
>   "sessionTtlMinutes": 480
> }
> ```

---

## Step 8 — Configure browser for Kerberos (Firefox only)

Chrome and Edge on domain-joined Windows machines handle Kerberos automatically.

For Firefox, users must configure trusted URIs once (or IT can deploy via Group Policy):

```
about:config → network.negotiate-auth.trusted-uris → gestalt.company.com
```

**Group Policy deployment for Firefox:**

```
User Configuration → Administrative Templates → Firefox → 
  → Authentication → Trusted URIs for Negotiate authentication
  → Value: https://gestalt.company.com
```

---

## Step 9 — Restart and test

```bash
# Restart the Gestalt server
docker-compose restart server

# Test Kerberos authentication
curl -v --negotiate -u : https://gestalt.company.com/auth/me
# Expected: 200 response with user info

# Test from a domain-joined Windows machine
# Open https://gestalt.company.com in Chrome/Edge
# Should load dashboard without any login prompt
```

---

## Troubleshooting

**"Kerberos authentication failed: KRB5KDC_ERR_S_PRINCIPAL_UNKNOWN"**

The SPN is not registered correctly. Verify with:
```powershell
setspn -L COMPANY\gestaltsvc
```

Ensure the SPN exactly matches the hostname in the browser URL.

**"KRB5KDC_ERR_ETYPE_NOSUPP"**

Encryption type mismatch. Ensure the service account supports AES256.
In AD, check the account properties → Account tab → "This account supports AES 256 bit encryption".

**"Cannot read keytab file"**

Check file permissions:
```bash
ls -la /etc/gestalt/krb5/gestalt.keytab
# Should be: -rw------- (600) owned by gestalt service user
```

**User authenticated but shows wrong role**

Check group membership propagation (can take up to 15 minutes in AD).
Verify LDAP group attribute lookup:
```bash
gestalt debug ldap-groups --user user@company.com
```

**Browser shows login prompt instead of SSO**

- Verify the user's machine is domain-joined: `whoami /fqdn`
- Verify the URL is in the trusted sites zone (Internet Explorer / Edge settings)
- Verify DNS resolves correctly: `nslookup gestalt.company.com`
- Check Chrome flags: `chrome://net-internals/#auth`

---

## Related guides

- [SAML 2.0 / ADFS Integration](./saml-adfs.md)
- [Azure AD / Entra ID Integration](./azure-ad.md)
- [Configuration Reference — Identity](../../reference/harness-config.md#identity)
