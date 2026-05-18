# 03-W1-PLAN check

**Checked:** 2026-05-18
**Plan reviewed:** .planning/phases/03-availability-rules/03-W1-PLAN.md
**Reviewer:** gsd-plan-checker (goal-backward, FORCE stance)

---

## Verdict

**Status:** block

**Rationale:** Two issues will prevent Task 4 and Task 6 from passing their own done criteria as written. (1) Task 4 founding-admin seed uses `ON CONFLICT (name)` on a `tenant` table that has no unique constraint on `name` (verified against migration 0002) and also omits the required `org_depth NOT NULL` column — the seed cannot run. (2) Task 6 Layer-2 CI gate includes `tx` in its forbidden identifier set, which causes it to flag the W1 codebase's only legitimate `tx.select()` call inside `app/(authed)/shifts/page.tsx` (the sanctioned `tenantScopedQuery((tx) => ...)` callback) — the gate fails on the very code Task 5 ships. Both are local edits to the plan, not structural rework. The three-layer tenant-isolation contract, the 8-task partition, and the three locked decisions (D-W1-01/02/03) are otherwise wired correctly.

---

## Goal-backward sign-off

Working from Wave 1 GOAL (Next.js scaffold + Auth.js + Drizzle + first authed route working end-to-end; substrate Wave 2 to 4 depend on) and verifying each truth in must_haves.truths traces to a covering task:

| Truth | Covered by | Status |
|---|---|---|
| pnpm dev boots on :3000 | Task 2 (scaffold) + Task 5 (routes) verify | OK |
| /login renders Hebrew RTL form on 375px viewport | Task 2 (RTL root layout) + Task 5b (form) | OK |
| Form submit writes verification_tokens row + triggers Resend SDK | Task 4 (Auth.js wiring) + Task 8e smoke | OK (manual smoke; no automated Resend mock) -- see M-3 |
| Magic-link click sets __Secure-authjs.session-token cookie + writes sessions row | Task 4 + Task 8e smoke | OK (manual smoke) -- same caveat |
| session.user.shiftyTenantId populated from users.shifty_tenant_id | Task 1 (migration 0015) + Task 4b (callback) + Task 4h (seed) | BLOCKER on seed; see B-1 |
| /shifts runs tenantScopedQuery() against shift_slot, empty Card | Task 5g | OK -- depends on B-2 fix |
| pnpm test:check-tenant-isolation exits 0 on codebase; exits 1 on bad fixture | Task 6 | BLOCKER; see B-2 |
| pnpm build produces .next/standalone/ | Task 2 verify + Task 8 Dockerfile | OK |
| docker compose build nextjs-app succeeds locally | Task 8 | OK (PsExec note for hpg5 explicit) |
| Migration 0015 applied; psql backslash-d users shows column | Task 1 | OK |
| Layer-5 active: SELECT * FROM soldier outside tx returns 0 rows | Task 7b integration test | OK |

Sign-off: Once B-1 and B-2 are addressed, every must_have truth has a covering task whose action actually delivers it. The plan's verification block (lines 749 to 766) will pass.

---

## Findings (severity-classified)

### Blockers (must fix before execution)

#### B-1 -- Task 4 seed script ON CONFLICT (name) will fail at runtime

**Where:** Task 4 step 4h sub-step 1 (line 484):

    INSERT INTO tenant (name) VALUES (...) ON CONFLICT (name) DO NOTHING RETURNING id;

**Why it is a blocker:** Migration 0002 defines `tenant` with `id` as the only PRIMARY KEY and no UNIQUE constraint or index on `name` (verified `db/migrations/0002_tenancy_and_org.up.sql` lines 25-31; grep across all 14 migrations confirms no `CREATE UNIQUE INDEX` on `tenant.name` anywhere). Postgres rejects `ON CONFLICT (name)` with the error "there is no unique or exclusion constraint matching the ON CONFLICT specification" because `ON CONFLICT (target)` requires a corresponding unique index. Task 4 verify block runs `pnpm seed:admin` and would fail on first invocation.

**Cascades:**
- Task 4 done criterion (pnpm seed:admin runs idempotently -- second run produces same row) cannot be satisfied.
- must_haves.truths line about `session.user.shiftyTenantId` being populated from the seeded `users.shifty_tenant_id` column fails -- the user never gets seeded.
- The Task 8 first-run smoke (8e) which expects `/shifts` to render after login fails because `shiftyTenantId` stays NULL and the (authed) layout redirects to `/login?reason=no-tenant`.

**Bonus catch in the same INSERT:** Task 4 step 4h does not specify `tenant.org_depth` in the INSERT, but that column is `NOT NULL CHECK (org_depth BETWEEN 1 AND 3)` per migration 0002 line 28. The seed would fail with "null value violates not-null constraint" before it ever gets to the ON CONFLICT clause. Both issues live in the same INSERT -- fix together.

**Proposed fix to plan file** (edit Task 4 step 4h, replacing the idempotent flow):

    Idempotent flow inside a single transaction connected as migrator:
    1. SELECT id FROM tenant WHERE name = $1 LIMIT 1;
       IF found, reuse the id.
       ELSE INSERT INTO tenant (name, org_depth) VALUES ($1, 1) RETURNING id;
       (tenant.org_depth NOT NULL CHECK BETWEEN 1 AND 3 per migration 0002 line 28.)
    2. INSERT INTO "users" (email, "emailVerified", shifty_tenant_id)
       VALUES ($1, now(), $2)
       ON CONFLICT (email) DO UPDATE SET shifty_tenant_id = EXCLUDED.shifty_tenant_id
       RETURNING id, shifty_tenant_id;
       (users.email already has UNIQUE constraint per migration 0002 line 57 -- safe.)
    3. INSERT INTO app_user (tenant_id, email, locale, user_id)
       VALUES (...)
       ON CONFLICT (tenant_id, email) DO UPDATE SET user_id = EXCLUDED.user_id;
       (app_user UNIQUE (tenant_id, email) exists per migration 0002 line 73 -- safe.)

**Alternative fix (if user prefers):** add a new migration 0016 introducing `CREATE UNIQUE INDEX ... ON tenant(lower(name))` and keep the `ON CONFLICT (name)`. NOT recommended for W1 -- expands W1 scope beyond D-W1-02 and tenant.name uniqueness is not a domain requirement (Phase 02 has no such constraint).


---

#### B-2 -- Layer-2 CI gate will flag the W1 codebase's only legitimate tx.select() call site

**Where:** Task 6 step 6a defines DB_IDENTIFIERS = new Set(['db', 'tx']) (also baked into the research's Example 6 sketch). But the only call site in Task 5 that uses the new tenantScopedQuery is:

    // app/(authed)/shifts/page.tsx (Task 5g, line 536)
    const slots = await tenantScopedQuery(session, (tx) =>
      tx.select().from(shiftSlot).limit(50)
    );

The gate as written walks every CallExpression, sees tx.select(), walks up to the root identifier (tx), finds it is a parameter inside an arrow function passed to tenantScopedQuery -- not a top-level import from @/db/client -- and still flags it because the gate has no context about whether tx came from the boundary or from a parameter. app/(authed)/shifts/page.tsx is OUTSIDE the src/lib/tenant/ exempt prefix; the violation reports.

**Why this is a blocker:** Task 6 done text on line 586 explicitly says "pnpm test:check-tenant-isolation exits 0 against the W1 codebase". With the gate as specified, it exits 1 on shifts/page.tsx. The done criterion contradicts the implementation. Worse, the Task 6 done hand-waves this with "the gate must trace as a function call NOT containing a direct db chain" -- but the gate as sketched does NOT do that tracing; it only checks identifier names.

**Architectural truth:** tx in a tenantScopedQuery((tx) => ...) callback is, by construction, a transaction handle the caller did not produce -- it came from inside withTenantTx. The whole purpose of tenantScopedQuery is that calling code passes tx.select().from(...) and Layer 2 + Layer 5 are still upheld. Treating tx as forbidden outside the boundary cripples the API.

**Proposed fix to plan file** (Task 6 step 6a -- three options, planner picks one):

**Option A (cheapest, recommended):** Restrict DB_IDENTIFIERS to a single-element set with only "db". Justification: tx is only reachable via the tenantScopedQuery callback (which is what we want people to use); db.select() is the actual anti-pattern. The threat model is "someone reaches around the boundary by importing db from @/db/client" -- restricting to db covers that fully.

Edit: change the DB_IDENTIFIERS constant from a two-element set (db, tx) to a single-element set with only db.

Add a follow-on comment in the plan: "tx is intentionally NOT in DB_IDENTIFIERS -- a tx outside src/lib/tenant/ can only be reached via the tenantScopedQuery callback (the sanctioned boundary). The gate job is to prevent reach-around imports of db."

**Option B:** Keep tx in DB_IDENTIFIERS but add an exemption: when the tx.select() call is inside an arrow function that is the second argument of a CallExpression whose callee identifier is tenantScopedQuery or withTenantTx, do not flag. Structural-exemption path; more code but tighter.

**Option C:** Restrict to only db AND add a separate ESLint rule (or a second ts-morph check) that disallows raw "import tx" patterns or assigning tx from anywhere other than the tenant-helper callback. Most defensive; W1 overkill.

**Recommended:** Option A. The tx parameter pattern is the documented, sanctioned API; treating it as forbidden defeats the design.

Also fix the done text on line 586 to match: replace "the gate must trace as a function call NOT containing a direct db chain -- the gate scans the actual call expression, not the indirect helper" with "the gate flags db method calls (only); tx method calls inside a tenantScopedQuery callback are sanctioned and not scanned (this is the boundary contract)."

Concurrent observation: Task 6 6b and 6c name fixtures ok-inside-boundary.ts and bad-outside-boundary.ts -- both write db.select().from(shiftSlot) (using db, not tx). The OK fixture is OK because it is mounted inside the boundary. The fixtures already test the db case, not the tx case. With Option A, the fixtures cleanly cover the live threat (db reach-around). No fixture edits needed.


---

### Major (should fix; defer only with explicit decision)

#### M-1 -- Task 6 self-test mounting strategy is underspecified

**Where:** Task 6 6b: "for the self-test, the runner uses a temp project that re-roots the fixture to src/lib/tenant/probe.ts. (Implementation note: simplest is a fresh Project() per self-test invocation that mounts only the fixture file with a synthetic path.)"

**Why a problem:** The --self-test CLI flag in 6a runs the gate "against the two fixture files in tools/test/fixtures/tenant-isolation/". But the file path on disk is tools/test/fixtures/... which the gate tools/** exclusion rule (also in 6a) would naturally skip. So how does the self-test fail on the bad fixture? 6c hand-waves "mounted at synthetic path app/(authed)/dashboard/page.tsx" but neither 6a nor 6c describes the mechanism by which the gate consumes a synthetic-path mount. ts-morph Project.createSourceFile(path, content) lets you do this, but the plan does not name the API or describe the flow.

**Proposed fix to plan file** (Task 6 6a, append after the --self-test flag spec):

    The --self-test flag does NOT walk the filesystem normally. Instead it:
    1. Creates a fresh ts-morph Project with no tsConfigFilePath.
    2. Reads the two fixture file contents.
    3. Calls project.createSourceFile("src/lib/tenant/__probe.ts", okContent)
       and project.createSourceFile("app/(authed)/__probe/page.tsx", badContent).
    4. Runs the same scan loop over project.getSourceFiles().
    5. Asserts: exactly 0 violations on the OK-mounted file (under exempt prefix);
       exactly 1 violation on the BAD-mounted file (under app/(authed)).
    6. Exits 0 iff both assertions pass; exits 1 otherwise.

This way the on-disk path tools/test/fixtures/... is irrelevant -- the gate sees a virtual file tree shaped for the test.

**Severity rationale:** Major (not blocker) because the executor will figure it out from the research example, but it is the kind of underspec that produces ambiguous SUMMARYs and re-work loops. Spell it out.

---

#### M-2 -- Task 5 + Task 8 verify commands use Bash-only constructs on a PowerShell host

**Where:** Task 5 verify line 543 uses pnpm dev backgrounded with ampersand + sleep + curl piped through grep + kill of job 1. Also Task 8 8e first-run smoke checklist (similar shape).

**Why a problem:** CLAUDE.md says "Shell: PowerShell". Ampersand-background, kill of %1, &&-chain semantics, and grep are Bash. The executor bash-via-bash tool can run these, but if the executor is operating in PowerShell they will silently degrade or fail. The plan should be explicit about expected shell.

**Proposed fix to plan file** (Task 5 + Task 8 verify blocks): add a one-line note above each verify command: "Run in bash (Git Bash on Windows, or WSL); PowerShell equivalent uses Start-Process / Stop-Process and Invoke-WebRequest."

Or move the curl smoke into the integration test in Task 7 where Playwright handles it cross-shell. Latter is cleaner.

**Defer-with-decision option:** Leave as-is and rely on executor judgment -- D-09 says autonomous. Acceptable, but flag in SUMMARY.

---

#### M-3 -- Resend SDK side-effect verification has no automated path

**Where:** must_haves.truths line 95: "Submitting the form with a valid email writes a verification_tokens row and triggers a Resend SDK call (verified via SDK mock OR Resend onboarding dashboard)."

**Why a problem:** The Task 8 8e smoke checklist says "visible in Resend onboarding dashboard" -- that is manual eyeball verification, not in any verify block. Task 7 integration tests do not include auth-flow.spec.ts (the research "What W1 needs to add" listed this as a W0 gap but the plan does not add it). So the Resend-trigger truth is verifiable ONLY by manual smoke; if smoke is skipped, the truth is unverified.

**Proposed fix to plan file** (two options):

**Option 1 (preferred):** Add Task 7 7g -- tests/integration/auth-flow.spec.ts -- that monkey-patches the Resend SDK at test setup (or sets AUTH_RESEND_KEY to a known stub and uses a NODE_ENV equals "test" branch in sendHebrewMagicLink to record the call into a sink). Assert: form POST triggers sendVerificationRequest, verification_tokens row written. About 50 LOC; closes the truth automatedly.

**Option 2:** Re-classify the truth as "verified manually in Task 8 8e first-run smoke" and explicitly mark Task 8 8e as a checkpoint:human-action gate within W1. Acceptable but weaker.

**Defer-with-decision option:** Plan currently treats this as deferred-to-manual. Operator must capture the dashboard screenshot in SUMMARY. Acceptable for a first plan post-pivot given the alternative is a 60-minute extra integration-test task -- but DECLARE the deferral in the plan rather than leaving the truth half-covered.

---

#### M-4 -- Layer-5 negative-test for write-after-RLS not in Task 7

**Where:** Task 7 7b tests SELECT-without-tx returns 0 rows. The user prompt question 11 asks for a NEGATIVE test "Layer-5 RLS rejects writes outside the active tenant." Task 7 covers the read path; it does not cover the write path.

**Why a problem:** RLS USING-clauses on SELECT and WITH CHECK on INSERT/UPDATE are different policies in Postgres. Migration 0009 RLS policies on domain tables include both FOR SELECT USING and FOR ALL (which covers writes), but the active enforcement is only confirmed at read time by 7b. If a future change weakens the WITH CHECK clause, 7b would still pass but writes would leak. The user explicitly asked for write coverage.

**Proposed fix to plan file** (extend Task 7 7b or add 7b2):

    Test 5 (write probe):
    - Connect as shifts (auto-assumes shifty_app). No SET LOCAL.
    - Attempt INSERT INTO soldier (tenant_id, display_name) VALUES (
        UUID-of-real-tenant , Probe Soldier
      );
    - Assert: INSERT raises a Postgres error like "new row violates row-level
      security policy" OR returns 0 rows (depending on policy shape per
      migration 0009). Either way, the assertion is "no row visible at SELECT
      time afterwards" -- proves Layer 5 also blocks writes from a sentinel-
      tenant connection.

**Severity rationale:** Major because user explicitly requested it; not a blocker because the plan does cover the primary leak path (read). If executor adds it, about 15 LOC; if deferred, log the gap.

---

#### M-5 -- Founding-admin seed: collision under SEED_ADMIN_TENANT_NAME reuse

Already partially covered in B-1 fix above (the seed needs org_depth=1 to insert the tenant at all). Tracking separately: the plan should also note that if two different operators run pnpm seed:admin with the same SEED_ADMIN_TENANT_NAME but for different intended tenants, the script will silently reuse the first tenant id -- a footgun. Add a comment in 4h saying SEED_ADMIN_TENANT_NAME is the operator contract -- collisions reuse the existing tenant. To create a fresh tenant for a fresh admin, use a unique name (suffix with date or operator initials).

**Severity rationale:** Major -- will not fail W1, but adds tribal knowledge for W2 multi-tenant tests.


---

### Minor (informational; consider during execution)

#### N-1 -- tools/check-bb-queries.mjs does not exist; Task 6f DELETE is a no-op

**Where:** Task 6 6f: DELETE the dead tools/check-bb-queries.mjs + tools/test/check-bb-queries.test.mjs + tools/test/fixtures/check-bb-queries/ if they exist.

**Why:** Verified tools/ contains check-queries.mjs (Lowdefy-era) and test/, fixtures/, backup/ but NOT check-bb-queries.mjs (despite package.json referencing it on lines 11-13). The plan "if they exist" hedges the delete correctly. Note that Task 2 2a says "replace the existing root package.json wholesale" -- so the dangling script references in package.json get cleaned up automatically. Consistent.

**Action:** None. Flagged for executor awareness.

---

#### N-2 -- shadcn init may emit a tsconfig overlay

**Where:** Task 2 2l: "Critical: shadcn init may try to create a separate tsconfig or modify next.config.ts -- review the generated diff and reconcile with the specs above before committing."

**Why:** Plan calls this out as executor responsibility. This is the shadcn-init-reconciliation item the user flagged as one of the 6 deferred gaps. Adequately surfaced.

**Action:** None -- defer is sensible.

---

#### N-3 -- cross-tenant-leak.spec.ts mentioned in success_criteria but not in files_modified

**Where:** success_criteria line 777: tests/e2e/cross-tenant-leak.spec.ts (with cookie-name + baseURL updates) all pass.

**Why:** Task 7 7d updates tests/e2e/_fixtures/seed-tenants.ts (cookie-name) and 7e updates playwright.config.ts (baseURL). The cross-tenant-leak.spec.ts file consumes both. Frontmatter files_modified includes seed-tenants.ts and playwright.config.ts but NOT cross-tenant-leak.spec.ts -- correct because the spec is unchanged (only consumes the updated fixture).

**Action:** None. Confirming.

---

#### N-4 -- Drizzle 0.45 db.transaction shape is correct

**Where:** Plan 3d composes withTenantTx using db.transaction(async (tx) => { ... }) per the research Pattern 2.

**Why:** Drizzle 0.45 pg.PgDatabase#transaction accepts the callback as the first argument. The tx.execute(sql...) API is stable. Correct.

**Action:** None.

---

#### N-5 -- Atomic commit boundaries are sensible

**Where:** Plan does not call out commit boundaries explicitly. By task structure: Commit 1 = Task 1 (migration 0015 only); Commit 2 = Task 2 (scaffold); Commit 3 = Task 3 (Drizzle wiring); Commit 4 = Task 4 (Auth.js + seed); Commit 5 = Task 5 (middleware + routes); Commit 6 = Task 6 (Layer-2 gate); Commit 7 = Task 7 (tests); Commit 8 = Task 8 (Docker + compose + README).

**Why:** Sensible -- one logical change per commit, no mixed concerns. The seed script (Task 4h) is in commit 4 (with Auth.js) which is correct because it is part of the founding-admin bootstrap.

**Action:** None. User question 9 answered yes.

---

#### N-6 -- README 10-minute cold start

**Where:** Task 8 8d README "Getting started (local dev)" -- 7-step recipe.

**Why:** Recipe (cp .env.example to .env; docker compose up postgres; migrate; pnpm install; drizzle-kit pull; seed:admin; pnpm dev) is correct and complete IF the operator .env has Resend keys provisioned. The 10-minute target feels right for someone with all prereqs (Docker Desktop, pnpm, Node 22+). Could trip someone on Node 20.

**Improvement (minor):** Prepend a Prerequisites subsection with Node 22+, Docker Desktop, pnpm 9+, a Resend account.

**Action:** Defer to executor judgment -- trivial addition.

---

#### N-7 -- pnpm version pin in packageManager field

**Where:** Task 2 2a specifies packageManager pnpm@9.x.

**Why:** packageManager field expects a precise version (e.g., pnpm@9.15.0), not a range. Corepack will refuse pnpm@9.x and emit a warning or error depending on corepack version. Plan should specify an exact version.

**Action:** Trivial fix -- executor can patch on the fly. Note in SUMMARY.

---

#### N-8 -- Open Question deferrals (user question 10)

The 6 flagged gaps (Resend dev sandbox, ts-morph self-test, shadcn init reconciliation, founding-admin seed env var, Drizzle introspect quirks, no-commit-yet boundary):

- Resend dev sandbox -- adequately scoped (use onboarding@resend.dev for dev; flip to shifty@nesher.co post-domain-verification).
- ts-morph self-test -- partially addressed in 6a but the mounting mechanism is underspec'd. See M-1.
- shadcn init reconciliation -- flagged in 2l as executor responsibility. OK to defer.
- founding-admin seed env var -- addressed in 4h (SEED_ADMIN_EMAIL, SEED_ADMIN_TENANT_NAME). But B-1 must be fixed for the seed to work at all.
- Drizzle introspect quirks -- 3b says "Hand-fix any column-name oddities the introspect tool gets wrong by comparing against db/migrations/0002_up.sql and 0015_up.sql directly." Adequate deferral.
- No-commit-yet boundary -- Plan-Checker assumes this means executor decides commit timing. Plan implies one commit per task (see N-5). OK.

**Sign-off:** Of the 6 deferrals, 5 are sensible executor-judgment items; 1 (ts-morph self-test) deserves M-1 tighter spec.


---

## Per-question answers (user review checks)

| # | Question | Answer |
|---|----------|--------|
| 1 | Each task has unambiguous action/verify/files_modified? | YES with B-1 (Task 4) and B-2 (Task 6) fixes. |
| 2 | Critical path correct (Task 1 -> 3 -> 4 -> 5 etc.)? | YES -- migration -> scaffold -> Drizzle -> Auth.js -> routes -> gate -> tests -> Docker. Linear within W1; no parallel sub-tasks. |
| 3 | Goal-backward: every task executes -> verification block passes? | YES post-fix. See goal-backward table above. |
| 4 | 3 locked decisions honored? | YES. D-W1-01 (Auth.js v5 beta) -> 2b dep pin 5.0.0-beta.31 + 4a imports next-auth/providers/resend. D-W1-02 (migration 0015 users.shifty_tenant_id) -> Task 1. D-W1-03 (compose 8080:3000) -> Task 8 8b. |
| 5 | Tenant-isolation triple-layer wired across Tasks 3, 4, 5, 6? | YES (subject to B-2 fix on the gate). Layer 1: 4d session callback. Layer 2: 3e tenantScopedQuery + Task 6 gate. Layer 5: 3d withTenantTx + migration 0013 (pre-existing). The wiring graph in must_haves.key_links correctly chains middleware -> auth.config -> schema -> callbacks -> tenantScopedQuery -> withTenantTx -> Postgres. |
| 6 | Task 6 gate has negative-fixture? | YES (6c bad-outside-boundary.ts) -- but mechanism is underspec'd (M-1) and the gate identifier set is wrong (B-2). |
| 7 | Task 8 Dockerfile matches Next 15 standalone best-practice? | YES. Multi-stage, output standalone, node:22-bookworm-slim (NOT Alpine), non-root user, .next/standalone/ + .next/static/ + public/ only. Matches Vercel canonical example. |
| 8 | Any task that would silently no-op or be skipped? | Task 7 integration tests SKIP gracefully when DATABASE_URL is unset (7g). Intentional but means CI can pass without ever running them. Acceptable for W1 with explicit operator note. Otherwise no silent no-ops. |
| 9 | Atomic commit boundaries sensible? | YES. See N-5. |
| 10 | 6 flagged gaps sensible to defer? | 5/6 yes; 1/6 (ts-morph self-test) needs M-1 spec. |
| 11 | Sufficient tenant-isolation test coverage? | Positive (admin sees own tenant only): YES, 7a Tests 1+2. Negative (Layer-5 blocks writes outside active tenant): NO -- see M-4. Static (Layer-2 gate catches synthetic violation): YES, 7d gate self-test, but see B-2. |
| 12 | withTenantTx + SET LOCAL composed correctly with Drizzle 0.45 transaction API? | YES (3d). db.transaction(async (tx) => { await tx.execute(sql-SET-LOCAL); return fn(tx); }) is the canonical Drizzle 0.45 shape; SET LOCAL reverts on commit/rollback to the migration-0013 sentinel. The one sql.raw use is defensible (UUID regex-validated one statement above). |
| 13 | Migration 0015 has up + down + correct shifty_app grant? | YES -- Task 1 specifies both files; the up adds GRANT SELECT, UPDATE (shifty_tenant_id) ON users TO shifty_app explicitly; the down DROP COLUMN IF EXISTS is safe. |
| 14 | Founding-admin seed safe (idempotent, single env, migrator role for RLS bypass)? | RUNS-AS-MIGRATOR: YES (4h header comment). IDEMPOTENT: BLOCKED -- B-1 prevents the script from running at all. Once B-1 is fixed, the upserts in steps 2 + 3 are correctly idempotent. Single env: yes (SEED_ADMIN_EMAIL + SEED_ADMIN_TENANT_NAME). |
| 15 | README concrete enough for 10-min cold start? | YES (subject to N-6 -- prepend prereqs subsection). |

---

## Summary

| Severity | Count |
|----------|-------|
| Blocker | 2 (B-1, B-2) |
| Major | 5 (M-1, M-2, M-3, M-4, M-5) |
| Minor | 8 (N-1 through N-8) |

**Recommended action:** Return to planner with B-1 + B-2 + M-1 marked as required edits; M-2 through M-5 marked as recommended-with-fallback (planner may defer with explicit rationale in revision); N-1 through N-8 are FYI.

**Loop status:** First iteration. Per revision-gate convention, allow up to 3 iterations before escalating; current expected delta is small (two textual fixes for blockers + one spec tightening for the major).



---



## Round 2 review



**Checked:** 2026-05-18 (revision 2)

**Plan reviewed:** .planning/phases/03-availability-rules/03-W1-PLAN.md (revised in place)

**Reviewer:** gsd-plan-checker, round 2, FORCE stance preserved



### Verdict



**Status:** pass_with_warnings


**Rationale:** Both round-1 blockers (B-1 seed schema, B-2 gate identifier set) are correctly and completely fixed. B-1 self-verifying assertion plus the SELECT-then-INSERT pattern reads cleanly against migration 0002; B-2 reduced DB_IDENTIFIERS to a one-element set, and the new sanctioned-tx-callback positive fixture closes the false-positive surface end-to-end. Four of five round-1 majors (M-1 ts-morph mounting, M-2 shell portability, M-3 Resend builder split plus deferral declaration, M-5 seed env var footgun) are fixed concretely with named APIs, explicit assertions, and copy-paste-ready code. The fifth (M-4 Layer-5 write probe) is correct in concept (migration 0009 line 100-103 confirms the WITH CHECK clause; the cross-tenant plus same-tenant test pair is sound), but the example INSERT SQL embedded in Task 7 step 7c has a schema mismatch against migration 0003 line 11-25 that will cause the test to fail for the wrong reason if the executor copy-pastes it verbatim. This is a new warning (W-R2-01), not a blocker; the executor should catch and fix it during 7c implementation. No regressions in atomic-commit boundaries, critical path, locked decisions, or files_modified. No invisible Unicode anywhere. Executor is unblocked.

### Per-finding sign-off

| Finding | R1 severity | Fix location | Verified concrete? | Status |
|---------|-------------|--------------|--------------------|--------|
| B-1 -- Seed schema mismatch (ON CONFLICT(name), missing org_depth) | blocker | Task 4 step 4h lines 570-618; artifacts line 163-165 | YES -- SELECT-then-INSERT with org_depth=1; ON CONFLICT(email) for users; ON CONFLICT(tenant_id,email) for app_user; self-verifying SELECT-IS-NOT-NULL assertion at lines 607-618. Cross-checked against migration 0002 (no UNIQUE on tenant.name; org_depth NOT NULL CHECK BETWEEN 1 AND 3; users.email UNIQUE; app_user UNIQUE(tenant_id,email)). | FIXED |
| B-2 -- Gate flags sanctioned tx callback | blocker | Task 6 step 6a line 721; step 6c-new lines 761-773; done lines 795-797 | YES -- DB_IDENTIFIERS reduced to a one-element set with rationale comment lines 703-720. New sanctioned-tx-callback.ts fixture defined inline; self-test asserts 0 violations on it (line 749); fixture listed in files_modified line 58 and must_haves.truths line 107. | FIXED |
| M-1 -- ts-morph self-test mounting underspecified | major | Task 6 step 6a-selftest lines 733-750 | YES -- named API project.createSourceFile(path, content) at line 743; three synthetic mount paths enumerated lines 740-742; three assertions enumerated lines 747-749. | FIXED |
| M-2 -- Bash-only verifies on PowerShell host | major | shell_portability block lines 338-345; all 8 verify blocks; tools/verify/smoke-login.mjs in Task 5 step 5h | YES -- exhaustive scan of automated verify blocks confirms only semicolon separators, pnpm scripts, docker compose, and node -e assertions with double-quoted strings. Zero ampersand-backgrounding, zero kill-job-1, zero test-f-file, zero grep-q, zero stderr-redirect-to-devnull in any verify block. The only kill or grep references in the file are inside commentary describing what NOT to use. | FIXED |
| M-3 -- Resend SDK no automated test | major | Task 4 step 4c lines 500-510 (split builders); step 4c-test lines 511-525 (new unit test); truths line 102 (deferral declaration) | YES -- buildMagicLinkHtml plus buildMagicLinkText exported as pure functions (no SDK import); sendHebrewMagicLink is a separate SDK wrapper. New tests/unit/auth-resend-template.spec.ts imports the pure builders only (line 513) and asserts Hebrew default plus English fallback plus URL placeholder plus U+200F RLM in plaintext. Deferral is explicit in must_haves.truths: SDK HTTP call verified manually in 8e smoke against the Resend onboarding dashboard, declared deferred-to-manual per M-3 Option 1+3 hybrid. | FIXED |
| M-4 -- Layer-5 write probe missing | major | Task 7 step 7c lines 821-850; tests/integration/layer5-rls-write-probe.spec.ts | PARTIAL -- concept correct (cross-tenant INSERT against shift_slot while app.current_tenant set to a different tenant), error code 42501 correct, same-tenant control case present, WITH CHECK exists at migration 0009 line 100-103. BUT example SQL at plan lines 831-832 has schema mismatch -- see W-R2-01. | FIXED (concept) / WARNING (example SQL) |
| M-5 -- SEED_ADMIN_TENANT_NAME footgun | major | Task 4 step 4h lines 562-566; Task 8 step 8c lines 922-933; README step 1 lines 944-947 | YES -- env required, no default, exit 2 with stderr message on missing. .env.example has footgun comment: re-runs with the SAME name REUSE the existing tenant (this is by design; tenant.name is NOT a unique key). README step 1 calls out the operator contract. | FIXED |

### New warnings introduced by revision

#### W-R2-01 -- Task 7c example INSERT SQL has schema mismatch against shift_slot

**Where:** Task 7 step 7c lines 831-832 -- the example INSERT references columns that do not match the live shift_slot schema.

**Why a warning (not a blocker):** Cross-referenced against migration 0003 line 11-25, shift_slot requires team_id UUID NOT NULL REFERENCES org_unit(id) -- the example INSERT omits it, which will raise Postgres error code 23502 (not_null_violation) BEFORE the RLS WITH CHECK clause fires at 42501. Additionally, shift_slot has NO weekday column -- including it raises 42703 (undefined_column). If the executor copy-pastes this SQL verbatim, the test will fail with the wrong error code; the assertion expecting 42501 never matches, and the regex against the RLS-violation message also fails (the actual error will be about null violation or undefined column). The test would fail-fail (correctly failing, but for the wrong reason).

**Why not a blocker:** The test concept and pattern are correct; migration 0009 WITH CHECK clause is a real policy that will fire if the executor crafts a valid INSERT. An attentive executor checking the schema during implementation will catch this in under 5 min. The Wave 1 codebase has not shipped the test yet; correction is a one-line edit during Task 7 execution.

**Fix during execution (executor responsibility):** Replace the example INSERT with the shift_slot columns that actually exist (tenant_id, team_id, name, start_time, end_time, headcount), and seed an org_unit row for tenantB in the beforeAll setup. Alternative: probe a simpler table like app_user which has fewer NOT NULL columns; but shift_slot matches the test narrative.

**Reference:** migration 0003 line 11-25 (shift_slot schema), migration 0009 line 100-103 (tenant_isolation policy USING plus WITH CHECK).

### Regression checks (none broke)

| Check | Status | Notes |
|-------|--------|-------|
| Atomic commit boundaries unmuddied | PASS | Task 1-8 still partition cleanly; new files (smoke-login.mjs in Task 5; sanctioned-tx-callback.ts in Task 6; layer5-rls-write-probe.spec.ts in Task 7; auth-resend-template.spec.ts in Task 4) each land in the natural commit. |
| Critical path unchanged | PASS | success_criteria line 1047: 1 -> 2 -> 3 -> 4 -> 5 -> (6 parallel 7) -> 8. Same as round 1. |
| 3 locked decisions honored | PASS | D-W1-01 in Task 2 step 2b plus Task 4 step 4a; D-W1-02 in Task 1 plus Task 4 step 4b; D-W1-03 in Task 8 step 8b. |
| LOC estimate update sane | PASS (slightly under) | +150 LOC declared. Actual additions estimated: smoke-login.mjs ~60, auth-resend-template.spec.ts ~80, layer5-rls-write-probe.spec.ts ~100, sanctioned-tx-callback.ts ~15, seed script rewrite ~30 net, shell_portability block ~10. Closer to ~250 LOC delta than ~150. Acceptable underestimate; not flagging. |
| 4 new files in files_modified | PASS | tools/verify/smoke-login.mjs (line 60), sanctioned-tx-callback.ts (line 58), layer5-rls-write-probe.spec.ts (line 63), auth-resend-template.spec.ts (line 65). All four present. |
| pnpm@9.15.0 exact pin (N-7 carry-over) | PASS | Task 2 step 2a line 381: packageManager pnpm@9.15.0 (NOT pnpm@9.x -- corepack refuses range specifiers). Done-block line 431 also asserts it. |
| Invisible Unicode removed (RLM/LRM/ZWSP/BOM/NBSP) | PASS | Programmatic scan: 0 occurrences of any of the 5 invisible codepoints across the entire plan file. |

### Goal-backward re-check

All 14 truths from must_haves.truths (lines 99-112) now have a concrete covering task with a runnable verify path. Critically:

| Truth | Covering task | R2 status |
|-------|---------------|-----------|
| pnpm dev boots on :3000 | Task 2 verify plus Task 5 verify (via verify:smoke-login) | PASS |
| /login renders Hebrew RTL on 375px viewport | Task 2 plus Task 5b | PASS |
| Hebrew RTL email template unit-tested | Task 4c-test (new, M-3) | PASS |
| Form submit plus Resend SDK trigger | Task 4 plus manual 8e (M-3 declared deferred) | PASS (deferral honored) |
| Magic-link click sets cookie plus sessions row | Task 4 plus manual 8e | PASS (deferral honored) |
| session.user.shiftyTenantId populated | Task 1 plus Task 4b plus Task 4h (B-1 fixed) | PASS |
| /shifts runs tenantScopedQuery | Task 5g plus B-2 fix | PASS |
| test:check-tenant-isolation exits 0 | Task 6 plus B-2 fix | PASS |
| Sanctioned-tx-callback NOT flagged | Task 6 step 6c-new plus 6d test 3 | PASS (new positive fixture covers it) |
| pnpm build produces standalone | Task 2 plus Task 8 | PASS |
| docker compose build nextjs-app | Task 8 | PASS |
| Migration 0015 applied; psql column visible | Task 1 | PASS |
| Layer-5 READ probe returns 0 rows | Task 7b | PASS |
| Layer-5 WRITE probe raises 42501 | Task 7c (M-4) | PASS (concept) -- W-R2-01 flags example SQL |

### Summary

| Severity | R1 count | R2 count | Delta |
|----------|----------|----------|-------|
| Blocker | 2 | 0 | -2 |
| Major | 5 | 0 | -5 |
| Warning (new in R2) | 0 | 1 (W-R2-01) | +1 |
| Minor | 8 | 8 (unchanged) | 0 |

**Recommended action:** Executor proceeds with /gsd:execute-phase 03 W1. W-R2-01 is a ~5-line fix during Task 7 implementation -- executor should verify the shift_slot INSERT shape against migration 0003 before writing tests/integration/layer5-rls-write-probe.spec.ts, and seed an org_unit row alongside the tenant in the beforeAll. No further plan revision is required.

**Loop status:** Iteration 2 of 3 (cap). Verdict resolved; no further revision needed.

