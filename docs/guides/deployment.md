# Deployment Guide — AgentForge SDLC

This guide is written for **corporate IT teams** deploying AgentForge SDLC in a
production enterprise environment.

---

## Prerequisites

### Infrastructure requirements

| Component | Minimum spec | Recommended spec |
|---|---|---|
| Server OS | Ubuntu 22.04 LTS / RHEL 8+ | Ubuntu 22.04 LTS |
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Disk | 50 GB SSD | 100 GB SSD |
| Network | Internal corporate network access | — |

### Software requirements

| Software | Version | Notes |
|---|---|---|
| Docker Engine | 24.0+ | See [Docker install guide](https://docs.docker.com/engine/install/) |
| Docker Compose | 2.20+ | Usually bundled with Docker Engine |
| Git | 2.38+ | For cloning the repository |

### Network requirements

| Destination | Port | Purpose |
|---|---|---|
| Your LLM endpoint | 443 | AI model calls (Azure OpenAI / on-premise) |
| Your database (if external) | 5432 / 1521 / 1433 | PostgreSQL / Oracle / SQL Server |
| Your corporate IdP | 443 | SAML/OIDC authentication |
| Your KDC (if Kerberos) | 88 | Kerberos ticket validation |
| Your AD/LDAP (if Kerberos) | 389 / 636 | Group membership lookup |
| Internal Git repository | 443 / 22 | Project repository access |

**No outbound internet access is required.** All calls go to internal corporate endpoints.

---

## Step 1 — Security review checklist

Before proceeding, ensure your security team has reviewed:

- [ ] Docker images — review `docker-compose.yml` and all referenced images
- [ ] Network ports — only port 3000 (or your configured SERVER_PORT) is exposed
- [ ] Environment variables — `.env` file contains no hardcoded secrets in the repo
- [ ] LLM endpoint — confirm your approved LLM provider is configured
- [ ] Database — confirm data residency requirements are met
- [ ] Authentication — confirm your IdP integration method (Kerberos / SAML / OIDC)

---

## Step 2 — Install from internal repository mirror

Most corporate environments do not allow direct GitHub access from servers.
Mirror the repository to your internal Git server first:

```bash
# On a machine with internet access, create a bare clone
git clone --bare https://github.com/afarahat-lab/agentforge-sdlc.git

# Push to your internal Git server
cd agentforge-sdlc.git
git remote add internal https://git.company.com/devtools/agentforge-sdlc.git
git push internal --all
git push internal --tags
```

On the production server:

```bash
# Clone from your internal mirror
git clone https://git.company.com/devtools/agentforge-sdlc.git
cd agentforge-sdlc
```

---

## Step 3 — Configure Docker image registry

If your environment does not allow pulling from Docker Hub, configure your
internal registry in `docker-compose.yml`:

```yaml
# Replace public image references with your internal registry mirror
services:
  postgres:
    image: registry.company.com/mirror/postgres:15-alpine
    # ... rest of config unchanged

  redis:
    image: registry.company.com/mirror/redis:7-alpine
    # ... rest of config unchanged
```

Pre-pull and push the required images to your registry:

```bash
# Images required (pull from Docker Hub, push to internal registry)
docker pull postgres:15-alpine
docker tag postgres:15-alpine registry.company.com/mirror/postgres:15-alpine
docker push registry.company.com/mirror/postgres:15-alpine

docker pull redis:7-alpine
docker tag redis:7-alpine registry.company.com/mirror/redis:7-alpine
docker push registry.company.com/mirror/redis:7-alpine
```

---

## Step 4 — Configure environment

```bash
cp .env.example .env
# Edit .env — see environment variable reference below
```

### Required environment variables

| Variable | Description | Example |
|---|---|---|
| `LLM_BASE_URL` | LLM provider endpoint | `https://company.openai.azure.com/openai/deployments/gpt-4o` |
| `LLM_API_KEY` | LLM API key | `abc123...` |
| `LLM_MODEL` | Model name | `gpt-4o` |
| `POSTGRES_PASSWORD` | Database password | Strong random string |
| `JWT_SECRET` | JWT signing secret | 64+ character random string |
| `SERVER_BASE_URL` | Public URL of the server | `https://agentforge.company.com` |

### Generate secure secrets

```bash
# Generate JWT_SECRET (Linux/macOS)
openssl rand -hex 64

# Generate POSTGRES_PASSWORD
openssl rand -hex 32
```

---

## Step 5 — Configure database

AgentForge SDLC uses PostgreSQL by default. To use your existing Oracle or
SQL Server instance, see the [Database Configuration Guide](../reference/database-config.md).

**PostgreSQL (default — runs in Docker):**

No additional configuration needed. The default `docker-compose.yml` starts
a PostgreSQL container.

**Oracle (existing corporate instance):**

```bash
# In .env
DATABASE_ADAPTER=oracle
DATABASE_URL=oracle://agentforge_user:password@oracle-server:1521/ORCL
```

See [Oracle Setup Guide](../reference/database-config.md#oracle) for user
and schema creation scripts.

---

## Step 6 — Start the platform

```bash
docker-compose up -d

# Verify all containers are healthy
docker-compose ps

# Check server logs
docker-compose logs -f server
```

The server is ready when logs show:
```
AgentForge SDLC server started on port 3000
Database connection established
Redis connection established
```

---

## Step 7 — Configure authentication

**Choose your authentication method:**

- [Windows Kerberos SSO](./identity/kerberos.md) ← recommended for Windows AD environments
- [SAML 2.0 (ADFS)](./identity/saml-adfs.md) ← for ADFS or other SAML providers
- [Azure AD / Entra ID (OIDC)](./identity/azure-ad.md) ← for Azure AD
- [Okta (OIDC)](./identity/okta.md) ← for Okta

---

## Step 8 — Configure reverse proxy (recommended)

Place a reverse proxy in front of the server for TLS termination and load balancing.

**Nginx example:**

```nginx
server {
    listen 443 ssl;
    server_name agentforge.company.com;

    ssl_certificate     /etc/ssl/certs/agentforge.crt;
    ssl_certificate_key /etc/ssl/private/agentforge.key;

    # Required for Kerberos authentication
    auth_gss on;
    auth_gss_keytab /etc/krb5/agentforge.keytab;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for SSE (disable buffering)
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

---

## Step 9 — Create initial admin user

```bash
# Install CLI on the server
npm install -g @agentforge-sdlc/cli

# Point CLI at the server
export AGENTFORGE_SERVER=https://agentforge.company.com

# If using IdP: the first user who logs in via the IdP and has the
# AgentForge-Admins group will automatically be an admin.
# No manual creation needed.

# If using local fallback (non-production only):
agentforge admin create-user --email admin@company.com --role admin
```

---

## Step 10 — Verify installation

```bash
# Health check
curl https://agentforge.company.com/health
# Expected: {"status":"ok","version":"0.1.0"}

# Open dashboard
# Navigate to: https://agentforge.company.com
```

---

## Firewall rules summary

**Inbound (to AgentForge server):**

| Port | Protocol | Source | Purpose |
|---|---|---|---|
| 443 | HTTPS | Corporate network | Dashboard and API |
| 3000 | HTTP | Internal only | Direct access (if no reverse proxy) |

**Outbound (from AgentForge server):**

| Destination | Port | Purpose |
|---|---|---|
| LLM endpoint | 443 | AI model calls |
| KDC (if Kerberos) | 88 | Kerberos ticket validation |
| LDAP/AD (if Kerberos) | 389/636 | Group membership |
| IdP (if SAML/OIDC) | 443 | Authentication |
| Git server | 443/22 | Project repository |

---

## Maintenance and updates

```bash
# Update to latest version
cd agentforge-sdlc
git pull origin main
docker-compose pull
docker-compose up -d --build

# Backup database
docker-compose exec postgres pg_dump -U agentforge agentforge > backup-$(date +%Y%m%d).sql

# View logs
docker-compose logs -f server
docker-compose logs -f --tail=100 server
```
