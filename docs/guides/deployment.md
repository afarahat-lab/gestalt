# Deployment Guide — Gestalt

This guide is written for **corporate IT teams** deploying Gestalt in a
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
git clone --bare https://github.com/afarahat-lab/gestalt.git

# Push to your internal Git server
cd gestalt.git
git remote add internal https://git.company.com/devtools/gestalt.git
git push internal --all
git push internal --tags
```

On the production server:

```bash
# Clone from your internal mirror
git clone https://git.company.com/devtools/gestalt.git
cd gestalt
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
| `SERVER_BASE_URL` | Public URL of the server | `https://gestalt.company.com` |

### Generate secure secrets

```bash
# Generate JWT_SECRET (Linux/macOS)
openssl rand -hex 64

# Generate POSTGRES_PASSWORD
openssl rand -hex 32
```

### Generate the master key for the encrypted secrets vault

The platform's secrets vault (Session 4, migration 015) encrypts API
keys at rest with AES-256-GCM. The encryption key — the **master key** —
is loaded once at server startup and is required for any secret
operation. In production, a missing master key is a **fatal startup
error**.

```bash
# Generate a 32-byte master key, base64-encoded (256 bits — required
# size for AES-256). Keep this file out of version control.
openssl rand -base64 32 > master.key
chmod 600 master.key
```

Then expose it to the server with one of these mechanisms (the server
checks them in this order):

1. `GESTALT_MASTER_KEY` environment variable — base64-encoded value
2. `/etc/gestalt/master.key` mounted into the container
3. `./master.key` in the cwd (dev-only auto-generation if missing)

The recommended production setup mounts the host-side file:

```yaml
# docker-compose.yml — uncomment the volume and the env-var stays unused
services:
  server:
    volumes:
      - ./master.key:/etc/gestalt/master.key:ro
```

**Operational warnings:**

- **Back up the master key out of band.** If it is lost, every
  encrypted secret in the database becomes unreadable. There is no
  recovery path — operators would have to re-enter every API key
  after generating a fresh master key.
- **Do not rotate the master key in place.** Rotation requires
  decrypting every secret with the old key and re-encrypting under the
  new key — a tooling task not yet automated by the platform. Treat
  the master key as a long-lived secret.
- **Never commit master.key.** Add it to `.gitignore` (the platform
  template already excludes it).

---

## Step 5 — Configure database

Gestalt uses PostgreSQL by default. To use your existing Oracle or
SQL Server instance, see the [Database Configuration Guide](../reference/database-config.md).

**PostgreSQL (default — runs in Docker):**

No additional configuration needed. The default `docker-compose.yml` starts
a PostgreSQL container.

**Oracle (existing corporate instance):**

```bash
# In .env
DATABASE_ADAPTER=oracle
DATABASE_URL=oracle://gestalt_user:password@oracle-server:1521/ORCL
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
Gestalt server started on port 3000
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
    server_name gestalt.company.com;

    ssl_certificate     /etc/ssl/certs/gestalt.crt;
    ssl_certificate_key /etc/ssl/private/gestalt.key;

    # Required for Kerberos authentication
    auth_gss on;
    auth_gss_keytab /etc/krb5/gestalt.keytab;

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
# Install the CLI from the monorepo (the package is not published to npm).
# Run these on the operator workstation that will manage this server.
git clone https://github.com/afarahat-lab/gestalt.git
cd gestalt
pnpm install
pnpm --filter @gestalt/cli build
cd packages/cli && npm link && cd ../..

# Point CLI at the server
export AGENTFORGE_SERVER=https://gestalt.company.com

# If using IdP: the first user who logs in via the IdP and has the
# Gestalt-Admins group will automatically be an admin.
# No manual creation needed.

# If using local fallback (non-production only):
gestalt admin create-user --email admin@company.com --role admin
```

---

## Step 10 — Connect to your CI/CD system (optional)

By default, every project registered through this server uses the NoOp
pipeline adapter — the deploy chain runs end-to-end but never touches a
real CI/CD system. Switch each project's adapter when the project repo
is ready for real CI:

- [GitHub Actions](./ci-cd/github-actions.md) — `gestalt projects set-adapter <name> github-actions`

Other adapter implementations (Azure DevOps, GitLab CI, Jenkins) are
planned but not yet built; the `PipelineAdapter` interface is in place
so they can be added without touching the deploy-orchestrator.

---

## Step 11 — Verify installation

```bash
# Health check
curl https://gestalt.company.com/health
# Expected: {"status":"ok","version":"0.1.0"}

# Open dashboard
# Navigate to: https://gestalt.company.com
```

---

## Firewall rules summary

**Inbound (to Gestalt server):**

| Port | Protocol | Source | Purpose |
|---|---|---|---|
| 443 | HTTPS | Corporate network | Dashboard and API |
| 3000 | HTTP | Internal only | Direct access (if no reverse proxy) |

**Outbound (from Gestalt server):**

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
cd gestalt
git pull origin main
docker-compose pull
docker-compose up -d --build

# Backup database
docker-compose exec postgres pg_dump -U gestalt gestalt > backup-$(date +%Y%m%d).sql

# View logs
docker-compose logs -f server
docker-compose logs -f --tail=100 server
```
