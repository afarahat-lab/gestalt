# Operations Runbook — AgentForge SDLC

Common issues and resolution steps for platform operators.

---

## Authentication issues

### Users cannot log in — Kerberos

**Symptom:** Browser shows a login prompt instead of seamless SSO, or returns 401.

**Check 1 — SPN registration:**
```powershell
setspn -L COMPANY\agentforgesvc
# Must show HTTP/agentforge.company.com
```

**Check 2 — Keytab validity:**
```bash
klist -k /etc/agentforge/krb5/agentforge.keytab
# Must show entries for HTTP/agentforge.company.com@COMPANY.COM
```

**Check 3 — DNS resolution:**
```bash
nslookup agentforge.company.com
# Must resolve to the server IP
```

**Check 4 — Browser compatibility:**
- Chrome/Edge: should work automatically on domain-joined machines
- Firefox: requires `network.negotiate-auth.trusted-uris` to be set

**Resolution:** See [Kerberos Troubleshooting](../guides/identity/kerberos.md#troubleshooting).

---

### Users authenticated but wrong role assigned

**Symptom:** User can log in but sees "Insufficient permissions" errors.

**Check group membership:**
```bash
agentforge debug user-role --email user@company.com
# Shows: resolved role, matched group, all IdP groups received
```

**Common causes:**
- AD group membership not propagated yet (wait up to 15 minutes)
- Group name in roleMapping does not match exactly (check DOMAIN\ prefix for ADFS)
- Azure AD: using group name instead of Object ID

---

### Local auth warning banner visible in production

**Symptom:** Dashboard shows "Local authentication is active" warning.

**Resolution:** Configure a corporate IdP provider and set local `enabled: false` in HARNESS.json.

If this is intentional and you have explicitly set `allowedInProduction: true`,
the banner cannot be dismissed — it is a permanent reminder.

---

## Agent execution issues

### Intent cycle stuck in 'analyzing' state

**Symptom:** Intent submitted but never progresses past 'analyzing'.

**Check LLM connectivity:**
```bash
agentforge debug llm-ping
# Expected: LLM connection OK, model: gpt-4o, latency: 234ms
```

**Check queue:**
```bash
docker-compose exec redis redis-cli LLEN bull:generate:wait
# If very high number: queue is backed up
```

**Check worker logs:**
```bash
docker-compose logs -f server | grep "intent-agent"
```

---

### GOLDEN_PRINCIPLE_BREACH alert not dismissible

**By design.** GOLDEN_PRINCIPLE_BREACH alerts require explicit human acknowledgement
with mandatory notes. They cannot be auto-dismissed.

To resolve:
1. Open the Alerts view in the dashboard
2. Click the alert to expand it
3. Review the breach details
4. Choose **Resume** (if the breach was a false positive or has been remediated)
   or **Abort** (if the intent cycle should be terminated)
5. Enter mandatory notes explaining your decision

All acknowledgements are permanently recorded in the audit log.

---

### Quality gate running endlessly (maxRetries exceeded)

**Symptom:** Intent cycle hits maxRetries and escalates to human.

**Diagnosis:**
```bash
agentforge intent-detail <correlationId>
# Shows all signals from each gate cycle
```

**Common causes:**
- Constraint rules too strict for the generated code pattern
- Test failures caused by a missing dependency or environment issue
- LLM consistently generating code that violates an architectural rule

**Resolution:** Review the signals, identify the recurring violation,
and either update the constraint rules or refine the intent.

---

## Deployment issues

### Docker containers fail to start

**Check logs:**
```bash
docker-compose logs postgres
docker-compose logs redis
docker-compose logs server
```

**Check environment variables:**
```bash
docker-compose config
# Verify all required variables are set
```

**Common: PostgreSQL fails with "password authentication failed":**
Check `POSTGRES_PASSWORD` in `.env` matches what was set when the volume was created.
If the password changed after first start: `docker-compose down -v` and restart
(this destroys data — backup first).

---

### Server cannot reach LLM endpoint

**Test connectivity:**
```bash
docker-compose exec server curl -I ${LLM_BASE_URL}
# Expected: HTTP/2 200 or 401 (auth error is fine — connectivity confirmed)
```

**If using Azure OpenAI behind a corporate proxy:**
```bash
# In .env
HTTP_PROXY=http://proxy.company.com:8080
HTTPS_PROXY=http://proxy.company.com:8080
NO_PROXY=localhost,postgres,redis
```

---

## Maintenance agent issues

### Drift agent reporting false positives

**Symptom:** Drift agent queuing intents for entities that are correctly documented.

**Resolution:** Review the drift findings in the Maintenance view.
If the pattern is consistently wrong, the AST parsing heuristic needs tuning.
File an issue with a sample of the false positive for the platform team.

---

## Database issues

### Oracle connection fails

**Check Oracle connectivity:**
```bash
docker-compose exec server node -e "
  const oracledb = require('oracledb');
  oracledb.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING
  }).then(() => console.log('OK')).catch(console.error);
"
```

**Common causes:**
- Oracle Instant Client not installed in the Docker image
- TNS name not resolvable from inside the container
- Firewall blocking port 1521 from the Docker network

---

## Useful diagnostic commands

```bash
# Platform health check
curl https://agentforge.company.com/health

# LLM connectivity test
agentforge debug llm-ping

# Auth debug for specific user
agentforge debug user-role --email user@company.com

# SAML claims debug
agentforge debug saml-claims --user user@company.com

# Queue depth
docker-compose exec redis redis-cli INFO keyspace

# Active agent count
agentforge status

# Tail all logs
docker-compose logs -f

# Export audit log (last 7 days)
agentforge audit export --days 7 --output audit-export.json
```
