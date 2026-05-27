# Azure AD / Entra ID — Identity Integration Guide

Configure AgentForge SDLC with Microsoft Azure Active Directory (now Entra ID)
using OpenID Connect (OIDC).

**Audience:** Azure AD administrator + AgentForge server administrator

---

## When to use this guide

- Your organisation uses Azure AD / Microsoft Entra ID
- Users authenticate via Microsoft 365 / Office 365
- You prefer OIDC over SAML (simpler token format)

---

## Step 1 — Register the application in Azure AD

1. Sign in to [Azure Portal](https://portal.azure.com)
2. Navigate to: **Azure Active Directory → App registrations → New registration**

Fill in:
- **Name:** `AgentForge SDLC`
- **Supported account types:** Accounts in this organizational directory only
- **Redirect URI:** Web → `https://agentforge.company.com/auth/oidc/callback`

Click **Register**.

Note the following values (you will need them in Step 4):
- **Application (client) ID** → `OIDC_CLIENT_ID`
- **Directory (tenant) ID** → used in the issuer URL

---

## Step 2 — Create a client secret

1. In the app registration, navigate to: **Certificates & secrets → Client secrets**
2. Click **New client secret**
3. Description: `AgentForge SDLC production`
4. Expiry: 24 months (set a calendar reminder to rotate)
5. Copy the **Value** immediately — it is only shown once

This is your `OIDC_CLIENT_SECRET`.

---

## Step 3 — Configure group claims

By default, Azure AD does not include group memberships in OIDC tokens.
You must enable this.

1. In the app registration, navigate to: **Token configuration**
2. Click **Add groups claim**
3. Select: **Security groups**
4. For ID token: select **Group ID** (this sends the group's Object ID)
5. Click **Add**

**Important:** Azure AD sends group Object IDs (GUIDs), not group names.
You will use these GUIDs in the roleMapping configuration (Step 5).

---

## Step 4 — Set API permissions

1. Navigate to: **API permissions → Add a permission**
2. Select **Microsoft Graph → Delegated permissions**
3. Add: `openid`, `profile`, `email`, `User.Read`, `GroupMember.Read.All`
4. Click **Grant admin consent for [your organisation]**

---

## Step 5 — Find your group Object IDs

You need the Object ID of each group you want to map to platform roles.

```powershell
# Using Azure CLI
az ad group show --group "AgentForge-Admins" --query id -o tsv
az ad group show --group "AgentForge-Operators" --query id -o tsv
az ad group show --group "AgentForge-Viewers" --query id -o tsv
```

Or in Azure Portal: **Azure AD → Groups → [group name] → Overview → Object ID**

---

## Step 6 — Update HARNESS.json

```json
"identity": {
  "providers": [
    {
      "type": "oidc",
      "enabled": true,
      "issuer": "https://login.microsoftonline.com/<TENANT_ID>/v2.0",
      "clientId": "<APPLICATION_CLIENT_ID>",
      "clientSecret": "${OIDC_CLIENT_SECRET}",
      "callbackUrl": "https://agentforge.company.com/auth/oidc/callback",
      "scopes": ["openid", "profile", "email", "GroupMember.Read.All"]
    }
  ],
  "roleMapping": [
    { "idpGroup": "<ADMINS_GROUP_OBJECT_ID>",    "platformRole": "admin" },
    { "idpGroup": "<OPERATORS_GROUP_OBJECT_ID>", "platformRole": "operator" },
    { "idpGroup": "<VIEWERS_GROUP_OBJECT_ID>",   "platformRole": "viewer" }
  ],
  "defaultRole": null,
  "sessionTtlMinutes": 480
}
```

Store the client secret in `.env`:
```bash
OIDC_CLIENT_SECRET=<your-client-secret-value>
```

---

## Step 7 — Test the integration

```bash
docker-compose restart server

# Test OIDC redirect
curl -I https://agentforge.company.com/auth/oidc/login
# Expected: 302 redirect to login.microsoftonline.com

# Open in browser, sign in with Azure AD credentials
# Should redirect to dashboard after authentication
```

---

## Troubleshooting

**"AADSTS50011: The reply URL specified in the request does not match"**

The redirect URI in Azure AD does not match your server URL exactly.
Check: **App registration → Authentication → Redirect URIs**
Must match `https://agentforge.company.com/auth/oidc/callback` exactly.

**"User authenticated but no groups in token"**

Groups claim not configured. Verify Step 3 — token configuration.
Also check if the user is in more than 200 groups (Azure AD limit for token claims).
If so, use the Microsoft Graph API to fetch groups instead.

**"AADSTS65001: The user or administrator has not consented"**

Admin consent not granted. Return to Step 4 and ensure admin consent
was granted for all permissions.
