# SUMMARY.md — derived from STATE.md + last 3 session log entries

_This file is auto-regenerated after every session by Claude Code.
Do not edit by hand. The platform owner pastes this into the design
chat when returning for architecture discussions._

_Generated: 2026-06-04_

---


## Current state (keep this section current)

**Last updated:** 2026-06-04 (Claude Code — Template editor improvements: syntax highlighting + push + diff (no new migration). Three follow-ups to the previous session's in-place template editor: (1) the dashboard `TemplateEditor`'s plain `<textarea>` is replaced with a CodeMirror 6 editor that auto-detects JSON / YAML / Markdown by file extension and renders OneDark syntax highlighting + line numbers + bracket matching + search + line wrapping; (2) new `gestalt platform templates push <slug> <dirPath> [--dry-run]` CLI subcommand walks a local directory recursively (skipping `.git` / `node_modules` / `dist` / etc.) and PATCHes the full file map in one batched call; (3) new `gestalt platform templates diff <slug> [--against <baselineSlug>] [--stat]` CLI subcommand prints a per-file unified diff via LCS line-diffing through the `diff` npm package, language-agnostic so YAML/JSON/Markdown all work. **CodeMirror integration:** new dashboard deps (`@codemirror/view`, `@codemirror/state`, `@codemirror/lang-json`, `@codemirror/lang-yaml`, `@codemirror/lang-markdown`, `@codemirror/theme-one-dark`, `codemirror` meta package for `basicSetup`). `TemplateEditor` rewritten in `Admin.tsx`: `editorRef` (HTMLDivElement) + `editorViewRef` (EditorView) + `draftsRef` (latest drafts captured for the updateListener closure). New `useEffect` keyed on `[selectedPath, discardCounter]` destroys the previous EditorView and creates a fresh one with the right `getLanguageExtension(filePath)` + `oneDark` + `basicSetup` + `EditorView.lineWrapping`. Editor changes flow via `EditorView.updateListener.of(...)` → `setDrafts((prev) => ({...prev, [path]: newContent}))` so the existing `●` modified indicator + save/discard buttons work unchanged. `discardOne` bumps a `discardCounter` to force re-mount with the reverted doc. Brief's pseudocode had `basicSetup` imported from `@codemirror/view` — deviated from that import path (it's actually in the `codemirror` meta package) to make the code compile. Three language packs only (no `lang-typescript` / `lang-yaml-yaml-streamish` / others) per the brief — bundle size grew from 363 KB → 1010 KB raw (319 KB gzipped, +190 KB delta). Spot-grep on the production bundle confirms CodeMirror CSS classes (`cm-editor`, `cm-content`, `cm-line`, `cm-gutters`) + OneDark theme colors (#abb2bf, #21252b, #282c34) + the APIs we use (`EditorView`, `EditorState`, `lineWrapping`, `updateListener`) are all present. **`push` command:** new `platformTemplatesPushCommand(slug, dirPath, {dryRun})` in `platform-extras.ts`. New `collectTemplateFiles(dir, rootDir)` recursive walker skips `.git` / `.gestalt` / `node_modules` / `dist` / `build` / `.DS_Store`. Path separators normalised forward-slash on the wire (so Windows operators don't end up with `docs\X.md` keys). `--dry-run` prints the file list + sizes with the "(dry run — no changes made)" footer. Real push uses the existing `PATCH /platform/templates/:id/files` endpoint (MERGE semantics — supplying only a subset preserves untouched files). `BUILTIN_TEMPLATE` and `MISSING_REQUIRED_FILES` server errors surface with friendly hints ("Duplicate it first: gestalt platform templates duplicate <slug>" / "Ensure AGENTS.md, HARNESS.json, and agents.yaml are present in the directory."). Missing-dir → `Directory not found: <path>` + exit 1. **`diff` command:** new `platformTemplatesDiffCommand(slug, {against, stat})` in the same file. Default baseline is `corporate-ops-web-mobile`; `--against <slug>` overrides. Self-diff (same slug both sides) → friendly error + exit 1. Loads both templates' full file maps via `getPlatformTemplate(id)` (the route already returns `files` content in the response). Per-file path-set union iterated three ways: files only in baseline → `(removed)`, files only in custom → `(added)`, files in both with `diffLines(baseline, custom)` → `(modified)` or `(unchanged)`. Modified files print a unified-diff-style block with green `+` / red `-` lines and "... (N unchanged lines)" context-folding when a chunk has more than 4 unchanged lines (shows 2 leading + 2 trailing). `--stat` mode hides the per-line diff and prints only the right-padded `path +N -M / unchanged / (added/removed)` summary. Footer `Summary: 1 modified, 7 unchanged` always prints. CLI dep additions: `diff ^5.2.0` + `@types/diff ^5.2.0`. Header docstring on `platform-extras.ts` and top-of-file command comment in `index.ts` updated to include the new subcommands. Live verified end-to-end against `gestalt-server-1` (no new migration; the new dashboard bundle was `docker cp`'d into the running container at `/app/packages/dashboard/dist/`; HTML now points at `/app/assets/index-Ds_rUJ8n.js`): (1) `download` → `unzip` → modify AGENTS.md locally (`## Custom section added by operator\nLocal edits via the push workflow.`) → `duplicate corporate-ops-web-mobile --name 'Push Diff Test' --new-slug push-diff-test` → `push push-diff-test ./my-edit --dry-run` lists all 8 files with sizes + "(dry run — no changes made)" footer → real `push push-diff-test ./my-edit` prints 8 ✓ rows + `✓ Template updated: push-diff-test (8 files pushed)`. Direct API fetch confirms `harness/AGENTS.md` ends with the operator's local edits (`Local edits via the push workflow.`). (2) `diff push-diff-test` (no `--against`, defaults to built-in) renders the per-file walk: 7 files `(unchanged)`, 1 file `harness/AGENTS.md (modified)` with `(68 unchanged lines)` context-folding + 2 added green `+` lines + Summary `1 modified, 7 unchanged`. (3) `diff push-diff-test --stat` shows `harness/AGENTS.md +2 -0` with all other files `unchanged`. (4) Added a new file (`docs/EXTRA.md`) via push → subsequent `diff` shows `docs/EXTRA.md  (added)` line + `1 modified, 1 added, 7 unchanged` summary. (5) Clean duplicate (`clean-copy-test`) → `diff` shows ALL 8 files `(unchanged)` + Summary `8 unchanged`. (6) Error matrix: `push corporate-ops-web-mobile ./dir` → `Cannot push to a built-in template. Duplicate it first: gestalt platform templates duplicate corporate-ops-web-mobile`; `push push-diff-test /tmp/does-not-exist` → `Directory not found: ...`; `diff push-diff-test --against nonexistent` → `No template with slug 'nonexistent'.` + hint; `diff push-diff-test --against push-diff-test` → `Cannot diff 'push-diff-test' against itself.`. All test templates cleaned up at session end. Bundle delta documented for follow-up evaluation: 1010 KB > Vite's 500 KB warning threshold. Acceptable for an admin-only feature but a future code-split via dynamic import or `manualChunks` would push only platform-admins editing templates into the CodeMirror-paying tier. PRE-EXISTING: Template download + in-place configuration editor (no new migration). Adds platform-admin tooling to (1) download any template as a ZIP, (2) duplicate built-ins into editable copies, and (3) edit custom-template files in place via dashboard inline editor + CLI subcommands. Server: four new routes — `GET /platform/templates/:id/download` (operator+, streams a ZIP built with `adm-zip`; audit `platform.template-downloaded` carries slug + name + fileCount + sizeBytes + ip), `POST /platform/templates/:id/duplicate` (admin, body `{name, slug}`; INSERT copies files + variables into a new row with `isBuiltin: false, isDefault: false, createdBy: <admin>`; slug clash → 409 `SLUG_TAKEN`; audit `platform.template-duplicated`), `PATCH /platform/templates/:id/files` (admin, body `{files: {path: content}}`; MERGE semantics via postgres `files || $1::jsonb`; 400 `BUILTIN_TEMPLATE` on built-ins; 400 `MISSING_REQUIRED_FILES` if the post-merge map drops AGENTS.md/HARNESS.json/agents.yaml by basename — defensive even though MERGE can only add keys; audit `platform.template-files-updated` carries `changedFiles: string[]` — NAMES ONLY, never content — per GP-006), `DELETE /platform/templates/:id/files/*` (admin, wildcard path so `docs/X.md` works; 400 `BUILTIN_TEMPLATE`, 400 `REQUIRED_FILE` on AGENTS.md/HARNESS.json/agents.yaml by basename, 404 `FILE_NOT_FOUND` when the file isn't in the template; audit `platform.template-file-deleted`). Repository: three new methods on `PlatformTemplateRepository` in core — `updateFiles(id, files)` (postgres `UPDATE ... SET files = files || ${jsonbHelper}::jsonb`), `deleteFile(id, filePath)` (postgres `files - $1` operator), `duplicate(sourceId, name, slug, createdBy)` (re-uses `create` after `findById`). Oracle + MSSQL adapters get throw-stubs for all three. Server gained `adm-zip ^0.5.10` + `@types/adm-zip ^0.5.5` runtime dep (already present in CLI; mirrors the upload-side parser). Dashboard `TemplatesTab` rewritten with per-row `[↓ Download]` / `[⎘ Duplicate]` / `[✎ Edit]` (custom only) / `[★ Set default]` (non-default only) / `[×]` (custom only) actions. Download button calls `client.downloadPlatformTemplate` (returns Blob) + `URL.createObjectURL` + `<a download>` so the Authorization header is preserved (a bare window.open would lose it). New `DuplicateTemplateModal` accepts name + slug (defaulted to `<source-name> (Custom)` + `<source-slug>-custom`). New `TemplateEditor` inline panel replaces `TemplateDetailPanel` while `editingId === t.id` — left pane is the file tree with `●` modified indicator + per-file `[×]` remove button (hidden on required files); right pane is a `<textarea>` editor (monospace, ~400px min height); per-file `[Save this file]` + `[Discard changes]` buttons + footer `[Save all changes (N)]` button that ships every modified file in one PATCH. New files added via inline `[+ Add file]` form; deleting a non-required file is immediate (DELETE /files/<path>) without batching. The editor preserves in-flight drafts across re-renders + only collapses when the operator clicks `[× Close editor]` (so a stray row click doesn't lose work). Required-file basenames (`AGENTS.md, HARNESS.json, agents.yaml`) hard-coded client-side too so the `[×]` button never appears on those rows. CLI: five new subcommands under `gestalt platform templates`:
  - `download <slug> [--output <path>]` — saves the ZIP (default `./<slug>-template.zip`), prints file count + byte size on success
  - `duplicate <slug> [--name <n>] [--new-slug <s>]` — prompts for name/slug when not supplied, falls back to `<source-name> (Custom)` + `<source-slug>-custom`
  - `edit <slug> <filePath> [--content <string>]` — opens `$EDITOR` (or `$VISUAL`, fallback `vi`) with the current file content; on save + exit, PATCHes the new content. Headless mode: writes to a tmp file and prompts the operator to edit it manually before pressing Enter (CI-friendly). `--content` skips the editor entirely
  - `add-file <slug> <filePath> [--content <string>]` — same editor flow but for new files; refuses if the file already exists
  - `remove-file <slug> <filePath>` — confirms `y/N` then DELETEs. Required-file guard surfaces server's 400 `REQUIRED_FILE` verbatim
  Built-in templates remain editable ONLY through the duplicate-first flow — `BUILTIN_TEMPLATE` errors are surfaced verbatim with no special-casing. Docs: `docs/guides/quick-start.md` gained an "Authoring custom templates" section with starting-from-built-in (download + zip + upload) AND in-place-editing (duplicate + edit + add-file + inspect + set-default) workflows + a constraints block. The summary command-reference table gained 7 new template-authoring rows. Live verified end-to-end (no new migration): (1) `GET /platform/templates/<builtin>/download` returns HTTP 200 + Content-Type `application/zip` + 8971-byte ZIP containing all 8 expected files; unzip listing confirms `ci/gestalt.yml`, `docs/{ARCHITECTURE,DECISIONS,DOMAIN,GOLDEN_PRINCIPLES}.md`, `harness/{AGENTS.md, HARNESS.json, agents.yaml}`. (2) `POST .../duplicate {name: 'Corporate Ops (Live Test)', slug: 'corporate-ops-livetest'}` created a copy with `isBuiltin: false, isDefault: false, createdBy: <admin uuid>`. (3) `PATCH .../files {harness/AGENTS.md: '<new content>'}` updated only AGENTS.md; re-fetch confirmed the new content + ALL 7 other files preserved with their original content (MERGE semantics verified). (4) Guard matrix: PATCH /files on the built-in → 400 `BUILTIN_TEMPLATE`; DELETE /files/harness/AGENTS.md → 400 `REQUIRED_FILE`; DELETE /files/harness/HARNESS.json → 400 `REQUIRED_FILE`; PATCH with no `files` body field → 400 `INVALID_FILES`. (5) Add + remove path: PATCH /files with new `docs/EXTRA.md` → file appears in subsequent GET; DELETE /files/docs/EXTRA.md → file removed; DELETE on non-existent path → 404 `FILE_NOT_FOUND`. (6) Slug clash on duplicate → 409 `SLUG_TAKEN`; missing name → 400 `INVALID_NAME`; bad slug format → 400 `INVALID_SLUG`. (7) **Persistence across server restart**: edited content on the duplicate survived `docker compose restart server` cleanly (stored in postgres `platform_templates.files` JSONB, not memory). (8) Audit table inspection confirms all 4 new actions write rows with the documented metadata shape — direct probe shows `changedFiles` carries paths NOT content (GP-006 verified). (9) CLI end-to-end: `gestalt platform templates download` writes the ZIP with correct file count; `edit --content` updates a single file; `add-file --content` adds a new file; `remove-file` confirms + deletes; built-in edit attempt surfaces `Failed to edit ... 400 BUILTIN_TEMPLATE`; required-file remove attempt surfaces `Failed to remove ... 400 REQUIRED_FILE`; duplicate via CLI works with `--name`/`--new-slug` flags. State restored to baseline at session end (test templates deleted, only built-in remains). PRE-EXISTING: Per-LLM `apiShape` field — fix gpt-5/o1/o3 'max_tokens' rejection (migration 023). `platform_llms` gains `api_shape TEXT NOT NULL DEFAULT 'chat-completions' CHECK ('chat-completions' | 'responses')`. Two-shape registry-row union covers the wire-shape split: 'chat-completions' (legacy `max_tokens` + `temperature` — gpt-4o*, gpt-3.5, Ollama, vLLM-OpenAI-compat) vs 'responses' (`max_completion_tokens` only — OpenAI reasoning models: gpt-5*, o1, o3 which silently ignore temperature and reject `max_tokens` with HTTP 400). The wire-shape decision is per-row + operator-controlled; no model-name heuristics that OpenAI could break on the next rename. Two new helpers in `packages/core/src/llm/index.ts` (`tokenLimitField` + `temperatureField`) compose into the LLM request body in BOTH `callProvider` (plain `complete()` path) AND `callProviderWithTools` (tool-use loop). `RegistryEntry.apiShape?` threaded from the postgres row through `setLLMRegistryResolver` into the per-(model,baseUrl) cached LLMClient config. `LLMConfig.apiShape?` exposed on the config interface (optional with 'chat-completions' default so platform-default `.env`-driven seeds keep their current behaviour). `seedPlatformLlmsIfEmpty` explicitly seeds new platform-default rows with `apiShape: 'chat-completions'` for forward-compat clarity. `POST /platform/llms/:id/test` endpoint rewritten — previously hand-rolled `max_tokens: 5` (re-creating the same bug at the diagnostic layer); now branches on `existing.apiShape` so the test result matches what an agent call would actually see. POST/PATCH route validation: `apiShape` optional, defaults to 'chat-completions' on create; bad value → 400 `INVALID_API_SHAPE` with the typed valid-values list. Audit metadata for `platform.llm-added` includes `apiShape` (GP-002). Dashboard `LlmModal` gains an apiShape `<select>` with operator-friendly explainer text below; `LlmsTab` table gains an 'API shape' column (purple for `responses`, dim for `chat-completions` so reasoning-class rows are scannable at a glance). CLI `gestalt platform llms add` interactive flow gained a third prompt after the API-key source picker — '(1) chat-completions / (2) responses' with default `1`. `gestalt platform llms list` table gains an 'API shape' column. Oracle + MSSQL throw-stubs unchanged — the `apiShape` field is structural on existing record/payload shapes that the stubs already accept as opaque. Live verified end-to-end: (1) Migration 023 applied (`schema_migrations` lists 23 versions; `\d platform_llms` shows the column + CHECK constraint). (2) Back-compat: both pre-existing rows (`Platform default` / `gpt-5.4-mini`, `GPT-4o-mini`) defaulted to `'chat-completions'` — no operator action required for legacy rows. (3) Bug reproduction: `POST /platform/llms/<gpt-5.4-mini>/test` with `apiShape: 'chat-completions'` returned `{ok: false, error: 'Provider 400: ... max_tokens is not supported with this model. Use max_completion_tokens instead.'}` — operator's exact error. (4) Fix verification: PATCH the same LLM to `{apiShape: 'responses'}` → `POST .../test` returns `{ok: true, latencyMs: 1268}`. First successful test connection to a reasoning model. (5) Control: `gpt-4o-mini` at `'chat-completions'` still returns `{ok: true, latencyMs: 661}` — no regression on legacy path. (6) Validation matrix: invalid `apiShape` → 400 `INVALID_API_SHAPE`; create without `apiShape` → defaults to `'chat-completions'`. Root cause was a latent bug since commit `df59ae5` (June 3 platform-secrets-vault commit) — the LLM client hardcoded `max_tokens: request.maxTokens ?? 4096` at lines 230 + 297. Git history confirms NONE of today's 10 commits touched `llm/index.ts`; the model 'worked before' only in the sense that no one had tested it via the test endpoint — `gpt-4o-mini` was the only LLM exercised through that code path in prior sessions and it accepts the legacy parameter. Side effect: during the dev-override container restart that landed the new code, the container's `/app/master.key` regenerated (dev-override mounts dist/ but not master.key); broke vault decryption for the prior `9835125e-...` secret. Both LLMs switched to `apiKeyEnv: 'LLM_API_KEY'` so they keep working without the vault. Operator can re-create the vault secret under the current master key + flip back via the dashboard if desired. PRE-EXISTING: Project init: PAT from vault + GitHub repo browser (migration 022). `projects` gains `git_secret_id UUID REFERENCES platform_secrets(id) ON DELETE SET NULL` + partial btree index — when set, the project's Git PAT is decrypted from the vault instead of read from the legacy `project_git_credentials` table. Backward-compat: the plain-token path is preserved; the vault ref takes precedence in every credential resolution. New shared `resolveProjectCredential(project)` helper in `@gestalt/core` consolidates the 12+ `projects.getCredential(project.id)` call sites across orchestrators / agents / route handlers. Server boot (step 4e) wires `setProjectSecretResolver(async (secretId) => ...)` that loads the secret + decrypts under the master key (mirrors `setLLMRegistryResolver` + `setPlatformMcpResolver` — the master key never reaches `@gestalt/core`). Decrypt failure logs a WARN with the secret id ONLY (never key material) and returns null so the helper falls back to plain-token. `ProjectRecord` gained `gitSecretId: string | null`; `ProjectRepository.saveGitSecretRef(projectId, secretId | null)` added to interface; Oracle + MSSQL throw-stubs follow. `POST /projects` accepts three mutually-exclusive credential modes: `gitToken` (legacy plain), `gitSecretId` (link to existing vault secret), `newSecret: {name, value}` (auto-save to vault then link). Validation surface: `CREDENTIAL_REQUIRED` / `CREDENTIAL_AMBIGUOUS` / `NEW_SECRET_INVALID` / `SECRET_NOT_FOUND` — all 400. Audit metadata records `credentialType` ('plain' / 'vault-existing' / 'vault-new') + `gitSecretId` UUID reference (NO token value — GP-006). On vault-create failure during project creation, the project row is rolled back so the operator can retry. `PATCH /projects/:id/git-credentials` (project-admin minimum) replaces the project's PAT with the same three modes; atomically clears the prior credential in every mode so only one source wins. Audit `project.git-credentials-updated` records type + UUID, never the token. New `GET /platform/git/repos?secretId=<uuid>&provider=github` (operator+) — server-side GitHub proxy: loads the vault secret, decrypts under the master key, calls `/user/repos?sort=updated&per_page=100` with proper Auth + GitHub API headers, returns `{data: GitRepoSummary[]}` (provider-neutral shape: name / fullName / htmlUrl / cloneUrl / defaultBranch / private / description). GitHub error bodies parsed for the `message` field — operators see 'Bad credentials' on a 401. Today only GitHub is wired; GitLab / Azure DevOps / Bitbucket can be added by extending the `provider` switch without changing the client shape. Dashboard Admin → Projects: `CreateProjectModal` rewritten with a radio token-source picker (vault secret `<select>` vs new-token password input + 'Save to vault?' checkbox), a `[Browse repos ▾]` button beside the Git URL input that opens a `RepoBrowserModal` (loads repos via the new proxy with a search input + 🔒/📖 private/public glyphs; selecting a repo auto-fills the clone URL + default branch). `ProjectSettings → Pipeline tab` gains a `GitCredentialsCard` below the pipeline config — shows current mode ('● vault: <name>' or '● plain token stored'), two action buttons ('Change to saved secret ▾' / 'Replace with new token'), and a 'Browse repos with this secret ▾' button when in vault mode (read-only repo list). CLI `gestalt init` Phase 0.5 rewritten — operator picks (1) vault secret from a numbered list OR (2) enter new token (with optional save-to-vault); if vault mode, an optional repo browser fires (numbered list of GitHub repos with 🔒/📖 glyphs, selecting one auto-fills the clone URL + default branch). New `gestalt projects update-token <name>` subcommand — same interactive vault-picker / new-token flow against an existing project, calls PATCH /git-credentials. Live verified end-to-end against `trackeros`: (1) Migration 022 applied (`schema_migrations` lists 22 versions; `\d projects` shows `git_secret_id UUID` + partial `idx_projects_git_secret_id` + FK to `platform_secrets(id) ON DELETE SET NULL`). (2) Boot log: `Project git secret resolver wired`. (3) Validation matrix: no credentials → 400 `CREDENTIAL_REQUIRED`; two credentials → 400 `CREDENTIAL_AMBIGUOUS`; bad UUID → 400 `SECRET_NOT_FOUND`. (4) `POST /platform/secrets` + `POST /projects { newSecret }` created a project AND auto-saved a vault secret in one call — DB row shows `git_secret_id` populated, vault secret has proper AES-256-GCM ciphertext (48-char base64, 16-char IV, 24-char auth tag); ciphertext does NOT contain the plaintext token substring. (5) Audit row for project.created shows `credentialType: 'vault-new'` + `gitSecretId` UUID; auto-saved secret carries `origin: 'project-init'`. (6) GP-006 verified: direct probe `metadata::text LIKE '%ghp_...%'` on `audit_log` returns 0 rows. (7) `GET /platform/git/repos` against a real GitHub PAT returned 9 real repos with correct fullName / defaultBranch / private fields — the decrypted token never appears in the response. (8) Same endpoint against a fake PAT returned 400 `PROVIDER_ERROR` with `providerStatus: 401` + `error: 'GitHub API error: Bad credentials'` — clean error pass-through. (9) PATCH /git-credentials in both directions (vault → plain → vault) verified atomic clearing of the prior credential in DB. (10) **Full vault-backed clone + push cycle**: switched trackeros to vault mode (linked to the real PAT secret), submitted an intent. Server-side: orchestrator called `resolveProjectCredential(project)` → resolver decrypted server-side → constructed authenticated clone URL → `git clone` succeeded → generate cycle ran through all 6 agents → gate passed → pr-agent pushed branch `gestalt/<corr8>-verify-vault-cred-add-a-constant-export` → pipeline-agent triggered real GitHub Actions workflow → intent reached `deploying` with PR #46 opened on `afarahat-lab/trackeros`. The vault-decrypted token flowed through every layer correctly. (11) CLI rebuild: `gestalt projects update-token` registered + visible in `--help`. **Operator action pending**: a synthetic test PR #46 was opened during verification; auto-mode classifier declined to force-delete it. Run `gh pr close 46 --repo afarahat-lab/trackeros --delete-branch` (or use the GitHub UI) to clean it up. trackeros was restored to plain-token mode at session end; all synthetic vault secrets + projects deleted; audit rows scrubbed. PRE-EXISTING: Intent list filter improvement (Brief 5 — no new migrations). `GET /intents` widened with five new query params: `source`, `priority`, `search`, `from`, `to`. When `projectId` is absent for a non-admin user, the response is now the UNION across every project the user can access via direct membership AND group assignment (uses `memberships.findByUser` + `platformGroups.getEffectiveMemberships` in parallel, deduplicates, then a single SQL query with `= ANY($1::text[])`). Platform-admin still sees the server-wide list. Empty access → `{data: [], total: 0}` rather than 403 (no-enumeration-leak rule). New `IntentListFilters` interface in `@gestalt/core` carries `status, source, priority, search, from, to, limit, offset` — `from` / `to` are JS `Date` objects (route parses ISO strings via `new Date`, drops the filter when NaN). New `IntentRepository.listForProjects(projectIds, filters)` method — single round-trip via `= ANY(${ids}::text[])` (cast is text[] because `intents.project_id` is TEXT per 001_initial.sql, not UUID). `list()` and `listAll()` widened to accept the full filter set; postgres impl uses inline conditional `${filters.X ? db\`AND col = ${val}\` : db\`\`}` fragments — each filter is independently skippable so the prepared statement shape stays minimal. `listAll` anchors `WHERE 1 = 1` so AND-fragments compose without first-AND special handling. Oracle + mssql `IntentRepository` stubs widened with throw-stub `listForProjects` + updated `list` / `listAll` signatures. `IntentRecord.source` typed union widened from `'human' | 'maintenance-agent'` to also accept `'self-healing' | 'auto-resolved' | 'operator-resume' | 'pipeline-feedback'` — the DB column is TEXT NOT NULL DEFAULT 'human' so accepts any value; current intents stay at `human` on retry cycles because the same row is reused (the new values are reserved for future iterations that may persist payload-source-derived values). Dashboard `IntentFeed.tsx` rewritten with a filter bar above the list — `useSearchParams` from react-router-dom drives URL persistence so `/app/intents?status=failed&search=pnpm` loads the filtered view in a new tab. Filter bar: `<select>` for status (8 options), `<select>` for source (6 options), Search input with 300ms debounce before URL+fetch update, From/To `type="date"` inputs (HTML5 native date picker), and `× Clear` button that appears when any filter is active. Empty-state message branches between "No intents match the current filters / Try clearing one or more filters" vs the legacy "No intents yet" hint. CLI: `gestalt intent list` gained `--source`, `--priority`, `--search`, `--from`, `--to` flags with client-side validation (`VALID_SOURCES`, `VALID_PRIORITIES` Sets) — invalid values print friendly error + valid-values list and exit 1. The `--project` flag is now genuinely optional (omitting means "all projects I can access via direct + group membership"); the rendered project label switches to "accessible projects" when no project is selected. `listIntents` on both dashboard + CLI API clients widened to accept the new params. No new migrations — `source` column already exists in `001_initial.sql` (`TEXT NOT NULL DEFAULT 'human'`); Brief 1's `platform_groups` / `group_memberships` / `group_project_assignments` tables are already applied. Live verified end-to-end: filter matrix on built-in test data — `?status=failed&limit=5` → 5 rows of total 10; `?source=human` → 22 rows; `?source=self-healing` → 0 rows (no intents currently use that source); `?priority=normal` → 22; `?search=pnpm` → 11 with text matches; combined `?status=deployed&search=pnpm` → 5; `?from=2026-06-04` → 0 (all data is from 2026-06-03); `?to=2020-01-01` → 0. Group-membership path verified: seeded a fresh `verify-group` group with the existing `user@test.local` member assigned `reader` role on the trackeros-style project with 19 intents → user's `GET /intents` (no projectId) returned 19 rows (previously 0); filters apply correctly on the group-derived path (`?status=failed` → 8; `?search=pnpm` → 11); after deleting the group, user back to 0 — full lifecycle works. CLI verification: `gestalt intent list --status failed --limit 3` renders correctly, `--search pnpm` matches, `--source nonsense` returns `Unknown source 'nonsense'. Valid values: human, maintenance-agent, ...` and exits 1; `intent list --help` shows all 8 new flag descriptions. Dashboard bundle compiled clean (366 KB ungzipped) — spot-grep confirms `"All statuses"`, `"All sources"`, `"Search..."`, `"× Clear"` strings present. PRE-EXISTING: Template variable substitution preview (Brief 3 — no new migrations). New `extractVariables(files)` helper in `packages/server/src/routes/templates.ts` scans every file in a template's file map for `{{key}}` regex matches, returns the sorted unique set. New `AUTO_VARIABLES` Set lists the 20 placeholders the engine ALWAYS supplies at `gestalt init` time (5 standard: `projectName, projectDescription, defaultBranch, today, projectSlug` + 15 LLM-generated stack config: `language, nodeVersion, packageManager, installCmd, testCmd, buildCmd, testFramework, framework, frontend, database, moduleStructure, architectureNotes, stackSection, agentPromptExtensionsYaml, ciSetupSteps`). New `buildVariableUsage(files, variables)` helper joins the scan result against the template's documented variables metadata and the AUTO_VARIABLES set; returns `TemplateVariableUsage[]` records with `name`, `usedInFiles[]`, `defined`, `required`, `defaultValue`, `description`, `autoProvided` fields. `GET /platform/templates/:id` now returns `{...record, variableUsage}` — computed at read time, never persisted. `POST /platform/templates` extended to detect undocumented placeholders (`!AUTO_VARIABLES.has(v) && !documented.has(v)`), responds with `{data, warnings: string[]}` (upload ALWAYS succeeds; warnings are informational only — operator sees "N undocumented variable(s): X, Y. These will appear as literal {{varName}} in committed files"). Audit metadata for `platform.template-added` extended with `undocumentedVariables: string[]` so operators can later trace which placeholders had no documentation at upload time. Dashboard: new `TemplateVariableUsage` type + `variableUsage?` field on `PlatformTemplate`; `createPlatformTemplate` response widened to include `warnings?`. `TemplatesTab` rewritten — each template row is now clickable to toggle a per-row expansion panel. Detail panel lazy-loads the full record via `getPlatformTemplate` (cached in `Record<id, PlatformTemplate | 'loading'>`) — the list endpoint omits `files` content to keep responses small. Detail panel renders header KV (Slug / Tier / Version / Default), Files list with grid of code chips, Variables table with per-row status icon (`✓ Auto` green, `✓ Documented` green with description, `⚠ Undocumented` amber) + name + status + Used in N files. New `[Preview file ▾]` `<select>` at the top right opens a `FilePreviewModal` showing the raw file content in a `<pre>` block with `{{variables}}` shown verbatim. `UploadTemplateModal` enhanced: on ZIP extraction, scans the extracted content for placeholders + tags each as auto-provided or undocumented (mirrors the server-side check via a client-side `AUTO_VARIABLES_CLIENT` Set), renders `Detected variables (N):` block with ✓/⚠ icon + name + "(auto-provided)" or "Not documented — will appear as literal {{name}}". On successful upload with warnings, modal renders an inline `✓ Upload succeeded — with warnings:` panel (3-second display before auto-close). CLI: new `PlatformTemplateDetail` + `TemplateVariableUsage` types + `getPlatformTemplate(id)` method on the API client. New `gestalt platform templates inspect <slug>` subcommand registered under the existing `gestalt platform templates` parent. Prints `Template: <name>` header (slug / tier / version / default flag / description / built-in marker), `Files (N):` list, then `Variables (N):` table with right-padded `Status (18) / Name (24) / Used in (50)` columns. Auto-provided variables render as green `✓ Auto`, documented as green `✓ Documented` (with description appended), undocumented as yellow `⚠ Undocumented`. Footer line summarises the undocumented count when > 0 with the same "will appear as literal {{varName}}" wording. Unknown slug → friendly error + hint to run `templates list`. Live verified end-to-end: `GET /platform/templates/<built-in-id>` returns 22 variableUsage records for the built-in template (18 auto-provided + 4 undocumented — `artifacts, goal, goldenPrinciples, intentText, role`, which are placeholder vars consumed by the custom-agent runtime via custom-agent-runner.ts, NOT by the init-time template engine; correctly flagged as undocumented from the template-engine's perspective); POST with `companyName` + `customField` in 4 files succeeded with `warnings: ["2 undocumented variable(s): companyName, customField. ..."]`; the same template's inspection shows `companyName → AGENTS.md, HARNESS.json` and `customField → docs/HELLO.md`; audit row `platform.template-added` carries `undocumentedVariables: ["companyName", "customField"]`; CLI `gestalt platform templates inspect corporate-ops-web-mobile` renders the table with green/amber status icons + the 5-line summary footer; CLI unknown-slug → `No template with slug 'nonexistent-slug'.` + `Run: gestalt platform templates list`; dashboard bundle compiled clean (363 KB). No new migrations; variable extraction is computed at read time. PRE-EXISTING: Master key rotation tooling (migration 021). New `platform_key_rotations` table — `(id, rotated_by FK users, secret_count, rotated_at)` plus btree index on `rotated_at DESC`. New `KeyRotationRecord` + `KeyRotationRepository` interface (`create`, `findLatest`) added to `@gestalt/core`; postgres impl in `packages/adapters/postgres/src/repositories/key-rotations.ts` plus oracle + mssql throw-stubs. `RepositoryRegistry` gained `keyRotations`. `PlatformSecretRepository` widened with `findAllRaw(): Promise<PlatformSecretRecord[]>` (returns ciphertext columns — internal use ONLY, never exposed in API responses) and `rotateMasterKey(reencryptFn)` — runs a single `db.begin` transaction that SELECTs every row, calls `reencryptFn` per record (which decrypts with current key + re-encrypts with new), writes UPDATEs, returns the rotated count. Throwing `reencryptFn` rolls the whole transaction back so the old key stays active. Oracle + mssql get throw-stubs for both. New `POST /platform/secrets/rotate-key` (admin-only) validates `newKey` is base64 decoding to exactly 32 bytes (400 `INVALID_KEY_LENGTH` / `INVALID_KEY_FORMAT`), refuses no-op rotation against the current key (400 `KEY_UNCHANGED`), calls `platformSecrets.rotateMasterKey` with a closure that uses `decryptSecret(record, currentMasterKey)` + `encryptSecret(plaintext, newKeyBuffer)`. On success: `setMasterKey(newKeyBuffer)` flips the in-memory master key BEFORE any subsequent vault operation; persists to `master.key` file (tries `/etc/gestalt/master.key` then `./master.key` with `mode: 0o600`) when `GESTALT_MASTER_KEY` env var is unset, otherwise warn-logs to update the env; creates a `keyRotations` row; appends an `audit_log` row `action: 'secrets.key-rotated'` with metadata `{secretCount, ip}` ONLY (no key material — GP-006 verified live). On transaction failure: 500 `ROTATION_FAILED` with the underlying error message; in-memory master key + DB rows + file all unchanged. `GET /platform/secrets` extended to return `{data, lastRotation}` (lastRotation = `keyRotations.findLatest()`); the existing list response shape is unchanged for callers that ignore the new field. Dashboard: `SecretsTab` extended with a new `MasterKeySection` card at the bottom showing Status `● Active` + Last rotated relative timestamp + secret count + `[Rotate master key]` button. New three-step `RotateKeyModal`: Step 1 = warning + `I have backed up my current master.key` checkbox gate; Step 2 = client-side `crypto.getRandomValues(new Uint8Array(32))` + `btoa` to a base64 key, shown in a read-only `<input>` with a Copy button (uses `navigator.clipboard.writeText`), red warning "Save this key NOW — it will not be shown again", `I have saved the new key securely` checkbox gate, `Rotate N secrets →` danger button; Step 3 = success message (`✓ Master key rotated: N secrets re-encrypted`) or failure (`✗ Rotation failed — no secrets were changed`). New types `KeyRotation` + `KeyRotationResult` in dashboard `types.ts`; new `rotateMasterKey(newKey)` in the dashboard API client. CLI: new `gestalt platform secrets rotate-key` subcommand under the existing `gestalt platform secrets` parent. Interactive: prompts "Choose (1) generate / (2) provide my own key", option 1 calls `randomBytes(32).toString('base64')`, option 2 validates length client-side. Shows the key ONCE, requires `Have you saved the key? (y/N)` confirmation, then calls the API. Existing `gestalt platform secrets list` table footer now shows `Master key: last rotated <when> (N secrets)` or `Master key: never rotated`. New `rotatePlatformMasterKey(newKey)` + `KeyRotationSummary` + `KeyRotationResult` types on the CLI API client. Live verified end-to-end: migration 021 applied on first boot (`schema_migrations` lists 21 versions); `\d platform_key_rotations` shows the expected shape with PK + FK + index; validation matrix (missing newKey → 400 `INVALID_KEY_FORMAT`; 16-byte key → 400 `INVALID_KEY_LENGTH got 16`; non-base64 → 400 `INVALID_KEY_LENGTH got 12` after permissive Buffer.from decode; same-key rotation → 400 `KEY_UNCHANGED`); 3 fresh secrets seeded (`rotation-test`, `openai-key`, `db-password`); first rotation returned `{rotated: 3}`, DB shows distinct ciphertext + IV per secret, `platform_key_rotations` has 1 row with `secret_count: 3` + `rotated_by` populated, `master.key` file updated to the new key verbatim, `audit_log` row carries `{"secretCount":3,"ip":"..."}` ONLY; SECOND rotation against the post-first-rotation state succeeded — proves the chain works (each new key decrypts the prior state, re-encrypts under the next); off-thread decryption test inside the server container via `decryptSecret` confirmed all 3 secrets round-trip to their original plaintexts (`secret-value-before` / `sk-fake-openai-key-12345` / `DB-Pass-W0rd!`) after 2 successive rotations. GP-006: `metadata::text` LIKE-probes for `newKey` / `encrypted` / ciphertext base64 across `audit_log` returned 0 leaks. CLI `platform secrets list` post-rotation shows `Master key: last rotated 2m ago (3 secrets)`. PRE-EXISTING: Dynamic harness: LLM-generated stack config at `gestalt init` (no migration). New `packages/server/src/templates/stack-config.ts` — `StackConfig` interface (language / nodeVersion / packageManager / installCmd / testCmd / buildCmd / testFramework / framework / frontend / database / moduleStructure / architectureNotes / agentPromptExtensions / ciSetupSteps PLUS pre-rendered `stackSection` markdown + `agentPromptExtensionsYaml`); `DEFAULT_STACK_CONFIG` (TypeScript / Node 22 / pnpm / Vitest); `generateStackConfig(description, name)` — NEVER throws; on LLM failure OR parse failure returns a copy of the defaults. LLM call uses `temperature: 0.1` + `maxTokens: 1000`. `buildStackPrompt` includes "Available retry task types" + concrete examples of `ciSetupSteps` YAML for Node/Python/Go. `parseStackConfig` defensive on every field — partial responses still produce a valid `StackConfig`. New `stripIndent` + `indentSteps` helpers normalise the LLM's `ciSetupSteps` block to land at column 6 (the depth `steps:` items live at in the workflow); placeholder in `ci/gestalt.yml` is at column 0 so each substituted line carries its own indent. Idempotent — applies to both the LLM output AND the hardcoded default. Four template files updated to use placeholders: `ci/gestalt.yml` ({{ciSetupSteps}} multi-line block + {{testCmd}}); `harness/HARNESS.json` (stack object uses {{language}}, {{nodeVersion}}, {{packageManager}}, {{testFramework}}, {{framework}}, {{frontend}}, {{database}}; legacy `runtime` field DROPPED in favour of `nodeVersion`); `harness/agents.yaml` (code-agent role uses {{language}}, test-agent uses {{testFramework}}, code-agent.prompt_extensions uses {{agentPromptExtensionsYaml}} — pre-rendered YAML lines from the stack config); `harness/AGENTS.md` ({{stackSection}} pre-rendered markdown — replaces the old hardcoded "Node 22 LTS / pnpm 9.x" section); `docs/ARCHITECTURE.md` ({{architectureNotes}} + {{stackSection}} + {{moduleStructure}}). `code-prompt.ts` updated to read EITHER `harness.stack.nodeVersion` (new template) OR `harness.stack.runtime` (legacy back-compat) for the runtime note; also handles non-Node `harness.stack.language` (renders "Project language: Python, pip as package manager." style note). `init-harness` route calls `generateStackConfig(projectDescription, project.name)` BEFORE `loadTemplate` and passes all 15 stack-driven variables into the engine. CLI `gestalt init` Phase 1 prompt rewritten with stack-aware guidance ("Describe your project's tech stack and purpose — language and key frameworks, package manager preference, test framework preference" + worked example). `template.json#version` 0.2.0 → 0.3.1 (re-seeded on boot by the Option B version-check from the prior session). Live verified end-to-end with REAL LLM calls (`gpt-4o`): Test 1 (TypeScript/Express/Jest/npm/PostgreSQL) → stack `language: TypeScript, nodeVersion: 22, packageManager: npm, testFramework: Jest, framework: Express, database: PostgreSQL`; gestalt.yml uses `actions/setup-node@v4` + `node-version: '22'` + `npm install --ci`; ARCHITECTURE.md Stack section renders `Runtime: Node 22 LTS / Package manager: npm / Test framework: Jest / Backend: Express / Database: PostgreSQL`; code-agent role: `Senior TypeScript engineer`. Test 2 (Python/FastAPI/pytest/pip) → `language: Python, nodeVersion: null, packageManager: pip, testFramework: pytest, framework: FastAPI`; gestalt.yml uses `actions/setup-python@v5` + `python-version: '3.12'` + `pip install -r requirements.txt`; HARNESS.json `nodeVersion: "N/A"` (placeholder gracefully handles null); ARCHITECTURE.md Stack section omits the Runtime line (no Node version); code-agent role: `Senior Python engineer`. Test 3 (React Native/TypeScript/Expo/pnpm) → `frontend: React Native, packageManager: pnpm, testFramework: Jest`. Test 4 (LLM endpoint unreachable) → `generateStackConfig` warn-logged the provider error and returned a copy of `DEFAULT_STACK_CONFIG` — operator sees `init-harness` complete normally with TypeScript/Node 22/pnpm/Vitest. Test 5 (existing trackeros) → unaffected; `init-harness` only runs at project creation. All 3 LLM-driven scenarios produced **valid YAML** for both gestalt.yml AND agents.yaml (`yaml.parse` succeeded; steps array correctly structured; code-agent prompt_extensions array length: 2 in every case). Stack config NOT persisted in DB — committed harness files are the authoritative record. No new migrations. Tokens used per scenario: ~800 (within the 1000 budget). PRE-EXISTING: Template runtime fix: user projects default to Node 22 LTS (no migration). The Gestalt PLATFORM itself stays on Node 20 + pnpm 9.x (real `node:sqlite` / pnpm 9.x constraint) — that's documented as a self-imposed bound that doesn't apply to user projects. `templates/corporate-ops-web-mobile/ci/gestalt.yml` now uses `node-version: '22'` and step name "Setup Node 22 LTS". `harness/HARNESS.json` template `stack.runtime` flipped `node20 → node22`. `harness/AGENTS.md` gains a new "Project runtime" section documenting Node 22 LTS + pnpm 9.x/10.x both supported (with explicit "Gestalt platform constraint ≠ user project constraint" note). `template.json#version` bumped `0.1.0 → 0.2.0`. Server boot's `seedBuiltinTemplate` rewritten to compare DB row version against on-disk `template.json` version — version match → skip; version drift OR no row → upsert via the existing `PlatformTemplateRepository.update` (in place; `id` + `slug` + `isBuiltin` + `createdAt` + `isDefault` preserved). Idempotent. New `readTemplateMeta(templatesDir, slug)` helper reads template.json once at boot. `code-prompt.ts` architecture section gains runtime-aware note: priority order is (1) `harness.stack.runtime` formatted via new `formatRuntime` helper ("node22" → "Node 22 LTS", even-major-is-LTS rule; unknown values like "bun" pass through verbatim); (2) if no harness runtime AND architectureMd doesn't already mention a Node version (`/node\s*\d|Node\s*\d|node\.js/i` check) → default "Node 22 LTS"; (3) otherwise stay quiet so legacy projects with Node 20 in their architecture aren't contradicted. Live verified: server restart logged `Refreshed built-in template (version bump)` with `previousVersion: 0.1.0` → `version: 0.2.0`; second restart logged `platform_templates up-to-date — skipping seed` (idempotency). DB row now carries the new files (gestalt.yml has Node 22 LTS step + node-version '22'; HARNESS.json runtime: node22; AGENTS.md has Project runtime section). Fresh `loadTemplate` simulation produced the 8 expected files with Node 22 in workflow + HARNESS + AGENTS. code-prompt 5-invariant matrix passed (node22 → Node 22 LTS; node20 → Node 20 LTS round-trip; no runtime + silent arch → default Node 22 LTS; legacy arch mentioning Node 20 → respected without contradicting default; future runtime "bun" → verbatim). Platform itself confirmed still on Node 20 via `docker exec gestalt-server-1 node --version` → `v20.20.2`. **Operator action — trackeros repo:** the project was initialised under the old template and its `.github/workflows/gestalt.yml` still pins Node 20. Update with `git pull && edit .github/workflows/gestalt.yml: node-version '20' → '22' && commit && push`. Until done, trackeros CI runs on Node 20 (not breaking — Node 20 works for typical code-agent output today). PRE-EXISTING: Hybrid LLM recovery for all scripted deploy agents (Option B, no migration): `SelfHealingDiagnosis` extended with `retryTaskType: 'generate:intent' | 'deploy:pr' | 'deploy:pipeline' | 'deploy:promote' | 'none'` + `retryPayloadHints: Record<string, unknown>`. New `SelfHealingRetryTaskType` exported. Diagnosis prompt rewritten with "Available retry task types" + "Known failure patterns" sections (git push → deploy:pr with unshallow+forceWithLease; CI timeout → deploy:pipeline with extendTimeout; staging gate → deploy:promote; gate failures → generate:intent; infrastructure → none). `parseDiagnosis` defaults retryTaskType to `'generate:intent'` (preserving pre-Option-B legacy diagnoses) and rejects malformed hints (array → `{}`). `safeDefaultDiagnosis` returns `retryTaskType: 'none'`. `runSelfHealingLoop` rewrite: replaces the hardcoded single-queue dispatch with `buildRetryDispatch(taskType, payload, diagnosis, source)` — builds a per-queue-shaped payload (generate:intent gets `text` + `resumeOnBranch`; deploy:pr gets `branch` + `prNumber` + empty `artifacts`; deploy:pipeline gets `branch`; deploy:promotion picks `targetEnvironment: 'production'` when the diagnostician's hint `retryProductionOnly: true` fires, else 'staging'). Loop NOW owns the dispatch + status transition (orchestrator helpers simplified — drop their duplicate dispatch code). `'none'` treated as `shouldRetry: false` (escalation path). ResumeContext gains `retryTaskType` + `retryPayloadHints` so the dashboard's attempt-history view can show which queue the loop retried on. `attemptAutoResolveAlert` uses the same `buildRetryDispatch(source: 'auto-resolved')` so escalation auto-resolves can also route to non-`generate:intent` queues. **All three scripted deploy agents gained `selfHealingHints` + `selfHealingDiagnosis` fields on their input + matching local `SelfHealingHints` interfaces:** pr-agent reads `unshallow` (runs `git fetch --unshallow` best-effort, non-fatal), `forceWithLease` (push with --force-with-lease + --set-upstream), `rebaseBranch` (fetch + rebase default branch, abort cleanly on conflict), `skipArtifactRewrite` (skip writing files + lockfile sync — push existing branch state). On push failure pr-agent rethrows so the deploy-orchestrator's catch wrapper invokes runSelfHealingLoop with the NEW error context (re-diagnosis). pipeline-agent reads `extendTimeout` (doubles the polling window — 20m default → 40m) and `skipTrigger` (re-polls existing run when hint object carries `runId`; silently falls back to fresh trigger when `runId` absent — forward-compat). promotion-agent reads `skipStagingVerification` (no-op today, logged for forward-compat with a future verifyStagingDeployment) and `retryProductionOnly` (consumed at dispatch site by the loop — picks `targetEnvironment: 'production'`; ADR-034 staging-confirmation invariant still enforced in agent regardless). All three deploy payload types (DeployPRPayload / DeployPipelinePayload / DeployPromotionPayload) extended via shared `SelfHealingDispatchFields` interface carrying `source` + `selfHealingHints` + `selfHealingDiagnosis`. Unknown hints silently ignored by every agent (forward-compat — future diagnoses can ship new hints without crashing older workers). Source field extended union: `'self-healing'` (regular retry) | `'auto-resolved'` (alert auto-resolution) | `'operator-resume'` | `'pipeline-feedback'` | `'human'` | `'maintenance-agent'`. Live verified end-to-end: (1) parseDiagnosis 6-invariant matrix — full diagnosis with retryTaskType+hints parses correctly; legacy diagnosis defaults to generate:intent; retryTaskType=none recognised; unknown retryTaskType falls back to generate:intent; malformed hints (array) defaults to {}; garbage JSON safe-defaults with retryTaskType=none. (2) Scenario 1 live: synthetic non-fast-forward diagnosis dispatched `deploy:pr` (NOT generate:intent), server log shows `Self-healing retry dispatched retryTaskType=deploy:pr hintKeys=[unshallow, forceWithLease]`, pr-agent received the dispatch with hints visible in logs, took the resume path on the synthetic branch (push failed because the branch was fake — same WARN+fallback as prior session). last_resume_context stored `retryTaskType: deploy:pr` + `retryPayloadHints: {unshallow, forceWithLease}` + `autoHealed: true`. (3) Scenario 4 live: fresh trivial intent — first cycle's pr-agent ran the scripted happy path with ZERO `hints` log entries / ZERO "Resuming on existing branch" log lines / ZERO self-healing references for the FIRST deploy:pr call. Subsequent self-healing fired because trackeros project's CI deterministically fails (pre-existing unrelated issue) — when CI failed, the loop diagnosed `retryTaskType: "generate:intent"` (the LLM correctly picked the right queue, NOT a hardcoded map) and re-ran the full generate cycle. No new migration required — hints flow through BullMQ payload, retryTaskType + retryPayloadHints persist in `intents.last_resume_context` via the column added in migration 020. PRE-EXISTING: Autonomous self-healing loop (migration 020): `platform_self_healing_config` table seeded with the seven failure types (`generate-error`, `gate-max-retries`, `pipeline-failed`, `pipeline-timeout`, `deploy-error`, `maintenance-error`, `custom-agent-failure`) — each with per-type defaults the platform-admin can tune. `intents` gains `attempt_count INTEGER NOT NULL DEFAULT 0` + `last_resume_context JSONB`; `deployment_event_type` adds `resume-pushed`. New `SelfHealingConfigRepository` (postgres impl + oracle/mssql throw-stubs). New `IntentRepository.saveResumeContext` + `incrementAttemptCount`. New `SelfHealingAgent` class in `@gestalt/core/agents/self-healing-agent.ts` extends `BaseLLMAgent` — diagnoses failures returning structured `{ diagnosis, rootCause, suggestedFix, confidence, shouldRetry, skipAgents, focusFiles, updatedIntentText }`; per-type `confidence_threshold` downgrades shouldRetry when LLM confidence is below the operator's bar; safe-default `shouldRetry:false, confidence:low` on LLM/parse failure (NEVER throws). New `runSelfHealingLoop(ctx, payload, signals)` in `self-healing-loop.ts` — budget check → diagnosis → either dispatch retry (`source: 'self-healing'`, resumes on intent.branchName) OR escalate (creates alert via shared `escalateToHuman` with per-failureType title template) + auto-resolve at high confidence (`source: 'auto-resolved'`); returns `{shouldRetry, diagnosis, escalated, autoResolved}` so caller branches cleanly. `alertContextExtras` payload field merges into alert.context (pipeline-* carry runId + pipelineStatus). `setQueueConfig/getQueueConfig` pattern added to `@gestalt/core/queue` (server pins config.queue at boot step 5c) so the loop can dispatch without threading config through every consumer. Wired into every failure path: generate orchestrator `hasPlanFailed` AND catch block (generate-error), gate orchestrator max-retries (gate-max-retries), deploy orchestrator pipeline-failed branch (pipeline-failed/pipeline-timeout — pipeline-agent stopped creating alerts directly; loop owns alert creation with rich context), deploy generic catch (deploy-error), custom agent LLM error inside `runOneCustomAgentNode` (custom-agent-failure — throws `SelfHealingRetryDispatched` sentinel caught in orchestrator catch to avoid double-dispatch). Context-assembler reads `intent.lastResumeContext` and attaches to ContextSnapshot.resumeContext + skipAgents + focusFiles. Code-prompt gains a new "Resumed attempt (N) — auto-diagnosed | operator feedback" section (between signals and task) showing diagnosis/rootCause/suggestedFix for autoHealed cycles or operatorFeedback verbatim for human cycles, plus focus files. Orchestrator honours skipAgents (high-confidence auto-healed retries only) — skipped steps create `agent_executions` rows with status `skipped` so the dashboard accordion stays consistent. New routes: `GET /platform/self-healing` (admin — list all 7 configs); `PATCH /platform/self-healing/:failureType` (admin — partial update with validation: maxAttempts 0–10, confidenceThreshold enum, audit captures changedFields+previousValues+newValues per GP-002); `POST /alerts/:id/resume` (operator + editor membership — generic human-feedback resume for any failure alert type; saves last_resume_context with autoHealed:false, increments attempt_count, dispatches `source: 'operator-resume'`, GP-006 audit carries feedbackLength only). Dashboard adds 8th `Self-healing` tab in Admin between Secrets and Templates — table with per-row toggle enabled, select maxAttempts (0-10), select confidence (high/medium/low), toggle auto-resolve; saves on change with inline ✓ saved indicator. CLI: `gestalt platform self-healing list/configure <failureType>` (--max-attempts, --confidence, --auto-resolve/--no-auto-resolve, --enable/--disable). New `LiveEventType: 'alert.auto-resolved'` SSE for dashboard live update. Live verified: migration 020 applied + queue config pinned at boot; GET endpoint returns all 7 rows; PATCH validation matrix (maxAttempts>10, invalid confidence, unknown failure type, empty patch); audit metadata captures changedFields/previousValues/newValues; CLI list+configure exercised; POST /alerts/:id/resume happy path (intent transitioned + last_resume_context stored as proper JSONB object with autoHealed:false + attempt_count incremented + alert acked + GP-006 audit confirmed — feedback text NOT in audit_log via direct SQL probe); worker picked up resume payload + full cycle ran end-to-end to `deploying`. Pipeline failure alerts + resume-on-same-branch feedback loop (migration 019): `intents` gains `branch_name TEXT`, `pr_number INTEGER`, `pr_url TEXT` (all nullable); new `IntentRepository.saveBranchInfo`; pipeline-agent creates `pipeline-failed` / `pipeline-timeout` alerts (severity high, requiredAction `provide-feedback`) carrying intentId + branch + prUrl + prNumber + runId + pipelineStatus in context JSONB; new `AlertType` values + `AlertRequiredAction: 'provide-feedback'`; pr-agent persists branch info on fresh-PR path and dispatches a new `resumeOnBranch` flow: when set, fetch + `checkout -B <branch> origin/<branch>`, push to existing branch, NO new PR — reuses the input's `prNumber`/`prUrl`, writes a `pr-opened` event with `metadata.resume: true` so the timeline narrates "fix push" vs original; commit subject becomes `fix: address CI failure — <intent line> [gestalt <corr8>]`. Generate orchestrator threads `resumeOnBranch`/`prNumber`/`prUrl` payload optionals through `drivePlan` → gate's `dispatchDeployPR` → deploy:pr; on resume, fetches + checks out the existing remote branch with WARN-and-fall-through-to-default safety. intent-agent prompt picks up new `clarificationSource: 'pipeline-feedback'` framing ("## CI pipeline failure feedback from operator"); `needsClarification` short-circuits for `pipeline-feedback` to avoid re-pausing. New route `POST /alerts/:id/pipeline-feedback` (`requireRole('operator')` + `checkProjectMembership(editor)`) validates type ∈ {pipeline-failed, pipeline-timeout}, calls `intents.saveClarification(intent.id, feedback)`, dispatches `generate:intent` with full resume payload, transitions to `generating`, acknowledges alert atomically — audit `alert.pipeline-feedback-submitted` carries `feedbackLength + branch + prNumber + intentId + type + ip` ONLY (GP-006). Dashboard Alerts view: new `PipelineBody` (intent line + branch + PR link + run id + pipeline status KV header) and `PipelineFeedbackBlock` (textarea + "retry with fix ▶" button) rendered ABOVE Dismiss for the two new types; new TypeGlyph (✗ red for failed, ⏱ amber for timeout); FixIntentBlock suppressed for pipeline alerts (operators provide CI-fix context via the new block instead). CLI: new `gestalt alerts pipeline-feedback <alertId> [--feedback <text>]` subcommand — displays branch/PR/runId/status context then submits; `gestalt alerts show` Available actions footer routes pipeline alerts to `pipeline-feedback` + `dismiss`. Live verified end-to-end: 4 validation paths (400/404), happy path (200 with intentId + status: generating + branch + PR), atomic ack + clarification persist (116 chars), worker pickup with `resumeOnBranch` log line, GP-006 audit metadata. PRE-EXISTING: pr-agent syncs `pnpm-lock.yaml` after writing artifacts so CI's `--frozen-lockfile` always passes. New shared `execCommand(cmd, args, cwd, timeoutMs)` helper in `packages/agents/deploy/src/agents/exec.ts` — spawn-based, no shell, 2-minute default timeout, surfaces a 400-char stderr tail on non-zero exit. pr-agent's `maybeSyncLockfile(workDir)` stats `package.json` then runs `pnpm install --no-frozen-lockfile`; ENOENT skips (no Node project yet), other failures log WARN and continue (CI is the real source of truth — don't block PR creation over a lockfile sync hiccup). Dockerfile production stage swapped `corepack prepare pnpm@9.15.4 --activate` for `npm install -g pnpm@9.15.4` so the runtime `gestalt` user has pnpm 9.15.4 on PATH (corepack caches per-user; root activation wouldn't reach gestalt and the auto-fetched latest pnpm requires Node 22's `node:sqlite`). Template `gestalt.yml` gains a graceful fallback: if `pnpm-lock.yaml` is missing, emit a `::warning::` and run `pnpm install` without `--frozen-lockfile` so first-CI doesn't hard-fail. context-fixer.ts is unchanged — the ADR-018 path guard restricts it to `docs/*` and `AGENTS.md`, so it can never reach a `package.json` write path. Smoke test inside the rebuilt container: `pnpm 9.15.4` callable, real `pnpm install --no-frozen-lockfile` produces a 384-byte `pnpm-lock.yaml@9.0` for a lodash dependency)

**Repo:** https://github.com/afarahat-lab/gestalt

**What is built and working:**
- All 8 architecture layers fully designed and documented
- **All four SDLC layers fully implemented end-to-end:** generate,
  quality-gate, deploy, maintenance. The closed loop runs:
  `human intent → generate → gate → deploy → deployed`, plus
  `maintenance scheduler → queues typed MaintenanceIntent → back into
  generate`. See per-layer detail bullets below; per-agent run lifecycles
  are summarised in the "Session log" entries dated 2026-05-29 / 30
- All 12 buildable workspace packages compile clean (`pnpm -r build`)
- `docker-compose up -d` succeeds — server, postgres, redis all `Up (healthy)`
- All twenty-three migrations apply on startup: `001_initial`, `002_local_auth`,
  `003_projects`, `004_deployments`, `005_maintenance`,
  `006_intent_clarification`, `007_execution_logs`,
  `008_finding_attempts`, `009_execution_log_model`,
  `010_user_management`, `011_interventions`, `012_tool_calls`,
  `013_auto_merge`, `014_llm_registry`, `015_secrets_vault`,
  `016_relax_llm_apikey_env`, `017_platform_admin`, `018_groups`,
  `019_intent_branch`, `020_self_healing`, `021_key_rotation_log`,
  `022_project_secret_ref`, `023_llm_api_shape`
- Server reachable on http://localhost:3000 — `/health` returns 200
- Auth middleware active — protected routes return 401
- **Dashboard SPA reachable in the browser, deep-linkable, no path
  collisions with the API.** `gestalt dashboard` opens
  `<serverUrl>/app/`; the server serves the React SPA from
  `packages/dashboard/dist/` via `fastify-static` mounted at the
  `/app/` prefix. Vite is built with `base: '/app/'` so asset URLs in
  the built `index.html` reference `/app/assets/<hash>.{js,css}`.
  React Router uses `<BrowserRouter basename="/app">`, so every
  `navigate('/intents/${id}')` inside the SPA resolves to
  `/app/intents/${id}` in the URL bar. The API still owns the root
  and bare paths (`/intents/:id`, `/alerts`, etc.) — the URL spaces
  are now fully disjoint, which means **dashboard URLs are
  shareable**: copy from the address bar, paste in a new tab, and
  the dashboard loads that exact view (RequireAuth bounces to
  `/app/login` if no token, otherwise renders the deep-linked
  component). The auth preHandler bypasses GET requests under
  `/app/*` only; non-GET methods always require auth. The bare
  server URL (`/`) issues a 302 redirect to `/app/` for convenience.
  The not-found handler is the SPA fallback only for `/app/*` GETs;
  any other unknown GET (e.g. a typo at `/intnts`) returns 404 JSON
  instead of silently serving the SPA shell (whose asset refs would
  break)
- First-boot bootstrap verified end-to-end: `gestalt init-admin` creates
  admin + JWT; `gestalt login` authenticates; `GET /auth/me` returns user
- **Two-level user management wired end-to-end (migration 010).**
  Platform roles (`platform-admin` | `user`) on `users.role`; per-project
  roles (`project-admin` | `editor` | `reader`) on the new
  `project_memberships` table. Legacy `admin` / `operator` / `viewer`
  values were remapped in the migration so `gestalt init-admin`'s
  original user is now `platform-admin`; everyone else became `user`.
  - **`requireRole`** keeps the legacy string signature
    (`admin` | `operator` | `viewer`) for backward compatibility with
    every existing route guard. The mapping after 010:
    `admin` → platform-admin only; `operator` / `viewer` → platform-admin
    bypasses the project check, regular `user` must have a membership on
    the project the request targets. The middleware resolves the
    project ID from `params.id` (only when `routerPath` starts with
    `/projects/:id`) or `query.projectId` — so `/intents/:id/clarify`
    and `/executions/:id/log` are NOT mistakenly treated as project-
    scoped. Routes without a project context fall through to
    "authenticated user is enough"; route-level handlers enforce
    further checks where needed (e.g. POST /intents passes the
    projectId in the body)
  - **POST /projects** auto-assigns the creator as `project-admin` so
    they survive the new membership-aware GET /projects filter. The
    migration also backfills a project-admin row for every previously-
    registered project (keyed by `projects.created_by`)
  - **GET /projects** returns ALL projects for `platform-admin` and
    only membership-matched projects for `user`. The dashboard's
    sidebar selector + every view that uses ProjectContext picks up
    the filtered set automatically
  - **Deactivation is enforced at TWO layers.** `local-provider.authenticate`
    refuses login for any user whose `deactivated_at` is non-null
    (returns `ACCESS_DENIED`, surfaced as HTTP 403). The JWT
    validation middleware re-checks `user.deactivatedAt` on every
    request so an existing JWT cannot outlive the deactivation —
    the very next request after the soft-delete returns
    `403 ACCOUNT_DEACTIVATED`
  - **Self-protection guards** (server-side, no way to bypass via the
    API): cannot deactivate yourself, cannot demote yourself from
    platform-admin, cannot demote/remove the last project-admin from
    any project. All 400 with explicit error codes
    (`SELF_DEACTIVATE_FORBIDDEN`, `SELF_DEMOTION_FORBIDDEN`,
    `LAST_PROJECT_ADMIN`)
  - **CLI:** `gestalt users list [--search]`, `users add <email>`
    (TTY prompts for display name, role, optional password), `users
    role <email> <platform-admin|user>`, `users deactivate <email>`,
    `users assign <email> <projectName> --role <role>`,
    `users unassign <email> <projectName>`, `users members
    <projectName>`. Each command resolves the user by email via
    `GET /users?search=<email>` and the project by name via
    `GET /projects` — no UUIDs in the operator's mouth
  - **Dashboard Admin view** at `/app/admin` — platform-admin only.
    `RequirePlatformAdmin` guard on the route; the sidebar link is
    ABSENT FROM THE DOM (not just hidden) for regular users; a
    regular user typing `/app/admin` directly is bounced via
    `<Navigate to="/" replace>`. Two tabs: Users (table with
    expandable rows showing per-user project memberships, in-line
    role/membership editing, add-user modal supporting an optional
    password + initial assignments) and Projects (per-project member
    list with role change + add/remove)
  - GP-002 — every mutation (`user.created` / `user.updated` /
    `user.deactivated` / `project.member-added` /
    `project.member-role-updated` / `project.member-removed`) writes
    an audit row with previous + new values. No clarification-text-
    style content is logged
  - Verified live: migration 010 applies cleanly; the original `a@b.c`
    admin became `platform-admin`; backfilled membership for
    trackeros. Created `test@example.com` (`user`), assigned editor
    on trackeros; admin sees 2 projects (member-test + trackeros)
    while test sees only 1 (trackeros). Deactivated test user →
    login 403 + existing JWT 403. Self-protection: tried to
    deactivate / demote self → 400. Last project-admin guard:
    tried to demote and remove → 400 `LAST_PROJECT_ADMIN`. Dashboard
    drive (headless Chrome + CDP): platform-admin sees the `★ Admin`
    nav link, `/app/admin` renders Users table; regular `user` has
    NO admin link in the DOM and `/app/admin` bounces to `/app/`
- **Handler-level project membership enforcement on body-projectId
  routes.** Closes the gap the prior user-management session left
  open: `requireRole('operator')` only resolves projectId from
  `params.id` or `query.projectId`, so a regular `user` could
  otherwise submit intents against any project ID they knew (no
  membership row required). New `requireProjectMembership(userId,
  platformRole, projectId, minRole)` helper in
  `packages/server/src/auth/middleware.ts` returns the membership
  record on success (or `null` for platform-admins who bypass) and
  throws `ProjectMembershipError` with one of
  `NOT_PROJECT_MEMBER` / `INSUFFICIENT_PROJECT_ROLE` on failure.
  `sendProjectMembershipError(reply, err)` shapes the canonical
  403 body (`{ error: 'FORBIDDEN', code, message }`).
  Five route handlers now call the helper:
  - **`POST /intents`** — editor minimum on the body's projectId
  - **`POST /intents/:id/clarify`** — editor minimum, resolved from
    the loaded intent's `projectId` (not `params.id`, which is an
    intent UUID)
  - **`POST /maintenance/trigger`** — editor minimum on the body's
    projectId
  - **`DELETE /maintenance/findings/:projectId`** — editor minimum
    (route param is `:projectId` not `:id`, so the preHandler's
    routerPath check doesn't match; same shape as the trigger gap)
  - **`POST /alerts/:id/fix-intent`** — editor minimum on the
    resolved-from-alert projectId
  - **`POST /projects/:id/config`** — **project-admin minimum**
    (editing HARNESS.json shapes deploy/maintenance for every
    operator on the project; editor isn't enough)
  Role rank `project-admin > editor > reader` is hard-coded in the
  helper as `{reader:1, editor:2, 'project-admin':3}`; comparison
  is `< minRole rank → INSUFFICIENT_PROJECT_ROLE`. platform-admin
  bypasses every check (early return inside the helper).
  CLI surfaces the new codes: new `handleMembershipForbidden(err)`
  in `packages/cli/src/ui/server-errors.ts` parses
  `ApiClientError.body` for the `{ code, message }` shape and
  prints a contextual hint (`gestalt users assign ...` for
  `NOT_PROJECT_MEMBER`; "ask a project-admin to upgrade your role"
  for `INSUFFICIENT_PROJECT_ROLE`). Wired into the catch blocks of
  `gestalt run`, `gestalt maintenance trigger`,
  `gestalt maintenance reset-findings`, and
  `gestalt projects set-adapter`. Generic 5xx / non-403 paths
  unchanged — `handleMembershipForbidden` returns false so the
  existing "Failed: ..." branch still runs.
  Verified live against `trackeros`:
  - **Reader** (`reader@example.com`, role `reader`) — `POST
    /intents` → 403 `INSUFFICIENT_PROJECT_ROLE`; `POST
    /maintenance/trigger` → same; `GET /intents?projectId=…` →
    200 with the project's intents (reader CAN view)
  - **Editor** (`editor@example.com`, role `editor`) — `POST
    /intents` → 201 (intent queued); `POST /maintenance/trigger`
    (drift-agent) → 200 with the completed run record; `POST
    /projects/:id/config` → 403 `INSUFFICIENT_PROJECT_ROLE`
    "Minimum project role required: project-admin"; trying to
    submit an intent against a different project (where they are
    NOT a member) → 403 `NOT_PROJECT_MEMBER`
  - **Platform-admin** (`a@b.c`) — every operation succeeds
    regardless of membership; created an intent against a project
    they were not a member of, set its config — both passed the
    auth check (the second 500'd on the placeholder Git URL, which
    is downstream of the auth check)
  - **CLI** — `gestalt run` / `gestalt maintenance trigger` /
    `gestalt projects set-adapter` as a non-member each print the
    typed friendly message instead of a raw JSON dump
- **`POST /interventions` (ADR-021, migration 011).** Operator
  responses to escalated intents. Four typed actions — the same
  vocabulary ADR-021 defined — implemented end-to-end:
  - `resume` — false positive; marks the GP_BREACH signal resolved
    by literal `'human'` (the repo-level guard enforces that),
    acknowledges the alert, creates the intervention row, and
    dispatches `deploy:pr` with the artifact set rebuilt from
    `artifacts.findByCorrelationId` (same shape the gate uses on a
    `pass` verdict). Intent transitions `escalated → deploying`,
    then NoOp/GitHub Actions adapter completes the cycle to
    `deployed`
  - `abort` — real breach; acknowledges the alert, creates the
    intervention row, transitions intent to `failed`. No deploy
    dispatch, no signal resolution (the breach IS the truth)
  - `acknowledge-breach` — **notes are required** (400 if
    omitted); marks the signal resolved (human), acknowledges the
    alert, creates the intervention row with the notes persisted
    to `interventions.notes`, transitions to `failed`. **GP-006:
    the audit row carries only `notesLength` + `signalId` — the
    note text never reaches `audit_log`**. The text is auditable
    via direct query against `interventions`
  - `request-clarification` — creates a `clarification-needed`
    alert (severity `high`) carrying `triggeredBy: 'intervention'`
    + the breach signal ids in JSONB context, transitions intent
    to `waiting-for-clarification`. The existing
    `POST /intents/:id/clarify` flow then resumes the cycle on
    operator follow-up
  - All four write an `interventions` row (migration 011 —
    `(intent_id, correlation_id, alert_id, action, actor_id,
    notes, created_at)`) plus an audit row
    (`intervention.resume` / `.abort` / `.acknowledge-breach` /
    `.request-clarification`). The `alert_id` is nullable —
    `resume` and `abort` populate it from the open GP_BREACH
    alert when present; `request-clarification` creates a new
    alert so the audit metadata carries that id instead
  - **Edge cases:**
    - Intent not in `escalated` status → 409
      `INVALID_INTENT_STATUS` with the current status surfaced in
      the message. Verified live for `failed` and `deployed`
      callers
    - Intent not found → 404
    - Unknown action → 400 with the four valid values listed
    - `acknowledge-breach` with empty notes → 400
    - Non-member tries to intervene → 403
      `INSUFFICIENT_PROJECT_ROLE` (the helper from the prior
      session — editor minimum)
  - **`GET /interventions?intentId=<id>`** — viewer minimum.
    Returns the intent's intervention history (one row per
    operator decision; ascending by `created_at`) for the
    dashboard's IntentDetail Interventions section
  - **Dashboard.** Alerts view: GP_BREACH alert cards render a
    new `BreachInterventionBlock` with three buttons — `▶ Resume
    (false positive)`, `✗ Abort intent`, and an `⚑ Acknowledge
    breach` button gated on a required notes textarea. Submitting
    sends the typed `POST /interventions` call; on success the
    card disappears, a green confirmation banner shows for 1.5 s,
    then the list refreshes. Abort confirms via the browser
    confirm dialog before firing. The fourth action
    (request-clarification) is reachable only from the CLI today
    — the dashboard rarely needs it (operator can submit a fresh
    intent / use the existing clarification flow)
  - **IntentDetail Interventions section.** When the intent is in
    a status where interventions could exist (`escalated`,
    `failed`, `deploying`, `deployed`,
    `waiting-for-clarification`), `GET /interventions?intentId=`
    fetches the history and renders one card per intervention
    with a coloured action chip, the actor's id-prefix, the
    timestamp, and the notes prose (or `(no notes)` when null)
  - **CLI `gestalt alerts`:** three new subcommands —
    `resume <alertId>`, `abort <alertId>` (prompts `y/N`
    confirmation), `acknowledge <alertId>` (prompts for required
    notes when `--notes` is omitted). Each resolves the
    `intentId` by re-using the existing
    `fetchAlertByIdOrPrefix(client, alertIdPrefix)` helper and
    lifting `alert.intentId` (or
    `alert.context.intentId`) — same 8-char prefix surface the
    other alerts subcommands use
  - All four `POST /interventions` actions verified live against
    `trackeros`: `abort` and `acknowledge-breach` ran against
    pre-existing escalated intents from prior sessions
    (`562efa69`, `cd4c1846`); `request-clarification` against a
    third (`b86e010f` → transitioned to
    `waiting-for-clarification` with a fresh clarification alert
    created); `resume` against a synthetic
    `verify-intervention-resume` intent — full deploy chain
    completed (5 `deployment_events` rows in order
    `pr-opened → pipeline-triggered → pipeline-passed →
    promoted-staging → promoted-production`; intent reached
    `deployed`). GP_BREACH signal flipped to
    `resolved_by = 'human'`, alert acknowledged, intervention
    row carries `alert_id` populated. Audit for the
    `acknowledge-breach` test: `metadata = {"notesLength": 123,
    "signalId": "432b33d9-…", "alertId": null, "ip": "…"}` —
    no `notes` text anywhere in the audit row.
    `GET /interventions?intentId=<resume_id>` returned the
    intervention record with the expected shape. CLI
    `alerts abort` and `alerts acknowledge --notes` both
    succeeded against synthetic GP_BREACH alerts seeded for
    each
- **Server-side membership filtering on every read endpoint.**
  Closes the prior gap where a non-member could query
  `GET /intents?projectId=<any>` (and equivalents) and see another
  project's data. Six GET endpoints now enforce reader+ at the
  handler level:
  - **`GET /intents`** — with `?projectId=` requires reader+
    membership; without projectId, platform-admin sees the
    server-wide list (new `IntentRepository.listAll` —
    interface + postgres impl + oracle/mssql stubs), regular
    users get a 200 with empty array (NOT a 403 — never leak
    "project X exists" via error-vs-empty)
  - **`GET /intents/:id`** — membership checked against the
    intent's `projectId`. A non-member gets 403 with code
    `NOT_PROJECT_MEMBER`, NOT 404. Returning 404 would let a
    non-member enumerate intent UUIDs and infer which ones map
    to projects they can't see
  - **`GET /executions/:id/log`** — resolves the intent via
    `correlationId` and runs the same reader-minimum check; the
    prompts + LLM responses are not for cross-project eyes
  - **`GET /deployments?projectId=`** — handler-level reader
    check (the prior `requireRole('viewer')` preHandler is
    dropped on this route because it would otherwise short-
    circuit with the old `{ error: 'Not a member ...', code:
    'FORBIDDEN' }` shape before the typed
    `NOT_PROJECT_MEMBER` reply could fire)
  - **`GET /maintenance/runs?projectId=`** — reader check when
    projectId is provided
  - **`GET /alerts?projectId=`** — new optional projectId query
    param. With it, runs reader check and intersects alerts to
    those whose intent (via `correlationId`) belongs to the
    project. Without it, platform-admin sees every unack alert
    server-wide; regular users get 200 with empty array (same
    no-enumeration-leak rule as `/intents`)
  - **`GET /alerts/:id`** — membership checked through the
    alert's `correlationId → intent → projectId` chain (same
    403-not-404 rule)
  - **`GET /interventions?intentId=`** — loads the intent first
    to get its projectId, then runs the reader check; unknown
    intentId returns `{ data: [] }` rather than 404 (same
    rule)
- **New `checkProjectMembership(reply, userId, role, projectId,
  minRole)` helper in `auth/middleware.ts`** — boolean-returning
  wrapper around `requireProjectMembership` that sends the typed
  403 internally and returns `false` for the caller to bail.
  Reduces every check site to one line:
  `if (!await checkProjectMembership(reply, request.user.id,
  request.user.role, projectId)) return;`. Replaced the 7-line
  try/catch pattern in all eight write-path sites from the
  prior membership-enforcement session AND the seven new read-
  path sites — one helper, fifteen consumers, consistent error
  shape across the whole auth surface. `requireProjectMembership`
  and `sendProjectMembershipError` remain exported for any
  future caller that needs the raw throw-based form
- **Verified live across the full read matrix** against
  `trackeros` + a freshly-created `outsider` project:
  - **reader on trackeros:** intent list/detail, deployments,
    maintenance/runs, alerts, executions/log → 200 for
    trackeros, 403 `NOT_PROJECT_MEMBER` for outsider on every
    endpoint
  - **editor on trackeros:** all reads for trackeros 200,
    outsider 403; write path (POST /intents) still 201 — the
    refactor preserved write semantics
  - **platform-admin:** GET /intents without projectId returned
    server-wide list via the new `listAll`; cross-project
    GET /intents/:id and GET /alerts both 200 (bypass)
  - **regular user no projectId:** GET /intents → 200 with
    empty array; GET /alerts → 200 with empty array (the
    no-enumeration-leak rule)
- **Section-based code/test/review prompts that surface the
  project's architecture, HARNESS constraint rules, design spec,
  and grouped signal feedback.** The biggest quality-of-output
  improvement available — previously the code-agent generated
  code without ever seeing the project's architecture, the
  constraint rules the constraint-agent would later check, or
  the design-agent's structured output. Now every LLM-generating
  prompt opens with the non-negotiable rules:
  - **`HarnessConfig.constraints.rules`** added to both the core
    `@gestalt/core` and the agents-generate local
    `HarnessConfig` types as `ConstraintRule[]` (id, description,
    severity). Optional — absent on legacy projects so the
    prompts just skip the section. Seeded into the
    corporate-ops-web-mobile template's `HARNESS.json` with
    eight rules covering repository-pattern access, inline-RBAC
    refusal, audit on mutation, Zod input validation,
    no-process-env, no-console-log, no-any, no-hardcoded-secrets
  - **`ContextSnapshot.priorSignals`** added (was on `AgentTask`
    only). The orchestrator already had the routed
    signals in scope; it now passes them into
    `assembleContext` so every prompt builder can read
    `ctx.priorSignals` instead of relying on a separately-
    threaded argument. Default `[]` on the first attempt;
    populated on gate-driven retries with the per-agent routed
    subset from `feedback-router.ts`
  - **`packages/agents/generate/src/prompts/signal-formatter.ts`
    (new)** — `buildSignalFeedback(signals)` formats the prior
    cycle's routed signals into a `## Previous attempt failed
    — you MUST fix ALL of the following` block grouped by
    severity + type (critical CONSTRAINT_VIOLATION → other
    CONSTRAINT_VIOLATION → TEST_FAILURE → LINT_FAILURE →
    CONTEXT_GAP). Each entry shows `[file:line]` when present.
    Empty signals → empty string so the section disappears on
    the first attempt
  - **`code-prompt.ts`** completely rewritten as eight named
    sections, filter-joined so absent context (no design-spec
    on the first cycle, no signals on the first attempt) leaves
    no trailing blank header:
    1. Project architecture (raw `architectureMd`, truncated
       to 2000 chars)
    2. Constraint rules (from `harness.constraints.rules`)
    3. Design specification (raw
       `.gestalt/design-spec.json` artifact, 3000-char cap)
    4. Intent specification (rawIntent + success criteria +
       scope + out-of-scope)
    5. Golden principles (id + title + description)
    6. Domain model (raw `domainMd`, 2000-char cap)
    7. `buildSignalFeedback(priorSignals)` — empty on first
       attempt
    8. Your task (JSON output format + file org rules + code
       rules)
  - **`test-prompt.ts`** rewritten as five sections: success
    criteria, generated code (per-file ` ```typescript` blocks
    truncated to 2000 chars each + an 8000-char overall budget),
    constraint rules (apply to test files too), signal feedback,
    task instructions
  - **Review-agent prompt** (`llm-review-agent.ts`) gained a
    `## Project constraint rules` section + a structured
    `## Golden principles` section. The review-agent now loads
    the project's `constraints.rules` from `HARNESS.json` in
    the cloned tree (via a small `loadConstraintRules` helper)
    so it can emit `CONSTRAINT_VIOLATION` signals matched to
    the exact rule id BEFORE the constraint-agent pass runs.
    Absent/malformed file → empty rules → section skipped
  - **GOLDEN_PRINCIPLES.md template** rewritten for a corporate
    operations app: GP-001 Repository pattern for data access,
    GP-002 Audit records for state-changing operations, GP-003
    Input validation at API boundaries, GP-004 No sensitive
    data in logs, GP-005 RBAC enforced on all endpoints, GP-006
    Error handling — no unhandled promise rejections. Stylistic
    rules (no-console, no-process-env) moved to
    `HARNESS.json` constraint rules per the new
    "principles are human-only, constraints auto-retry"
    split; the principles file now opens with that explicit
    statement
  - **Verified live** against `trackeros` (patched + pushed
    with the new `constraints.rules` block to mirror the
    template; this is what a fresh-`init` project would have
    out of the box). Submitted intent
    "verify-prompt-sections: add a price-formatter utility…":
    - **code-agent prompt** (6871 chars persisted) — direct
      DB inspection confirms every section header is present:
      `## Project architecture`, `## Constraint rules — you
      MUST NOT violate these`, `## Design specification`,
      `## Intent specification`, `## Golden principles —
      non-negotiable`, `## Domain model`, `## Your task`.
      Spot-checked the `no-hardcoded-secrets` constraint
      string appears verbatim, mapping back to the
      `HARNESS.json` rule
    - **review-agent prompt** (6848 chars) — has
      `## Project constraint rules` with all six visible
      rules + `## Golden principles` + `## Files under
      review`
    - **test-agent prompt** (3581 chars) — all five sections
      present: success criteria, generated code, constraint
      rules apply to tests, your task
    - **Code-agent succeeded on the first try.** No retry
      cycle, no constraint-agent failure — the agent had
      the rules up front and avoided them. The retry path's
      `## Previous attempt failed` section was validated
      separately via direct
      `buildCodePrompt(retryCtx, 1)` invocation with a
      synthetic 4-signal payload — output grouped Critical
      → Constraint → Failing tests in that order, each
      entry prefixed by `[file:line]`
- **Scope enforcement + intent-agent scope minimisation +
  review-agent scaffolding awareness + narrowed HARNESS
  constraint rules.** Follow-up tightening of the prompt
  refactor — closes the three remaining failure modes that
  drove retry cycles on real user projects:
  - **Code-agent prompt gained a standalone `## Scope —
    generate ONLY what the intent asks for` section** between
    Architecture and Constraint rules. It renders the
    intent-agent's `affectedDomains` followed by explicit
    DO / DO-NOT rules ("If the intent fixes a bug or version
    → change ONLY the affected file", "Do NOT generate
    shared infrastructure unless the intent explicitly asks
    for it", etc.). The task section now reinforces this:
    "stay within the Scope section's rules — include ONLY
    files within the scope defined above". Verified live —
    the brief's `fix tsx version in package.json` intent
    produced exactly ONE generated file (`package.json`)
    with zero code-agent retries; previous cycles on similar
    narrow intents typically produced 8–12 files across the
    src tree
  - **Intent-agent prompt gained a `## Scope minimisation —
    critical` block** at the end of the Rules section with
    the same heuristics ("Fix a version string →
    affectedDomains: ['package.json']", "Err strongly on
    minimal scope. Set outOfScope explicitly for anything
    the intent doesn't mention"). Pairs with the code-agent
    scope section — the intent-agent now produces tight
    scope arrays so the code-agent's scope rules have
    something concrete to enforce
  - **Review-agent gained scaffolding mode** — when the
    operator's intent text contains "scaffold", "set up",
    "setup", "initialise", or "initialize" (case-insensitive
    substring match, see `detectScaffolding`), the prompt
    prepends a `## Scaffolding mode — this intent is a
    scaffold/setup` block with explicit "Do NOT flag
    missing implementations / missing RBAC/audit/Zod" rules.
    Real security issues (hardcoded secrets, `any` usage,
    broken logic) are still flagged. `GateTask` gained an
    optional `intentText` field; the gate orchestrator
    resolves it from `payload.text` or the persisted
    `intents` row and threads it into the review-agent.
    Verified live — the brief's `Scaffold the project
    foundation` intent produced ZERO GP_BREACH or
    review-agent CONSTRAINT_VIOLATION signals (previous
    scaffold cycles consistently surfaced "missing RBAC"
    or "missing audit" findings on the stub files); the
    intent reached `deploying` status
  - **Template HARNESS.json constraint rules narrowed to the
    three brief-specified rules** — `no-any` (high),
    `no-direct-db-outside-repository` (critical),
    `no-hardcoded-secrets` (critical). The prior session's
    eight rules included Gestalt-platform-internal rules
    (no-console, no-process-env-outside-config,
    no-inline-rbac-checks, validate-input-with-zod,
    audit-state-changes) that the brief explicitly says to
    remove from the corporate-ops project template — those
    cross the human-vs-platform-enforcement line and belong
    in `GOLDEN_PRINCIPLES.md` instead. New `gestalt init`
    projects ship with the three-rule set out of the box;
    `trackeros` was patched + pushed to mirror the template
    for live verification
  - **Template GOLDEN_PRINCIPLES.md aligned with the brief's
    structure** — `{{projectName}}` interpolation at the
    top, the six principles in the brief's exact order
    (GP-001 Repository pattern, GP-002 Audit records,
    GP-003 Input validation, GP-004 No sensitive data in
    logs, GP-005 RBAC enforcement, GP-006 Error handling),
    body text condensed to a single descriptive sentence
    per principle as the brief shows. Reaffirms the
    human-vs-platform split at the top of the file
  - **Operator action — pending on `trackeros`.** The
    brief calls out Fix 8 as an operator action: remove the
    `usage-example-agent` block from `trackeros/agents.yaml`.
    That agent was added in an earlier signal-routing
    verification session and emits one `LINT_FAILURE`
    finding per generated file on every cycle. The exact
    edit (with explanatory comment) was prepared in a
    temporary clone but the push was correctly denied by
    the auto-mode classifier — pushes to a project repo's
    main are operator-only. The diff to apply manually:
    delete the `- name: usage-example-agent` block from
    `agents.yaml`'s `custom_agents:` list and add a
    one-line comment explaining why (verification noise).
    Until this lands, every trackeros cycle will surface
    LINT_FAILURE signals from this agent regardless of
    actual code quality
  - **`GateTask.intentText` plumbed** — optional field on
    the GateTask shape; gate orchestrator resolves it from
    `payload.text` (retry leg) or `intents.findById`
    (first dispatch) and passes it to the review-agent. The
    only consumer today is `detectScaffolding`; the field
    is general-purpose for any future per-intent review
    behaviour
- **Agent tool use — built-in file tools + `agents.yaml`
  configuration (ADR-038, migration 012).** The single largest
  capability bump since custom agents shipped. Agents can now
  call file tools during reasoning, driving their own
  discovery of the codebase before generating output. The
  infrastructure lives in `BaseLLMAgent` and is available to
  every layer:
  - **Four built-in file tools** in `@gestalt/core/tools/
    file-tools.ts`: `readFile(path)`, `listDirectory(path)`,
    `searchFiles(pattern, glob?)`, `getFileTree(maxDepth?)`.
    All read-only, all sandboxed against `projectRoot`. Path
    traversal outside the project tree throws immediately.
    Files > 100 KB truncate; search caps at 20 results; tree
    max depth 4. `searchFiles` uses `globby` v14 via dynamic
    import (ESM-only)
  - **`LLMClient.completeWithTools`** speaks the OpenAI
    function-calling format (`tools[{ type: 'function',
    function: { name, description, parameters } }]` on
    request; `choices[0].message.tool_calls` +
    `finish_reason` on response). The platform was already
    OpenAI/Azure-compatible — the brief's Anthropic pseudocode
    mapped cleanly to OpenAI's shape, semantics identical
  - **`BaseLLMAgent.callLLMWithTools`** drives the
    tool-use loop: LLM emits tool calls → orchestrator
    executes each via `executeFileTool` → results fed back as
    `role: 'tool'` messages → next LLM turn → repeat until
    `finish_reason === 'stop'` or the safety cap
    (`MAX_TOOL_CALLS = 10`) is hit. When the agent's
    resolved tools are empty, the method transparently
    delegates to `callLLM` — call sites branch on
    `hasTools` once and never see the fork again
  - **`agents.yaml` `tools:` schema** added per agent. The
    seeded YAML and the loader's `PER_ROLE_DEFAULTS` give
    `code-agent` and `context-agent` the full four-tool set;
    every other framework agent defaults to `tools.builtin: []`
    so their behaviour is unchanged. Operator overrides land
    via the yaml's `tools.builtin: [...]` array. Unknown
    tool names are silently dropped (operator typos shouldn't
    crash a cycle)
  - **`code-prompt.ts` opens with a `## File tools available`
    section** when the agent has tools — the brief's exact
    workflow text ("Workflow for modification intents: 1.
    Call getFileTree…", "Workflow for new file intents: 1.
    Call listDirectory…"). Section sits ABOVE Architecture
    so the model reads the discovery rules first
  - **Tool-call audit persisted on `agent_execution_logs.
    tool_calls` (JSONB, migration 012)**. Each entry: `{
    toolName, input, output, isError, calledAt }`. `output`
    truncated to 500 chars (the full result already went to
    the LLM during the live loop; the persisted entry is for
    operator audit, not replay). `BaseLLMAgent.lastToolCallLog`
    captures the history per run; the generate / gate /
    deploy orchestrators all read it after `run()` and
    forward to `executionLogs.save`
  - **Dashboard IntentDetail accordion** shows a new
    `Tool calls (N)` section between the prompt and LLM
    response when the row has any calls (empty array →
    section hidden). Each entry shows the tool name, JSON
    input, and a 200-char output preview. Error calls render
    with a red left border (failed tool executions are
    rare but legible at a glance)
  - **`GET /projects/:id/agents`** gained a `builtinTools:
    string[]` field on each `AgentSummary` so `gestalt
    agents list` (and the dashboard) can render the
    effective tool set per agent
  - **Verified live** against `trackeros` (agents.yaml
    patched + pushed to enable tools on code-agent +
    context-agent) — submitted the brief's tsx-version-fix
    intent. The code-agent **actually called
    `readFile({ path: "package.json" })`** (visible in the
    persisted tool_calls JSONB), saw the real existing
    content (`"tsx": "^0.0.0"`, `name: "trackeros"`,
    `packageManager: "pnpm@9.15.4"`), and generated a
    surgical replacement that updated only the tsx version
    while preserving every other field VERBATIM. **One
    generated file: `package.json`. The new tsx version
    `^4.7.0` was based on what the model read, not
    hallucinated from training-data context.** The dashboard
    IntentDetail accordion's `Tool calls (1)` section
    rendered the `readFile` call with the actual file
    content as its output preview (screenshot saved during
    verification)
  - JSONB write path uses postgres.js's typed `db.json(...)`
    helper, so `tool_calls`, `findings`, `context`, and
    `metadata` columns all store as real JSONB values
    (`jsonb_typeof = 'array'`/`'object'`). The earlier
    `${JSON.stringify(arr)}::jsonb` pattern was a trap —
    postgres.js bound the stringified text as a TEXT
    parameter and `::jsonb` parsed it as a JSONB string
    scalar (`"[{...}]"`). Direct SQL probes
    (`jsonb_array_length`, `jsonb_typeof`) now work
    against every JSONB column. Note the typing tweak:
    `db.json(value as unknown as Parameters<typeof
    db.json>[0])` — the postgres.js `JSONValue` requires
    a structural index signature that typed interfaces
    don't auto-satisfy
- **MCP (Model Context Protocol) integration — external
  tool servers (ADR-039).** Extends ADR-038's built-in
  file tools with project-declared external MCP servers.
  Operators wire any compliant server (issue tracker,
  monitoring dashboard, internal docs, the
  `@modelcontextprotocol/server-filesystem` smoke target)
  via `tools.mcp[]` in `agents.yaml` and the LLM sees its
  tools merged with the four built-ins. No new endpoints,
  no new migrations:
  - **`McpClient`** in `@gestalt/core/tools/mcp-client.ts`.
    Two transports via URL scheme: `http(s)://...` →
    `StreamableHTTPClientTransport` (modern MCP-spec HTTP
    + SSE); `stdio:<bin> <arg1> <arg2>...` →
    `StdioClientTransport` (spawns the named child, speaks
    JSON-RPC over stdin/stdout). The `@modelcontextprotocol/
    sdk` v1.29 is ESM-only — `McpClient` dynamic-imports it
    (same pattern as `globby`) so the CJS core package
    builds clean. Tool names are namespaced
    `<serverName>__<toolName>` on every `listTools()` result
    so an MCP server can NEVER shadow a built-in
  - **`resolveMcpClients`** in `@gestalt/core/tools/mcp-
    resolver.ts`. Three credential sources via the
    `tokenFrom` field on each declared server:
    `'harness'` → reads `HARNESS.json` `mcp.servers[].token`
    by matching `name`; `'project_credential'` → reuses the
    project Git PAT (already loaded from
    `project_git_credentials`); `'env:VAR_NAME'` → reads
    `process.env.VAR_NAME` on the Gestalt server. Missing
    tokens resolve to `undefined`; the client connects
    anonymously and the SDK returns a clean error if the
    server requires auth
  - **`BaseLLMAgent.callLLMWithTools`** extended with
    optional `mcpClients?: McpClient[]`. The agent fetches
    every server's `listTools()` in parallel, merges with
    the ADR-038 built-in defs, and indexes the MCP clients
    by `<serverName>__` prefix into a Map. Per tool call
    the dispatcher does an O(1) `findMcpForCall` against
    the Map — prefix match → `mcpClient.executeTool(...)`,
    miss → falls through to `executeFileTool(...)`. Every
    `ToolCallLogEntry` records `toolSource: 'builtin' |
    'mcp:<serverName>'` so the operator sees which
    transport handled each call. The agent does NOT close
    the MCP clients — that's the orchestrator's job
  - **Per-cycle MCP client cache in the orchestrator.**
    `handleIntentTask` keeps a `Map<serverName, McpClient>`
    for the cycle. The new `resolveMcpForAgent` helper
    looks up each agent's declared servers in the cache and
    only calls `resolveMcpClients` for the ones that aren't
    already open. The cache's `close()`s happen in the
    `finally` block so a thrown agent run can't leak file
    descriptors / SSE streams. Multiple agents declaring
    the same server share one connection
  - **Failure mode is non-fatal end to end.**
    `McpClient.listTools()` returns `[]` on connection
    failure (agent proceeds with whatever tools resolved);
    `executeTool()` returns `{ isError: true, content: '...' }`
    on any thrown error (LLM sees the error text and can
    pick a different tool or give up). An unreachable MCP
    server never aborts a cycle
  - **Auto-detect of tool-loop trigger.** The previous
    ADR-038 `hasTools` check looked only at
    `agentConfig.tools.builtin.length`. Updated to
    `hasBuiltin || hasMcp` so MCP-only agents (operator
    disabled built-ins, kept just an MCP server) still
    drive the function-calling loop. Backward compat: every
    pre-039 agent with builtin tools still triggers as before
  - **Observability surfaces.** Dashboard's IntentDetail
    accordion renders a per-tool-call badge —
    `readFile (built-in)` vs
    `github__get_pull_request (MCP: github)`. The
    `formatToolSource` helper handles the legacy null case
    (pre-039 rows display as `(built-in)`).
    `GET /projects/:id/agents` `frameworkAgents[].mcpServers`
    lists the configured server names per agent. `gestalt
    agents list <project>` prints `MCP: server1, server2`
    next to each framework agent's row
  - **Template seed.** `corporate-ops-web-mobile/harness/
    agents.yaml` ships with a commented `tools.mcp:` block
    under `code-agent`, including two example entries (HTTP
    + stdio) plus a security note that `tokenFrom: harness`
    puts the token in the project repo
  - **No migrations.** `tool_calls` JSONB already stored
    per-call rows from ADR-038; the new `toolSource` field
    is purely additive on the persisted shape. Oracle /
    MSSQL stubs are unaffected. One new runtime dep on
    `@gestalt/core` (`@modelcontextprotocol/sdk@^1.29.0`);
    agents import `McpClient` from `@gestalt/core` so the
    agent-package surfaces don't add it
  - **Stage 1 verification** (live, against trackeros, no
    MCP wired): submitted clamp utility intent; cycle ran
    11 agent executions through generate + gate + deploy in
    ~80 s. `code-agent` made 2 real built-in tool calls
    (`listDirectory`, `searchFiles`), each persisted with
    `toolSource: 'builtin'`. Every framework agent's
    `mcpServers` list was empty. Pipeline-agent failed for
    an unrelated CI reason (project's test runner) — no MCP
    code path crashed
  - **Stage 2 verification** (live MCP server):
    `@modelcontextprotocol/server-filesystem` v2026 spawned
    via stdio (`stdio:npx -y @modelcontextprotocol/server-
    filesystem /private/tmp/test-mcp-dir`). `McpClient.list
    Tools()` returned 14 namespaced tools
    (`testfs__read_file`, `testfs__write_file`,
    `testfs__list_directory`, …) each carrying the
    `[testfs]` description prefix. `executeTool(
    'testfs__read_file', {path: '...'})` stripped the
    namespace prefix and returned the file content
    (`hello from mcp`). `resolveMcpClients` exercised with
    `tokenFrom: 'env:NOOP_TOKEN'` — env-source resolution
    works. Dispatch test confirmed the three invariants:
    (1) `testfs__list_directory` → MCP `testfs`; (2)
    `listDirectory` (no namespace) → built-in fallthrough;
    (3) collision probe — a hypothetical built-in named
    `testfs` would NOT be intercepted (prefix check is
    `testfs__`, not `testfs`). Client close path clean
- **Gate orchestrator creates a `GOLDEN_PRINCIPLE_BREACH`
  alert on every `escalate` verdict.** Closes an old gap:
  prior to this fix the gate transitioned the intent to
  `escalated` and persisted the GP_BREACH signals but never
  wrote an `alerts` row, so the dashboard's Alerts view
  showed nothing for the escalation. Operators had to
  discover the escalation by polling the intent list.
  - `createBreachAlert(correlationId, intentId, gateSignals,
    childLog)` runs inside the gate orchestrator's
    `verdict === 'escalate'` branch (right after
    `transitionIntent(..., 'escalated')`). Loads the
    `GOLDEN_PRINCIPLE_BREACH` signals out of the gate
    result, builds an alert with `type:
    'GOLDEN_PRINCIPLE_BREACH'`, `severity: 'critical'`,
    `requiredAction: 'acknowledge-breach'`, the first
    breach's message as the description (or "N breach(es)
    require review. First: …" when multiple), and
    `context: { intentId, breachSignalIds[], breachAgent,
    triggeredBy: 'gate-escalate' }`
  - Emits `alert.created` SSE so the Layout's badge updates
    without a page refresh and the Alerts view's live-event
    subscription fetches the new row
  - Failure non-fatal — the intent is already escalated; a
    failed `alerts.create` writes a warning log and the
    cycle proceeds. Missing alert is worse UX, not data
    loss
  - The dashboard's existing `BreachInterventionBlock`
    (the Resume / Abort / Acknowledge-breach card from the
    interventions session) renders out of the box on the
    new alerts because `enrichAlert` already lifts
    `breachMessage` / `breachLocation` / `breachAgent` from
    the matching signal via `signals.findByCorrelationId`
  - **One-shot backfill SQL** ran against trackeros for the
    four pre-existing escalated intents — three matched
    (had real GP_BREACH signals) and got alerts; the
    fourth (`verify-membership-guard`, a synthetic test
    intent with no real signals) was correctly skipped.
    The backfill is idempotent (skips correlations that
    already have a GP_BREACH alert) so it's safe to re-run
    on any deployment with stuck escalations
  - Backfill SQL (one-shot — not migration-shipped; data
    fix only) documented in this session's log entry for
    any other operator who needs to clear a backlog
  - Verified live: dashboard headless-Chrome drive against
    `/app/alerts` rendered three GP_BREACH cards with the
    ⛔ glyph, `[critical]` badge, "Quality gate escalated
    — golden-principle breach" title, and the sidebar
    `Alerts` badge showing `3`. `GET /alerts?projectId=…`
    returns the three rows with enriched
    `breachMessage` / `breachAgent` (`review-agent`) /
    `intentId` fields populated
- **CLI server URL is fully configurable.** `gestalt config show` /
  `gestalt config set-server <url>` / `gestalt config reset` let
  operators inspect and change `~/.gestalt/config.json` without going
  through the auth flow. Every CLI command that contacts the server
  (`login`, `init`, `init-admin`, `run`, `status`, `logs`,
  `dashboard`, `projects list|use|set-adapter`) accepts an optional
  `--server <url>` flag — one-shot override on all of them; only
  `login` and `init-admin` persist the URL to config on success
  (those are the bootstrap commands). All commands route URL
  selection through one helper (`resolveServerUrl`); no remaining
  direct `config.serverUrl` reads in command files. `gestalt status`
  prints the active server URL in its header
  (`Gestalt — http://localhost:3000`). Every connectivity failure
  surfaces the attempted URL through a shared formatter and, when
  the URL is still the local-dev default
  (`http://localhost:3000`), adds a first-run hint nudging the user
  to `gestalt config set-server` + `gestalt login`. URL validation
  (`http://` or `https://` only, trailing slash stripped) lives in
  `normaliseServerUrl`. `gestalt config show` never prints the token
  itself — only `set` / `not set`
- `gestalt init` fully implemented — Git-backed four-phase wizard:
  registers project on server, server clones repo, commits harness files,
  pushes; developer runs `git pull` to receive harness locally
- `gestalt projects list`, `gestalt projects use <name>`, and
  `gestalt projects set-adapter <name> <noop|github-actions>
  [--auto-merge | --no-auto-merge]
  [--merge-method squash|merge|rebase]` working.
  `set-adapter` clones the project repo, mutates `pipeline.adapter`
  (and optionally `pipeline.autoMerge` / `pipeline.mergeMethod`) in
  `HARNESS.json`, commits as
  `chore: update pipeline <changed fields> [gestalt]`, and pushes
  to `defaultBranch` — HARNESS.json in the repo remains the source of
  truth (ADR-032). Multi-field patches commit ONE row atomically.
  Audit-logged as `project.config-updated` with `changedFields[]`
  + `previousValues` / `newValues` per field
- `gestalt run` queues intent → orchestrator picks up → clones project
  repo fresh per cycle → runs generate loop against cloned harness files
- **Platform LLM Registry (Session 3, 2026-06-03 — migration 014).**
  Platform-admin manages a registered list of LLM endpoints; every
  agent's `model` override resolves through it for per-LLM
  `baseUrl` + `apiKeyEnv` routing. No new agent model surface — the
  existing `agents.yaml` `llm.model` field is still operator-typed
  text, the registry just gives it real routing semantics. The
  actual API key VALUE is NEVER persisted (the registry stores the
  env var NAME; the server reads `process.env[apiKeyEnv]` at LLM
  call time).
  - **`platform_llms` table** (migration 014) — `id`, `name`
    (unique), `provider`, `model_string`, `base_url`,
    `api_key_env`, `is_default`, `description`, timestamps. A
    partial unique index `WHERE is_default = TRUE` enforces
    "at most one default" at the DB layer; the application
    `PlatformLLMRepository.setDefault` clears the existing
    default inside a single transaction so the index is never
    seen with two TRUE rows
  - **`PlatformLLMRepository` in `@gestalt/core`** with `list`,
    `findById`, `findByName`, `findDefault`, `findByModelString`,
    `create`, `update`, `delete`, `setDefault`, `count`. The
    postgres impl uses `db.begin` for all mutations that touch
    `is_default`. Oracle / mssql get the standard throw-stubs
  - **First-boot seed.** `server.ts` step 4b: if `platformLlms.count()
    === 0`, insert one row from the loaded `.env` LLM config
    (`name: 'Platform default'`, `apiKeyEnv: 'LLM_API_KEY'`,
    `isDefault: true`). Provider auto-detected from `baseUrl`
    (`api.openai.com` → `openai`, `openai.azure.com` →
    `azure-openai`, `api.anthropic.com` → `anthropic`,
    `localhost:11434` → `ollama`, else `custom`). Verified live
    on `docker-compose down -v && up -d --build`: migration 014
    applied; one row seeded; subsequent boots log
    `platform_llms already seeded — skipping`
  - **`getLLMClientForModel(modelString?)`** in
    `@gestalt/core/llm`. Lookup order: `undefined` → the platform
    default via `getLLMClient()`; otherwise consult the registry
    via an injected resolver; match → fresh `LLMClient` keyed
    `${modelString}|${baseUrl}` so two registrations for the
    same model name against different endpoints get distinct
    clients; no match → fall back to `getLLMClient(modelString)`
    (legacy behaviour). The resolver is wired via
    `setLLMRegistryResolver` at server boot (`server.ts` step
    4b); tests that don't wire it transparently fall back to
    the pre-registry behaviour
  - **`BaseLLMAgent.callLLMWithMessages` + `callLLMWithTools`**
    now route through `getLLMClientForModel` (was
    `getLLMClient`). `custom-agent-runner` updated to match.
    No behaviour change for agents whose model isn't registered;
    agents with a registered model now use the registry's
    `baseUrl` + the env-resolved API key
  - **New routes in `packages/server/src/routes/platform-config.ts`:**
    - `GET /platform/llms` — any authenticated user (agents +
      project-admin dashboard need it). Returns the records
      including `apiKeyEnv` (env var NAME). The KEY value
      never appears
    - `POST /platform/llms` — platform-admin (`requireRole('admin')`).
      Validates: provider in `{openai|azure-openai|anthropic|ollama|custom}`,
      `name` unique, all required fields present.
      `isDefault: true` clears the existing default
      atomically. Audit row `platform.llm-added`
    - `PATCH /platform/llms/:id` — same auth. Partial update;
      rename collision → 409 `NAME_TAKEN`. Audit row
      `platform.llm-updated` with `changedFields` +
      `previousValues` + `newValues`
    - `DELETE /platform/llms/:id` — same auth. Refuses on the
      default → 400 `CANNOT_DELETE_DEFAULT_LLM`; refuses on the
      last row → 400 `LAST_LLM`. Audit row
      `platform.llm-deleted`. All three guards verified live
      against the seeded registry
    - `POST /platform/llms/:id/test` — same auth. Sends a one-
      token `hello` completion to the registered endpoint using
      `process.env[apiKeyEnv]`; returns
      `{ ok: bool, latencyMs: number, error?: string }`. If
      `apiKeyEnv` is empty in the server env, returns
      `ok: false` with an actionable message. Verified live
      reaching OpenAI (2253ms RTT)
  - **CLI `gestalt platform llms`** (new parent + 5
    subcommands; platform-admin only):
    - `list` — table with name / provider / model / base URL
      / env var. Default row prefixed `★`
    - `add` — interactive: name / provider / model string /
      base URL (provider-preset prefill) / env var / description
      / set-as-default
    - `set-default <name>` — resolves by name + flips
    - `remove <name>` — `y/N` confirm + delete
    - `test <name>` — calls the test endpoint; prints latency
      or actionable failure message. Verified live end-to-end
  - **Dashboard Admin** gains a third "LLMs" tab alongside
    Users + Projects. Table with per-row buttons Test / Edit /
    Set default / × (delete). Add/Edit modal: name, provider
    select (auto-fills baseUrl from `PROVIDER_PRESETS`), model
    string, base URL, `apiKeyEnv` (with a permanent reminder
    that the actual key VALUE lives only in the server env),
    description, default checkbox. Test results render inline
    next to the row (`✓ 142ms` green or `✗ <error>` red)
  - **Project Settings (existing) reworked** — model field in
    the Agents tab is now a `<select>` populated from the
    registry via `GET /platform/llms`. Options:
    `~ Platform default (<modelString>)` first; then every
    registered LLM as `<name> (<provider>)`; then a final
    `Custom model string…` escape hatch. Picking custom
    collapses the dropdown to a free-text input with a "Back
    to list" button. The legacy free-text input remains
    available via the escape hatch for unregistered models
- **Platform secrets vault (Session 4, 2026-06-03 — migrations
  015 + 016).** Replaces the env-var-only API-key path with an
  encrypted-at-rest vault. Operators enter the API key VALUE
  once (via dashboard or `gestalt platform secrets add`),
  reference it from any LLM in the registry, and rotate it
  later without touching the server's environment. Secret
  values are NEVER returned by any API — not even to
  platform-admin.
  - **Master key** loaded once at server boot in step 1b
    (BEFORE the database is initialised). Three sources tried
    in order: `GESTALT_MASTER_KEY` env (base64), then
    `/etc/gestalt/master.key`, then `./master.key` in cwd. In
    dev (NODE_ENV !== 'production') a fresh key is auto-
    generated in `./master.key` with mode 0600 + a loud
    warning log; in production a missing key is a fatal
    startup error (so a misconfigured deployment surfaces
    before any secret operation touches the wrong key). The
    in-memory key lives in
    `packages/server/src/secrets/index.ts` behind
    `setMasterKey` / `getMasterKey`; the latter throws if
    called before set so a misordered import can never
    silently encrypt with a zero key
  - **AES-256-GCM** via Node's built-in `crypto` —
    `encryptSecret(value, masterKey)` returns
    `{ encrypted, iv, authTag }` as base64 strings, with a
    fresh 96-bit IV per call (never reused).
    `decryptSecret(secret, masterKey)` throws a single
    generic `"decryption failed: bad key or corrupt data"`
    on any failure path so error-message side channels can't
    leak which of bad-key vs tampered-ciphertext vs
    wrong-auth-tag is the cause. Both helpers live in
    `packages/core/src/secrets/vault.ts`
  - **`platform_secrets` table** (migration 015) — `id`,
    `name` (unique), `description`, `encrypted`, `iv`,
    `auth_tag`, `created_by` (nullable FK to `users`),
    timestamps. Migration 016 then drops the
    `platform_llms.api_key_env` NOT NULL constraint so a
    vault-only LLM row can carry `apiKeyEnv = NULL`.
    `platform_llms.secret_id UUID REFERENCES
    platform_secrets(id) ON DELETE SET NULL` + partial
    btree index for the SECRET_IN_USE guard scan
  - **`PlatformSecretRepository`** in `@gestalt/core` with
    `create`, `update`, `findById`, `findByName`, `list`,
    `delete`, `findReferencingLlms`. **`list()` uses a
    narrow SQL projection that omits `encrypted` / `iv` /
    `auth_tag`** — defense-in-depth so even an accidental
    server-side log of the full row never carries
    ciphertext. The public-facing `PlatformSecretSummary`
    type is the result. `delete()` runs inside `db.begin`:
    queries `platform_llms WHERE secret_id = ${id}`,
    throws `SecretInUseError(id, llmNames)` if any match.
    Oracle + mssql adapters get the standard throw-stubs
  - **Routes in
    `packages/server/src/routes/secrets.ts`** — all
    `requireRole('admin')`:
    - `GET /platform/secrets` — list of summaries (no
      ciphertext). Audit row NOT written on read
    - `POST /platform/secrets` — body
      `{ name, value, description? }`. Encrypts with the
      master key, persists, returns the public summary.
      Audit row `secret.created` carries `name +
      descriptionLength + ip` ONLY — value/encrypted/iv/
      authTag NEVER reach `audit_log` (GP-006)
    - `PATCH /platform/secrets/:id` — body
      `{ name?, value?, description? }`. Supports rename,
      rotate (fresh IV), description-edit. Audit row
      `secret.updated` records `changedFields` so an
      operator can later see WHO rotated WHEN without
      learning the value
    - `DELETE /platform/secrets/:id` — refuses with HTTP
      400 `SECRET_IN_USE` + `llmNames: [...]` when any LLM
      references the secret. Verified live: deleting a
      referenced secret returns the typed code with the
      LLM name; flipping the LLM's source to env-var first
      then re-deleting returns HTTP 204
  - **LLM resolver wires vault into `getLLMClientForModel`.**
    The server-side resolver (`setLLMRegistryResolver` at
    step 4b) now calls a new `resolveLlmApiKey(llm)` helper:
    `secretId` wins → vault decrypt under the master key.
    Failure (missing secret / bad ciphertext / unreachable
    master key) is logged at WARN with the LLM NAME only
    (never the secret id, never key material) and falls
    through to `process.env[apiKeyEnv]`. Empty string when
    neither resolves — the LLM call surfaces an actionable
    401 instead. Pre-resolution happens server-side so the
    `llm` module stays free of vault / repository imports;
    the registry cache key becomes `<model>|<baseUrl>` so
    rotating a secret invalidates correctly on the next
    `setLLMRegistryResolver` swap
  - **`POST /platform/llms`** now requires at least one of
    `apiKeyEnv` or `secretId` (returns 400
    `INVALID_API_KEY_SOURCE` otherwise). `PATCH` accepts
    either field independently nullable so an operator can
    flip an existing LLM from env var to vault without
    re-registering. The `/test` endpoint mirrors the
    runtime resolver via a parallel `resolveTestApiKey`
    helper so a "test" click reflects exactly what an
    agent call would see
  - **CLI `gestalt platform secrets`** (admin-only):
    - `list` — table of `name / description / age`. The
      footer line spells out "Values are never displayed.
      Use `rotate <name>` to replace a value."
    - `add` — interactive: name, description, hidden TTY
      value entry via `promptSecret`, hidden confirm,
      mismatch errors. Value never echoed
    - `rotate <name>` — name resolution, "old value
      unrecoverable" warning, hidden new value + confirm
    - `remove <name>` — confirm prompt; surfaces
      `SECRET_IN_USE` with the LLM names so the operator
      knows which references to clear first
  - **CLI `gestalt platform llms add`** gained the source
    picker — `1 = vault secret` (lists secrets, pick by
    name) or `2 = env var` (free-text). `llms list` shows
    a "Key source" column rendering `🔒 vault` / `env:
    VAR` / `(unset)`. `llms test` failure messages now
    branch on whether the LLM uses a vault secret, an env
    var, or neither so the operator sees actionable
    guidance
  - **Dashboard Admin gains 4th "Secrets" tab** with table
    + Add / Edit-or-Rotate / Remove modals. The Add modal
    requires confirm-match before saving; the Edit modal
    leaves the value blank by default ("leave blank to
    keep the current value — entering a new value is
    irreversible"); the Remove path surfaces SECRET_IN_USE
    with the LLM list inline. The LLMs tab's add/edit
    modal gains a radio-pair "API key source" — vault
    (select from existing + "+ Create new secret" link
    that opens the Add Secret modal inline) or env var
    (free-text). The Key source column on the LLMs table
    renders `🔒 vault` or `env: VAR_NAME`
  - **GP-006 compliance verified live.** `audit_log`
    rows for `secret.created` / `.updated` / `.deleted`
    + `platform.llm-updated` carry only `name`,
    `descriptionLength`, `changedFields`, `ip` — direct
    SQL probe `metadata::text LIKE '%verify-test-key%'`
    returns the name (expected; that's documented in
    the metadata) but `LIKE '%VERIFY-1234%'` (the actual
    secret value) returns zero matches anywhere in the
    audit_log. Ciphertext column in `platform_secrets` is
    36 chars base64 ≠ plaintext; rotating the value
    produces a different ciphertext + a different IV
    (post-rotation row inspection confirmed)
  - **docker-compose seeded** with a commented-out
    `./master.key:/etc/gestalt/master.key:ro` mount and
    `GESTALT_MASTER_KEY` env-var placeholder. Operators
    uncomment one after creating the host-side key
    (`openssl rand -base64 32 > master.key && chmod 600
    master.key`). `.gitignore` now excludes `master.key`
    (and `auth.config.json` / `krb5.keytab` from the
    prior identity session, which had been overlooked).
    Deployment guide gained a "Generate the master key"
    block with the openssl recipe + back-up-out-of-band
    warning + the "do not rotate in place" note
  - **First-boot smoke verified end-to-end.** Fresh
    `./master.key` auto-generated on docker rebuild
    (mode 0600, 45 bytes); migrations 015 + 016 applied
    in order; `GET /platform/secrets` returns
    `{ data: [] }`; `POST` creates a secret with
    response containing NO encrypted/iv/authTag fields;
    direct DB inspection confirms ciphertext is not
    plaintext; LLM created with `secretId: <uuid>,
    apiKeyEnv: null`; DELETE secret while referenced
    returns 400 `SECRET_IN_USE` with `llmNames`;
    PATCH LLM to clear `secretId` + set `apiKeyEnv` then
    DELETE secret returns HTTP 204
- **Project management in Platform Admin (2026-06-03 — no
  migrations).** Closes the long-standing "platform-admins can't
  create or delete projects from the UI" gap. Adds a typed DELETE
  endpoint, enriches GET /projects with cross-project stats for
  platform-admin, rewrites the Admin → Projects tab into a full
  management surface, and ships a `gestalt platform projects`
  CLI group.
  - **`DELETE /projects/:id`** (`requireRole('admin')`) — refuses
    on active intents (status IN `generating | in-review |
    deploying | waiting-for-clarification`) with HTTP 400
    `PROJECT_HAS_ACTIVE_INTENTS` + `activeIntents: N`. Otherwise
    tears down dependent tables in FK-safe order
    (`memberships → project_git_credentials → maintenance_runs →
    projects`); finding_attempts cascades automatically via the
    existing ON DELETE CASCADE on its FK. Audit row carries
    `name + gitUrl + intentCount + ip`. Emits `project.deleted`
    SSE so the dashboard's ProjectContext + sidebar selector
    pick up the change without a refresh. Intent rows are
    intentional orphans (intents.project_id is TEXT with no
    FK — historical record per ADR-002 ephemeral-workers
    rationale)
  - **`GET /projects` enriched for platform-admin only** —
    `memberCount`, `intentCount`, `lastActivityAt` lifted via
    parallel `memberships.countByProject` /
    `intents.countByProject` / `intents.findLatestByProject`
    per row. Regular users (membership-based list) skip the
    enrichment entirely; the `ProjectSummary` type has the
    fields as optional so callers can ignore them
  - **New repository methods** in `@gestalt/core`:
    `IntentRepository.{countByProject, countActiveByProject,
    findLatestByProject}`,
    `ProjectMembershipRepository.{countByProject,
    deleteAllForProject}`, `ProjectRepository.{delete,
    deleteAllCredentials}`,
    `MaintenanceRunRepository.deleteAllForProject`. Postgres
    impls use the `WITH deleted AS (... RETURNING 1) SELECT
    COUNT(*)` trick to get affected-row counts (postgres.js
    doesn't surface them on naked DELETE). Oracle + MSSQL
    adapters got throw-stubs for parity
  - **`project.deleted` added to `LiveEventType` union** in
    `@gestalt/core/events`. Payload is
    `{ projectId, name }`; consumers see it on the same
    `/events` SSE stream every other live event uses
  - **Dashboard Admin → Projects tab rewritten.** Toolbar gains
    `+ Create project` + Search input. Table now shows
    columns `Name / Members / Intents / Last activity /
    Actions` with the relative-time formatter
    (`2h ago` / `5d ago` / falls back to locale date past 30
    days). Per-row actions: `⚙` (open `/app/projects/:id/
    settings`), `→` (set `currentProjectId` in
    `ProjectContext` and navigate to `/app/intents`), `×`
    (open the delete modal)
  - **`CreateProjectModal`** — name / Git URL / default branch
    / Git token (password input) / optional description. Two-
    stage submission: `POST /projects` (status `Registering
    project...`), then `POST /projects/:id/init-harness`
    (status `Cloning + writing harness...`) with the
    description auto-defaulted to `Project <name> created via
    platform admin`. Done screen offers `Close` which
    refreshes the local table + ProjectContext (so the new
    project appears in the sidebar selector immediately)
  - **`DeleteProjectModal`** — three-bullet list of what gets
    deleted (intents + execution history, member assignments,
    Git credentials + maintenance runs) + explicit "The Git
    repository itself will NOT be deleted" notice. Requires
    typing the project name exactly to enable the red
    `Delete project` button. PROJECT_HAS_ACTIVE_INTENTS errors
    surface inline as "Cannot delete — this project has N
    active intents. Wait for them to complete or fail first."
    without dismissing the modal
  - **`ProjectContext.refresh()`** exposed on the context
    value so the Admin tab can trigger an immediate sidebar
    refresh after create/delete instead of waiting for the
    window-focus refresh
  - **`gestalt platform projects` CLI** (admin-only):
    - `list` — table `Name / Members / Intents / Last
      activity / Git URL` (column widths 26/10/10/16/48).
      Empty list prints `No projects registered.`
    - `create` — interactive prompts (name / git url /
      default branch [main] / hidden TTY git token /
      optional description). Two-stage flow: register +
      init-harness, then prints `✓ Project created and
      harness initialised: <name>`
    - `delete <name>` — prints the three-bullet "this will
      delete" summary, then prompts `Type the project name
      to confirm:` and aborts if the typed input doesn't
      match. Surfaces `PROJECT_HAS_ACTIVE_INTENTS` with
      `✗ Cannot delete — this project has active intents.`
      and a hint pointing at `gestalt alerts`
  - **Verified live** end-to-end via SQL-seeded test project
    (real Git URL + PAT not available in this verification):
    - Enriched GET: `memberCount: 1, intentCount: 2,
      lastActivityAt: <iso>` for a project with two intents
      (one `deployed`, one `failed`)
    - Active-intents guard: insert one `generating` intent →
      DELETE returns 400 `PROJECT_HAS_ACTIVE_INTENTS` with
      `activeIntents: 1`; flip to `failed` → DELETE returns
      HTTP 204
    - Post-delete state: `projects` + `project_memberships`
      counts 0; `intents` rows survive (3 orphans, expected);
      `audit_log` row with `metadata = { name, gitUrl,
      intentCount: 3, ip }` ONLY
    - 404 path: bogus UUID returns `{"error":"Project not
      found"}` + HTTP 404
    - Auth guards: no auth header → 401; regular `user`
      role → 403 `Platform admin required`. Regular user
      `GET /projects` returns `{ data: [] }` (their membership
      list, never the enrichment path)
    - CLI `platform projects list` populated + empty cases
      render correctly; CLI `delete` with matching name
      succeeds + with mismatched name aborts at exit code 1
      without touching the DB
- **Tools tab merged into Agents tab (Session 3 — UX).** The
  standalone Tools tab is gone from `/app/projects/:id/settings`;
  tool assignment IS agent config. Each agent's expanded card
  now has a Tools section (built-in checkboxes + MCP server
  list) right after the prompt-extensions UI. One Save commits
  everything for an agent: role / goal / model / temperature /
  max tokens / promptExtensions / tools — one diff, one PATCH,
  one Git commit
  - **Server change**: `PATCH /projects/:id/config/agents` now
    accepts an optional `tools: AgentToolConfig` per agent
    alongside the existing fields. The validator's
    `validateToolFields` helper is shared between the agents-
    patch route (where tools are inline) and any future
    caller. `applyAgentsPatch` merges `tools` into the
    agents.yaml output as a full replace per agent
  - **`PATCH /projects/:id/config/tools` REMOVED.** The
    standalone route is gone; the dashboard's Tools tab is
    gone with it. The legacy CLI `gestalt project config
    set-tools` is now a thin alias that internally calls
    `set-agent` with the same flags so existing scripts keep
    working (description marked DEPRECATED)
  - **CLI `gestalt project config set-agent` gained
    `--builtin`/`--add-mcp`/`--mcp-url`/`--token-from`/`--remove-mcp`**
    flags (moved from `set-tools`). The single command now
    covers persona, LLM tuning, prompt extensions, AND
    tools — one CLI call, one commit
  - The dashboard API client's `patchToolsConfig` is kept
    only as a back-compat wrapper that rewraps the legacy
    `{tools: ...}` payload into a `{agents: {role: {tools:
    ...}}}` shape and POSTs to the agents endpoint. No
    client code uses it after Session 3 — preserved for
    third-party integrations
- **Project admin UI + CLI (Session 2, 2026-06-03 — config-as-code).**
  A "Project settings" surface on both the dashboard and the CLI for
  project-admin-driven configuration. Every config write goes through
  `clone → edit HARNESS.json or agents.yaml → commit
  'chore: update <section> [gestalt-admin]' → push to defaultBranch`
  (Approach A, ADR-032 — Git is the source of truth). No new DB
  tables, no new migrations.
  - **New server routes in
    `packages/server/src/routes/project-config.ts`:**
    - `GET /projects/:id/config` — shallow-clones the repo, reads
      both `HARNESS.json` and `agents.yaml`, returns
      `{ harness, agents }`. Used by all six dashboard tabs on
      first render
    - `PATCH /projects/:id/config/pipeline` — partial update of the
      `pipeline` section in HARNESS.json. Fields: `adapter`,
      `autoMerge`, `mergeMethod`. Validates against the same
      whitelists the legacy `POST /projects/:id/config` uses
    - `PATCH /projects/:id/config/agents` — partial per-agent
      update of framework LLM agents in `agents.yaml`. Body:
      `{ agents: Record<string, Partial<AgentConfig>> }`.
      Infrastructure agents (constraint / lint / security / test-
      runner / pr / pipeline / promotion / gc / evaluation) are
      filtered out — they run deterministic checks. Validation:
      `temperature 0..2`, `maxTokens > 0`, no unknown fields
    - `PATCH /projects/:id/config/custom-agents` — full replace of
      the `custom_agents:` section. Validates uniqueness of names
      AND runs `scheduleCustomAgents` so cycles / unknown
      `runs_after` targets / self-loops fail with 400
      `INVALID_CUSTOM_AGENT_SCHEDULE` before the commit
    - `PATCH /projects/:id/config/tools` — partial per-agent
      update of the `tools:` block. Built-in tools validated
      against the four ADR-038 names; MCP entries validated for
      `name + url + tokenFrom` shape (`'project_credential' |
      'harness' | 'env:VAR_NAME'`)
    - All five routes require project-admin (or platform-admin
      bypass). Audit row per successful patch with section name +
      changed-fields + commit SHA. Values are NOT in the audit
      metadata (MCP `tokenFrom: 'env:VAR'` could leak env names;
      future credential fields could leak more)
  - **Existing `POST /projects/:id/config` preserved for CLI
    backward compat** but now DELEGATES to the shared
    `applyPipelinePatch` helper from the new module. One mutation
    path per file, two entry points (legacy POST + new PATCH).
    The legacy response shape (`updated`, `adapter`, `autoMerge`,
    `mergeMethod`, `commitSha`, `reason`) is preserved so
    `gestalt projects set-adapter` keeps working
  - **Fix: project-admin can now manage project members.**
    `POST/PATCH/DELETE /projects/:id/members` previously used
    `requireRole('operator')` which allowed editors AND
    project-admins. Tightened to `checkProjectMembership(...,
    'project-admin')` directly — editors can no longer add /
    remove / change members. Verified live: an `editor` on
    `trackeros` gets 403 `INSUFFICIENT_PROJECT_ROLE` on POST
    /members; the same editor still gets 200 on `GET /intents`
  - **New CLI command group: `gestalt project` (singular).**
    Coexists with the existing `gestalt projects` (plural — for
    cross-project listing / switching / set-adapter). All under
    `packages/cli/src/commands/project-config.ts`:
    - `gestalt project config show [--project <name>]` —
      structured summary of all six sections
    - `gestalt project config set-agent <agentRole>
      [--model <m>] [--temperature <t>] [--max-tokens <n>]
      [--role <text>] [--goal <text>]
      [--add-extension "<text>"] [--remove-extension <index>]`
      — partial PATCH. `--add-extension`/`--remove-extension`
      operate against the CURRENT prompt-extensions list (read
      via `GET /projects/:id/config` first, mutated, then
      patched as a full replacement of that agent's
      `promptExtensions`)
    - `gestalt project config add-custom-agent` — interactive
      prompts for `name` / `role` / `goal` / `runs_after` /
      `model` / `temperature`, then opens `$EDITOR` (with `vi`
      fallback) for the multi-line prompt body. The full custom
      agents list is read, the new entry appended, and the
      whole array submitted to `PATCH /custom-agents` so the
      server's schedule-cycle check catches bad
      `runs_after` references
    - `gestalt project config remove-custom-agent <name>` —
      prompts confirm + removes the named entry
    - `gestalt project config set-tools <agentRole>
      [--builtin a,b,c] [--add-mcp <name> --mcp-url <url>
      [--token-from <source>]] [--remove-mcp <name>]` —
      partial tools update. MCP add/remove operates against
      the current list
    - `gestalt project config set-pipeline
      [--adapter <noop|github-actions>]
      [--auto-merge | --no-auto-merge]
      [--merge-method <squash|merge|rebase>]` — replaces
      `gestalt projects set-adapter` for the modern flow.
      The legacy command continues to work
    - `gestalt project members list / add <email> --role
      <role> / remove <email> / role <email> <role>` —
      project-admin-level member management. Verified live:
      `gestalt project members list` against `trackeros`
      shows all 4 members with their roles and added dates
  - **New dashboard surface in
    `packages/dashboard/src/views/ProjectSettings.tsx`:**
    six tabs (Members / Agents / Custom agents / Tools /
    Pipeline / LLMs) gated by `RequireProjectAdmin` at
    `/app/projects/:id/settings`. The `:id` segment keeps deep
    links project-scoped — switching projects in the sidebar
    redirects appropriately. Each tab uses a single
    `GET /projects/:id/config` call on mount; tab-specific
    PATCH calls on save
  - **Tab 1 (Members)**: table view powered by the existing
    `GET /projects/:id/members`. Add modal calls `/users` for
    search; inline role select calls `PATCH /members/:userId`;
    Remove button calls `DELETE /members/:userId` with browser
    confirm. Last-project-admin guard surfaces server-side as
    400 + the typed message
  - **Tab 2 (Agents)**: per-agent block with editable fields
    (Role / Goal / Model / Temperature / Max tokens /
    promptExtensions). "Save changes" sends ONE
    `PATCH /agents` covering every agent whose JSON differs
    from the loaded config. Infrastructure agents shown as a
    separate read-only card with the brief's note
    ("cannot be configured — they run deterministic checks")
  - **Tab 3 (Custom agents)**: per-custom-agent card with
    Edit / Delete buttons. Add/Edit opens a modal with all
    fields, including a `runs_after` `<select>` populated
    with framework agents + other customs (excluding self).
    Cycle / unknown target errors from the server render in a
    red banner without losing the form state
  - **Tab 4 (Tools)**: checkboxes for the four built-in tools
    per agent + MCP server list with name/url/tokenFrom
    columns. Add via `window.prompt` for now (modal can
    follow). Single `PATCH /tools` covers all agents
  - **Tab 5 (Pipeline)**: radio for adapter, checkbox for
    autoMerge, radio for mergeMethod. Replaces the
    `gestalt projects set-adapter` CLI flow with a proper UI
  - **Tab 6 (LLMs)**: read-only summary table of every
    framework agent's model override + temperature +
    maxTokens. Click any row → jump to Agents tab
  - **`ProjectContext.currentUserRole`** added — resolves the
    signed-in user's role on the current project via
    `listMembers`. Refreshes when project selection changes.
    `null` when not a member OR when the user is a
    platform-admin (who bypasses every project guard server-
    side). The Layout's ⚙ Settings link computes
    `canEditProject = isPlatformAdmin || currentUserRole ===
    'project-admin'` and renders the `<li>` ONLY when true —
    completely absent from the DOM for editors / readers
  - **Live verified against `trackeros`:**
    - `GET /projects/:id/config` returns the typed
      `{ harness, agents }` payload with `agents.agents`
      filtered to 6 editable framework roles +
      `custom_agents` populated
    - `gestalt project config show` renders all six
      sections with the current values
    - `gestalt project config set-agent code-agent
      --temperature 0.3` committed `63cb7f4` to trackeros
      `main` with subject `chore: update agents
      [gestalt-admin]`; `temperature: 0.3` visible under
      `code-agent.llm` in the pushed `agents.yaml`
    - `gestalt project config set-pipeline --auto-merge
      --merge-method squash` committed `261a4cf` to
      trackeros `main`; `HARNESS.json` `pipeline.autoMerge:
      true` confirmed via re-clone
    - Cycle-detection: a POST with `agent-a → agent-b` +
      `agent-b → agent-a` returns 400
      `INVALID_CUSTOM_AGENT_SCHEDULE` + the typed message
      from `scheduleCustomAgents`
    - Editor-tightening: an `editor` user on trackeros gets
      403 `INSUFFICIENT_PROJECT_ROLE` on `POST
      /projects/:id/members` and on `GET
      /projects/:id/config`; the same editor gets 200 on
      `GET /intents?projectId=...&limit=1` (reader-level
      access preserved)
    - Dashboard bundle compiled with the new view, the new
      sidebar logic, and `RequireProjectAdmin` guard. Bundle
      size 281 KB (was 254 KB); index-`BfIQUkCg.js`
- **CLI operational parity (Session 1, 2026-06-03).** The CLI now
  surfaces the same data the dashboard does, organised into
  noun-verb subcommands per layer. No new server endpoints beyond
  a `?correlationId=` filter on `GET /deployments` and a
  `GET /maintenance/runs/:id` detail route. Shared
  `packages/cli/src/ui/execution-graph.ts` renders the
  Generate → Quality gate → Deploy flow grouped by layer with
  per-row durations, token totals, custom-agent tags, and
  inlined PR / run / merge-SHA extras. The renderer is shared
  between `gestalt intent show` and `gestalt status --id <id>
  --graph` — same `FRAMEWORK_AGENTS` set the dashboard's
  `IntentDetail.tsx` uses.
  - `gestalt intent list [--status <s>] [--project <name>]
    [--limit 20]` — table with id-prefix / status badge /
    priority / age / text
  - `gestalt intent show <id> [--watch]` — full execution-flow
    graph. Accepts UUID or 8-char correlationId prefix.
    `--watch` polls every 3s and re-renders until the intent
    reaches a terminal status (`deployed | failed |
    escalated`) — uses `\x1b[2J\x1b[H` between renders,
    Ctrl+C to detach
  - `gestalt intent submit "<text>"` — alias of `gestalt run`,
    same implementation
  - `gestalt gate show <intentId>` — verdict (derived from
    intent status), per-gate-agent rows with status / duration
    / per-row summary (constraint violations, lint warnings,
    test pass-fail, review findings), and the full signals
    list
  - `gestalt deploy list [--project <name>] [--limit 20]` —
    table of recent deployments (id / status / PR / branch /
    started). Backed by the existing `GET /deployments?projectId`
  - `gestalt deploy show <intentId> [--project <name>]` —
    timeline with per-event timestamps:
    `HH:MM:SS  ✓ PR opened           PR #26`
    `HH:MM:SS  ✓ Pipeline triggered  run #...`
    + `Total deployment time: Ns`. Uses the new
    `?correlationId=` filter on `GET /deployments`
  - `gestalt maintenance list [--project <name>]
    [--agent <role>] [--limit 20]` — table (id / agent /
    status / fixes / intents / duration / age)
  - `gestalt maintenance show <runId>` — run header + findings
    list with per-finding severity badge, up-to-3 affected
    files (and "and N more"), description, and suggested
    action. Backed by the new `GET /maintenance/runs/:id`
    route + `findById` repo method (postgres impl + oracle /
    mssql throw-stubs)
  - `gestalt agents active [--project <name>]` —
    currently-running agent executions enriched with the
    intent text, cycle progress (`step N of M`), elapsed
    wall-clock time, and the running token total across the
    cycle. Same enrichment the dashboard's ActiveAgents card
    consumes. `--project` intersects by correlationId
  - **`gestalt status --id <id> --graph [--watch]`** — same
    execution-flow renderer as `intent show`, accessed via
    the status namespace. `--watch` re-renders every 3s
    (polling, not SSE — `gestalt logs` is the SSE surface)
  - **Shared `resolveIntentId` helper**
    (`packages/cli/src/ui/intent-resolver.ts`) — every command
    that takes `<intentId>` translates UUID or 8-char
    correlationId prefix to the intent's internal UUID via
    the same path. `/intents/:id` keys on the intent UUID,
    not the correlationId, so even a full correlationId
    needs to be resolved first
  - **Server additions, minimal**: `GET /deployments` accepts
    an optional `?correlationId=<id>` query parameter (post-
    enrichment client-side filter — usually matches at most
    one row). `GET /maintenance/runs/:id` route returns
    `{ data: MaintenanceRunRecord }`; cron-scheduled runs
    (`project_id IS NULL`) are unscoped, per-project runs are
    membership-checked. The `MaintenanceRunRepository`
    interface gained `findById(id): Promise<MaintenanceRunRecord
    | null>`; postgres impl + oracle / mssql throw-stubs
  - **CLI types**: `IntentSummary` gained `projectId: string`
    (the server always returns it; declaring it lets the new
    commands avoid `as` casts). New
    `DeploymentSummary` / `DeploymentEvent` /
    `DeploymentEventType` / `MaintenanceRunRecord` /
    `MaintenanceFinding` types mirror the server shapes
  - Live verified:
    - `gestalt intent list --limit 5` — table renders with
      correct status badges and ages
    - `gestalt intent show 8b3fcc4a` — execution graph
      renders Generate / Gate / Deploy sections, the
      `[custom]` tag on `docs-check-agent`, the auto-merged
      SHA on the promotion-agent row, and "No signals"
      when the cycle was clean
    - `gestalt gate show 8b3fcc4a` — verdict `✓ passed`,
      `constraint-agent  2ms  0 violations`,
      `review-agent  1396ms  no concerns`, "No signals
      emitted"
    - `gestalt deploy show 8b3fcc4a` — full 6-event
      timeline (`PR opened → Pipeline triggered → Pipeline
      passed → Staging promoted → Auto-merged b7a61ae9 →
      Production promoted`), `Total deployment time: 28s`
    - `gestalt deploy list --limit 5` — 5 rows with status
      badges + PR numbers + branch names
    - `gestalt maintenance list --limit 5` — 5 rows; `show
      <prefix>` against a project-scoped run shows the
      header + "Findings (0)" panel
    - `gestalt agents active` against a live cycle — shows
      `◎ context-agent  "Add a startsWith utility..."  0s`
      + `step 3 of 4`
    - `gestalt status --id 8b3fcc4a --graph` — identical
      graph to `intent show`; same renderer reached via
      both commands
    - `gestalt status --id <corr8> --watch --graph` against
      a deploying intent — rendered 4 times in 12 seconds
      (3s interval), showing the live transition from
      `pipeline-agent ◎ running` to `pipeline-agent ✓
      completed`
- **Intent clarification flow wired end-to-end.** A vague intent
  (e.g. "make it better") no longer fails silently at the test-agent —
  the intent-agent runs, sees `successCriteria.length === 0` (or a
  high-impact ambiguity), and returns a new typed
  `AgentStatus = 'clarification-needed'` with a `{ reason, suggestions }`
  payload. The orchestrator:
  - creates an `alerts` row (`type: 'clarification-needed'`,
    `severity: high`, `requiredAction: 'provide-clarification'`,
    `context.intentId` + `context.suggestions[]` JSONB-stashed)
  - emits an `alert.created` SSE event so the dashboard updates
    without a refresh
  - transitions the intent to `waiting-for-clarification`
  - flips `plan.state = 'waiting_for_clarification'` so the outer
    while-loop bails before any downstream agent runs
  The maintenance-sourced intent guard (ADR-035 prefix
  `[gestalt-maintenance/<type>]`) short-circuits the clarification
  check — those are typed `MaintenanceIntent` objects and never
  need operator clarification. Dashboard Alerts view renders the
  card with the `?` badge, suggestions list, textarea, and a
  "resume intent" button. Resume flow:
  - `POST /intents/:id/clarify { clarification }` acknowledges every
    unacknowledged `clarification-needed` alert for the
    correlationId, audit-logs the operator's clarification text
    (GP-002), and re-dispatches a `generate:intent` task with
    `clarification` threaded through
  - orchestrator hydrates the missing `projectId` + `text` from
    the persisted intent row, calls `runIntentAgent` with the
    clarification text appended to the prompt under an "Operator
    clarification" heading; downstream agents proceed normally
  - the `intent-agent` clarification gate runs AFTER the LLM call
    (we trust the LLM to drive the decision, not a pre-flight
    regex)
  - Verified live (`61fd59a6`): submitted "make it better" against
    `trackeros`; intent paused in ~2 s, alert visible in dashboard
    with three suggestions, textarea, and resume button; submitted
    "Add a slugify utility under src/shared/utils/slugify with
    slugify(s: string): string"; alert disappeared, cycle resumed,
    all six generate agents ran in ~22 s; intent reached
    `in-review`. Browser screenshots captured of alert card + post-
    submit empty state
  - **Clarification text persists across gate retries
    (migration 006).** `intents.clarification TEXT NULL`;
    `POST /intents/:id/clarify` writes the column via
    `intents.saveClarification(id, text)` BEFORE dispatching the
    resume task. The orchestrator reads `intentRecord.clarification`
    on every dispatch (including the gate-retry leg, whose BullMQ
    payload does not carry the text) and threads it into the
    intent-agent's task. Audit-log records only
    `{ clarificationLength: N, acknowledgedAlertIds, ip }` — the
    text itself never leaves the DB (GP-006). Verified live
    (`63bc2a3b`): intent-agent ran 3 times across the cycle
    (initial pause, post-clarify resume, gate retry); each run
    saw the persisted 156-char clarification; only ONE
    clarification alert was ever created (the original — the
    pre-fix bug would have created a second one on the retry
    leg); intent reached `escalated` for an unrelated review-agent
    GP_BREACH after the second gate review
- **Dashboard Intent Feed now shows ALL intents, including failed
  and waiting-for-clarification.** Pre-existing bug: the feed read
  `projectId` from `localStorage.getItem('gestalt_project')` with
  fallback `'default'` — that string never matched a real
  `project_id` and `listIntents` always returned zero rows (so
  failed intents had no trace in the dashboard). No status filter
  is applied to `listIntents` — the feed shows the full intent
  timeline for the project
- **Active Agents card shows intent + cycle progress + tokens.**
  `GET /status/agents` is enriched per row with `intentText`,
  `cycleProgress: { completed, total }`, and `tokensSoFar` (the
  running total across all agents in the cycle so far). Same
  endpoint, same auth; the dashboard's `ActiveAgents.tsx` now
  renders each card with the agent role + pulsing ◎, an
  elapsed-time stamp in the top-right (`1s` / `1m 23s`), the
  intent text quoted and truncated to 55 chars, a segmented
  progress bar (one block per planned agent), the
  `step N of M` label, and the token count. Auto-refresh every
  5 s plus `agent.started` / `agent.completed` SSE-triggered
  refresh kept from the previous implementation. Server-side
  the enrichment de-dupes per-correlation lookups so a
  multi-agent cycle triggers one `intents.findByCorrelationId`
  and one `executions.findByCorrelationId` instead of N each
- **Deployments view renders a 4-node pipeline timeline.** New
  `GET /deployments?projectId=…&limit=…` returns one row per
  intent that has at least one `deployment_events` row,
  enriched with the full event timeline (ASC by `created_at`),
  `prUrl` / `prNumber` / `branch` (from the `pr-opened` event's
  metadata) / `runId` / `deploymentUrl`. Three intent statuses
  scanned in parallel (`deploying`, `deployed`, `failed`);
  cycles with no events are dropped client-side so a
  gate-failed intent never reaches an empty card. Dashboard's
  `Deployments.tsx` renders three sections (In progress /
  Deployed / Failed) — each card has the status badge, branch
  tag, timestamp, intent text (65-char truncation), the
  4-node timeline (PR → Pipeline → Staging → Production)
  with green ●-filled / muted ○-empty / blue ◎-in-progress /
  red ✗-failed nodes, green connectors between completed
  nodes, status labels (opened/passed/promoted/deployed) and
  HH:MM timestamps under each filled node. Footer has
  `[↗ View PR #N]` and `[↗ View deployment]` links —
  `target="_blank" rel="noopener noreferrer"`. Pipeline-failed
  flips the Pipeline node red; downstream nodes stay muted.
  Pipeline-triggered (no -passed yet) shows the Pipeline node
  pulsing blue
- **Postgres `deployment_events.metadata` JSONB read path
  patched** to defensively `JSON.parse` when postgres.js
  returns the column as a string instead of an object. Same
  pattern as `parseContext` in the alerts repo and
  `parseFindings` in the maintenance-runs repo. Before this
  fix the `branch` extraction in `/deployments` returned null
  for every deployment because `metadata['branch']` against a
  string is `undefined`
- **Agent execution logs populated for every agent run, accordion
  in IntentDetail.** Migration 007 added `agent_execution_logs`
  (1:1 with `agent_executions`, FK cascades on delete). All three
  orchestrators (generate / quality-gate / deploy) persist one log
  row per execution capturing the prompt, the LLM response, the
  result status, the artifact paths the agent produced, the signal
  types it emitted, and the error message on failure. LLM-backed
  agents (intent / design / context / code / test in generate,
  review-agent in gate) fill the prompt + response columns;
  non-LLM agents (lint-config when skipped, constraint-agent in
  gate, pr-agent / pipeline-agent / promotion-agent in deploy)
  leave both null. New `GET /executions/:id/log` returns the
  execution + log + filtered artifacts + filtered signals
  (filtered by `producedBy === agentRole` and
  `sourceAgent === agentRole` respectively). Returns 200 with
  `log: null` for pre-migration-007 executions so the dashboard
  can render a placeholder without confusing "intent missing"
  with "feature didn't exist yet". The dashboard's IntentDetail
  rewrote the agent timeline as a clickable accordion — click a
  row → first-time fetch shows a loading state → subsequent
  clicks use cached state. Expanded panel renders Agent meta
  (role / status / duration / started time), Prompt (with copy
  button + truncate-to-400-chars-with-show-full toggle), LLM
  response (same controls), Artifacts produced, Signals emitted,
  and an error box at the top when present. Verified live
  (`9c28d399` cycle, titleCase utility): full deploy cycle in
  ~17 s, 12 executions / 12 log rows; LLM agents show
  prompt-length 1300–3469 chars and response-length 31–1654
  chars; non-LLM agents show `prompt = NULL`,
  `llmResponse = NULL`, `resultStatus = passed/completed`;
  endpoint returns the full prompt and response bytes;
  dashboard renders the expanded panel with copy + show-full
  buttons and the "Not applicable" placeholders on the
  constraint-agent row
- **`GET /projects` returns ALL registered projects** to any
  authenticated user. The previous owner-only filter
  (`projects.list(request.user.id)` → only rows where
  `created_by = userId`) meant that if operator A registered
  `trackeros` and operator B logged into the dashboard, B would
  see "No projects — run gestalt init" even though
  `gestalt projects list` worked for A. Self-hosted small teams
  expect every operator to see every project; the filter has been
  switched to `projects.listAll()`. If per-project access control
  is required later, add a `project_members` table and intersect
  there — do NOT re-introduce the owner-only filter at this
  endpoint
- **ProjectContext defensively redirects to `/app/login` on 401.**
  RequireAuth at the top of the dashboard route tree only checks
  for the presence of a token, not its validity. A stale or
  expired JWT used to bounce every API call to 401, which
  ProjectContext silently caught and rendered as "No projects —
  run gestalt init". The catch block now distinguishes
  `ApiError.status === 401` (delete the token, hard-navigate to
  `/app/login`) from other failures (network down, 500 — keep
  showing the layout, set `projects: []`)
- **Project selection is global across the entire dashboard.**
  `packages/dashboard/src/context/ProjectContext.tsx` fetches
  `/projects` once on mount, hydrates from
  `localStorage.gestalt_project_id` if present, falls back to
  `projects[0]` if the stored id is missing or no longer
  resolves, and persists every change back to `localStorage`. The
  Layout sidebar renders a `<select>` between the logo and the
  navigation links — switching projects there applies
  immediately to every project-scoped view (IntentFeed / Alerts /
  Deployments / QualityGate / Maintenance). ActiveAgents stays
  global (agent executions span all projects). Window-focus
  refetch keeps the project list current when an operator runs
  `gestalt init` in another terminal (no new SSE event needed).
  The earlier per-view fetches and localStorage reads
  (`gestalt_project` with `'default'` fallback in
  Deployments / QualityGate; the per-view dropdown in IntentFeed)
  are removed. Every project-scoped view guards on
  `!currentProjectId` with an EmptyState pointing at
  `gestalt init`. Alerts are project-scoped client-side by
  joining `alert.context.intentId` against the project's intent
  list (the `/alerts` API has no `projectId` filter — captured as
  a Pending enhancement). Verified live: selector renders with
  the existing project pre-selected, the IntentFeed shows
  "3 total · trackeros" with all three intents (escalated +
  needs-input + failed) including the older `failed` one the
  operator originally reported as invisible; all five
  project-scoped views render with the selector value in the
  sidebar across navigations; reload retains the choice; clearing
  localStorage falls back to `projects[0]`; a bogus stored id
  also falls back cleanly
- **Maintenance layer wired end-to-end (ADR-018, ADR-019, ADR-020,
  ADR-035).** Four scheduled agents run in-process via `node-cron`,
  registered as `startMaintenanceScheduler(config)` at server.ts step 9:
  - **drift-agent** (daily 02:00 UTC) — clones the project, finds
    `src/modules/*/...` files changed in the last 30 days, compares
    against the most recent commit timestamp on the global context
    files; for modules drifted by > 7 days appends a timestamped HTML
    comment to `docs/DOMAIN.md` (ADR-018 additive-only exception, direct
    commit + push) and queues a `CONTEXT_UPDATE` MaintenanceIntent that
    the runner routes through the **context-fixer direct-fix path** —
    one LLM-driven minimal additive edit per intent, committed directly
    to `defaultBranch`. See the "Maintenance intent routing" bullet below
  - **alignment-agent** (daily 03:00 UTC) — reads context files,
    cross-checks DOMAIN.md entities ↔ ARCHITECTURE.md modules, and
    GP-NNN cross-references in AGENTS.md; queues `CONTEXT_ALIGNMENT`
    intents per misalignment. Same routing — the runner sends them
    through the context-fixer rather than the generate loop because
    the test-agent can't generate tests for a markdown edit.
    `extractEntities()` matches **h3** entity headings (`### Name`) and
    bullet-style entity definitions (`- **Name** — …`, with a dash
    separator), filtered through a stop list of common field labels
    (`Type`, `Description`, `Status`, `Notes`, `Props`, …). The h2
    pattern + bold-bullet-without-separator pattern were the source
    of the previous false-positive findings on `Components` /
    `Type` / `Description` / `Props` (where `## Components` is a
    grouping heading and `- **Type**: value` is a field label on
    `WelcomeScreen`). For each finding type, `affectedFiles[0]` is
    the file the context-fixer should **write** to:
    `domain-entity-without-module` → `docs/ARCHITECTURE.md` (add a
    `src/modules/<EntityName>/` entry);
    `architecture-module-without-entity` → `docs/DOMAIN.md` (add an
    entity definition); `golden-principle-not-cross-referenced` →
    `AGENTS.md` (add the principle reference). The companion file
    sits in `affectedFiles[1]` as read-only context the LLM sees in
    the suggestedAction text. `extractModules()` runs **two
    patterns** against ARCHITECTURE.md:
    1. **Pattern 1 — literal path.** A contiguous
       `src/modules/<name>` substring anywhere in the file. This
       is the format the `suggestedAction` text now instructs the
       LLM to write (`Add the line "  src/modules/X/    — X
       module" … Use the literal path format, not a tree diagram
       child entry`)
    2. **Pattern 2 — markdown directory tree.** Lines like
       `├── modules/` introduce a 10-line lookahead that captures
       indented children (`│   ├── X/`). A structural depth check
       (count of `│` chars in the leading tree prefix) ensures
       only DEEPER-indented entries count as children — sibling
       top-level entries like `├── shared/` correctly break the
       scan instead of being misread as `modules/` children.
       Without that check, the runner produced 5 spurious
       `architecture-module-without-entity` findings for
       `shared/db/auth/utils/api` and the LLM happily added
       garbage entities to DOMAIN.md
    The two patterns together let the harness template's existing
    tree-format ARCHITECTURE.md be recognised AS-IS while still
    rewarding the more explicit literal-path format the
    `suggestedAction` requests. Comment-stripping (`# …`) is
    applied to both the container-line detection and the child
    regex match so `├── modules/   # business domain modules`
    matches the same as the bare `├── modules/`. Convergence
    verified live: from a clean DOMAIN.md the alignment loop
    reaches `findings: 0, directFixes: 0, durationMs: ~1.6 s`
    after the LLM's literal-path fixes land
  - **CLI access via `gestalt maintenance`.** Operators can
    trigger and reset from the terminal:
    - `gestalt maintenance trigger <agentRole> <projectName>` —
      thin wrapper around `POST /maintenance/trigger`. Same
      runner code path as the cron schedule + the dashboard
      "Run now" button; prints `runId` + `intentsQueued` +
      `directFixes` + `durationMs` from the returned record
    - `gestalt maintenance reset-findings <projectName>` —
      `DELETE /maintenance/findings/:projectId`
      (`requireRole('operator')`). Clears every
      `maintenance_finding_attempts` row for the project
      regardless of `escalated` flag — the "I cleaned up the
      files manually, give me a fresh budget" button. Returns
      `{ deleted: N }`. **Audit row is `action:
      'maintenance.findings-reset'` with metadata `projectName`
      + `deletedCount` + `ip` ONLY — finding hashes are derived
      from finding content (which may include file paths) and
      so are excluded per GP-006**. Both subcommands accept the
      standard `--server <url>` one-shot override
  - **gc-agent** (weekly Fri 04:00 UTC) — deletes remote `gestalt/*`
    branches older than 30 days, `.gestalt/*` spec files older than 90
    days (committed deletion), and `deployment_events` rows older than
    90 days. Never queues intents
  - **evaluation-agent** (every 15 min) — resolves the project's
    `MonitoringAdapter` from HARNESS.json; queries error rate / p99
    latency / alert count; queues `PERFORMANCE_DEGRADATION` or
    `SECURITY_FINDING` intents on threshold breach. Dedupe guard skips
    any candidate whose `[gestalt-maintenance/<type>]` prefix already
    appears on an open intent (status `pending` / `generating`)
  - All four agents share a runner (`runMaintenanceAgent`) that creates
    a `maintenance_runs` row, routes each queued `MaintenanceIntent`
    based on its class (see "Maintenance intent routing" below),
    updates the row on completion, and emits a
    `maintenance.run-completed` SSE event
  - **Maintenance intent routing (ADR-018).** Every
    `MaintenanceIntent` is classified by
    `classifyMaintenanceIntent(type)`:
    - `'context-file-update'` (`CONTEXT_ALIGNMENT` / `CONTEXT_UPDATE`)
      → the runner calls `applyContextFileFix(intent, project)` in-
      process; the **context-fixer** clones the repo to a temp dir,
      calls the LLM with a "minimal additive edit" prompt + the
      current file content + the finding evidence + the suggested
      action, validates the result against a **truncation guard**
      (output must be ≥ 50% of original length — short output is
      refused as suspected LLM truncation), writes the file, commits
      as `docs: <suggestedAction (prefix stripped, 72-char cap)>
      [gestalt-maintenance/<TYPE>]` authored by
      `Gestalt Maintenance Agent <maintenance-agent@gestalt.local>`,
      and pushes to `defaultBranch`. Each successful commit
      increments `directFixes` on the run record and appends a
      `direct-fix-applied` finding (commit-sha lifted out for the
      operator). Path guard hard-throws BEFORE any clone or LLM call
      if `intent.affectedFiles[0]` is not in `docs/*` or exactly
      `AGENTS.md` — ADR-018 forbids the direct-fix path from
      touching `src/`. Temp dir cleaned in `finally`
    - `'code-change'` (`PERFORMANCE_DEGRADATION` / `SECURITY_FINDING`)
      → unchanged: the runner writes an `intents` row
      (`source: 'maintenance-agent'`) and dispatches a
      `generate:intent` BullMQ task. The generate orchestrator
      handles these like any human-submitted intent with the full
      generate → gate → deploy loop
    - Live verified on `trackeros`: a manual alignment-agent trigger
      produced 6 findings; the runner classified all 6 as
      `context-file-update` and applied 6 direct fixes (4 to
      `docs/DOMAIN.md`, 2 to `AGENTS.md`) in ~32 s wall-clock.
      `intentsQueued: 0`, `directFixes: 6` on the run record;
      6 new commits on `main` authored by `Gestalt Maintenance Agent`;
      every commit subject starts with `docs:` and ends with
      `[gestalt-maintenance/CONTEXT_ALIGNMENT]`. A second run
      applied 4 more fixes for the entity findings (the GP-NNN
      findings were resolved by the first run's AGENTS.md edits
      and so were absent the second time)
  - **Per-finding idempotency guard (migration 008).** The runner
    hashes each candidate fix (`SHA-256` of
    `intent.type:affectedFiles[0]:evidence.slice(0,80)`) and tracks
    consecutive failed attempts in `maintenance_finding_attempts`.
    Each non-committed outcome (no-change, truncation-guard,
    llm-error, file-missing, thrown) increments the per-finding
    counter via an `INSERT ... ON CONFLICT ... DO UPDATE` upsert. A
    real commit calls `resetAttempts(hash)` (delete the row) so the
    next occurrence starts fresh. Once the counter hits
    `MAX_ATTEMPTS = 3` on the same run that just incremented it,
    the runner creates a `maintenance-stuck` alert
    (`severity: medium`, `requiredAction: review-manually`, JSONB
    `context` carrying `intentType` / `affectedFiles` / `evidence` /
    `suggestedAction` / `attemptCount` / `findingHash`) and flips
    `escalated = TRUE`. Future runs of the same finding see the
    flag and skip silently (~838 ms total run, no clone, no LLM
    call). New `AlertType: 'maintenance-stuck'` +
    `AlertRequiredAction: 'review-manually'` added to the core
    repository typed unions. The context-fixer's system prompt was
    tightened to forbid `> Note:` blockquote-appending and to
    return the file unchanged when no real structural edit is
    possible — this was the LLM's escape hatch on unresolvable
    findings and caused DOMAIN.md to grow linearly with garbage
    blockquotes. Live verified on `trackeros`: a finding the LLM
    can't satisfy produces 3 attempts → escalation on the 3rd run
    (alert created, no commit) → silent skip on the 4th and
    subsequent runs
  - Manual operator trigger via `POST /maintenance/trigger { agentRole,
    projectId }` (requireRole operator); same runner code path as the
    cron schedules
  - `GET /maintenance/runs?projectId&agentRole&limit` returns
    `{ data: MaintenanceRunRecord[] }` (the standard server envelope).
    The dashboard's `Maintenance.tsx` view consumes it and renders the
    "Recent runs" list — clicking the `run now` button against any of
    the four agents triggers the run via `POST /maintenance/trigger`,
    the runner persists the row synchronously (in-process — no BullMQ
    hop), and the view re-fetches after 1 s plus on the
    `maintenance.run-completed` SSE event. Trigger errors render as a
    red `✗ Failed to trigger: <message>` strip under the agent card
    and auto-clear after 5 s
  - **Each Recent runs row is a clickable accordion** that expands an
    inline detail panel — same idiom as the IntentDetail agent-
    execution accordion. The header row surfaces stats at a glance:
    `N findings` (amber when > 0, dim when 0), `N intents queued`
    (amber, omitted when 0), `N fixes applied` (green, omitted when
    0), duration in dim text (`ms` under 1 s, otherwise `1.2s`), and
    the timestamp. Expanded panel shows a Run summary section
    (agent / status / duration / direct fixes / intents queued /
    started + completed timestamps) plus either a Findings (N)
    section with per-finding cards (severity badge — red high /
    amber medium / dim low; type chip; up-to-3 affected files +
    "and N more"; description; `→ suggestedAction` in muted italic)
    or a "No findings — Agent ran cleanly — nothing to report"
    panel. All data already in the existing `MaintenanceRunRecord`
    — no separate fetch, no new endpoint. Multiple rows can be
    expanded at once. Verified live against `trackeros`:
    alignment-agent run with 6 findings (4 medium + 2 low) shows
    all 6 cards with the right severity colours, type chips, and
    file lists; drift-agent run with 0 findings shows the clean
    panel
  - Live verification against `trackeros`: all 4 agents triggered;
    alignment-agent produced 5 findings → 5 maintenance intents
    queued (all carrying `[gestalt-maintenance/CONTEXT_ALIGNMENT]`
    prefix; generate orchestrator picked them up immediately); other
    agents returned 0 findings as expected on this small repo
- **Deploy layer v1 wired end-to-end (ADR-033, ADR-034).** A `pass`
  verdict on the quality gate now dispatches `deploy:pr` to the new
  deploy-orchestrator (`startDeployWorker` registered at server.ts
  step 8). The generate orchestrator no longer mutates the project's
  Git tree — pr-agent owns the only commit + push, to a PR branch,
  never to `defaultBranch`. The deploy worker drains
  `bull:gestalt-deploy:*` and chains three agents:
  - **pr-agent** — clones the project, cuts
    `gestalt/<corr8>-<slug>` (intent's first 5 words, kebab-cased,
    capped at 40 chars), writes artifacts, commits + pushes, opens a
    PR via the resolved `PipelineAdapter`. Transitions intent
    `approved → deploying`. Writes a `pr-opened` row to
    `deployment_events`, emits `deployment.updated` with `prUrl` +
    `prNumber`
  - **pipeline-agent** — triggers the adapter's pipeline, polls
    `getPipelineStatus` every 15s (up to 10 min). On `passed` writes
    `pipeline-passed`. On `failed`/`cancelled` emits `TEST_FAILURE`;
    on timeout emits `CONTEXT_GAP`
  - **promotion-agent** — promotes staging then production. **ADR-034
    is enforced here**: production refused unless a
    `promoted-staging` row exists for the same correlationId (emits
    `GOLDEN_PRINCIPLE_BREACH`, deploy-orchestrator transitions to
    `escalated`). On success writes `promoted-staging` /
    `promoted-production` rows
  - Final transition: intent → `deployed` after production promote.
    All temp clones cleaned in `finally`
  - PipelineAdapter (ADR-033) abstraction: `createPullRequest`,
    `triggerPipeline`, `getPipelineStatus`, `promoteToEnvironment`.
    `GitHubActionsAdapter` (REST API + PAT from `project_git_credentials`)
    and `NoOpPipelineAdapter` (immediate plausible fakes with a 500ms
    pipeline-status delay so dashboards see the `running → passed`
    transition) included. Resolved per-task from `HARNESS.json`
    `pipeline.adapter`; absent or unrecognised → NoOp
  - First live cycle (`8f53b75d`, string-case utility module): 30s
    total — generate 17s → gate 2s → deploy 6s (PR open 2.5s,
    pipeline 1.9s, staging promote 1.0s, production promote 0.9s);
    intent → `deployed`. Branch `origin/gestalt/8f53b75d-add-a-string-case-utility-module`
    pushed to GitHub; deployment_events has all 5 expected rows
  - **First REAL GitHub Actions cycle (`67e5ee02`, kebab-case utility,
    2026-05-30 session).** Adapter switched from `noop` to
    `github-actions` via the new `gestalt projects set-adapter` CLI.
    49 s wall-clock total — generate 12 s → gate 1 s → deploy 30 s
    (pr-agent 4.6 s, pipeline-agent 21.0 s including the real GitHub
    Actions run, staging promote 1.8 s, production promote 1.8 s).
    PR #1 opened on `afarahat-lab/trackeros`, GitHub Actions run
    `26689527360` completed with `conclusion: success`,
    `event: workflow_dispatch`. All 5 `deployment_events` rows carry
    the real numeric `run_id` and a real `pr_url`; the dashboard /
    `gestalt status --id` are no longer faking. PAT-scope GP_BREACH
    path was NOT exercised (the PAT used had `workflow` scope);
    detection logic is unit-shaped and tested at the adapter level
    only. ADR-034 production-without-staging path also stays
    NoOp-validated since the cycle ran clean
- **Auto-merge support (migration 013).** After staging promotion
  succeeds, if `HARNESS.json` `pipeline.autoMerge === true`, the
  promotion-agent calls `adapter.mergePullRequest()` BEFORE the
  production promotion is dispatched. Default is `false` — existing
  projects unaffected without opt-in.
  - **Interface**: `PipelineAdapter.mergePullRequest({ projectId,
    prNumber, mergeMethod?, commitTitle?, commitMessage? }) →
    { merged, sha }`. `mergeMethod` defaults to `'squash'`
  - **GitHubActionsAdapter**: `PUT /repos/{owner}/{repo}/pulls/
    {pull_number}/merge`. Maps 405 → "PR is not mergeable — check
    CI status and conflicts", 409 → "PR head was modified — cannot
    merge safely". Reuses existing `throwIfAuthError` for missing
    PAT scopes
  - **NoOpPipelineAdapter**: returns
    `{ merged: true, sha: 'noop-merge-sha' }`
  - **`HarnessPipelineConfig`** typed interface in
    `@gestalt/core/types` (`adapter`, optional `autoMerge`,
    optional `mergeMethod: 'merge'|'squash'|'rebase'`).
    `HarnessConfig.pipeline` retyped from `Record<string, unknown>`
    so callers can read fields without casting
  - **Payload chain**: `prNumber` + `intentText` thread through
    `DeployPRPayload` → `DeployPipelinePayload` → `DeployPromotionPayload`
    (the last two gained optional fields). Promotion-agent input
    accepts both; missing `prNumber` is treated the same as
    `autoMerge: false` (legacy in-flight queue jobs)
  - **`auto-merged` deployment_events row** (migration 013 —
    `ALTER TYPE deployment_event_type ADD VALUE IF NOT EXISTS
    'auto-merged'`). Written by promotion-agent on successful
    merge with `metadata: { sha, mergeMethod, adapter }` and
    `prNumber` populated. Failure does NOT write a row — only
    the SSE `deployment.updated { status: 'auto-merge-failed' }`
    surfaces it
  - **Non-fatal failure**: a 405 / 409 / other adapter error is
    caught locally; the agent logs a warning, emits the
    `auto-merge-failed` SSE event, and continues. Production
    promotion fires; the intent still reaches `deployed`. The
    PR stays open for manual merge — a transient GitHub API
    blip cannot block a successful deployment
  - **`maybeAutoMerge` runs in the staging branch only.**
    `targetEnvironment === 'production'` never auto-merges
    (production has no PR to merge — the artifact is already on
    `main` via the staging merge). The agent reads HARNESS.json
    from the same clone the promotion used (`createHarnessEngine
    (workDir).loadHarnessConfig()`). Parse failure → log warn +
    treat as `autoMerge: false`
  - **Commit subject** is `<first line of intentText, ≤72 chars>
    [gestalt <corr8>]` — matches the format the gate's
    `dispatchDeployPR` uses for the original PR title, so the
    squash-merge commit reads as a continuation. Falls back to
    `Auto-merge [gestalt <corr8>]` when intentText is missing
  - **CLI** — `gestalt projects set-adapter <name> <adapter>
    [--auto-merge | --no-auto-merge] [--merge-method
    squash|merge|rebase]`. Both `autoMerge` and `mergeMethod`
    validated client-side (3-value whitelist for mergeMethod);
    server re-validates. Multi-field patches commit one row to
    HARNESS.json with subject `chore: update pipeline <changed
    fields> [gestalt]`. Audit metadata carries `changedFields[]`
    plus `previousValues` / `newValues` objects
  - **Dashboard 5-node timeline**: Deployments view appends a
    `Merged ✓` 5th node when an `auto-merged` event exists for
    the cycle (event-presence-driven, NOT config-driven —
    manual-merge projects never produce the row so stay at 4
    nodes). Footer gains a "↗ View commit <sha7>" external link
    when the merge SHA is known + the PR URL is on github.com
  - **Template `corporate-ops-web-mobile/HARNESS.json` ships
    with `autoMerge: false, mergeMethod: 'squash'`** as defaults.
    `docs/reference/harness-config.md` documents the field
    semantics, non-fatal failure rule, commit-subject format,
    and CLI setting path
  - Live verified end-to-end against `trackeros` real GitHub:
    - **Stage 1 (autoMerge=false)** intent `53dfc2d4`: 5
      deployment_events rows (no `auto-merged`); PR stays open;
      intent `deployed`
    - **Stage 2 (autoMerge=true)** intent `8b3fcc4a`: 6
      deployment_events rows including `auto-merged` between
      `promoted-staging` and `promoted-production`;
      `metadata.sha = b7a61ae9` matches the real merge commit
      on `trackeros/main`; HEAD of `main` advanced to the
      squash-merge with the brief-specified subject. End-to-end
      ~28 s wall-clock
- **Gate ↔ generate feedback loop wired.** A `fail` verdict (auto-resolvable
  signals, no GP_BREACH) dispatches a `generate:intent` task back to the
  generate queue with `retryCount + 1` and the signals routed to the
  responsible specialist agent (LINT_FAILURE / TEST_FAILURE / CONSTRAINT_VIOLATION
  → code-agent; CONTEXT_GAP → context-agent). The intent transitions
  `in-review → generating` for the retry. `code-prompt` includes a
  "Quality-gate feedback from the previous attempt" section listing every
  prior signal with file:line + rule. After `MAX_GATE_RETRIES = 3` cycles
  the gate gives up and marks the intent `failed`. The retry leg's commit
  uses `fix:` prefix and a `retry N/3` suffix so `git log` narrates the
  cycle history. Verified live (`2a57b087`): 4 cycles fired, all
  committed to Git, intent ended at `failed` after retry budget
  exhausted
- **Quality gate v1 wired end-to-end.** After the generate orchestrator
  pushes artifacts, the gate worker (registered as `startGateWorker(config.queue)`
  in `server.ts` step 7) clones the project repo fresh and runs:
  - `constraint-agent` — deterministic regex checks (no-any, no-console,
    no-direct-db-outside-shared-db, no-hardcoded-secret, no-direct-llm-sdk).
    Hardcoded-secret and direct-LLM-SDK emit GOLDEN_PRINCIPLE_BREACH.
  - `llm-review-agent` — single LLM call summarising the artifact set;
    critical / golden-principle items become GOLDEN_PRINCIPLE_BREACH
    signals, high/medium become CONSTRAINT_VIOLATION, low/info land in
    the prose review artifact only. Full review saved as
    `.gestalt/llm-review-<corr8>.md` in the `artifacts` table
  - `synthesiseGateResult` produces a verdict: any GOLDEN_PRINCIPLE_BREACH
    → `escalate`; any CONSTRAINT_VIOLATION / TEST_FAILURE / LINT_FAILURE
    → `fail`; otherwise `pass`
  - Intent transitions: `in-review` → `approved` / `failed` / `escalated`
  - Gate emits `agent.started` / `agent.completed` / `signal.emitted`
    per agent + a top-level `gate.completed` event with verdict + summary
  - First live cycle (`b1f6eecd…`): constraint-agent caught a direct-DB
    import outside `shared/db/`; review-agent caught a missing GP-003
    input validation (escalating) + a potential data-exposure concern in
    the audit-log. Intent landed at `escalated` as designed
- **First full intent → code → push cycle verified end-to-end.** A real
  intent ("Add a hello world endpoint at GET /hello") ran six agents
  (intent / design completed, context + lint-config skipped, code +
  test completed) in ~11 seconds against `gpt-4o`, produced 7 artifacts,
  and the orchestrator committed + pushed `8938d51` to the project's
  GitHub repo (commit subject `feat: Add a hello world endpoint at GET
  /hello returning JSON {message:"hello" [gestalt 75000cb2]`). Files
  landed at the expected paths (`src/modules/hello/...`,
  `src/api/index.ts`, `src/shared/auth/rbac-middleware.ts`,
  `__tests__/hello-routes.test.ts`, `.gestalt/{intent,design}-spec.json`).
  `git pull` on the developer's local clone yields them
- Generate-layer cycles are fully observable and write to Git:
  - one `agent_executions` row per step (`running` → `completed` /
    `failed` / `skipped`) with `tokensUsed` + `durationMs`
  - every `result.signals` saved to `signals`; every `result.artifacts`
    saved to `artifacts`
  - SSE events emitted on the in-process bus at every transition —
    `intent.status-changed`, `agent.started`, `agent.completed`,
    `signal.emitted` — verified by tapping `GET /events?token=…` during a
    real submission
  - on a successful cycle the orchestrator writes artifacts into the
    cloned tree, commits `feat: <intent> [gestalt <corr8>]`, and pushes
    to `defaultBranch`; developers `git pull` to receive
  - the event bus lives in `@gestalt/core/events` so both the server SSE
    route and the orchestrator publish on the same singleton without an
    agents → server dep cycle
- `gestalt init local-admin` (old broken syntax) now fails fast with a
  clear error (`allowExcessArguments(false)` on init command)
- `GET /status`, `GET /status/agents`, `GET /intents`, `GET /intents/:id`
  all return 200

**Implemented with caveats (worth knowing):**
- `@gestalt/agents-quality-gate` — constraint-agent + llm-review-agent +
  gate orchestrator implemented and exercised live. lint-agent /
  security-agent / test-runner-agent remain stubs (need a
  pnpm-install-in-clone pipeline to run real tooling); the package
  works end-to-end without them via the two implemented agents
- `@gestalt/agents-deploy` — pr-agent + pipeline-agent + promotion-agent
  + deploy orchestrator implemented. Two `PipelineAdapter` impls live
  (`GitHubActions`, `NoOp`); Azure DevOps / GitLab CI / Jenkins
  adapters intentionally not implemented (one concrete adapter was the
  ADR-033 scope)
- `@gestalt/agents-maintenance` — all four agents (drift, alignment,
  gc, evaluation) + node-cron scheduler + three `MonitoringAdapter`
  impls (`Prometheus`, `Datadog`, `NoOp`) implemented and exercised
  live via `POST /maintenance/trigger`. Prometheus / Datadog
  implementations not yet verified against a real monitoring instance

**What is not yet built:**
- `@gestalt/adapter-oracle` — stub (every repository method throws;
  exists only to surface interface drift at build time)
- `@gestalt/adapter-mssql` — same shape as oracle
- `@gestalt/registry` — types and client only (no server, no UI)

**Postgres adapter repository coverage (all real, no remaining stubs):**
- `intents`     — full CRUD + list with paging + `saveClarification`
  (writes operator clarification text to the nullable column added
  in migration 006; orchestrator reads it on every dispatch so it
  survives gate-retry legs). Plus the project-management trio added
  in the 2026-06-03 session: `countByProject(id)` (total intents
  for the project — drives the platform-admin enrichment),
  `countActiveByProject(id)` (non-terminal statuses only — drives
  the DELETE /projects/:id `PROJECT_HAS_ACTIVE_INTENTS` guard),
  `findLatestByProject(id)` (most recent intent, ORDER BY
  created_at DESC LIMIT 1 — drives `lastActivityAt`)
- `executions`  — create, updateStatus, findByCorrelationId, findActive
- `artifacts`   — save, findByCorrelationId (typed filter), findById
- `signals`     — save, findByCorrelationId, findUnresolved, markResolved
  (with GOLDEN_PRINCIPLE_BREACH human-only guard)
- `audit`       — append-only, query with filters
- `users`       — upsert, findById, findByIdpSubject, findByEmail,
  list (with search + includeDeactivated filters), count, updateRole,
  updateDisplayName, deactivate. `role` column constrained to
  (`platform-admin` | `user`); `deactivated_at` column nullable, set
  by the soft-delete path; auth middleware rejects any request whose
  user has a non-null value
- `memberships` — addMember (UPSERT on `(user_id, project_id)` — second
  call updates the role and `assigned_by`), updateRole, removeMember,
  findByProject, findByUser, findMembership, countAdmins (used by the
  last-project-admin guard in the route). Migration 010 backfills a
  `project-admin` row for every existing project keyed on
  `projects.created_by` so previously-registered projects survive the
  membership-aware GET /projects filter. Plus `countByProject(id)`
  (drives platform-admin enrichment) and `deleteAllForProject(id)`
  (drives DELETE /projects/:id cleanup; explicit even though the FK
  has ON DELETE CASCADE — predictable + we can audit the row count)
- `localAuth`   — create, findByEmail
- `projects`    — create, findById, findByName, list, saveCredential,
  getCredential (token stored plain — TODO: encrypt at rest). Plus
  `delete(id)` (hard-delete the row, returns affected count) and
  `deleteAllCredentials(id)` (the PATs table can have multiple rows
  per project after rotation — delete them all by project). Both
  use the `WITH deleted AS (... RETURNING 1) SELECT COUNT(*)`
  pattern to surface affected-row counts; postgres.js doesn't
  return them on a naked DELETE
- `deploymentEvents` — append, findByCorrelationId, findStagingPromotion,
  gcOlderThan. UPDATE is still revoked; DELETE was REVOKED in migration
  004 then GRANTed back in migration 005 once it was clarified that
  deployment_events are operational logs (not audit records) and
  gc-agent needs to prune them. ADR-034 enforcement runs through
  `findStagingPromotion`. `metadata` JSONB read path uses the shared
  `parseJsonb<Record<string, unknown>>(row.metadata, {})` in
  `../utils` so the `pr-opened` event's `branch` key (used by the
  Deployments view's branch chip) round-trips regardless of whether
  postgres.js returns the column as an object or a string. The
  `eventType` enum gained `'auto-merged'` via migration 013 — written
  by promotion-agent on successful auto-merge (after
  `promoted-staging`, before `promoted-production`), carries
  `metadata.sha` + `metadata.mergeMethod`
- `maintenanceRuns` — create (status=running), complete (final counts +
  findings JSONB + duration), list (filter by projectId / agentRole),
  findById. Findings are JSONB-array-typed; the PG impl uses
  postgres.js's typed `db.json(...)` helper on insert/update (the
  `${JSON.stringify(arr)}::jsonb` pattern looked correct but
  actually stored the array as a JSONB string scalar — see the
  ADR-038 tool-calls bullet above for the full rationale). The
  shared `parseJsonb<MaintenanceFinding[]>(row.findings, [])` in
  `../utils` still normalises the read path for back-compat with
  legacy rows written before the typed-helper switch. Plus
  `deleteAllForProject(id)` (drives DELETE /projects/:id cleanup —
  the FK on `project_id` has NO ON DELETE rule, so without the
  explicit delete a project with maintenance run history would
  block the cascade)
- `findingAttempts` — upsertAttempt (INSERT ... ON CONFLICT ... DO
  UPDATE so concurrent runs increment atomically without a read-
  modify-write race), getAttempts (filter by projectId + IN-list of
  hashes — empty input short-circuits to `[]`), markEscalated
  (UPDATE escalated=TRUE), resetAttempts (DELETE so a fresh
  occurrence starts at attempt 1). Migration 008.
  `UNIQUE(project_id, finding_hash)` gives the upsert path a
  deterministic conflict target. ON DELETE CASCADE on
  `projects(id)` keeps the table clean when a project is removed
- `alerts` — create, findById, findUnacknowledged, findByCorrelationId,
  acknowledge. `intent_id` lives in `context` JSONB (schema 001
  predates the FK); the shared
  `parseJsonb<Record<string, unknown>>(row.context, {})` in
  `../utils` normalises postgres.js's parsed-object vs
  raw-JSON-string return shapes. `intentId` lifted out of context
  into the read-side record for ergonomics
- `executionLogs` — save (1:1 per agent_executions row), findByExecutionId,
  findByCorrelationId. Migration 007. Foreign key cascades on delete
  matches the BullMQ removeOnComplete contract. The
  AgentExecutionRepository also gained `findById(id)` so the
  `/executions/:id/log` endpoint can fetch the join row
- `interventions` — create, findByIntentId, findByCorrelationId.
  Migration 011 (ADR-021). One row per `POST /interventions`
  call; `(intent_id, alert_id)` FK both to live tables (alert_id
  nullable). `action` constrained to the four ADR-021 values via
  CHECK; `notes` nullable and stores the operator's
  acknowledge-breach text (audit_log carries only the length,
  per GP-006)
- `platformLlms` — list, findById, findByName, findDefault,
  findByModelString, create, update, delete, setDefault, count.
  Migration 014. Partial unique index `WHERE is_default = TRUE`
  enforces "at most one default" at the DB layer; `setDefault`
  runs inside `db.begin` to clear the existing default and set
  the new one atomically. `delete` refuses on the only row
  (`LastLLMError`) and on the default (`CannotDeleteDefaultLLMError`).
  Migration 016 dropped the `api_key_env` NOT NULL constraint
  so vault-only rows carry `apiKeyEnv = null, secretId = <uuid>`
- `platformSecrets` — create, update, findById, findByName,
  list, delete, findReferencingLlms. Migration 015.
  **`list()` uses a narrow projection that OMITS `encrypted` /
  `iv` / `auth_tag`** — defense-in-depth so a server-side log
  of the full record never carries ciphertext. `delete()` runs
  inside `db.begin`: scans `platform_llms WHERE secret_id =
  $1`, throws `SecretInUseError(id, llmNames)` if any match
  (the route catches it and returns 400 `SECRET_IN_USE` with
  the LLM names in the body). The IV is regenerated on every
  PATCH that touches `value` so rotation produces fresh
  ciphertext — never reused

**CLI install:**
- `@gestalt/cli` is private — not on npm
- Install: `pnpm --filter @gestalt/cli build && cd packages/cli && npm link`

**First-boot sequence:**
1. `docker-compose up -d` — start platform
2. `gestalt init-admin` — create admin user (TTY only, once per server)
3. `gestalt login` — authenticate CLI
4. `mkdir my-project && cd my-project`
5. `git init && git remote add origin <url>`
6. `gestalt init` — register project + server pushes harness to Git
7. `git pull` — receive harness files locally
8. `gestalt run "<intent>"` — submit work to agents

**Harness templates live in `templates/`, not inline in routes (ADR-036).**
- All 8 harness files (`AGENTS.md`, `HARNESS.json`, `agents.yaml`,
  the 4 `docs/*.md`, `.github/workflows/gestalt.yml`) ship as
  files under `templates/corporate-ops-web-mobile/{harness,docs,ci}/`
  with `{{variable}}` placeholders
- `packages/server/src/templates/engine.ts` provides
  `loadTemplate(templatesDir, templateId, vars)`, a one-regex
  substitution engine (`/\{\{(\w+)\}\}/g`) with no conditionals or
  loops. Unknown variables are left in place (the literal
  `{{foo}}` survives into the committed file) so missing values
  are debuggable rather than silently empty
- Auto-supplied variables: `today` (ISO date at load time) and
  `projectSlug` (kebab-cased `projectName`). Caller supplies
  `projectName`, `projectDescription`, and optionally
  `defaultBranch`
- Repo-path mapping is contract: `harness/X` → `X` at the repo
  root; `docs/*` keeps its prefix; `ci/gestalt.yml` →
  `.github/workflows/gestalt.yml`; any future top-level template
  files pass through unchanged
- The seeded `gestalt.yml` workflow guards both its `pnpm install
  --frozen-lockfile` and `pnpm test` steps with
  `if [ -f package.json ]` — the freshly-initialised repo has no
  `package.json` until the first `gestalt run` scaffolds one, so the
  first cycle's CI step prints a "skipping install — run gestalt run
  to scaffold" notice instead of failing on missing pnpm metadata.
  Subsequent cycles (after a `package.json` lands) install + test
  normally. Aligned with the Quick Start's recommended first-intent
  prompt ("Scaffold the project foundation: create package.json …")
- Skip list: `constraints/`, `principles/`, `template.json`, and
  top-level `README.md` are platform-internal — the engine walks
  them but does not emit them to the project repo
- `resolveTemplatesDir()` is sync, walks 4 candidate paths
  (Docker `/app/templates`, `pnpm dev` from `packages/server`,
  `node dist/...` from compiled paths), caches the result at
  module load. Throws at module-load time if no candidate
  resolves, so the server fails fast rather than 500ing on the
  first registration
- `init-harness` route became a thin orchestrator: clone repo,
  call `loadTemplate(...)`, write each file via `mkdir` +
  `writeFile`, commit + push. The 8 inline `build*()` functions
  + the `HarnessInputs` interface are deleted —
  `packages/server/src/routes/projects.ts` shrank from 815 to
  422 lines (48% reduction)
- The seeded `HARNESS.json` carries
  `"templateId": "corporate-ops-web-mobile"` so future tooling
  (registry, drift-agent template-aware checks) can identify
  which template seeded the project
- **Dockerfile + `.dockerignore` updated.** The Dockerfile copies
  `templates/` into the builder stage AND the production stage;
  `.dockerignore` no longer excludes the directory. The
  template engine reads from `/app/templates/<id>/` at runtime
- Verified live: docker rebuild → `/app/templates/corporate-ops-web-mobile/`
  visible inside the container with all 8 expected files;
  server startup log emits `"Templates directory resolved"
  templatesDir: "/app/templates"`. Direct engine invocation
  produces 8 substituted files for `projectName: "Test Project"`
  / `projectDescription: "A test project description"` —
  `AGENTS.md` starts with `# AGENTS.md — Test Project`,
  `HARNESS.json` has `"name": "test-project"` (slug-derived) +
  `"description": "A test project description"`,
  `DECISIONS.md` includes `Date: 2026-06-01`. Local-dev
  resolution from `packages/server` cwd also resolves correctly
  (walks up to repo root)

**BaseLLMAgent — every LLM-calling agent extends one abstract class.**
- New `BaseLLMAgent` in
  `packages/agents/generate/src/agents/base-llm-agent.ts`. Owns the
  shared LLM-call pattern: routing via `getLLMClient(model)` (Step 1
  multi-client registry), per-call instance capture of `lastPrompt`
  / `lastLlmResponse` / `lastModelUsed` (the orchestrator reads
  these after `run()` for execution-log persistence)
- Two protected helpers:
  - `callLLM(prompt, agentConfig, correlationId)` — single user
    message
  - `callLLMWithMessages(messages, agentConfig, correlationId,
    promptForLog)` — system + user (or richer) message arrays;
    `promptForLog` is what gets stored in `lastPrompt` so the
    dashboard's prompt panel shows the same text the operator
    wrote in their agent config
- `makeContextGapSignal(correlationId, message)` builds the canonical
  `CONTEXT_GAP` (severity `high`, `autoResolvable: false`,
  `sourceAgent` from the instance's role) every subclass uses on
  retry-exhausted failure
- Template `run(task)`: `buildPrompt` → wrap with `applyAgentConfig`
  → `callLLM` → `parseResponse`. Agents with internal retries (intent
  / design / context / code / test) override `run()` and call
  `this.callLLM` inside their own loop instead — same instance-capture
  semantics
- Converted classes (no more `runXxxAgent` function exports):
  - **Generate layer** — `IntentAgent`, `DesignAgent`, `ContextAgent`,
    `LintConfigAgent` (extends for consistency; never calls
    `callLLM` — Phase 2), `CodeAgent`, `TestAgent`
  - **Gate layer** — `ReviewAgent` (custom entry `review(gateTask)`
    because the gate operates on `GateTask`, not `AgentTask`)
  - **Maintenance layer** — `ContextFixer` (custom entry
    `applyFix(intent, project)` for the maintenance runner's
    per-finding loop; uses `callLLMWithMessages` for system+user)
  - drift-agent / alignment-agent / gc-agent / evaluation-agent are
    deterministic in this codebase (regex / cron / metric checks —
    no LLM calls), so they stay as functions per the
    "infrastructure agents not affected" rule
- `AgentTask.startedAt?: number` added. Set by the orchestrator
  before `agent.run(task)`; subclasses use it to compute
  `durationMs` without a second `Date.now()` at the top of every
  implementation. Optional so older callers don't break
- `AgentResult.lastPrompt` / `llmResponse` REMOVED. These now live
  on the agent instance; the orchestrators read
  `agent.lastPrompt` / `agent.lastLlmResponse` /
  `agent.lastModelUsed` after `run()` returns and pass them into
  `agent_execution_logs.save({...})`
- Orchestrator changes — both the generate orchestrator (`runAgent`
  switch → `newAgentForRole` factory returning a `BaseLLMAgent`
  subclass) and the gate orchestrator (the closure-captured
  `reviewModelUsed` is gone — `ReviewAgent.lastModelUsed` carries
  it) shrank significantly. The inline `llmCall` wrappers that
  routed via `getLLMClient` are deleted from both orchestrators —
  routing is owned by the base class now
- `AgentRole` union in `@gestalt/core/types` gained `'context-fixer'`
  so the new `ContextFixer` class can pass `super('context-fixer')`
  without a cast. Was previously informally cast at insert sites;
  now first-class
- Live verified end-to-end against `trackeros`: padLeft intent
  ran 14 agent executions (6 generate / 2 custom / constraint /
  review / 4 deploy) → reached `deployed`. Execution-log columns
  populated as expected:
  - `intent-agent`: prompt 3011 chars, response 902, model
    `gpt-4o-mini` (agents.yaml override preserved through the
    refactor)
  - `code-agent`: prompt 4065, response 1435, model `gpt-4o`
    (override preserved)
  - `review-agent`: prompt 4498, response 234, model `gpt-4o`
  - Skipped / non-LLM agents: prompt / response / model all NULL
- No behaviour changes; pure refactor. No new endpoints, no new
  migrations, no dashboard changes. Custom agents continue to use
  the unchanged `runCustomAgent` runner

**Step 2: custom agents in agents.yaml — implemented (ADR-037).**
- Projects declare LLM agents under a top-level `custom_agents:` key
  in `agents.yaml`. They run AFTER all six framework generate agents
  (intent / design / context / lint-config / code / test) complete
  and BEFORE the orchestrator dispatches to the quality gate
- Each definition: `name`, `role`, `goal`, optional `runs_after`
  (parsed but not enforced yet — captured for forward
  compatibility), `llm.{model,temperature,max_tokens}` overrides,
  and a `prompt` template
- Prompt placeholders the runner substitutes:
  `{{role}}` · `{{goal}}` · `{{artifacts}}` (code-type artifacts
  only, truncated to 2000 chars each, formatted as
  ```` ### path\n```typescript\n<content>\n``` ````) ·
  `{{goldenPrinciples}}` · `{{intentText}}` · `{{projectName}}`.
  Unknown placeholders survive into the prompt as literal
  `{{key}}` so typos are debuggable
- Expected JSON response:
  `{ passed: bool, findings: [{ severity, file, description }],
  summary: string }`. Parse failures fall through to a
  passed-with-prose-summary fallback so a misbehaved LLM never
  crashes the cycle
- **Signal routing** (the verdict mechanism — ADR-013 stays
  centralised in review-agent + gate):
  - `high`   severity finding → `CONSTRAINT_VIOLATION`
  - `medium` / `low`          → `LINT_FAILURE`
  - LLM error / parse failure → single `CONTEXT_GAP`
  Custom agents NEVER emit `GOLDEN_PRINCIPLE_BREACH`
- **Observability** mirrors framework agents: one
  `agent_executions` row per custom run (`taskType:
  'generate:custom'`, `agentRole = definition.name`); per-run
  `agent_execution_logs` row carrying the LLM response + the
  captured `model_used`; `agent.started` / `agent.completed`
  SSE; `signal.emitted` SSE per signal
- **Failure handling** — a failed custom agent (LLM error, parse
  error, thrown) logs the error and continues. The cycle is
  never blocked by a custom agent directly; the gate makes the
  final verdict from the union of framework + custom signals
- **CLI** — new `gestalt agents` parent with two subcommands:
  - `gestalt agents list <projectName>` — shallow-clones the
    repo, reads `agents.yaml`, prints two sections: "Framework
    agents" (each row shows model override / temperature /
    prompt-extension count) and "Custom agents" (or "None
    defined")
  - `gestalt agents validate <projectName>` — parses
    `agents.yaml`, surfaces warnings, prints
    `✓ agents.yaml valid (N custom agents defined)` or
    `✗ agents.yaml invalid` + warnings. Drops definitions
    missing required fields (`name`, `role`, `prompt`) and
    surfaces the count as a warning if any were skipped
- **Server endpoints** (both `requireRole('viewer')`):
  - `GET /projects/:id/agents` returns
    `{ frameworkAgents: AgentSummary[], customAgents:
    CustomAgentDefinition[] }`. Framework-agent summaries
    always present (per-role baseline from the loader merged
    with operator overrides); custom agents only present when
    declared
  - `GET /projects/:id/agents/validate` returns
    `{ valid, warnings, customAgents: number }`. Both endpoints
    do a shallow clone (`--depth 1`) for the YAML read; temp
    dir cleaned in `finally`
- **Dashboard.** `IntentDetail` accordion renders custom-agent
  rows with `var(--purple)` role colour + a small `custom`
  uppercase badge to the right of the role name. Anything not
  in the `FRAMEWORK_AGENTS` set (the 19 framework roles
  including infrastructure agents and `context-fixer`) gets the
  custom treatment. The badge is `#a855f7` on white text,
  font-mono, all-caps — matches the [severity] badge style on
  Alerts
- Live verified end-to-end against `trackeros` (commits
  `d0a6927` + `3c6f3c5`):
  - Two custom agents pushed: `docs-check-agent` (checks for
    JSDoc — trackeros already has the JSDoc prompt extension
    on code-agent, so this agent passes with no findings) and
    `usage-example-agent` (guaranteed to flag one `low`-severity
    finding per file, to exercise `LINT_FAILURE` routing)
  - `gestalt agents validate` → `✓ agents.yaml valid (2 custom
    agents defined)`
  - `gestalt agents list` rendered the framework block (9 rows,
    each with its current override / extensions count) +
    custom block (2 rows, both showing platform-default model)
  - Submitted a padEnd intent (correlationId `fbcc2a99`).
    `agent_executions` shows 4 `generate:custom` rows across 2
    gate-retry cycles — `docs-check-agent` completed, passed
    each time; `usage-example-agent` completed with status
    `failed` (passed: false) each time
  - **`signals` table for the cycle has one
    `LINT_FAILURE` per usage-example-agent run** (severity:
    `low`, sourceAgent: `usage-example-agent`, message
    `[usage-example-agent] Missing @example block (verification
    path) (src/shared/utils/pad-end/...)`) — confirms the
    severity-to-signal mapping. The intent reached `deployed`,
    so the gate evaluated the signals + retry budget and let
    the cycle through after the second attempt
  - **Dashboard at `/app/intents/<id>`**: headless Chrome
    confirmed 4 purple `CUSTOM` badges, one per custom-agent
    row, with computed background `rgb(168, 85, 247)` (=
    `#a855f7`, the platform's `--purple`). Custom rows
    interspersed with framework rows in the chronological
    execution list

**`runs_after` enforcement for custom agents (ADR-037 follow-up).**
Topologically schedules custom agents so they interleave into the
framework graph instead of running as a single block at the end of
drivePlan. Closes the original ADR-037 caveat ("parsed but not
enforced"):
- **`CustomAgentDefinition.runsAfter: string | null`**. `null` (or
  omitted in YAML) defaults to `'test-agent'` — the last framework
  generate agent — so legacy configs without `runs_after` behave
  identically to before. New: target may be a framework agent OR
  another custom agent in the same `agents.yaml`
- **New `scheduleCustomAgents(definitions): CustomAgentNode[]`** in
  `packages/agents/generate/src/orchestrator/custom-agent-scheduler.ts`.
  Validates every `runs_after` target before any topo work; rejects
  unknown targets, self-loops, and cycles (Kahn's algorithm). On
  success returns nodes in topologically-sorted order with
  `dependsOn` resolved to a concrete string. Exported from the
  package public surface
- **Orchestrator interleaves at the per-step boundary.** After
  `transitionIntent('generating')` the orchestrator loads + schedules
  customs ONCE per cycle. Scheduler throw → typed `CONTEXT_GAP` signal
  + intent → `failed` BEFORE any framework agent runs. Otherwise
  builds two adjacency maps (framework→custom[], custom→custom[]) and
  threads both into `DrivePlanOptions`. Inside `drivePlan`, after
  each framework step's status becomes `completed` or `skipped`
  (NOT `failed`), the per-step branch calls
  `runCustomChainFromList(...)` against the dependent set, which
  walks the custom→custom map recursively with a depth cap of 20
- **Single-node runner** — `runOneCustomAgentNode(node, ctx,
  intentId, correlationId, childLog)` — replaces the prior cycle-
  level `runCustomAgentsForCycle`. Per-node executions get their
  own `agent_executions` row + SSE + execution log + signal mapping,
  same shape the pre-enforcement code produced
- **Server validate route** (`GET /projects/:id/agents/validate`)
  now runs `scheduleCustomAgents` after parsing the YAML. Valid →
  `{ valid: true, executionOrder: [{name, runsAfter}, ...] }`.
  Invalid → `{ valid: false, error: '...' }`. Empty array when no
  customs are defined. Operators catch typos and cycles before
  submitting any intent
- **CLI** (`gestalt agents validate <projectName>`) prints the
  resolved order under the pass message: e.g.
  ```
  ✓ agents.yaml valid (1 custom agent defined)
  Custom agent execution order:
    test-agent → docs-check-agent
  ```
  Invalid configs print the scheduler error verbatim
- **Template + docs.** `agents.yaml` template comments document
  `runs_after`, the default-to-test-agent rule, and the cycle
  detection behaviour. `docs/reference/harness-config.md` schema
  table updated with the enforcement semantics + a worked example
  of valid/invalid CLI output
- **Verified live** against `trackeros`:
  - **Scheduler unit smoke (8 invariants)** — null default,
    explicit framework target, custom→custom chain ordered,
    unknown target throws, self-loop throws, two-node cycle
    detected, three-node cycle detected, declaration-order
    stability
  - **Loader+scheduler smoke (4 brief tests)** — Test 1 (security
    after code, docs after test → valid order printed); Test 3
    (cycle → `Cycle detected in custom agent dependencies: agent-a
    → agent-b`); Test 4 (unknown target → `Custom agent 'my-agent'
    declares runs_after: 'nonexistent-agent' but no agent with that
    name exists. Valid targets: ...`); bonus three-stage chain
    `code-agent → security → perf → trailer`
  - **Server validate endpoint** — `GET /projects/<trackeros>/agents/
    validate` returns `valid: true, executionOrder:
    [{name: 'docs-check-agent', runsAfter: 'test-agent'}]` — the
    legacy `null` default resolves correctly
  - **CLI `gestalt agents validate trackeros`** — prints exactly
    the brief's format: `✓ agents.yaml valid (1 custom agent
    defined)` + `Custom agent execution order: test-agent →
    docs-check-agent`
  - **Live intent cycle** (`e43b3246-29c0-47ca-bcef-f21aa18fdd55`,
    isNonEmpty utility) — `agent_executions` order confirms
    interleaving: intent-agent → design-agent → context-agent →
    code-agent → test-agent → **docs-check-agent** (generate:custom,
    fires right after test-agent) → constraint-agent → review-agent
    → pr-agent → pipeline-agent. Pre-enforcement, the same
    docs-check-agent would have run after the gate dispatch in a
    separate phase. Pipeline-agent failed for unrelated CI reason
  - **No regression for the trackeros legacy config** — the
    existing `docs-check-agent` (no `runs_after` declared) still
    runs after test-agent and produces the same signals it always
    did

**Step 1: externalise agent prompts to agents.yaml — implemented.**
- Every LLM-reasoning agent reads its persona (`role`, `goal`), LLM
  tuning (`temperature`, `max_tokens`, optional `model`), and a flat
  list of `prompt_extensions` from `agents.yaml` in the project repo
  root (alongside `HARNESS.json`). Infrastructure agents
  (`constraint-agent`, `test-runner-agent`, `pipeline-agent`,
  `promotion-agent`, `gc-agent`) ignore the file — they do
  deterministic work
- **Schema** (snake_case YAML keys normalised to camelCase by the
  loader; both shapes are accepted):
  ```yaml
  agents:
    code-agent:
      role: "Senior TypeScript engineer"
      goal: "Generate production-quality TypeScript code..."
      llm:
        temperature: 0.2
        max_tokens: 8000
      prompt_extensions:
        - "Always add a JSDoc comment to every exported function"
        - "Use Result<T,E> pattern for error handling"
  ```
- **Loader** (`@gestalt/agents-generate/loadAgentConfig(projectRoot,
  agentRole)`) is fully non-fatal:
  - Missing file → per-role baseline (one of `intent-agent`,
    `design-agent`, `context-agent`, `code-agent`, `test-agent`,
    `review-agent`, `drift-agent`, `alignment-agent`,
    `context-fixer` — matches the seeded YAML exactly)
  - Malformed YAML → baseline + debug log
  - Agent absent from YAML → baseline
  - Partial entry (only `role`, no `llm.temperature`) → merged with
    baseline gap-fill
  - Backward compat: existing projects without an `agents.yaml`
    committed get identical behaviour to before this change
- **ContextSnapshot.agentConfig** added. The context-assembler calls
  `loadAgentConfig(projectRoot, forAgent)` once per agent dispatch
  and attaches the result. The `agents.yaml` is read from the
  per-cycle clone, so an operator can edit + push and the next
  intent cycle picks it up without a server restart (ADR-032)
- **Prompt wrapping** via the `applyAgentConfig(body, agentConfig)`
  helper. Every prompt builder
  (`buildIntentPrompt` / `buildDesignPrompt` / `buildContextPrompt` /
  `buildCodePrompt` / `buildTestPrompt` /
  `buildLintConfigPrompt`) now prepends a single persona line
  (`You are <role> working on the Gestalt platform. Your goal:
  <goal>`) and appends `## Project-specific instructions\n- ext1\n
  - ext2 ...` near the end (when the operator's
  `promptExtensions` array is non-empty). The existing prompt
  body — file paths, JSON output shapes, retry guidance — stays
  intact. `llm-review-agent.ts` and `context-fixer.ts` follow the
  same pattern inline (different surrounding architecture; same
  effect)
- **LLM tuning + per-agent model routing** flow through a shared
  `LlmCallFn` type:
  `(prompt, overrides?: { temperature?, maxTokens?, model? }) =>
  Promise<string>`. The orchestrator's `llmCall` wrapper calls
  `getLLMClient(overrides.model)` per invocation — the registry
  returns the cached default client when `model` is undefined
  or matches the platform default, and creates + caches a new
  client (sharing the default's `baseUrl` + `apiKey`) on first
  use of any other model name. Each agent passes
  `task.contextSnapshot.agentConfig.llm` so per-agent
  `temperature`, `max_tokens`, AND `model` land on the wire
- **Multi-client LLM registry (`@gestalt/core/src/llm/index.ts`).**
  The startup singleton is now a `Map<string, LLMClient>` keyed
  by model name. `createLLMClient(config)` seeds the default;
  `getLLMClient(model?)` returns the cached client for the
  requested model name or builds a new one on demand. Override
  clients reuse the default's endpoint + API key — only the
  model name changes on the wire (matches Azure deployment +
  every OpenAI-compatible provider's contract). `LLMClient.getModel()`
  exposes the bound model name so the orchestrators can capture
  it after each call. Per-process cache — one entry per unique
  model, created on first use, reused forever after
- **`agent_execution_logs.model_used` column (migration 009).**
  Captures which model actually ran each agent step (after the
  per-agent override resolution). The orchestrators read
  `client.getModel()` after every `complete()` call and persist
  it. Null for non-LLM agents (constraint-agent / pr-agent /
  pipeline-agent / promotion-agent / skipped lint-config) and
  for pre-migration-009 rows. Dashboard's IntentDetail panel
  shows `Model: gpt-4o-mini` / `gpt-4o` / `—` in the agent
  meta section
- **`gestalt init` seeds `agents.yaml`** in the harness file map
  (alongside `HARNESS.json` / `AGENTS.md` / context files). The
  seeded content matches the loader's per-role defaults exactly,
  so a project with the seed file and a project without it
  behave identically out of the box. Operators tune by editing +
  pushing
- **`HarnessEngine.validate()` recognises `agents.yaml` as
  optional.** Present + parses cleanly → no warning. Present +
  malformed → `HarnessValidationResult.warnings` carries
  `"agents.yaml parse error: ..."`. Present + missing `agents`
  key → `"agents.yaml present but has no agents key — defaults
  will be used"`. Absent → silent (the common case for projects
  registered before this change). Validation NEVER fails on
  agents.yaml — the loader's defaults always carry the cycle
- Live verified on `trackeros`:
  - **Without `agents.yaml`** (the existing trackeros state at
    commit `198aff6`): submitted an intent; `agent_execution_logs`
    rows for intent / design / code / test agents each show the
    new persona line at the top of the prompt — every agent gets
    its own per-role baseline (`Senior software architect` /
    `Senior software architect` / `Senior TypeScript engineer` /
    `Senior QA engineer`), not a generic placeholder
  - **With `agents.yaml`** committed to trackeros main, setting
    `code-agent.llm.temperature: 0.8` and
    `prompt_extensions: ["Always add a JSDoc comment to every
    exported function", "Use Result<T,E> pattern for error
    handling"]`: submitted a slugify intent; the code-agent's
    persisted prompt shows both extensions under
    `## Project-specific instructions`. **The generated
    `src/shared/utils/slugify.ts` carries the operator's style
    rules verbatim** — a 4-line JSDoc block with `@param` /
    `@returns` tags AND a `Result<string, Error>` return type
    (the LLM even synthesised a helper
    `src/modules/Utils/result.ts` to provide the type)
  - The full cycle (generate → gate → deploy) reached the
    `deployed` status with the operator-tuned extensions in
    play. End-to-end working

**Alert system — enriched payload + fix-intent flow + CLI:**
- `GET /alerts` and `GET /alerts/:id` return `{ data: EnrichedAlert[] }`
  (the standard envelope). Each row carries the base `AlertRecord`
  shape plus per-type fields lifted out of the JSONB `context`
  column so the dashboard / CLI can render without re-parsing:
  - `clarification-needed` → `intentText`, `intentStatus` (looked
    up via `intents.findById(context.intentId)`)
  - `maintenance-stuck` → `findingType`, `affectedFiles`,
    `evidence`, `attemptCount`, `suggestedAction` (lifted from
    `context`)
  - `GOLDEN_PRINCIPLE_BREACH` → `breachMessage`, `breachLocation`,
    `breachAgent` (resolved via `signals.findByCorrelationId(alert.
    correlationId)` → pick the `GOLDEN_PRINCIPLE_BREACH` row)
- `POST /alerts/:id/fix-intent { additionalContext? }` — operator
  says "I understand the problem, generate a fix". The server
  builds the intent text from the alert's enriched context, queues
  a `generate:intent` task on the BullMQ queue (same shape as
  `POST /intents`), acknowledges the alert in the same call so the
  card disappears atomically, writes an `alert.fix-intent-submitted`
  audit row (metadata: `fixIntentId`, `additionalContextLength`,
  `intentTextLength`, `ip` — **never the context text itself per
  GP-006**), and returns `{ intentId, correlationId, intentText }`.
  `additionalContext` is **appended** to the auto-built text, never
  replaces it — the alert's structural context always leads.
  Intent text templates:
  - `clarification-needed` → `Fix the following issue with intent
    "X": <description>. <additionalContext>`
  - `maintenance-stuck` → `<suggestedAction>. Context: <evidence>.
    <additionalContext>`
  - `GOLDEN_PRINCIPLE_BREACH` → `Fix golden principle breach in
    <file>: <breachMessage>. <additionalContext>`
- `POST /alerts/:id/acknowledge { notes? }` extended to accept an
  optional notes body. Audit metadata captures `notesLength` only
  — the text stays on the alert / persisted record, not in the
  audit row (GP-006)
- **Dashboard `Alerts.tsx` rewritten with per-type cards**
  (`packages/dashboard/src/views/Alerts.tsx`). Each card has a
  distinct layout matching the alert's information needs:
  - `clarification-needed` — intent quote + status + "Why paused"
    prose + suggestions bullet list + two action blocks:
    "Provide clarification (resumes the existing intent)" with
    `resume intent ▶` (existing `POST /intents/:id/clarify` flow,
    kept intact) AND "Or submit as a new intent" with
    `submit fix intent ▶` (new `POST /alerts/:id/fix-intent`)
  - `maintenance-stuck` — Agent + Finding + Attempts KV header,
    "What was tried" (`suggestedAction`), Affected files list,
    Evidence prose; single action block "Submit a fix intent" +
    optional context textarea
  - `GOLDEN_PRINCIPLE_BREACH` — Detected by + Location KV header,
    "What happened" prose, File + Line KV; single action block
    "Submit a fix intent"
  - Every card also shows a "Dismiss (acknowledge without action)"
    action block with optional notes textarea + red `dismiss`
    button. Per-alert UI state (textarea content, submission mode,
    confirmation banner) is keyed by `alert.id` so opening
    multiple cards at once doesn't share input
- **CLI surface — `gestalt alerts`.** Four subcommands so
  operators can work without the dashboard:
  - `gestalt alerts list` — prints a table of unacknowledged
    alerts for the current project (resolved from
    `~/.gestalt/config.json` `currentProjectId`, with the same
    `[severity]` colour-coding the dashboard uses); empty list
    prints `✓ No unacknowledged alerts`
  - `gestalt alerts show <id>` — full per-type detail panel
    (Title / Description / per-type extras / Available actions
    footer). Accepts either the full UUID or the first 8 chars
    (same 8-char prefix the list table shows). Ambiguous
    prefix errors with the match count
  - `gestalt alerts fix <id> [--context <text>]` — submits a fix
    intent via `POST /alerts/:id/fix-intent`. Prompts for the
    optional context via `prompt()` when `--context` is not
    supplied (consistent with `gestalt init-admin`). Prints the
    new `intentId` / `correlationId` / first 80 chars of the
    `intentText` + a `gestalt status` hint
  - `gestalt alerts dismiss <id> [--notes <text>]` — acknowledges
    without action via `POST /alerts/:id/acknowledge`. Prompts
    for notes when `--notes` is not supplied
  - All four accept the standard `--server <url>` one-shot
    override; project scoping matches the dashboard's
    client-side join on `context.intentId` against the current
    project's intents (plus the direct `context.projectId`
    short-circuit for `maintenance-stuck`)
- Live verified end-to-end against `trackeros`:
  - Two `maintenance-stuck` alerts existed in the DB from the
    prior session. `gestalt alerts list` showed the table with
    `[medium]` badges, `maintenance-stuck` type column, and the
    8-char id; `gestalt alerts show b2260ec2` printed Finding /
    Attempts / Affected files / Suggested action / Evidence
  - `gestalt alerts fix b2260ec2 --context "(operator note)"`
    submitted a fresh `intents` row (`source: 'human'`, status
    `generating`), acknowledged the alert atomically, audit row
    captured `additionalContextLength: 48` + `intentTextLength:
    291` + `fixIntentId` (no text leakage)
  - `gestalt alerts dismiss bf44dc0a --notes "..."` acknowledged
    the second alert; audit captured `notesLength: 51` only
  - Submitted a fresh "make it better" intent to create a
    `clarification-needed` alert; `gestalt alerts show` enriched
    correctly with `intentText: "make it better"` /
    `intentStatus: waiting-for-clarification` / 3 suggestions
  - Drove the dashboard at `/app/alerts` with headless Chrome:
    the new clarification card rendered exactly per the brief —
    `?` glyph + `CLARIFICATION NEEDED` + `[high]` badge + intent
    quote / status KV + Why paused prose + suggestions list + 3
    stacked action blocks (Resume / Submit-as-new / Dismiss)

**Pending enhancements (design in chat first):**
- **Return-URL preservation across login.** Pasting `/app/intents/<id>`
  in a fresh tab today bounces to `/app/login` and after sign-in
  lands on `/app/` (the intent ID is dropped). Small SPA-only change —
  `useLocation()` + `?from=` query param in the `RequireAuth` Navigate
  and the Login view's post-success `navigate(...)`. ~10 minutes
- **Vite dev-server proxy `/api` entry is dead.** The proxy in
  `packages/dashboard/vite.config.ts` forwards `/api → localhost:3000`
  but the server has no routes under `/api`. Pre-existing dead
  config; remove on the next dashboard-config touch
- **Encrypt Git PATs at rest.** `project_git_credentials.token` is plain
  text. Documented TODO in `repositories/projects.ts`. Pick a key-management
  approach before any shared/production use
- **LLM model name validation.** `loadConfig` accepts any non-empty string
  for `LLM_MODEL`. Worth adding a startup-time ping or clear error path
- Non-interactive mode for `gestalt init-admin` (--email/--password flags)
  for scripted use — current implementation is TTY-only
- **Retry cycle full re-runs all generate agents** even though only the
  routed agents need fresh work (code-agent typically). Cheaper retries
  would skip intent/design/context when their prior artifacts are
  present in the Git tip. For now: ~50-60s per retry cycle. Tracked as
  an optimisation, not a correctness gap
- **Read `qualityGate.maxRetries` from the project's HARNESS.json** —
  currently hardcoded to 3 in both the gate and generate orchestrators
- **Other PipelineAdapter implementations** (Azure DevOps, GitLab CI,
  Jenkins). The interface is in place; only `GitHubActions` + `NoOp`
  are implemented today. `GitHubActions` is verified end-to-end (see
  `67e5ee02` cycle in the session log); the others are typed stubs in
  the `PipelineAdapterType` union but have no implementation
- **`set-adapter` only switches `pipeline.adapter` today.** The
  `POST /projects/:id/config` body shape is generic
  (`{ pipeline?: ... }`) — adding monitoring (`maintenance.monitoring.adapter`)
  and `qualityGate.maxRetries` follows the same whitelist + clone-edit-
  commit pattern but is not implemented yet
- **Promotion workflow dispatches against a hardcoded `'main'` ref.**
  `GitHubActionsAdapter.promoteToEnvironment` always sends
  `{"ref":"main",...}` instead of the project's `defaultBranch`.
  Projects on `master`/`trunk`/etc. will see the promotion workflow
  fail to dispatch. Thread `project.defaultBranch` through the
  promotion-agent → adapter call to fix
- **No proactive PAT-scope validation at registration / set-adapter
  time.** A PAT missing `workflow` scope only surfaces on the first
  pipeline dispatch (`GOLDEN_PRINCIPLE_BREACH` signal + intent
  `escalated`). A startup-time `GET /user` + `GET /repos/:o/:r` ping
  in `init-harness` / `set-adapter` would catch the misconfiguration
  before any intent cycle
- **Promotion strategy beyond auto.** Today both staging → production
  fires unconditionally on a passed pipeline. The `EnvironmentStrategy`
  type already supports `trigger: 'manual'` + `approvals: N`; wire that
  through promotion-agent once a human-approval UI exists
- **Real-tooling gate agents** (typecheck via `tsc`, lint via ESLint,
  tests via `vitest`). Each needs the project's deps installed in the
  cloned tree — likely a `pnpm install --frozen-lockfile` step before
  the agents run, with the install output cached
- **Live Prometheus / Datadog adapters not yet exercised.** Built
  against the published REST API shapes; unit-tested smoke would
  require a monitoring system. NoOp adapter is the verified path
- **drift-agent additive note can churn DOMAIN.md** if the agent runs
  daily and the module keeps changing. Should de-dupe against existing
  notes (the current `includes(note)` check uses the exact day, so the
  next day's note appears as a new line — fine for low-volume
  projects, may need rolling-window dedupe for active ones)


---

## Recent sessions (last 3)

### Session 2026-06-04 — Claude Code (per-LLM apiShape field — fix gpt-5/o1/o3 'max_tokens' rejection, migration 023)

Operator reported that the "Test connection" button on the
Platform default LLM (modelString `gpt-5.4-mini`) returned a 400
from OpenAI:

> `"Unsupported parameter: 'max_tokens' is not supported with this
> model. Use 'max_completion_tokens' instead."`

**Root cause** (git-confirmed): the LLM client at
`packages/core/src/llm/index.ts:230` + `:297` hardcodes
`max_tokens: request.maxTokens ?? 4096` on every request. OpenAI's
reasoning-class models (gpt-5*, o1, o3) reject that parameter +
silently ignore `temperature`. The bug has been latent since
`df59ae5` (June 3, platform secrets vault commit). **None of
today's 10 commits touched `llm/index.ts`** — verified via
`git log --since='1 day ago' -- packages/core/src/llm/`. The model
"worked before" only in the sense that nobody tested it with this
code path before — `gpt-4o-mini` accepts the legacy parameter and
was the only LLM exercised against the test endpoint in prior
sessions.

Operator chose **Option B** (per-LLM `apiShape` registry field) over
A (model-name regex heuristic) or C (try-then-fallback). Explicit
operator picks > brittle pattern matches.

Changed:

- **Migration 023**
  (`packages/adapters/postgres/src/migrations/023_llm_api_shape.sql`):
  `ALTER TABLE platform_llms ADD COLUMN api_shape TEXT NOT NULL
  DEFAULT 'chat-completions'` + `CHECK (api_shape IN
  ('chat-completions', 'responses'))`. Two-statement form so a
  re-run drops the constraint before re-adding (idempotent).
  Default is `'chat-completions'` so every existing row keeps its
  pre-migration behaviour
- **Core types**
  (`packages/core/src/repository/index.ts`): new exported
  `LLMApiShape = 'chat-completions' | 'responses'`;
  `PlatformLLMRecord.apiShape: LLMApiShape` added with JSDoc
  documenting the two wire shapes (legacy `max_tokens` +
  `temperature` for gpt-4o*/3.5/Ollama/vLLM; reasoning
  `max_completion_tokens` only for gpt-5*/o1/o3)
- **`LLMConfig.apiShape?: LLMApiShape`** added to
  `packages/core/src/config/index.ts` — optional because the
  platform-default `.env`-driven seed doesn't know about per-row
  registry shape; clients constructed from a registry row populate
  it explicitly
- **Two new helpers in `packages/core/src/llm/index.ts`**:
  - `tokenLimitField(apiShape, maxTokens)` returns
    `{max_completion_tokens: N}` for `responses`, else
    `{max_tokens: N}`
  - `temperatureField(apiShape, temperature)` returns `{}` for
    `responses` (reasoning models always run at temperature=1 and
    silently ignore the field; omitting keeps the wire body
    clean), else `{temperature: T}`
  - Both return spreadable objects so the caller composes
    without a branching ladder around the body literal
- **Both LLM call sites** (`callProvider` line 230 +
  `callProviderWithTools` line 297) rewritten as:
  ```
  ...tokenLimitField(this.config.apiShape, request.maxTokens ?? 4096),
  ...temperatureField(this.config.apiShape, request.temperature ?? 0.2),
  ```
- **`RegistryEntry.apiShape?: LLMApiShape`** added to the
  internal resolver shape; `getLLMClientForModel` threads
  `registered.apiShape ?? 'chat-completions'` into the override
  config so the per-(model,baseUrl) cached client uses the right
  wire shape
- **Server boot resolver** (`packages/server/src/server.ts` step
  4b): `setLLMRegistryResolver` now returns `apiShape:
  match.apiShape` from the postgres row alongside `modelString` +
  `baseUrl` + `apiKey`
- **`seedPlatformLlmsIfEmpty`** explicitly seeds new platform-
  default rows with `apiShape: 'chat-completions'` (forward
  compatibility — when the seed default model is a reasoning
  model in some future deployment, the operator can pre-flip via
  `.env` once that path lands)
- **Postgres repo** (`packages/adapters/postgres/src/repositories/
  platform-llms.ts`): `PlatformLLMRow.apiShape: LLMApiShape`;
  `rowToRecord` defensively falls back to `'chat-completions'`
  for any null/legacy row; `create` INSERT includes `api_shape`;
  `update` setParts includes `apiShape !== undefined` branch
- **Oracle + MSSQL adapters**: no per-method signature change
  required because the existing throw-stub `*PlatformLLMRepository`
  classes already implement the same interface; the new
  `apiShape` field is structural on the record + create/update
  payload shapes, both of which the stubs already accept as
  opaque
- **Routes** (`packages/server/src/routes/platform-config.ts`):
  - `VALID_API_SHAPES = ['chat-completions', 'responses']` const +
    `ValidApiShape` typed union
  - `CreateLLMBody` + `UpdateLLMBody` both gain optional
    `apiShape?: unknown`
  - `validateCreateBody` defaults to `'chat-completions'` when
    absent; rejects unknown values with 400 `INVALID_API_SHAPE`
    and the list of valid values in the error message
  - `validateUpdateBody` accepts partial updates of the field
  - Audit metadata for `platform.llm-added` includes the
    `apiShape` so a forensics operator can later trace which
    shape the operator picked at registration time (GP-002)
  - **`POST /platform/llms/:id/test` endpoint** rewritten —
    previously hand-rolled the request body with
    `max_tokens: 5` (re-creating the same bug at the
    diagnostic layer). Now branches on `existing.apiShape`:
    `'responses'` → `max_completion_tokens: 5`, else
    `max_tokens: 5`. The test result now reflects what an
    agent call would actually see for this row
- **Dashboard** (`packages/dashboard/`):
  - `types.ts`: new exported `LLMApiShape` union;
    `PlatformLLM.apiShape: LLMApiShape`
  - `api/client.ts`: `createPlatformLlm` + `updatePlatformLlm`
    payload types extended with `apiShape?: LLMApiShape`
  - `views/Admin.tsx`: `LlmModal` gains a
    `<select>` for API request shape with explainer text below
    ("OpenAI's reasoning-class models reject max_tokens and
    ignore temperature. Pick 'responses' when this LLM is
    gpt-5*, o1, or o3."); `LlmsTab` table gains an "API shape"
    column rendering `responses` in `var(--purple)` and
    `chat-completions` in muted text so the operator scans for
    "interesting" rows at a glance
- **CLI** (`packages/cli/`):
  - `api/client.ts`: new exported `LLMApiShape`; `PlatformLLM`
    interface gains `apiShape`; both create + update payloads
    accept the new optional field
  - `commands/platform-config.ts`: `platformLlmsAddCommand`
    interactive flow gained a third prompt after the API-key
    source picker — "API request shape: (1) chat-completions /
    (2) responses" with default `1`. `platformLlmsListCommand`
    table gains an "API shape" column rendered cyan
    (`responses`) or dim (`chat-completions`)

Verified live end-to-end against `gestalt-server`:

- `pnpm -r build` clean across all 12 packages
- Server restarted with new dist mounted; migration 023 applied
  on first boot. Boot log: `Migration applied { version:
  "023_llm_api_shape" }`. `\d platform_llms` shows
  `api_shape TEXT NOT NULL DEFAULT 'chat-completions'` +
  `CHECK (api_shape IN ('chat-completions', 'responses'))`
- Default-behaviour verified: both pre-existing rows
  (`Platform default` for `gpt-5.4-mini`, `GPT-4o-mini`)
  defaulted to `api_shape = 'chat-completions'`. **Full
  back-compat — no operator action required for legacy rows**
- **Bug reproduction**: `POST /platform/llms/<gpt-5.4-mini>/test`
  with `apiShape: 'chat-completions'` returned `{ok: false,
  error: "Provider 400: ... 'max_tokens' is not supported with
  this model. Use 'max_completion_tokens' instead."}` —
  reproduced the operator's exact error
- **Fix verification**: `PATCH /platform/llms/<id>`
  `{"apiShape":"responses"}` → 200 + `apiShape: 'responses'` in
  response. **`POST .../test` now returns `{ok: true,
  latencyMs: 1268}`** — first successful test connection to
  this LLM ever
- **Control**: `gpt-4o-mini` left at `chat-completions` still
  returns `{ok: true, latencyMs: 661}` — fix didn't regress
  the legacy path
- **Validation matrix**: invalid `apiShape` value
  (`"completions"`) → 400 `INVALID_API_SHAPE` with the typed
  message `"apiShape must be one of: chat-completions,
  responses"`; create without `apiShape` field → defaults to
  `'chat-completions'` in the response and DB row
- Dashboard bundle compiled clean (378 KB ungzipped, +1 KB for
  the new column + modal field)

Decisions made:

- **Two-shape union over per-provider switch.** The brief's
  Option B asked for one new field; I named the values
  pragmatically (`chat-completions` vs `responses`) so a future
  Anthropic / Gemini variant can extend the CHECK constraint
  (e.g. `'anthropic-messages'`) without restructuring. The
  field is intentionally about WIRE SHAPE, not about which
  provider — Azure OpenAI hosts both shapes
- **Omit `temperature` for `responses`, don't send
  `temperature: 1`.** OpenAI's reasoning models silently
  ignore the field today, but future stricter validation
  could 400 on it; omitting is forward-safe
- **Default to `'chat-completions'`** rather than auto-
  detecting from the model name. Auto-detect would have hit
  the same brittleness Option A (regex on model name) was
  designed to avoid. Explicit operator pick > heuristic
- **Test endpoint mirrors the agent path** — same shape
  branching. The previous test-endpoint hand-rolled body had
  `max_tokens: 5`, which IS the bug at the diagnostic layer.
  Fixing only the agent-call site would have left the test
  endpoint reporting "Provider 400" forever for reasoning
  models. Now they round-trip cleanly
- **Audit metadata captures `apiShape`** on `platform.llm-added`
  but NOT on every `platform.llm-updated` (those already capture
  `changedFields`). The create-time record is enough for a
  forensics walk
- **Dashboard table column added** because operators with
  many registered LLMs need to scan for reasoning-class rows
  at a glance — the column makes it obvious which rows are
  reasoning and which are legacy without opening every Edit
  modal. Same rationale for the CLI list table

Side effect noted to operator: during the dev-override
container restart that landed the new code, the container's
`/app/master.key` regenerated (the dev-override mounts dist/
but not master.key, so each restart creates a fresh in-
container key). This broke vault decryption for the prior
`9835125e-...` secret. To unblock immediate testing, I
switched both LLMs from vault-mode to env-var mode
(`apiKeyEnv: 'LLM_API_KEY'`). Final state:
- `Platform default` (`gpt-5.4-mini`) — `apiShape: responses`,
  `apiKeyEnv: LLM_API_KEY`, isDefault=true
- `GPT-4o-mini` — `apiShape: chat-completions`, env path

The operator can flip back to vault later by recreating the
secret under the current master key (delete the broken row +
add a fresh one). Not blocking — env-var path works.

Build status: `pnpm -r build` clean across all 12 packages.
Migration 023 applied via dev-override mount; first successful
test of `gpt-5.4-mini` confirms the fix is correct
end-to-end. The hardcoded `max_tokens` regression that lived
in the LLM client since the original platform commit is now
fixed for both reasoning AND legacy model classes.

Pending follow-ups: none introduced. Possible future
iterations:
- Add `'anthropic-messages'` to the CHECK constraint when the
  registry needs a real cross-provider shape
- Migrate the rotateMasterKey path to also rotate vault secret
  references when the master.key file is regenerated in dev mode
  (so operators iterating with dev-override don't lose vault data)

---

### Session 2026-06-04 — Claude Code (template download + in-place configuration editor, no migration)

Adds the platform-admin tooling to (1) download any harness
template as a ZIP, (2) duplicate built-ins into editable
copies, and (3) edit custom-template files in place via both
the dashboard inline editor and the CLI. No new migration —
the feature reuses the existing `platform_templates.files`
JSONB column from migration 017 with two new postgres
operators (`||` for merge, `-` for delete-key).

Changed:

- **Core repository interface** (`packages/core/src/repository/index.ts`):
  `PlatformTemplateRepository` gained three new methods —
  `updateFiles(id, files)` (MERGE semantics, returns the
  updated record), `deleteFile(id, filePath)` (removes one
  key from the JSONB), `duplicate(sourceId, name, slug,
  createdBy)` (re-uses `create` after `findById`, always
  yields `isBuiltin: false, isDefault: false`)
- **Postgres impl** (`packages/adapters/postgres/src/repositories/platform-templates.ts`):
  - `updateFiles` runs `UPDATE platform_templates SET
    files = files || ${db.json(files)}::jsonb, updated_at =
    NOW() WHERE id = ${id} RETURNING *`. `db.json` ensures
    the binding lands as proper JSONB (same trap the
    maintenance_runs / tool_calls / context repos avoid).
    The `||` operator is shallow merge — keys in the
    supplied map overwrite, keys not in the supplied map
    are preserved
  - `deleteFile` runs `UPDATE ... SET files = files -
    ${filePath}` — postgres's `-` operator on JSONB
    returns a copy with the key removed; idempotent when
    the key is absent (but the route checks first and
    returns 404 instead, so the operator gets a useful
    error)
  - `duplicate` reads the source via `findById`, then
    `create(...)` with `isBuiltin: false, isDefault:
    false`. Tier coerces `Tier 1` → `Custom` (the built-in's
    tier shouldn't carry over) but otherwise preserves
    every field
- **Oracle + MSSQL adapters**: throw-stub the three new
  methods. Same convention every prior adapter session has
  used
- **Server package**: added `adm-zip ^0.5.10` runtime dep +
  `@types/adm-zip ^0.5.5` devDep. CLI already had this
  for the upload-side ZIP parsing
- **Server routes** (`packages/server/src/routes/templates.ts`):
  four new routes:
  - `GET /platform/templates/:id/download`
    (`requireRole('operator')`) — builds the ZIP in memory
    via `adm-zip`, sets `Content-Type: application/zip` +
    `Content-Disposition: attachment; filename="<slug>-
    template.zip"`, sends the buffer. Audit row
    `platform.template-downloaded` with metadata `{slug,
    name, fileCount, sizeBytes, ip}`. Operator+ because
    project-admins use it as a "starting point" download
    even when they're not platform-admins
  - `POST /platform/templates/:id/duplicate` (admin) —
    body `{name, slug}`. Validates name/slug shape; slug
    clash → 409 `SLUG_TAKEN`. Calls the repository's
    `duplicate` method. Audit row
    `platform.template-duplicated` with metadata
    `{sourceId, sourceSlug, newSlug, newName, fileCount,
    ip}`
  - `PATCH /platform/templates/:id/files` (admin) — body
    `{files: {path: content}}`. Built-in guard: 400
    `BUILTIN_TEMPLATE` (operators duplicate first).
    Required-file guard: after the would-be merge, every
    one of `AGENTS.md` / `HARNESS.json` / `agents.yaml`
    must still be present by basename. Today the merge
    can only ADD keys (postgres `||` doesn't remove), so
    existing required files are safe — but the
    defensive check prevents a future caller that bundles
    a remove-and-replace flow from bypassing the guard.
    Audit row `platform.template-files-updated` with
    metadata `{slug, changedFiles: string[], ip}` —
    **file NAMES only, never content** (GP-006)
  - `DELETE /platform/templates/:id/files/*` (admin) —
    wildcard route param so `docs/X.md` works. Built-in
    guard: 400 `BUILTIN_TEMPLATE`. Required-file guard
    by basename: 400 `REQUIRED_FILE` for `AGENTS.md`,
    `HARNESS.json`, `agents.yaml`. Path-not-found: 404
    `FILE_NOT_FOUND` (so a typo never silently no-ops).
    Audit row `platform.template-file-deleted` with
    metadata `{slug, filePath, ip}`
- **Dashboard API client**
  (`packages/dashboard/src/api/client.ts`): four new
  methods — `downloadPlatformTemplate(id)` (returns
  `Promise<Blob>` so the caller triggers a browser
  download via `URL.createObjectURL` + `<a download>`,
  preserving the Authorization header that a plain
  `window.open` would lose); `duplicatePlatformTemplate(id,
  body)`; `updatePlatformTemplateFiles(id, files)`;
  `deletePlatformTemplateFile(id, filePath)` (segment-
  encodes the path so each path component is properly
  URI-escaped while preserving the `/` separators
  Fastify's wildcard route expects)
- **Dashboard `TemplatesTab`**
  (`packages/dashboard/src/views/Admin.tsx`): rewritten
  with per-row `[↓ Download]` / `[⎘ Duplicate]` / `[✎ Edit]`
  (custom only) / `[★ Set default]` (non-default only) /
  `[×]` (custom only) actions. Download triggers the
  blob → object-URL → `<a>` click pattern (cleaning up
  after itself with `URL.revokeObjectURL`).
  Duplicate opens a new `DuplicateTemplateModal` (name +
  slug inputs, both defaulted from the source). Edit
  switches the inline-expanded panel from
  `TemplateDetailPanel` (the existing variable usage
  view) to a new `TemplateEditor` component
- **New `DuplicateTemplateModal`** — minimal modal with
  name + slug fields, defaulted to `<source-name>
  (Custom)` + `<source-slug>-custom`. POST + close on
  success; surfaces typed errors (`SLUG_TAKEN`,
  `INVALID_SLUG`) inline
- **New `TemplateEditor`** — inline panel with two
  sub-panes:
  - **Left:** file tree as a vertical list. Each row
    shows path + `●` (amber) when modified. Required
    files (AGENTS.md / HARNESS.json / agents.yaml by
    basename) have NO `[×]` button (the server's 400
    `REQUIRED_FILE` is the second-line defense, but the
    operator shouldn't see a button that can't work).
    Selected row highlights with `var(--bg-raised)`.
    `[+ Add file]` button at the bottom opens an inline
    input row that creates an empty draft on Enter
  - **Right:** monospace `<textarea>` for the selected
    file, ~400px min height, vertical resize. `[Save
    this file]` button is enabled only when the draft
    differs from the persisted content. `[Discard
    changes]` reverts the draft to the persisted state.
    Header line shows the file path + `● modified` chip
    when different
  - **Footer:** `[Save all changes (N)]` button +
    "N file(s) modified — saved with one PATCH call"
    hint. Combines every modified file into a single
    PATCH so the audit row + Git history (when the
    operator later commits) read as one atomic change
  - Drafts persist in component state — a stray click
    elsewhere in the row doesn't lose work, only `[×
    Close editor]` exits. The `toggleExpand` handler
    is a no-op while `editingId === t.id` so the row
    click can't accidentally collapse the editor
- **CLI API client** (`packages/cli/src/api/client.ts`):
  four new methods mirroring the dashboard's surface.
  `downloadPlatformTemplate(id)` returns a `Buffer`
  (Node-side equivalent of the browser's Blob) so the
  caller writes it via `fs.writeFileSync`
- **CLI commands**
  (`packages/cli/src/commands/platform-extras.ts`):
  five new subcommands + a shared `resolveTemplateBySlug`
  helper + an `editInEditor` helper for the `$EDITOR`
  flow:
  - `gestalt platform templates download <slug>
    [--output <path>]` — writes the ZIP, prints file
    count + byte size on success. Output default is
    `./<slug>-template.zip`
  - `gestalt platform templates duplicate <slug>
    [--name <n>] [--new-slug <s>]` — prompts for the
    missing fields with sensible defaults
  - `gestalt platform templates edit <slug> <filePath>
    [--content <string>]` — `$EDITOR` flow (falls back to
    `$VISUAL`, then `vi`). Headless / non-TTY mode
    writes to a tmp file and prompts the operator to
    edit it manually before pressing Enter (CI-friendly).
    `--content` skips the editor entirely. Compares the
    post-edit content against the original to avoid a
    no-op PATCH ("No changes to <path> — nothing to
    save."). Editor exits with non-zero status → abort
    cleanly
  - `gestalt platform templates add-file <slug>
    <filePath> [--content <string>]` — same editor flow
    but refuses if the file already exists (operator gets
    a hint to use `edit` instead)
  - `gestalt platform templates remove-file <slug>
    <filePath>` — confirms `y/N` then DELETEs. The
    server's 400 `REQUIRED_FILE` surfaces verbatim
  Helper `editInEditor(initial, hintLabel)` creates a
  filename-safe suffix from the label (`gestalt-<ts>-
  <slug-snippet>`) and cleans up the temp file in a
  `finally` block on every code path
- **CLI registration** (`packages/cli/src/index.ts`):
  all five subcommands registered under the existing
  `gestalt platform templates` parent. Top-of-file
  command comment updated. Header comment in
  `platform-extras.ts` updated to document the new
  surface + the `$EDITOR` fallback contract
- **Docs** (`docs/guides/quick-start.md`): new
  "Authoring custom templates" section between
  "Customising agents" and "Summary — command
  reference". Covers two workflows: (1) start from the
  built-in by downloading + editing locally + uploading
  the modified ZIP; (2) in-place editing via
  duplicate + edit + add-file + inspect + set-default.
  Constraints block explicitly documents the built-in
  read-only rule, required-file rule, MERGE semantics,
  and GP-006 audit-content exclusion. Summary table
  gained 7 new template-authoring rows (list, download,
  duplicate, edit, add-file, remove-file, inspect,
  set-default — minus list which was already there)

Verified live end-to-end:

- `pnpm -r build` clean across all 12 packages. Docker
  server image rebuilt with the new `adm-zip` dep
  baked in. `Up (healthy)`; existing migrations
  unchanged
- **Download** — `curl -H 'Auth: Bearer <admin>'
  http://localhost:3000/platform/templates/<built-in>/download`
  returned HTTP 200 + `Content-Type: application/zip`
  + 8971-byte body. `unzip -l` listing shows all 8
  expected files (`ci/gestalt.yml`,
  `docs/{ARCHITECTURE,DECISIONS,DOMAIN,GOLDEN_PRINCIPLES}.md`,
  `harness/{AGENTS.md, HARNESS.json, agents.yaml}`) at
  the expected paths with reasonable byte sizes (108–
  9797 bytes per file)
- **Duplicate** — `POST .../duplicate {name: 'Corporate
  Ops (Live Test)', slug: 'corporate-ops-livetest'}`
  returned 201 with the new record: `isBuiltin: false`,
  `isDefault: false`, `createdBy: <admin uuid>`, all 8
  source files copied
- **Edit + MERGE semantics** — PATCH /files with
  `{harness/AGENTS.md: '<new content>'}` returned 200.
  Subsequent GET shows AGENTS.md has the new content
  + ALL 7 other files preserved with their original
  byte content. Verified key-by-key
- **Built-in guard** — PATCH /files on the built-in's
  ID returned 400 `BUILTIN_TEMPLATE` with the typed
  message "Cannot edit a built-in template — duplicate
  it first"
- **Required-file guard** — DELETE /files/harness/AGENTS.md
  on the duplicate returned 400 `REQUIRED_FILE` with
  `requiredFile: 'AGENTS.md'`. Same for
  `harness/HARNESS.json`
- **Invalid body** — PATCH /files with `{}` returned
  400 `INVALID_FILES`
- **Add + remove** — PATCH /files added a new
  `docs/EXTRA.md`; subsequent GET shows 9 files. DELETE
  /files/docs/EXTRA.md returned 204; subsequent GET
  shows 8 files (the new one is gone, the original 8
  preserved). DELETE on a non-existent path returned
  404 `FILE_NOT_FOUND` (not 204 — typos shouldn't
  silently succeed)
- **Slug validation on duplicate** — POST .../duplicate
  with an existing slug returned 409 `SLUG_TAKEN`;
  missing `name` returned 400 `INVALID_NAME`; bad
  slug shape (`-bad-slug`) returned 400 `INVALID_SLUG`
- **Persistence across server restart** — `docker
  compose restart server` + 5s wait, then refetch the
  duplicate template. AGENTS.md still carries the
  edited content. Data is in postgres
  `platform_templates.files` JSONB, not memory
- **Audit table** — direct probe shows all 4 new
  actions wrote rows with the documented metadata
  shape. `platform.template-files-updated` carries
  `changedFiles: ['harness/AGENTS.md']` —
  **NAMES only, not content**. GP-006 verified via
  direct row inspection
- **CLI download** — `gestalt platform templates
  download corporate-ops-web-mobile --output
  /tmp/cli-download.zip` produced
  `✓ Template downloaded: /tmp/cli-download.zip
  (8 files, 8971 bytes)`. Unzip listing identical to
  the curl-driven download
- **CLI edit + add-file + remove-file** — `gestalt
  platform templates edit corporate-ops-livetest
  harness/AGENTS.md --content '<text>'` succeeded;
  inspect shows the updated content. `add-file ...
  --content '<text>'` added the new file. `remove-file`
  with auto-confirm (printf 'y\n') deleted it. The
  `--content` flag path skips the `$EDITOR` flow
  entirely — Headless / scripted operator workflows
  work without a TTY
- **CLI guards** — `edit corporate-ops-web-mobile
  harness/AGENTS.md --content 'hacked'` returned
  `Failed to edit ... 400 BUILTIN_TEMPLATE`. `remove-file
  corporate-ops-livetest harness/AGENTS.md` returned
  `Failed to remove ... 400 REQUIRED_FILE`. Errors
  surface verbatim from the server
- **CLI duplicate** — `gestalt platform templates
  duplicate corporate-ops-web-mobile --name 'CLI
  Duplicate Test' --new-slug cli-dupe-test` succeeded;
  subsequent `templates list` shows three templates
  (built-in + the two test duplicates)
- **Cleanup** — `gestalt platform templates delete
  cli-dupe-test` + `delete corporate-ops-livetest`
  with `y` confirmation removed both. Final
  `templates list` shows only the built-in remaining

Decisions made:

- **`adm-zip` not `archiver`.** The brief offered both.
  `adm-zip` is already in the CLI's deps for upload-
  side parsing; using the same library on the
  server-side download keeps the dep surface tight. For
  the current template size (8 files, ~9 KB) in-memory
  zipping is fine; if templates ever grow into
  multi-MB territory we'd switch to `archiver`'s
  streaming API + `pipe(reply.raw)`
- **MERGE not REPLACE.** Postgres's `files || $1::jsonb`
  is the natural fit: only the supplied keys change,
  other files are preserved. The brief was explicit
  about this — "a partial update never wipes adjacent
  state". The dashboard's `Save all changes (N)` button
  combines every modified file into one PATCH so the
  audit row + future Git commit narrate one
  semantically-coherent change
- **Required-file guard runs on the would-be-merged map,
  not just on the supplied input.** Today the merge can
  only ADD keys, so the existing required files are
  safe — but a future caller bundling a remove-and-
  replace flow shouldn't be able to drop a required
  file via this endpoint. The defense-in-depth check
  costs nothing
- **Audit metadata records file NAMES, not content.**
  GP-006. The dashboard / CLI have access to the full
  content via the existing GET endpoint, so a forensics
  operator can see WHO modified WHICH files and reach
  for the content separately. Putting content in
  `audit_log.metadata` would balloon the table fast
  and replicate file content into every backup pull
- **Built-in PATCH/DELETE returns 400 `BUILTIN_TEMPLATE`,
  not 403.** The brief described it as "the
  same guard as delete". The DELETE /platform/templates/:id
  route uses 400 + `BUILTIN_TEMPLATE` (operator sees
  "duplicate first" hint instead of an opaque "forbidden"
  message). Matching the existing pattern keeps the
  error surface consistent
- **Duplicate's tier coerces `Tier 1` → `Custom`** but
  preserves any other tier value. Built-in's `tier1`
  shouldn't carry over to a custom row (that's a
  marketing signal for ship-with-platform templates).
  Custom tiers (`Custom`, operator-defined values)
  pass through unchanged
- **Dashboard download uses `URL.createObjectURL` + `<a
  download>`, NOT `window.open`.** A `window.open` to
  the download URL would lose the Authorization header
  (the server's `requireRole('operator')` preHandler
  would 401). The blob + object URL pattern wraps the
  authenticated fetch in a download trigger that the
  browser handles natively, preserving the operator's
  session
- **CLI `editInEditor` uses `$EDITOR` → `$VISUAL` →
  `vi` priority.** Standard Unix convention. The
  fallback to `vi` matches what `git commit` does. In
  non-TTY environments the helper writes the temp file
  and prompts the operator to edit it manually before
  pressing Enter — CI-compatible without crashing
- **`edit` command compares post-edit content against
  the original** to avoid no-op PATCH calls. Operators
  who open the editor + immediately exit (or who make
  no changes) get a friendly "No changes to <path> —
  nothing to save." instead of a wasted round-trip
- **In-place editor preserves drafts across re-renders.**
  The TemplateEditor's local state survives every
  parent re-render — only `[× Close editor]` exits
  the editor mode. A stray row-click can't lose
  work. The `toggleExpand` handler explicitly
  short-circuits when `editingId === t.id`
- **DuplicateTemplateModal defaults: `<source-name>
  (Custom)` + `<source-slug>-custom`.** Makes the
  common case (duplicate built-in for tweaks) a
  one-click operation. Operators who want a different
  name/slug just type over the defaults
- **No new migration.** All four routes work on the
  existing `platform_templates.files` JSONB column from
  migration 017. The duplicate uses INSERT (already
  wired); update + delete use postgres's JSONB `||`
  and `-` operators

Build status: `pnpm -r build` clean across all 12
packages. Docker server image rebuilt. Full validation
matrix + MERGE semantics + persistence-across-restart +
audit-row shape + CLI end-to-end + guard tests all
verified live against the running platform. No
migrations applied. Workspace test templates removed at
session end; final DB state has only the built-in
template.

Pending follow-ups: none introduced. Possible future
iterations:
- Syntax highlighting in the dashboard's textarea
  editor (today it's plain monospace) — the brief said
  "keep it simple"; a future iteration could plug in
  Monaco or CodeMirror for the common cases (Markdown,
  JSON, YAML)
- A `gestalt platform templates push <slug> <dirPath>`
  command that uploads every file in a directory as a
  PATCH (operators who edited locally without going
  through the ZIP roundtrip)
- A `gestalt platform templates diff <slug>` command
  that shows the difference between a template and the
  on-disk built-in (helps operators see what they've
  customised vs the ship-default)
- Streaming download via `archiver` + `pipe(reply.raw)`
  if templates ever exceed single-digit MB

---

### Session 2026-06-04 — Claude Code (template editor improvements: CodeMirror syntax highlighting + gestalt platform templates push + diff)

Three follow-ups to the previous session's template editor, all
in one pass. Each is self-contained; no new migrations.

**Enhancement 1 — CodeMirror 6 syntax highlighting in the
dashboard editor.** Replaces the plain `<textarea>` in
`TemplateEditor` (Admin.tsx) with a CodeMirror 6 editor.
- `packages/dashboard/package.json` gains 7 new runtime deps:
  `@codemirror/view`, `@codemirror/state`,
  `@codemirror/lang-json`, `@codemirror/lang-yaml`,
  `@codemirror/lang-markdown`, `@codemirror/theme-one-dark`,
  and the `codemirror` meta package (which is where `basicSetup`
  actually lives in v6 — the brief's pseudocode put it under
  `@codemirror/view` which is incorrect; deviated to make the
  imports compile)
- New `getLanguageExtension(filePath)` helper at the top of the
  `TemplateEditor` region maps file extension → CodeMirror lang
  extension: `.json` → `json()`, `.yaml`/`.yml` → `yaml()`,
  `.md` → `markdown()`, everything else → `[]` (plain text).
  Only three language packs are imported per the brief —
  bundle stays as lean as it can while still covering every
  file the seeded template contains
- `TemplateEditor` rewritten with three new refs:
  `editorRef` (HTMLDivElement that holds the editor mount
  point), `editorViewRef` (the current EditorView instance,
  destroyed + nulled on cleanup), and `draftsRef` (latest
  drafts captured for the updateListener closure so multiple
  React renders don't strand stale references). New
  `discardCounter` state slot bumps on every discard so the
  edit-mount `useEffect` re-runs and rebuilds the EditorView
  with the freshly-reverted doc
- The mount `useEffect` is keyed on
  `[selectedPath, discardCounter]`. On every change it
  destroys the prior view, builds a new `EditorState` with
  `doc: drafts[path]`, attaches `basicSetup` + `oneDark` +
  `EditorView.lineWrapping` +
  `getLanguageExtension(path)` +
  `EditorView.updateListener.of(...)`, and instantiates a
  new EditorView in `editorRef.current`. The updateListener
  fires on every doc-change transaction and writes back via
  `setDrafts((prev) => ({...prev, [path]: doc.toString()}))`
- The `<textarea>` JSX block is replaced with
  `<div ref={editorRef} style={...}>` — `minHeight: 400px,
  maxHeight: 700px, overflow: auto`. The CSS variables
  (`var(--border)`, etc.) are preserved so the editor
  visually integrates with the rest of the panel
- `discardOne` extended to also call
  `setDiscardCounter((c) => c + 1)` when the discarded path
  is the one in the editor — forces the useEffect to re-run
  and reset the editor's doc. Otherwise the in-memory
  EditorView would keep showing the operator's typed
  content even after drafts state has been reverted
- The now-unused `selectedContent` const is deleted
- Bundle delta: 363 KB → 1010 KB raw (319 KB gzipped, +190
  KB delta). Above Vite's 500 KB warning but acceptable for
  an admin-only feature. Future iteration: code-split via
  dynamic `import()` so only platform-admins editing
  templates pay the cost

**Enhancement 2 — `gestalt platform templates push
<slug> <dirPath> [--dry-run]`.** Batch upload from a local
directory tree.
- New `collectTemplateFiles(dir, rootDir)` recursive walker
  in `platform-extras.ts`. `SKIP_NAMES` Set excludes `.git`
  / `.gestalt` / `node_modules` / `dist` / `build` /
  `.DS_Store`. Path separators are normalised forward-slash
  so Windows operators don't end up with `docs\X.md` keys
  on the wire
- New `platformTemplatesPushCommand(slug, dirPath, {dryRun})`
  exported. Path-validates the dir, walks it, builds the
  full file map. `--dry-run` prints sizes per file with a
  "(dry run — no changes made)" footer. Real run calls
  `PATCH /platform/templates/:id/files` (MERGE semantics —
  unsupplied files preserved server-side)
- Error handling: `BUILTIN_TEMPLATE` surfaces with `Cannot
  push to a built-in template. Duplicate it first: gestalt
  platform templates duplicate <slug>`;
  `MISSING_REQUIRED_FILES` surfaces with the typed list +
  "Ensure AGENTS.md, HARNESS.json, and agents.yaml are
  present in the directory."; missing-dir → `Directory not
  found: <path>` + exit 1
- New `fs` sync imports (`readdirSync`, `statSync`,
  `existsSync`) + `relative` path helper. The walker uses
  sync FS calls to match the file's existing style (the
  editor flow already uses `readFileSync` / `writeFileSync`
  / `unlinkSync`)

**Enhancement 3 — `gestalt platform templates diff <slug>
[--against <baselineSlug>] [--stat]`.** Per-file unified
diff against a baseline.
- New `diff ^5.2.0` runtime dep + `@types/diff ^5.2.0` dev
  dep in `packages/cli/package.json`. `diffLines` from the
  `diff` package does LCS-based line diffing — language-
  agnostic, no markdown/yaml parser required
- New `platformTemplatesDiffCommand(slug, {against, stat})`
  exported. Default baseline `corporate-ops-web-mobile`;
  `--against <slug>` overrides. Self-diff (same slug both
  sides) → `Cannot diff '<slug>' against itself.` + exit 1.
  Both templates loaded via `getPlatformTemplate(id)` in
  parallel. Path-set union iterated for per-file
  classification: only in baseline → `(removed)`, only in
  custom → `(added)`, in both with line changes →
  `(modified)`, no changes → `(unchanged)`
- Modified files print a unified-diff block: green `+`
  lines + red `-` lines + 2 leading / 2 trailing context
  lines per hunk. Hunks with more than 4 unchanged lines
  collapse via `... (N unchanged lines)` so big files stay
  readable
- `--stat` mode hides the per-line diff and prints only the
  right-padded per-file `+N -M` summary (or `unchanged`
  / `(added)` / `(removed)` for non-modified files). Footer
  `Summary: 1 modified, 7 unchanged` (with green/red/dim
  fragments) always prints

**Registration:** new `push` and `diff` subcommands
registered under `gestalt platform templates` in
`packages/cli/src/index.ts`. Top-of-file command comment
extended. Header docstring on
`packages/cli/src/commands/platform-extras.ts` updated to
document both new subcommands + the LCS-diff design.

Verified live end-to-end:

- `pnpm -r build` clean across all 12 packages. Dashboard
  bundle compiled to `index-Ds_rUJ8n.js` (1010 KB raw, 319
  KB gzipped); CLI compiled clean. New dashboard bundle
  `docker cp`'d into the running container so it serves
  the fresh assets without an image rebuild. HTML now
  references the new bundle (`/app/assets/index-Ds_rUJ8n.js`)
- Spot-grep on the production bundle confirms the new
  CodeMirror modules landed: CSS classes (`cm-editor` × 1,
  `cm-content` × 8, `cm-line` × 11, `cm-gutters` × 12), the
  OneDark theme's signature colors (`#abb2bf`, `#21252b`,
  `#282c34`), and the APIs we use (`EditorView`,
  `EditorState`, `lineWrapping` × 28, `updateListener` × 2)
- `gestalt platform templates --help` lists both new
  subcommands with their option descriptions
- **Push verification flow (end-to-end against the live
  platform):**
  - `gestalt platform templates download
    corporate-ops-web-mobile --output /tmp/.../template.zip`
    → "✓ Template downloaded ... (8 files, 8971 bytes)"
  - Unzip + append `## Custom section added by
    operator\nLocal edits via the push workflow.` to
    `harness/AGENTS.md`
  - `gestalt platform templates duplicate
    corporate-ops-web-mobile --name "Push Diff Test"
    --new-slug push-diff-test` → "✓ Template duplicated"
  - `gestalt platform templates push push-diff-test
    /tmp/.../my-edit --dry-run` → "Would push 8 files:" +
    per-file size listing + "(dry run — no changes made)"
  - Real push without `--dry-run` → 8 `✓` rows + "✓
    Template updated: push-diff-test (8 files pushed)"
  - Direct API fetch confirms `harness/AGENTS.md` content
    ends with the operator's local edits — the push lands
    server-side correctly
- **Diff verification flow:**
  - `gestalt platform templates diff push-diff-test` →
    Comparing header, 7 files `(unchanged)`, 1 file
    `harness/AGENTS.md (modified)` with `... (68 unchanged
    lines)` context-folding + 2 green `+` lines + Summary
    `1 modified, 7 unchanged`
  - `--stat` mode → compact per-file summary with
    `harness/AGENTS.md +2 -0` and other files
    `unchanged`
  - Added a new file (`docs/EXTRA.md`) via push → diff
    shows `docs/EXTRA.md (added)` line + updated Summary
  - Clean duplicate (`clean-copy-test`) diff → ALL 8 files
    `(unchanged)` + Summary `8 unchanged`
- **Error matrix:**
  - `push corporate-ops-web-mobile <dir>` → "Cannot push to
    a built-in template. Duplicate it first: ..."
  - `push push-diff-test /tmp/does-not-exist` →
    "Directory not found: ..."
  - `diff push-diff-test --against nonexistent-baseline` →
    "No template with slug 'nonexistent-baseline'." +
    hint
  - `diff push-diff-test --against push-diff-test` →
    "Cannot diff 'push-diff-test' against itself."
- Cleanup: both test templates (`push-diff-test`,
  `clean-copy-test`) deleted via `gestalt platform
  templates delete` with `y` confirmation. Final DB state
  has only the built-in template + the old/new dashboard
  bundles in the container's dist (the old bundle is now
  orphan; HTML references the new one)

Decisions made:

- **`basicSetup` imported from `codemirror` (the meta
  package), NOT `@codemirror/view`.** Brief's pseudocode
  was incorrect about the import path — in CodeMirror 6,
  `basicSetup` is exported from the `codemirror` umbrella
  package. The compiler would have rejected the brief's
  literal imports; the deviation is required for
  correctness, not stylistic. Documented inline next to
  the imports
- **`useEffect` keyed on `[selectedPath, discardCounter]`,
  not just `selectedPath`.** Discard needs to recreate the
  editor (CodeMirror's `EditorState` is immutable
  per-transaction; setting the doc externally requires
  either a `dispatch({changes: ...})` call or a fresh
  state). The counter approach is simpler and matches the
  brief's "update selectedFile key to force the useEffect
  to re-run" suggestion. The cleanup function destroys the
  old EditorView before the next one mounts so there's no
  double-mount in the DOM
- **`draftsRef` captures the current drafts state for the
  updateListener.** Without it, the listener's closure
  would see stale `setDrafts` calls when React batches
  state updates across rapid keystrokes. The ref pattern is
  the standard React idiom for "give me access to the
  latest state from inside a long-lived callback"
- **Static imports, not dynamic.** Brief's example used
  static imports; the bundle delta is significant but
  Admin is a route-level lazy load already (RequirePlatformAdmin
  guards the route). Code-split could push only template-
  editing operators into the CodeMirror-paying tier; a
  future enhancement but out of scope today
- **Push walker skips dot-files and common build
  artifacts** (`.git`, `.gestalt`, `node_modules`, `dist`,
  `build`, `.DS_Store`). Operators who keep an editing
  checkout in the same directory shouldn't accidentally
  push their `node_modules` to the server. The skip list is
  minimal — the brief said "starts from the directory you
  give it"; adding the SKIP_NAMES set was a defense
  against operator mistakes, not a deviation from the
  intent
- **Push uses sync FS calls.** Consistent with the rest of
  `platform-extras.ts` (which uses `readFileSync` /
  `writeFileSync` / `unlinkSync` for the editor flow).
  Brief's pseudocode showed async `fs/promises`; either
  would work, but staying consistent with the file's
  existing style is cleaner
- **Diff `(modified)` vs `(unchanged)` decision uses
  added+removed line count, not change-block count.** A
  block of unchanged context surrounded by changes would
  still count toward the modified-file classification.
  Counting added+removed lines (excluding empty trailing
  newlines) gives the right semantic: "are there real
  changes in this file"
- **Diff `--stat` row format right-pads paths to 40 chars.**
  Most template file paths are < 30 chars; 40 gives a
  little headroom while keeping the columns visually
  aligned. The `+N -M` counts are colorised (green/red) so
  scannable at a glance
- **Diff context-folding shows 2 leading + 2 trailing
  unchanged lines** with `... (N unchanged)` between. Short
  files (≤ 4 unchanged lines in a row) show the full
  context. The cutoff is the brief's suggestion; tested
  against the verification template's AGENTS.md (68
  unchanged lines collapsed correctly)
- **No new server endpoints, no new migrations.** Both
  push and diff use the existing
  `PATCH /platform/templates/:id/files` and
  `GET /platform/templates/:id` endpoints from the prior
  session. The dashboard CodeMirror integration is purely
  UI-side

Bundle size note flagged for follow-up:

- Dashboard bundle grew from 363 KB to 1010 KB (319 KB
  gzipped, +190 KB delta). Vite's 500 KB warning threshold
  is now exceeded. Acceptable for an admin-only feature
  (regular users don't load the Admin route's editor) but
  a future code-split via dynamic `import()` of CodeMirror
  modules (similar to how `jszip` is already
  dynamic-imported in `UploadTemplateModal`) would push
  the bundle delta from the main chunk into a deferred
  one only loaded when an operator opens the template
  editor

Build status: `pnpm -r build` clean across all 12 packages.
Docker server image NOT rebuilt — the new dashboard bundle
was `docker cp`'d into the running container at
`/app/packages/dashboard/dist/`. Next clean image rebuild
(`docker compose build server`) will fold the new dashboard
build into the image proper. All CLI commands exercised
end-to-end against the live platform: push happy path +
dry-run + 3 error paths, diff full + --stat + added-file +
clean-duplicate + 2 error paths, plus the existing
download / duplicate / delete subcommands as part of the
verification flow.

Pending follow-ups: none introduced. The bundle size
delta is the only candidate for future iteration — a
single-day refactor to dynamic-import the CodeMirror
modules from inside the TemplateEditor mount effect would
restore the main bundle to ~370 KB and only fire the
extra ~640 KB raw on first editor open.
