# GitHub Actions integration

The deploy layer's `GitHubActionsAdapter` (ADR-033) drives a real CI/CD
pipeline against any GitHub-hosted project repository. This guide walks
through the one-time setup, the per-project switch, and how to verify the
integration end-to-end.

The default for fresh projects is `pipeline.adapter: noop` — the NoOp
adapter returns plausible fake values so the deploy chain progresses
without real CI. Switch to `github-actions` when the repo is ready to
accept dispatched workflow runs.

---

## Prerequisites

### PAT scopes

The personal access token registered with the project must have BOTH the
clone/push scopes and the workflow-dispatch scope:

```
GitHub PAT (classic):
  - repo       (clone, push, create PRs)
  - workflow   (dispatch GitHub Actions workflows)

GitHub fine-grained PAT (per-repository):
  - Contents:       read+write
  - Pull requests:  read+write
  - Actions:        read+write
  - Workflows:      read+write
```

If the PAT is missing `workflow`, the pipeline-agent's first
`workflow_dispatch` call returns HTTP 403 with body
`"Resource not accessible by personal access token"`. The adapter
detects this specific response and the deploy-orchestrator emits a
`GOLDEN_PRINCIPLE_BREACH` signal — the intent is escalated for human
review (never silently retried). The signal message tells the operator
exactly which scope is missing.

### Project repo requirements

The repo must contain:

1. **`.github/workflows/gestalt.yml`** — seeded automatically by
   `gestalt init`. The workflow declares `workflow_dispatch` with three
   string inputs (`environment`, `correlationId`, `branch`).
2. **`pnpm-lock.yaml`** — the default workflow runs
   `pnpm install --frozen-lockfile`. Commit your lockfile before the
   first run.
3. **A `test` script in `package.json`** that exits 0 — even
   `"test": "echo no tests"` is enough to get a green pipeline while
   you build out real tests.

The default workflow body is minimal (checkout / Node 20 / pnpm install /
pnpm test). Customise it freely; the platform only requires that
`workflow_dispatch` is wired up and the workflow file is named
`gestalt.yml`.

---

## Create the PAT (GitHub UI)

GitHub → Settings → Developer settings → Personal access tokens.

**Classic PAT (recommended for the first run):**

1. Generate new token (classic).
2. Note: "Gestalt — `<projectname>`".
3. Expiration: 90 days (or per your org policy).
4. Scopes: tick `repo` and `workflow`.
5. Generate. Copy the token immediately — you will not see it again.

**Fine-grained PAT (recommended for production):**

1. Generate new token (fine-grained).
2. Resource owner: the org or user that owns the project repo.
3. Repository access: only-select-repositories → pick the project repo.
4. Repository permissions:
   - Contents: Read and write
   - Pull requests: Read and write
   - Actions: Read and write
   - Workflows: Read and write
5. Generate.

---

## Register the project with the new PAT

```bash
cd <project-folder>
gestalt init
# Project name:         <name>
# Git repository URL:   https://github.com/yourorg/<repo>.git
# Default branch:       main
# Git PAT:              <paste the new token>
```

The server clones the repo, writes the harness (including
`.github/workflows/gestalt.yml`), commits, and pushes.

Pull the result locally:

```bash
git pull
```

If the project was already registered with a PAT that lacks `workflow`,
re-register the project so the new PAT lands in `project_git_credentials`:

```bash
# Repeat `gestalt init` with the same name + URL. The CLI does not yet
# support PAT-only rotation; this is the supported workaround.
```

---

## Switch the pipeline adapter

```bash
gestalt projects set-adapter <projectName> github-actions
```

The CLI calls `POST /projects/:id/config`. The server clones the repo,
flips `pipeline.adapter` in `HARNESS.json` from `noop` to
`github-actions`, commits as
`chore: update pipeline adapter to github-actions [gestalt]`, and
pushes to the default branch.

To switch back at any time:

```bash
gestalt projects set-adapter <projectName> noop
```

Receive the change locally:

```bash
git pull
```

---

## Verify the integration

Submit a test intent against a tiny, low-risk change:

```bash
gestalt run "Add a kebab-case utility under src/shared/utils/kebab-case with kebabCase(s: string): string"
```

Watch the platform-side stream:

```bash
gestalt logs --id <correlationId>
```

Expected sequence on the platform:

1. `intent.status-changed → generating` — generate agents run
2. `intent.status-changed → in-review` — handoff to gate
3. `gate.completed → pass` — generate's output meets the constraints
4. `intent.status-changed → deploying` — pr-agent picks up
5. `deployment.updated → pr-open` — PR opened on GitHub
6. `deployment.updated → pipeline-triggered` — workflow dispatched
7. `deployment.updated → pipeline-passed` — workflow run finished green
8. `deployment.updated → promoted (staging)`
9. `deployment.updated → promoted (production)`
10. `intent.status-changed → deployed`

Expected sequence on GitHub:

1. New branch `gestalt/<corr8>-<slug>` appears in the repo.
2. New PR opened against `main` with the intent text in the body.
3. Actions tab shows a `gestalt` workflow run started by
   `workflow_dispatch`, with `inputs.correlationId` matching the cycle.
4. Two more `gestalt` workflow runs for the staging + production
   promotions (also dispatched by the platform's token).

Cross-check the platform-side records:

```bash
# REST
curl -H "Authorization: Bearer $JWT" \
  http://localhost:3000/intents/<intentId>

# psql
docker-compose exec postgres psql -U gestalt -c \
  "SELECT event_type, environment, pr_url, pr_number, run_id, created_at
     FROM deployment_events
    WHERE correlation_id = '<corrId>' ORDER BY created_at;"
```

You should see exactly five rows in this order:

| event_type | notes |
|---|---|
| `pr-opened` | `pr_url` points at `https://github.com/.../pull/<n>` |
| `pipeline-triggered` | `run_id` is the numeric GitHub Actions run id |
| `pipeline-passed` | same `run_id` |
| `promoted-staging` | `environment = staging` |
| `promoted-production` | `environment = production` |

The `run_id` is the real numeric GitHub Actions run id — clicking it in
the Actions URL pattern
`https://github.com/<owner>/<repo>/actions/runs/<runId>` opens the live
workflow run page.

---

## Troubleshooting

### `GOLDEN_PRINCIPLE_BREACH` signal — "GitHub PAT lacks 'workflow' scope"

The PAT is missing the `workflow` scope (or, for fine-grained tokens,
`Actions: write` and `Workflows: write`). Issue a new PAT with the
correct scopes and re-register the project. The intent itself is
escalated — it does NOT retry, by design.

### Pipeline run never appears in the Actions tab

Check that `.github/workflows/gestalt.yml` is present on the default
branch (`gestalt init` seeds it; `git pull` after init brings it
locally). `workflow_dispatch` requires the workflow file to be on the
default branch — it will not dispatch a workflow that only exists on a
feature branch.

### Adapter resolved as `noop` instead of `github-actions`

Confirm `HARNESS.json` `pipeline.adapter` is `"github-actions"` on the
default branch of the project repo (`git log -- HARNESS.json`,
`git show <commit>:HARNESS.json`). The resolver reads HARNESS.json from
the cloned tip; if the `set-adapter` commit was never pushed, the
adapter stays NoOp. The deploy-orchestrator log line
`Resolved pipeline adapter` shows which adapter the cycle picked.

### Workflow run reaches the platform's 10-minute polling timeout

The CI workflow took longer than 10 minutes. `pipeline-agent` emits a
`CONTEXT_GAP` signal and the orchestrator marks the intent `failed`.
Either speed up the workflow or raise the polling budget — the budget
is currently a constant in `pipeline-agent.ts`
(`DEFAULT_TIMEOUT_MS`); a per-project HARNESS.json field is a planned
follow-up.
