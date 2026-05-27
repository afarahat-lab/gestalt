# Registry & Ecosystem — AgentForge SDLC

Version: 0.1.0
Layer: 8
Status: Designed + implemented (registry API server pending Phase 2)

---

## Overview

The registry layer turns the platform into a community. It provides a structured
way to discover, share, and contribute harness patterns, adapters, and compliance
rule sets — with a quality signal that tells users exactly how trustworthy
each entry is.

---

## What can be registered

| Type | Description | Example |
|---|---|---|
| `harness-template` | Complete project harness starter | `corporate-ops-web-mobile` |
| `db-adapter` | Database repository adapter | `mysql-adapter`, `snowflake-adapter` |
| `pipeline-adapter` | CI/CD system adapter | `teamcity-adapter` |
| `scanner-interpreter` | Security scanner interpreter | `snyk-interpreter` |
| `monitoring-adapter` | Monitoring platform adapter | `newrelic-adapter` |
| `golden-principle-pack` | Compliance rule set | `hipaa-principles`, `pci-dss-principles` |

---

## Three-tier model

### Tier 1 — Standard library
Ships with the platform. Curated by core maintainers. Backward compatibility guaranteed.
Currently includes: `corporate-ops-web-mobile` template.

### Tier 2 — Verified registry
Community-contributed. Reviewed and badged by maintainers. Not shipped by default —
pulled on demand during `agentforge init`. Safe to use in production.

### Tier 3 — Community registry
Open contributions. No review. Explicit warning shown before installation.
Experimental — use in production at your own risk.

---

## The promotion path (platform's learning loop)

```
Tier 3 (open contribution)
    │
    │  Automated checks pass
    │  Downloads ≥ 10, active projects ≥ 1
    │  1 maintainer review approval
    ▼
Tier 2 (verified)
    │
    │  Downloads ≥ 100, active projects ≥ 3
    │  Rating ≥ 4.0 with 5+ ratings
    │  3+ production projects
    │  2 maintainer review approvals
    │  Integration tests pass
    ▼
Tier 1 (standard library — ships with next release)
```

---

## Registry architecture

The registry is a metadata service, not a file host.
It stores: slug, name, description, type, tier, version, git URL, git ref, checksum.

When a project pulls an entry:
- Tier 1 → copied from bundled platform files (no registry call)
- Tier 2/3 → registry call returns metadata → git clone from source URL → checksum verified

This means:
- Air-gapped environments work by mirroring source repos internally
- The registry has minimal infrastructure requirements
- Entries are always served from their source of truth

---

## CLI commands

```bash
# Search the registry
agentforge registry search "fintech compliance"
agentforge registry search --type harness-template --tier tier2

# Get details on an entry
agentforge registry info corporate-ops-web-mobile

# Install a registry entry
agentforge registry install fintech-saml-principles

# Submit a contribution
agentforge registry submit \
  --name "MySQL Adapter" \
  --type db-adapter \
  --git https://github.com/myorg/agentforge-mysql \
  --ref v1.0.0

# Check promotion readiness
agentforge registry promotion-check my-template-slug
```

---

## Tier 1 standard library — current contents

### `corporate-ops-web-mobile`
Complete harness for corporate operations web and mobile applications.

Includes:
- Modular monolith architecture with enforced boundaries
- RBAC middleware framework
- Audit trail enforcement (GP-002)
- Approval workflow primitive
- 7 golden principles for enterprise operations
- 11 constraint rules pre-loaded

---

## Contributing to the registry

### Quick path (Tier 3)

1. Create a repository with your harness template or adapter
2. Ensure `AGENTS.md` and `HARNESS.json` are present
3. Write a meaningful `README.md` (200+ chars)
4. Run: `agentforge registry submit --git <your-repo-url> --ref <version-tag>`
5. Automated checks run — all must pass for Tier 3 acceptance

### Path to Tier 2 verification

1. Submit as Tier 3 and gather usage (10+ downloads, 1+ active project)
2. Open a GitHub Issue: "Request Tier 2 verification for [slug]"
3. Maintainer reviews code, documentation, and security
4. On approval: entry is badged as Verified

### Path to Tier 1 inclusion

1. Entry must be at Tier 2 with strong usage (100+ downloads, 3+ production projects, 4.0+ rating)
2. Two maintainer approvals required
3. Integration tests must pass on the reference implementation
4. Entry is included in the next platform release with backward compatibility guarantee

---

## Air-gapped registry usage

Corporate environments that cannot reach the public registry can configure
an internal mirror in HARNESS.json:

```json
"registry": {
  "mirrorUrl": "https://registry.company.com/agentforge"
}
```

The platform will use the mirror URL for all registry calls. Tier 1 entries
remain bundled and are unaffected.

---

## Implementation file map

```
packages/registry/src/
├── index.ts
├── types.ts                              ✅ complete
├── api/
│   └── client.ts                         ✅ complete (registry server pending Phase 2)
├── validators/
│   └── entry-validator.ts                ✅ complete
└── promotion/
    └── promotion-engine.ts               ✅ complete

templates/
└── corporate-ops-web-mobile/            ✅ complete
    ├── README.md
    ├── harness/AGENTS.md
    ├── principles/GOLDEN_PRINCIPLES.md
    └── constraints/index.ts
```
