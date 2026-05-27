# SAML 2.0 / ADFS — Identity Integration Guide

Configure AgentForge SDLC as a SAML Service Provider (SP) with Active Directory
Federation Services (ADFS) or any SAML 2.0 compliant Identity Provider.

**Audience:** ADFS administrator + AgentForge server administrator

---

## When to use this guide

- Your organisation uses ADFS (Active Directory Federation Services)
- Users are not on domain-joined Windows machines (Kerberos not available)
- Your IdP supports SAML 2.0 but not OIDC
- You need federated authentication across multiple AD forests

For domain-joined Windows environments, [Kerberos SSO](./kerberos.md) provides
a better user experience (no login redirect).

---

## SAML flow overview

```
1. User opens https://agentforge.company.com
2. Server redirects to ADFS login page
3. User enters AD credentials (or uses Windows Integrated Auth at ADFS)
4. ADFS validates credentials and issues SAML assertion
5. Browser POSTs assertion to AgentForge ACS URL
6. Server validates assertion signature against IdP certificate
7. User identity and group claims extracted
8. Platform role assigned, dashboard loads
```

---

## Step 1 — Retrieve AgentForge SP metadata

Start the server and retrieve the SP metadata XML:

```bash
curl https://agentforge.company.com/auth/saml/metadata > agentforge-sp-metadata.xml
```

This XML file contains the SP entity ID, ACS URL, and signing certificate.
You will provide this to your ADFS administrator.

---

## Step 2 — Configure ADFS (ADFS administrator)

### Add a Relying Party Trust

1. Open ADFS Management Console
2. Navigate to: **Trust Relationships → Relying Party Trusts**
3. Click **Add Relying Party Trust**
4. Select **Import data about the relying party from a file**
5. Browse to `agentforge-sp-metadata.xml`
6. Complete the wizard with these settings:
   - Display name: `AgentForge SDLC`
   - Access control policy: Select appropriate policy for your organisation
   - Configure claim rules: See next section

### Configure claim rules

Add the following claim rules to the Relying Party Trust:

**Rule 1 — Send email address**
```
Rule name: Send Email
Claim rule template: Send LDAP Attributes as Claims
LDAP attribute: E-Mail-Addresses
Outgoing claim type: E-Mail Address
```

**Rule 2 — Send display name**
```
Rule name: Send Display Name
Claim rule template: Send LDAP Attributes as Claims
LDAP attribute: Display-Name
Outgoing claim type: Name
```

**Rule 3 — Send group memberships**
```
Rule name: Send Groups
Claim rule template: Send LDAP Attributes as Claims
LDAP attribute: Token-Groups - Qualified by Long Domain Name
Outgoing claim type: Group
```

**Rule 4 — Transform Name ID**
```
Rule name: Transform Name ID
Claim rule template: Transform an Incoming Claim
Incoming claim type: E-Mail Address
Outgoing claim type: Name ID
Outgoing name ID format: Email
```

---

## Step 3 — Export IdP certificate from ADFS

```powershell
# On ADFS server — export the token signing certificate
$cert = Get-AdfsCertificate -CertificateType Token-Signing
$cert.Certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert) |
  Set-Content -Encoding Byte adfs-signing.cer

# Convert to PEM format (run on Linux or use OpenSSL on Windows)
openssl x509 -inform DER -in adfs-signing.cer -out adfs-signing.pem
```

Copy `adfs-signing.pem` to the AgentForge server:
```bash
/etc/agentforge/certs/adfs-signing.pem
```

---

## Step 4 — Update HARNESS.json

```json
"identity": {
  "providers": [
    {
      "type": "saml",
      "enabled": true,
      "entryPoint": "https://adfs.company.com/adfs/ls",
      "issuer": "agentforge-sdlc",
      "cert": "file:///etc/agentforge/certs/adfs-signing.pem",
      "callbackUrl": "https://agentforge.company.com/auth/saml/callback"
    }
  ],
  "roleMapping": [
    { "idpGroup": "COMPANY\\AgentForge-Admins",    "platformRole": "admin" },
    { "idpGroup": "COMPANY\\AgentForge-Operators", "platformRole": "operator" },
    { "idpGroup": "COMPANY\\AgentForge-Viewers",   "platformRole": "viewer" }
  ],
  "defaultRole": null,
  "sessionTtlMinutes": 480
}
```

**Note:** ADFS sends group names as `DOMAIN\GroupName` — include the domain prefix
in your roleMapping idpGroup values.

---

## Step 5 — Create AD groups

| Group name | Platform role |
|---|---|
| `AgentForge-Admins` | admin |
| `AgentForge-Operators` | operator |
| `AgentForge-Viewers` | viewer |

Add users to groups in Active Directory Users and Computers.

---

## Step 6 — Test the integration

```bash
# Restart the server
docker-compose restart server

# Test SAML redirect
curl -I https://agentforge.company.com/auth/saml/login
# Expected: 302 redirect to https://adfs.company.com/adfs/ls?...

# Open in browser and complete the ADFS login flow
# Should redirect back to dashboard after authentication
```

---

## Troubleshooting

**"SAML signature validation failed"**

The IdP certificate does not match. Verify:
```bash
# Check certificate currently configured
cat /etc/agentforge/certs/adfs-signing.pem

# Verify against current ADFS certificate
curl https://adfs.company.com/FederationMetadata/2007-06/FederationMetadata.xml
# Compare X509Certificate values
```

**"No group claims received"**

ADFS is not sending group claims. Verify Rule 3 is configured in the
Relying Party Trust claim rules. Check the SAML assertion in browser dev tools
(Network tab → POST to /auth/saml/callback → Form Data → SAMLResponse → decode base64).

**"User authenticated but wrong role"**

Log the raw group claims:
```bash
agentforge debug saml-claims --user user@company.com
```
Ensure group names in roleMapping match exactly (including DOMAIN\ prefix).

**"SSL certificate error on ADFS redirect"**

If ADFS uses a self-signed or internal CA certificate, add the CA to the
server's trust store:
```bash
cp company-ca.crt /usr/local/share/ca-certificates/
update-ca-certificates
docker-compose restart server
```
