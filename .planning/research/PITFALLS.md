# Pitfalls Research

**Domain:** Multi-tenant Hebrew-first workforce scheduling SaaS (Israeli miluim reserve units) — Lowdefy + Postgres + OR-Tools CP-SAT solver + multi-channel notifications (Email/WhatsApp/Web Push/in-app), self-hosted on a single Windows 11 desktop, public via Cloudflare Tunnel.
**Researched:** 2026-05-12
**Confidence:** HIGH for ecosystem-specific findings (Lowdefy+pnpm, CP-SAT, WAHA, Outlook RTL — all corroborated by primary issue trackers and primer documentation); MEDIUM for the precise contingency thresholds (those are recommendations, not industry constants).

**Scope of this file:** This is **not** a duplicate of PRD §15. It extends the risks register with domain failure modes that are either (a) sub-pitfalls of an existing PRD risk that need to be made concrete before phase planning, or (b) entirely new failure modes the PRD does not enumerate. Every pitfall here maps to a phase from PROJECT.md "Active" requirements.

Phase shorthand used below:
- **F** = Foundations (Lowdefy runtime, tenancy, auth, RBAC, schema)
- **O** = Org & people / Roster CSV import
- **A** = Availability & rules
- **S** = Solver service (FastAPI + CP-SAT)
- **L** = Schedule lifecycle (draft/publish/override)
- **W** = Swap workflow
- **TC** = Time clock
- **N** = Notifications (Resend/WAHA/Push/in-app)
- **R** = Reports + cron
- **D** = Dashboard
- **E** = Exports (iCal/CSV/PDF)
- **I** = i18n / RTL
- **M** = Tenant #1 migration from Google Sheet
- **OPS** = Single-host hpg5 operations (cross-cutting)

---

## Critical Pitfalls

### Pitfall 1: Lowdefy runtime stays broken indefinitely — no stop-the-bus contingency

**What goes wrong:**
The `ERR_MODULE_NOT_FOUND` blocker against `@lowdefy/helpers-<hash>` (documented in `CLAUDE.md`) keeps recurring after each "fix attempt" because the root cause is pnpm's symlink layout fighting with Next.js standalone output across a multi-stage Docker COPY. The same failure pattern is the #1 documented Next.js + pnpm + Docker issue (`vercel/next.js#48017`, `#65636`, `#50072`). Without a hard contingency, the team spends weeks iterating on Dockerfile changes while every other phase (solver, notifications, exports) waits.

**Why it happens:**
- pnpm places a package's dependencies as **siblings** under `node_modules/.pnpm/<pkg>@ver/node_modules/<pkg>`, accessed via symlinks. `@vercel/nft` (Next's file tracer) captures the symlink graph but copying it across Docker stages breaks relative-path resolution.
- Lowdefy's build emits a Next.js standalone bundle at workspace root, but Lowdefy creates an inner `pnpm-lock.yaml` under `.lowdefy/server/`, so Next thinks the workspace root is the inner directory. The "tracedFiles" list misses transitive deps.
- The community wisdom (per `dev.to/kochan` and the linked Next.js discussions): there is **no elegant fix** — the reliable approach is a shell post-step that resolves symlinks at the original location before copying.
- Lowdefy 5.3 is a small, still-niche project. Its Docker reference may lag the pnpm symlink mitigations Next.js has shipped.

**How to avoid:**
- **Time-box the Lowdefy runtime fix to 5 working days** from the start of Phase F. Track three parallel attempts: (a) `output: 'standalone'` with corrected workspace root; (b) Node flags `--preserve-symlinks --preserve-symlinks-main`; (c) the Lowdefy published Dockerfile verbatim with `.lowdefy/server/` path adjustments; plus (d) a shell-based symlink-resolution post-step that copies real files (not symlinks) into the runtime stage.
- **At day 5: hard checkpoint.** If no fix renders the home page server-side without `ERR_MODULE_NOT_FOUND`, escalate to one of two contingencies:
  1. **Switch to npm or yarn** in `app/package.json`. pnpm is not a Lowdefy requirement — Lowdefy uses pnpm internally for its workspace, but the consumer install can be npm. This sidesteps the symlink class of bug entirely. Trade-off: slower CI installs.
  2. **Switch off Lowdefy.** The PRD says Lowdefy is locked (§1), but a phase-blocking runtime defect is grounds to re-open with the user. The viable replacement that preserves "config-as-code, no paywall, Apache-2.0" is a hand-rolled **Next.js + Auth.js + Postgres** app — higher effort but no platform risk. NocoDB is an Airtable-shaped fallback that loses the "free-form builder" property but ships immediately.
- **The Phase F definition of done MUST include "Lowdefy SSR boots the employees-list page with a live Postgres row visible"**, not just "container starts." A container that exits 1 after first request is not "running."

**Warning signs:**
- `docker logs shifty-lowdefy` shows `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@lowdefy/helpers-<hash>'` after the first HTTP request.
- The build succeeds but `curl http://hpg5:8080/` returns 500 or hangs.
- Day 3 of the fix attempt finds another hashed-package error after fixing the previous one (whack-a-mole pattern means the COPY graph is fundamentally wrong — switch contingency).
- A Lowdefy GitHub issue search for `@lowdefy/helpers` and `ERR_MODULE_NOT_FOUND` shows similar unresolved reports — confirms this is platform-level, not a local config bug.

**Phase to address:** **F (Foundations)** — first task, first week.

**Severity:** Critical. This is the bus factor of the whole project. The 5-day budget is a forcing function.

---

### Pitfall 2: Tenant-isolation layer that "looks safe" because a Lowdefy operator silently masks a missing filter

**What goes wrong:**
PRD §8.3 prescribes a four-layer defense (session tenant_id → query filter → page auth → request server-side role check). In a YAML-driven platform, **a single misconfigured operator can break all four layers at once.** Concrete failure modes:

- A list page query reads `SELECT * FROM soldier WHERE team_id = {{event.params.team_id}}` — no `tenant_id` filter. The dev assumes "team_id is unique across tenants because UUID." It is — but a manager from tenant B who guesses tenant A's team UUID (or whose URL is forwarded) sees the data. The query is structurally tenant-scope-blind.
- A Lowdefy `_payload` or `_request` operator concatenates results from two queries — one tenant-scoped, one accidentally not — and renders the merged list. The mistake is invisible in YAML review because each individual query "looks right."
- A page's `properties.auth` block declares `roles: [team_manager]` but checks the role in the **rendered page context**, not on every mutation request. A soldier crafts a `formAction` POST directly to the request URL and bypasses the page guard.
- A `request` block's `properties.auth: { public: false, roles: [admin] }` looks server-enforced, but Lowdefy 5.x evaluates some auth conditions client-side when expressions reference `_user`. If an attacker overrides `_user.role` in DevTools, the request fires.
- On first signin via magic link, the session is created **before** the `membership` row is fully written. A race window allows a query to fire with a session that has no `tenant_id` claim — and the query, gracefully handling NULL, returns rows from ALL tenants because `WHERE tenant_id = NULL` evaluates to NULL (not false) for a poorly written predicate.
- The dev uses a connection pooler with `SET tenant_id = ...` (instead of `SET LOCAL`); the variable persists across pooled connections and the next request sees the wrong tenant.

**Why it happens:**
- YAML feels safer than code, but a typo or missing key fails open, not closed. There is no compiler.
- Lowdefy has no native Postgres RLS integration — every isolation rule is enforced in app code.
- Reviewers grep for `tenant_id` and see hits; they don't notice the **missing** ones.
- The PRD's four-layer defense is correct in principle but every layer is opt-in per query/page/request.

**How to avoid:**
- **Layer 0: Postgres-level RLS as the bottom safety net.** Even though PRD §15 R4 flags RLS as "second layer once Lowdefy supports it cleanly," enable it from day one regardless. Pattern: `ALTER TABLE soldier ENABLE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON soldier USING (tenant_id = current_setting('app.tenant_id')::uuid);`. The Lowdefy connection sets `app.tenant_id` via `SET LOCAL` at the start of each transaction, derived from `_user.tenant_id`. If a query forgets the WHERE clause, RLS catches it.
- **CI grep gate:** `tools/check-queries.mjs` parses every `*.yaml` in `app/` and FAILS the build if any `request: { type: PostgreSQLQuery }` block's `where`/`args` doesn't contain `tenant_id` (or doesn't go through a tenant-aware view). Whitelist exceptions are explicit comments.
- **Pen-test harness:** Playwright fixture that runs every page as user-from-tenant-B with `?tenant_id=<A>` URL overrides and asserts 403. The fixture must be part of pre-release blocking tests, not "nice to have." PRD G5 demands zero leaks; encode it.
- **Smart-quote canary in CI:** the kibbutz fixture seeds one soldier with U+2019 in display_name; every integration test must successfully count that soldier in tenant-scoped aggregates and find them via UUID-only joins.
- **Session race: write membership row first, mint JWT second.** Auth.js's `jwt` callback should refuse to return a token without a verified `tenant_id` claim — return an error that forces a re-signin (better UX than silently broken).
- **No client-side auth expressions in `request.properties.auth`.** Every mutating request uses a server-evaluated role check that references the JWT claim, never `_user` in browser context.
- **Connection pooling:** use `SET LOCAL` exclusively. Document in `app/connections/*.yaml`.

**Warning signs:**
- Code review reveals a Lowdefy request block with `WHERE id = {{event.params.id}}` and no `AND tenant_id = {{_user.tenant_id}}`. This is the canonical bug; failing CI immediately when found is the goal.
- An integration test names like `test_cross_tenant_leak_<entity>` returns a row.
- Postgres logs show queries without `app.tenant_id` set (`SHOW app.tenant_id;` returns empty). Add a log_statement = mod policy in staging to surface this.
- A user logs in for the first time and the first page request errors with "no tenant_id in session" — that's the race window firing **defensively**, which is the desired state.

**Phase to address:** **F (Foundations)** — RLS migration in 0002; CI gate scaffolded in 0002–0003; pen-test harness lands with first list page in F. Extended into every subsequent phase (every new page/query must pass the gate).

**Severity:** Critical. Extends PRD R4 with concrete failure modes and adds a Postgres RLS bottom layer the PRD currently defers.

---

### Pitfall 3: CP-SAT solver becomes infeasible-by-default once all 8 rules are active — and the "offending rules" report is useless

**What goes wrong:**
The PRD's 8-rule catalog (§7.6) is feasible in theory but **collectively over-constrained** for many real rosters. Specific landmines:

- `max_consecutive_nights=3` + `weekend_separation=true` + `min_rest_hours_between_shifts=8` + 12-soldier roster on 2×12h shifts → the solver returns `infeasible` for any window longer than ~10 days. The user's actual prior-art sheet has 12 soldiers. Phase 1 ships infeasible.
- The PRD-mandated `infeasibility_report.offending_rules` field is **a list of rule names** (per §7.8 schema), e.g., `["max_consecutive_nights", "min_rest_hours_between_shifts"]`. This does NOT tell the manager WHICH SOLDIER on WHICH DATE caused the bind. A list of names is the kind of report that "looks done but isn't" — the manager can't act on it without manually re-running the solver with one rule disabled at a time.
- **Variance-based fairness objective dwarfs hard constraints when scaled wrong.** If the objective sums squared deviations × 1000 (to stay integer for CP-SAT) but a soft-converted constraint penalty is × 1, the solver will violate the soft constraint to chase a fractional fairness improvement. PRD §7.6 keeps fairness as objective and rules as hard constraints — good — but a future "make this rule soft" change without re-thinking scales will silently break.
- **Soft-converting hard rules to escape infeasibility blows up solve time.** A tempting fix when `max_consecutive_nights` causes infeasibility is to make it soft (penalty + objective). For 30×30 problems, this multiplies the search space and times out at `max_seconds=10`.
- **Determinism breaks when `num_search_workers > 1`.** OR-Tools documents this: parallel search is non-deterministic by default (`google/or-tools#3590`). The PRD asserts "same seed = same output." If the Docker image picks up multiple cores, a re-solve produces a different schedule, breaking the "reproducibility for debugging" promise.
- **Input ordering matters for tiebreaks.** If `soldiers` array order is non-canonical (e.g., dict iteration in Python <3.7 or hash-set semantics), two identical-from-the-DB inputs hash differently and the solver returns different "optimal" schedules. Two solver runs from the same draft show different assignments.

**Why it happens:**
- CP-SAT is integer-only. Mixing a fairness-variance objective (scaled × 1000) with constraint penalties (scaled × 1) is a classic numerical gotcha (per CP-SAT Primer).
- Workforce-scheduling tutorials don't surface that "minimum rest 8h + max consecutive nights 3" is genuinely tight at 12-soldier scale.
- The PRD's `offending_rules` field schema permits a vague answer — names without coordinates.
- The platform-default `num_search_workers` is auto-detect; without explicit `params.num_search_workers = 1`, parallel search engages on multi-core hpg5.
- Python dict iteration is insertion-order since 3.7, but JSON parsing from FastAPI may produce a different order than what Postgres ORDER BY returned; the test fixture passes locally and fails in CI.

**How to avoid:**
- **Phase S definition of done includes "kibbutz fixture (12 soldiers, 64-day window, all 8 rules with PRD defaults) returns `optimal` or `feasible` in <10s."** If it returns `infeasible` against the PRD-default rule values, the rules' defaults need re-tuning BEFORE shipping, not after. The user's actual data is what tenant #1 will see on day one.
- **Promote `infeasibility_report` from "rule names list" to "explicit conflict locator":** every infeasible response includes `offending_rules: [{rule_name, affected_soldier_ids[], affected_dates[], explanation_he}]`. Implement via CP-SAT's assumption mechanism — encode each rule as a boolean assumption and use `solver.SufficientAssumptionsForInfeasibility()` to extract a minimal unsat core (per `google/or-tools` discussion). This is the **only** UX that makes infeasibility actionable for a non-technical מפקד.
- **Explicit determinism config:** `solver.parameters.num_search_workers = 1` in the FastAPI service. Document the trade-off (single-threaded means slower at scale; v1 traffic is low so acceptable). When v1.1 needs parallelism, switch to `interleave_search = True` with a fixed `interleave_batch_size`, which the OR-Tools team confirms is deterministic even with multiple workers.
- **Canonical input ordering before solving:** sort `soldiers` by UUID, `shift_slots` by (display_order, id), `availability` by (soldier_id, date, slot_id) **inside the solver service**, regardless of what Lowdefy sends. Belt-and-suspenders: also sort in Lowdefy's request-building query (`ORDER BY id`).
- **Never soft-convert a hard rule without a 30-day window load test.** Document this rule in a `solver/README.md` and tag commits that touch the rule encoding with this constraint as a checklist.
- **Hard constraints get integer coefficients in `[1, 100]`; the fairness objective scales to `[1000, 100000]` so a single rule violation always dominates a fairness improvement.** Numerical scaling chart pinned in `solver/README.md`.

**Warning signs:**
- `solver_run.status='infeasible'` rate > 30% in the first week against real tenants. Either rules are too tight or the offending-rules report isn't being used to relax.
- Two consecutive `solver_run` rows with identical `request_payload` and identical `random_seed` have different `assignments`. Determinism broke — likely `num_search_workers` is not 1.
- A manager files a support ticket saying "I disabled `weekend_separation` and now it solves but I don't understand why" — the report didn't tell them, they trial-and-errored.
- p95 solve time creeps from 2s to 9s after a "small change" — usually a hard→soft constraint conversion. Check git diff for `Add(<bool>)` becoming `AddImplication` or a new `solver.Minimize` term.

**Phase to address:** **S (Solver service)**. The fixture-feasibility check is a Phase-S gate. The assumptions-based infeasibility report extends solver scope; budget extra time.

**Severity:** High. Extends PRD R1 and R9 with concrete failure modes and a far stricter bar for the "offending rules" UX than the schema currently mandates.

---

### Pitfall 4: WAHA's WhatsApp session drops silently, soldiers stop receiving swap notifications, and the swap queue stalls invisibly

**What goes wrong:**
PRD R2 acknowledges WAHA session drops. The concrete failure modes that R2 underdescribes:

- The same phone number used for **personal WhatsApp Web on the user's laptop** and **WAHA on hpg5** triggers WhatsApp's one-active-Web-session-per-number rule. Opening WhatsApp Web on the laptop kicks WAHA out. WAHA reports session DOWN. Soldiers stop receiving notifications. **The user themselves is the most likely cause of WAHA drops** because the user IS a soldier on tenant #1.
- WAHA is **stateful** (per its docs) — the WhatsApp session is held in the container's runtime. A Docker Desktop auto-restart (e.g., after a Docker engine update on Windows) wipes the session. Without `WHATSAPP_RESTART_ALL_SESSIONS=true`, the container starts but no session is active; admin must re-pair via QR.
- WhatsApp rate-limits at the account level. The documented "safe outbound rate for a fresh number is well under 20 messages/minute." Shifty's `schedule.published` event fans out to 12 soldiers in 12 messages; that's fine. But `availability.lock_approaching` to 30 soldiers across 3 channels (email + WhatsApp + in-app) sends 30 WhatsApp messages in one cron tick — flirting with rate-limit territory. Repeat across multiple tenants on the same WAHA instance and account ban becomes plausible.
- WAHA's `/api/sendText` returns 200 on accept-into-queue, not delivery. The PRD's `notification_log.status = 'sent'` should NOT be set on a 200 — it should be set on the WAHA webhook callback for delivery (per WAHA docs). If `status='sent'` is set on the HTTP 200, delivery failures (number not on WhatsApp, account blocked the sender, etc.) never propagate to the audit log.
- An admin "reconnects" WAHA via QR, but Shifty's PRD says "no QR-based session management automation in v1" — the in-app banner needs to direct the admin to the WAHA container's web UI (which is not exposed publicly). If WAHA's UI port isn't exposed on the docker network internally with a tunnel-by-Lowdefy or a separate localhost binding, the admin has no way to scan the QR.

**Why it happens:**
- WhatsApp's "Web/Linked Device" model is single-active-session-per-number by design.
- WAHA is an **unofficial** HTTP gateway (per WAHA's own docs and security writeups) — every connection method (WEBJS, NOWEB, GOWS) is a reverse-engineered WhatsApp Web client.
- "Sent" semantics are easy to get wrong without an explicit webhook-driven status transition.
- WAHA web UI / QR pairing flow is undocumented for the "exposed publicly via Cloudflare Tunnel" use case.

**How to avoid:**
- **Use a phone number dedicated to WAHA**, not the user's personal number. Document this in `docs/OPERATIONS.md` as a hard prerequisite for Phase N. Buy a cheap second SIM or use an iMessage-free number. This sidesteps the "user kicks out WAHA" failure mode entirely.
- **Set `WHATSAPP_RESTART_ALL_SESSIONS=true` and `WAHA_AUTO_START_DELAY_SECONDS=15` in `.env`** so sessions auto-resume across restarts.
- **WAHA web UI: expose on a private port via Tailscale only**, not via the public tunnel. The user already runs Tailscale to hpg5; binding WAHA UI to `100.92.65.46:3001` and connecting from the user's laptop is the QR-scan path. Document this in `docs/OPERATIONS.md`.
- **`notification_log.status` transitions:** `queued` → (on HTTP 200 from WAHA) `accepted` → (on WAHA webhook delivery event) `delivered` OR `failed`. Never use `sent` to mean "we made the HTTP call." This requires adding the WAHA inbound webhook receiver `/api/webhook/waha` (already in PRD §11.1) but actually consuming the message-status events, not just the session-status events.
- **WAHA session health check as a cron task, NOT polled per-notification:** every 5 minutes the cron service hits WAHA's session-status endpoint; if status is not `WORKING`, fire `waha.session_down` (PRD event catalog §7.11) ONCE — but also set a flag in Postgres so subsequent notifications fail fast (`notification_log.status='failed', provider_response='WAHA_SESSION_DOWN'`) without burning the 3-retry budget on a dead service.
- **Per-tenant rate-limiter on WAHA dispatch:** max 15 messages/minute per WAHA instance, queued. Above that, defer to next minute. Avoids account-ban territory at scale (multiple tenants on one WAHA instance).
- **Document acceptance of the residual risk in `docs/OPERATIONS.md`:** "WhatsApp may ban the WAHA-attached number. If banned, replace the number, re-pair WAHA, all soldiers re-confirm their channel preference. Email channel always delivers regardless."

**Warning signs:**
- WAHA logs (`docker logs shifty-waha`) show `Session disconnected` or `WhatsApp logout` messages.
- `notification_log` table shows a streak of `failed` rows with `provider_response` containing `not_authorized` or `session_not_found`.
- `notification_log` shows many `sent` rows but no follow-up `delivered` rows — the webhook isn't firing or isn't being consumed.
- A soldier reports "I never got the swap notification" and `notification_log` confirms the dispatch as `sent` — investigate the sent-vs-delivered semantic.
- WAHA `WHATSAPP_RESTART_ALL_SESSIONS` env var is missing from `.env` after a deploy; the next restart breaks the session.

**Phase to address:** **N (Notifications)**, with dependencies in **OPS** (Tailscale-bound UI port, dedicated phone number).

**Severity:** High. PRD R2 calls likelihood "High" already; this extends it with specific causes and adds the rate-limit and sent-vs-delivered failure modes.

---

### Pitfall 5: Hebrew display bugs from Bidi mixing — names rendered, names typed, names sorted, names emailed

**What goes wrong:**
PRD §8.5 covers the obvious (locale-driven `dir="rtl"`, ICU MessageFormat, date format per locale). Hebrew bugs that bite anyway:

- **Bidi text mixing in cells.** A list cell shows "דני כהן · dani.cohen@example.il" — Hebrew followed by an LTR email. The Unicode BiDi algorithm sees the punctuation between them as a "weak" character; depending on the surrounding base direction, the dot and the email may render in the wrong logical position. Result: the email appears to belong to a different soldier in the table. Real bug class, hard to reproduce without test data.
- **Date-range "from 14/05/2026 to 21/05/2026" in a Hebrew sentence.** The slashes within dates are weak chars. Inserted into an RTL paragraph, the date order may swap visually (the day and year flip). Solver/UI computes correctly; the manager sees wrong dates.
- **Hebrew sort order in Postgres is locale-dependent.** A default `text` column with `en_US.UTF-8` collation sorts Hebrew strings by Unicode codepoint (i.e., by encoding order), NOT by alphabetic order. List queries `ORDER BY display_name` show soldiers in a non-Hebrew-alphabetic order, breaking the user's intuition that "the list is sorted." The fix is `COLLATE "he-x-icu"` (Postgres 12+ ICU collation) on the column, or `ORDER BY display_name COLLATE "he-x-icu"` per query.
- **CITEXT for case-insensitive search loses Hebrew niqqud (vowel marks) and final-form characters.** A search for "כהן" doesn't match "כהן" with a stray niqqud. The PRD doesn't mandate CITEXT; if added later for invite-code or email matching, it's an English-only safety. For Hebrew names use a nondeterministic ICU collation, not CITEXT.
- **CSV import: hidden RLM/LRM chars in pasted-from-Word names.** A manager pastes a roster from Word; some names have invisible U+200F (RLM) bytes glued on. The `display_name` looks identical visually but UUID is a separate column so joins are safe — UNTIL a search-by-name autocomplete on the "duplicate detection" path fails to match. Result: duplicates not detected on CSV re-import.
- **Outlook's email-body RTL rendering bugs (PRD R5 acknowledges):** Outlook 2013/2016/2019 + Windows 10 Mail show a 1px vertical line on cells with `dir="rtl"` + padding. Mac Outlook 16.102.1 reportedly breaks RTL on bullet/numbered lists outright (per Microsoft Q&A). The daily report HTML must avoid `dir` on cells with padding; use nested tables for padding (Litmus community-documented workaround).
- **`dir="rtl"` + CSS `direction: rtl` together cause inconsistent behavior.** Litmus community guidance: use HTML attribute OR CSS, never both.
- **Plaintext email fallback in Hebrew is RTL-broken in many clients** because plaintext emails ignore `dir`. A plaintext daily report shows "14/05/2026 :משמרות" instead of ":משמרות 14/05/2026". Wrap Hebrew strings with U+200F (RLM) at the front for plain text to set base direction.
- **Hebrew name in PDF rendered via Puppeteer-in-Alpine.** Alpine ships with `ttf-freefont` but that covers basic Latin. Hebrew glyphs need `font-noto-hebrew` or `dejavu-sans-fonts`. Without them, Puppeteer renders boxes (tofu) — and Puppeteer doesn't error, it just renders garbage glyphs.

**Why it happens:**
- BiDi is genuinely hard. The Unicode Bidirectional Algorithm has surprising edge cases that bite even in "correct" RTL apps.
- Postgres default collation is database-level, not column-level — easy to miss that a Hebrew app needs `he-x-icu` somewhere.
- Outlook is the world's worst email client for RTL; "test in Litmus" (PRD R5 mitigation) only catches what Litmus tests.
- Alpine Docker images strip "non-essential" packages including Hebrew fonts.

**How to avoid:**
- **Always set `unicode-bidi: isolate` (CSS) or `<bdi>` (HTML) around any user-supplied name displayed in a mixed-direction context.** This isolates a name from the surrounding direction. Add to a Lowdefy theme/global CSS so every soldier-name display uses it without per-page work.
- **Postgres collation:** in `0002_tenancy_and_org.sql`, declare `display_name TEXT COLLATE "he-x-icu" NOT NULL`. For email columns keep default (English-ASCII). For sortable Hebrew columns use ICU collation; for searchable Hebrew use a separate `tsvector` with Hebrew dictionary if v1 needs search (defer to v1.1 if not in scope).
- **CSV import normalization:** the migration script (and the CSV roster import) strip U+200E, U+200F, U+202A–U+202E from `display_name` before insert. Document this in the import preview as "removed N invisible direction marks."
- **Outlook email defense:** every email template in `app/templates/` ships with a Litmus snapshot of Outlook 2019 + Outlook Mac + Gmail rendering before merge. CI hooks a Litmus check on template change. Plaintext fallback prefixes Hebrew lines with U+200F.
- **Puppeteer Alpine Dockerfile MUST install `font-noto-hebrew` (or equivalent) and `fontconfig`** before chromium runs. Verify with a Hebrew-only test page in the PDF render integration test. Browserless blog post documents the exact Alpine deps.
- **Date rendering in mixed Hebrew sentences:** never inline-concatenate "from {{date_from}} to {{date_to}}" into a Hebrew paragraph. Use ICU MessageFormat with `<bdi>` wrappers around dates, or render dates in a separate UI block with isolated direction.

**Warning signs:**
- A soldier reports "the dates in my email are flipped" — Bidi mixing in a paragraph.
- The roster CSV import shows N duplicates but the manager sees them as the same name — invisible direction marks.
- Postgres `SELECT display_name FROM soldier ORDER BY display_name` returns soldiers in non-Hebrew-alphabet order — default collation.
- A PDF export of the schedule shows tofu (□) where Hebrew names should be — missing fonts in the Puppeteer container.
- An email sent to an Outlook recipient renders LTR even though the Hebrew template has `dir="rtl"` — Outlook ignoring or fighting the attribute.

**Phase to address:** **I (i18n/RTL)** for the framework-wide concerns (collation, Bidi isolation); **N (Notifications)** for Outlook + plaintext fallback; **E (Exports)** for Puppeteer fonts; **O (CSV import)** for direction-mark stripping.

**Severity:** High. PRD R5 covers one slice (Outlook); the BiDi and collation slices are net new pitfalls.

---

### Pitfall 6: Single-host hpg5 going dark in ways the PRD acknowledges but doesn't operationalize

**What goes wrong:**
PRD R6 documents "power outage = full downtime" and R7 documents the credential-helper gotcha. The pitfalls that R6/R7 don't make concrete enough:

- **Windows Update auto-reboots at 03:00 local time** by default. After reboot, Sysinternals Autologon brings `claude` user back ~30s later, Docker Desktop starts ~60s after that, compose stack ~60s after that. **The daily report cron fires at 07:00.** If Windows Update happens to be running a long-rebooting cumulative update that takes 5–15 minutes, the cron may miss its 07:00 firing window (it's a one-shot cron, not a make-up cron). The PRD's daily-report SLA (G4: "zero missed days") gets broken silently.
- **Docker Desktop disk pressure.** `docker_data.vhdx` (the WSL2 backing file) grows monotonically — Postgres WAL + Docker image cache + container layers. It DOES NOT shrink on `docker system prune`. After 6 months of weekly Lowdefy rebuilds, the file can hit 100GB+. C: drive fills up; Postgres refuses writes; the app appears alive but every write 500s. Compose health checks may not surface this because they don't check disk.
- **Windows Defender (or any third-party AV) deep-scans the Sysinternals Autologon LSA secret on a security update.** Result: the auto-login fails, the user is stuck at the lock screen, `docker pull` (which needs interactive session 1) fails forever until someone walks to the desktop. Same outcome for any HIPS that flags PsExec as malicious (Defender does flag it, hence the `-accepteula` flag — but enterprise AV may quarantine the binary).
- **Postgres growth.** With 100 tenants × 200 soldiers × multiple planning windows × full audit logs (PRD §10's `schedule_audit`, `roster_import_log`, `notification_log`), the database can hit 10GB+ quickly. The `pg_dump --format=custom` nightly backup grows linearly. The backup script's failure to handle a multi-GB dump (e.g., a long-running pg_dump conflicting with autovacuum) silently halts backups.
- **Cloudflare Tunnel cold-cache after restart.** Cloudflared running as a separate Windows user account (per CLAUDE.md) needs that user logged in too. If only `claude` user is autologged but the `cloudflared` user's password is forgotten/expired, the public URL stops working even though Docker is fine. The user has explicitly said the tunnel "doesn't depend on anything in this repo" — but it does depend on its own user-account session.
- **Single-machine = single-point-of-failure for the SOLVER too.** PRD §15 R1 covers solver latency but not solver process crashes. A CP-SAT segfault on a pathological input (rare but possible) kills the FastAPI worker. Without `--workers > 1` or a restart policy, the solver is unavailable until manual intervention.

**Why it happens:**
- Windows is opinionated about updates and reboots; Docker Desktop is opinionated about needing a logon session; LSA secrets are paranoid by design.
- "Single-host" sounds simple but is actually a stack of independently-failing components (WSL2, Docker Desktop, Postgres, cloudflared, claude user session, Defender).
- Backup scripts often fail silently — `pg_dump | gzip > file.gz` with a failure in `pg_dump` produces a tiny `file.gz` of zero bytes; no error code propagates.

**How to avoid:**
- **Pin Windows Update active hours:** set Active Hours to 00:00–23:00 (so updates never reboot mid-day or mid-night cron window), and switch to "pause updates for 7 days at a time" with monthly manual cycles by the user. Document this in `docs/OPERATIONS.md` as the v1 ops contract.
- **Disk-space monitoring as a cron task:** every hour, the cron container hits `/api/internal/health/disk` which returns C: drive free space; if < 20GB, fire `ops.disk_pressure` notification to the admin (the user). Add `ops.disk_pressure` to the PRD §7.11 event catalog (or as an out-of-band alert via Resend directly).
- **VHDX compaction quarterly:** `docs/OPERATIONS.md` documents the `Optimize-VHD` procedure with the Docker Desktop + WSL shutdown prereqs. Add to the quarterly restore drill (PRD §8.8).
- **Backup script self-test:** the nightly `pg_dump` script writes to a `.pending` file, runs `pg_restore --list` on the result to verify integrity, then renames to `.dump`. If `pg_restore --list` errors, the script keeps the previous-night's good dump and fires `ops.backup_failed` notification.
- **Daily-report make-up logic:** the cron job for `report.daily_briefing` first checks `notification_log` for a sent row in the last 18 hours; if none and the current time is between 07:00 and 23:00, fire now. Trivially recovers from a 07:00 missed firing.
- **Cloudflared monitoring:** add a Tailscale-internal probe (a cron task pinging `https://apps.nesher.co/api/health` from inside the docker network — over the public tunnel back). If 5xx for >5 minutes, fire `ops.tunnel_down`.
- **Solver process restart:** Docker compose `restart: unless-stopped` on the solver service. uvicorn `--workers 2` so a segfault doesn't take all workers down simultaneously (the second worker keeps serving while the first restarts).
- **Antivirus exclusions documented:** `docs/OPERATIONS.md` lists C:\shifts-manager\, C:\Program Files\Docker\, and the Autologon binary as Defender exclusion paths. Without these documented, future "Defender broke things" debugging is opaque.

**Warning signs:**
- `notification_log` daily report row for the morning is missing.
- `docker_data.vhdx` grows > 50GB; check with `Get-ChildItem $env:LOCALAPPDATA\Docker\wsl\disk\` quarterly.
- C: drive < 10% free.
- Lock screen at hpg5 says "Sign in" instead of being already-signed-in — Autologon disabled or LSA secret broken.
- `apps.nesher.co` returns 502 or DNS-fails but `docker ps` is healthy — cloudflared is the broken piece.
- `pg_dump` files in `C:\shifts-manager\backups\pg\` have inconsistent sizes (one day 100MB, next day 100KB) — silent failure.

**Phase to address:** **OPS (cross-cutting)** with explicit work items in **F (Foundations)** for backup-self-test, disk-monitoring cron task, and runbooks; **N (Notifications)** for the `ops.*` event additions; **R (Reports)** for daily-report make-up logic.

**Severity:** High. Extends PRD R6/R7 with operational failure modes the PRD acknowledges but does not encode into the build plan.

---

### Pitfall 7: Solver-Lowdefy contract drifts — stale results, oversized payloads, mismatched expectations

**What goes wrong:**
The PRD §11 direction-of-calls is clean (Lowdefy → Solver, never reverse). Concrete failures of this contract:

- **Solver returns `status='feasible'` (not `optimal`) at the timeout** (PRD §7.8 says this is correct behavior). Lowdefy code paths that test `if status == 'optimal'` fail silently — they don't create a draft. The user clicks "Run solver," sees a spinner, then nothing happens. No error, no draft. The actual response is a valid `feasible` result.
- **Solver returns `status='infeasible'` while Lowdefy assumed at least feasible.** The PRD's solver-run page (UI) needs distinct rendering for `optimal | feasible | infeasible | error`. If Lowdefy renders only one happy path, the manager hits "Run solver" with rules that don't admit a solution and the screen is blank.
- **Solver times out at 504 mid-page render.** Lowdefy uses HTTP requests with default timeout (usually 30s, depending on configured timeouts). PRD's `SOLVER_MAX_SECONDS=10` is well under that — but if the solver hangs (e.g., on an `INTERNAL` error path that doesn't return), Lowdefy's HTTP client times out at 30s, and the user sees a generic 504. PRD's solver error envelope is never displayed.
- **Lowdefy assembles a request body > HTTP body limit.** A 30-day window × 30 soldiers × 7 slots × 1 availability row per cell = 6,300 availability rows + soldier metadata + rule overrides. Each row is ~100 bytes JSON. Total ~600KB. Lowdefy's default body limit (server-side, Next.js) is 1MB. Fine for v1. But a 90-day window × 100 soldiers × 4 slots × availability rows = ~3.6MB. Phase-S tests use the kibbutz fixture (small) and never hit this. Tenant signups with 2-month-out planning windows hit the limit silently — solver returns 413 or Lowdefy returns 413 before the request leaves the app.
- **Stale `solver_run_id` from a previous run leaks into a new run.** The PRD's request schema includes `solver_run_id` as optional. If Lowdefy reuses a Postgres-generated ID and the manager clicks "Run again" rapidly, both runs may overlap with the same ID. The audit log shows duplicate IDs. Worse: if Lowdefy doesn't generate a NEW ID per click, the second run's response overwrites the first run's `solver_run` row, and the first run's draft assignments are orphaned.
- **Solver-side bearer-token mismatch on `.env` reload.** Both services read `SOLVER_SHARED_SECRET` at startup. If the user rotates the secret in `.env` and `docker compose up -d` only restarts the solver (not Lowdefy), Lowdefy sends the old token, solver rejects with 401, and the UX is a generic "solver error" with no hint to the user that secrets are out of sync.

**Why it happens:**
- HTTP boundaries are loosely typed. JSON Schemas help but enforcement requires explicit validation on both ends (per PRD §7.8 schemas — but Lowdefy doesn't natively validate response shapes).
- The PRD specifies the contract; engineering both sides at once requires discipline.
- Lowdefy operators don't natively retry or chunk requests.
- Multi-second long-running requests inside a web page (the solve endpoint) need spinner UX, not just a fire-and-wait pattern.

**How to avoid:**
- **`solver_run` row is created in Lowdefy BEFORE the HTTP call to the solver**, with `status='running'` and `request_payload` snapshot. The row's UUID is the `solver_run_id` sent to the solver. After the solver responds (or 504s), Lowdefy updates the row to the final status. This guarantees uniqueness, prevents stale runs, and makes "What's the solver doing right now?" answerable from Postgres.
- **Lowdefy's solver-call request block uses an idempotency key (the `solver_run_id`) in a header.** If the user double-clicks "Run," the second call short-circuits server-side to the in-flight row.
- **All four statuses (`optimal | feasible | infeasible | error`) and all four error codes (`INVALID_INPUT | WINDOW_TOO_LARGE | TIMEOUT | INTERNAL`) get distinct UI paths.** Phase S definition of done includes "rendered acceptance tests for each of the 4 statuses + 4 error codes against a real Postgres + solver stack."
- **Increase Lowdefy HTTP timeout on the solver request to `SOLVER_MAX_SECONDS + 5s` (15s)** so the solver always returns its own envelope before Lowdefy times out.
- **Hard cap on request body size at the Lowdefy → Solver boundary:** compute the expected JSON size before assembling; if > 2MB, prefer to split (later, v1.1) or reject with a "window too large" UX. For v1, document the ceiling (e.g., "60 days × 50 soldiers × 4 slots = ~2MB"). Surface a warning in the UI when the manager configures a window that approaches this.
- **Bearer token reload script:** when `.env` changes affect solver/lowdefy shared secrets, the deploy script restarts BOTH services. Document in `docs/OPERATIONS.md`.
- **Solver `/health` endpoint (PRD §11.1 lists it) is polled every 30s by a Lowdefy heartbeat operator;** the heartbeat result feeds into an in-app banner "Solver: healthy / degraded / down." Failures are visible to the manager before they click "Run solver."

**Warning signs:**
- A `solver_run` row stays in `status='running'` for > 1 minute — orphaned, indicates a crashed Lowdefy or solver.
- Two `solver_run` rows have the same UUID — primary key violation in Postgres (good, fails closed) — but if you see a 409 in app logs, it confirms the duplicate-id pattern.
- Lowdefy logs show `solver returned 401` after a recent `.env` edit — secret rotation failure.
- The manager clicks "Run solver" and the spinner runs > 12s — solver is silently above timeout; either the kibbutz-fixture latency budget has slipped or the request size grew.
- Postgres `SELECT count(*) FROM solver_run WHERE status='running' AND created_at < now() - interval '5 min'` returns > 0 — orphaned runs accumulating.

**Phase to address:** **S (Solver service)** for the contract + Lowdefy heartbeat; **L (Schedule lifecycle)** for the UI rendering of all 4 statuses + 4 error codes; **F (Foundations)** for the `.env` rotation deploy script.

**Severity:** High. Net-new pitfalls; PRD §7.8 and §11 specify the contract but don't enumerate these failure modes.

---

### Pitfall 8: Notification fan-out semantics — partial failures, preference races, leaked iCal tokens

**What goes wrong:**
- **Per-channel partial failure:** `schedule.published` fan-outs to email + WhatsApp + push for one recipient. Email succeeds; WhatsApp fails (WAHA down); push succeeds. What's the overall event "status"? If `notification_log` rows are per-channel (✓), this is fine. If a single per-event row tries to summarize, the partial failure is invisible. The PRD §7.11 says each delivery is logged separately — good — but the dispatcher's retry logic must per-channel-retry, not per-event-retry, or a WAHA failure causes an email re-send and duplicate emails.
- **Per-event preference resolution races with profile edits.** A soldier disables "WhatsApp for swap notifications" at T=0. At T=0+50ms, an event fires; the dispatcher loaded prefs at T=0-100ms (stale read). WhatsApp message goes anyway. Unlikely but real for active users editing prefs while events fire.
- **Per-recipient locale resolution at send-time vs queue-time.** PRD §7.11 says "dispatcher loads the recipient's locale at send time." If the dispatcher queues a job at T=0 in Hebrew and the soldier switches to English at T=0+10s, what gets sent? Implementation matters — queue the locale-at-event-time vs resolve-at-send-time has different UX.
- **iCal subscription URL leak — broader than PRD R11.** PRD R11 covers leak by forwarding. But the same "long-lived signed URL no auth header" pattern applies to ANY signed URL Shifty introduces — CSV/PDF export download URLs (PRD §11.1 `/api/export/csv/<run_id>` uses session auth, so this is fine for those). The risk pattern: a manager pastes a CSV-export URL into a Slack/WhatsApp message; if the export is implemented with a signed URL instead of session auth, the URL becomes a credential.
- **Soldier "off" channel choice ignored.** Per-user × per-event prefs (PRD §7.11) is correct. But the implementation must ALSO honor "all-off for this event" — a soldier who turns off every channel for `availability.lock_approaching` should receive nothing, not silently fall back to email. The dispatcher's default fallback logic is the leak path.
- **`notification_log` audit assumes write-after-send; if dispatcher crashes mid-batch, the audit lies.** A batch of 30 sends starts; 12 succeed and write log rows; the container OOM-kills; the remaining 18 never wrote log rows. The cron's "did the report fire?" check returns 12 sent, looks healthy.
- **The cron service's `/api/internal/cron/*` endpoints (PRD §11.1) use `CRON_SHARED_SECRET`.** If that secret leaks (e.g., in a debug log dump shared in a support ticket), an attacker can trigger arbitrary cron jobs from inside the docker network. Internal-only is the PRD's mitigation, but the secret in a log file isn't internal anymore.

**Why it happens:**
- Fan-out dispatchers naturally have "best-effort" semantics; making them precise requires explicit transaction boundaries.
- Notification preference UIs feel simple but the resolution layer is tricky to get right.
- Signed URLs feel like a tidy security pattern but are credentials in disguise.
- "Internal-only" is a network statement, not a secret-handling statement.

**How to avoid:**
- **Per-channel atomic logging:** the notification dispatcher writes `notification_log` row with `status='queued'` BEFORE the HTTP call to the channel provider, in the same DB transaction as the event. Channels read their queue from the log. Crashes mid-batch are recoverable (the next dispatcher invocation re-picks up `queued` rows older than the retry-delay).
- **Resolve locale + channel prefs as of the EVENT TIME, not the send time.** PRD §7.11 says send-time; this pitfall recommends event-time. Trade-off: a user who switches to English at T+5s gets a Hebrew email if the event fired at T. UX cost is small (rare race); correctness cost of send-time resolution is higher (stale read possible AND the dispatcher reload may be 10 seconds later than the event for queue-backlog reasons).
- **Per-user "channels = []" honored as "do not send this event to this user, period."** No fallback to email. Document this rule in `docs/USER_GUIDE.md` so soldiers understand the consequence.
- **Audit-event row written FIRST (in Postgres transaction with the schedule mutation), then notifications dispatched.** Compensating action if dispatch crashes: cron task re-scans the `notification_event` table for events with no `notification_log` rows in 60s and re-fires.
- **For signed URLs (iCal, future): every signed URL ALSO logs to a `signed_url_access_log` table by token, with rate-limit (5 requests/min/token).** A token used > 50 times in an hour gets auto-revoked and the soldier notified. Treats signed URLs as a credential category with detection.
- **`CRON_SHARED_SECRET` not log-able:** prefix the var name with `SENSITIVE_` (or `SECRET_`) and have a log middleware that redacts any env-var-named-thing in logs. Same for `SOLVER_SHARED_SECRET`, `WAHA_API_KEY`, `WAHA_WEBHOOK_SECRET`. PRD §17 has the env var list; this just adds a redaction policy.

**Warning signs:**
- A user reports "I got a WhatsApp message even though I turned WhatsApp off" — fallback default kicked in, OR stale-read race.
- `notification_log` shows `status='queued'` rows older than 5 minutes — dispatcher dead-letter pattern; cron should re-pick.
- Resend webhook reports a `bounced` or `complained` event but `notification_log` has no corresponding row — the inbound webhook handler is broken or the row was written post-send (so it's missing for crashes).
- A signed-URL access log shows 200+ accesses from 5 different IP geolocations for one soldier's iCal token — token has been forwarded broadly; recommend rotation.
- Debug logs accidentally contain `SOLVER_SHARED_SECRET=...` — redaction middleware is missing.

**Phase to address:** **N (Notifications)** for the per-channel atomic logging, dispatcher recovery, and locale-resolution timing; **E (Exports)** for the signed-URL access log; **F (Foundations)** for the log-redaction middleware; **R (Reports)** for the cron-event recovery.

**Severity:** Medium-High. Extends PRD R3 (Resend deliverability) and R11 (iCal token leaks) with multi-channel correctness pitfalls.

---

### Pitfall 9: Migration from the Google Sheet hits silent-data-loss patterns that the PRD's §13.2 doesn't catch

**What goes wrong:**
PRD §13.2 covers smart-quote canonicalization. The other data-integrity pitfalls of migrating from a human-edited Google Sheet:

- **Timezone interpretation drift.** The sheet stores dates as Google's date-typed cells, which are timezone-naive but rendered in the user's locale. The migration script reads via `gviz/tq` CSV export, which returns dates as **strings in the sheet-owner's locale format** (likely Hebrew DD/MM/YYYY) — NOT ISO. Without explicit parsing, a "01/05/2026" becomes January 5 in some parsers and May 1 in others. The PRD's locked timezone is Asia/Jerusalem; the migration must explicitly parse with `%d/%m/%Y` AND assert that interpretation against a known-good cell.
- **"Soldier removed mid-window" in the sheet.** The sheet doesn't have an `archived` model; the user deletes a row when a soldier leaves. Old assignments referenced that row by name — and the sheet's `COUNTIF` formulas just stop matching. The migration sees an assignment for "[deleted name]" with no soldier row to point at. Currently the migration script has no answer for this; the assignment is dropped silently.
- **Role tag fuzz: "medic" vs "Medic" vs "מד" (the Hebrew abbreviation).** The sheet's role column is free text. Migration to PRD's lowercase-kebab-case role tags requires a fuzzy-match step, but pure-canonical mapping ("Medic" → "medic", "מד" → "medic") needs a mapping table, not just `lowercase()`. Without it, the same soldier role becomes 3 separate tags and the eligibility filter (PRD §7.4 required_role_tags) doesn't fire.
- **Hand-typed Hebrew names with mixed-spacing variants.** "דני כהן" vs "דני  כהן" (double space) vs "דני כהן " (trailing space). These visually-identical cells hash to different rows in the COUNTIF lookup. The migration MUST `.strip().replace(/\s+/g, ' ')` AND log every transformation so the user can audit.
- **Constraints (rows 14–29) reference soldiers by display name; migration must resolve to UUIDs.** If a constraint row says "דני - Tuesday 13/05 unavailable" but the canonical name is "דני כהן", the resolution fails. The script needs both fuzzy match AND a manual-review queue for unresolved rows.
- **The sheet's `settings` tab has rule values as cell numbers; some cells are formulas (e.g., `=IF(B5>3, 3, B5)`) returning their computed value.** `gviz/tq` returns the computed value (good), but if the computed value is `#REF!` or `#VALUE!`, the migration silently writes a broken value. Check every numeric cell for `#`-prefixed errors before insert.
- **Idempotency: re-running the migration doubles the data.** The script doesn't currently know if it has run before. If it crashes halfway, re-running should be safe but isn't.

**Why it happens:**
- Sheets are human-editable, so data quality is human-grade.
- CSV via `gviz` is convenient but coerces types to strings; explicit parsing is required.
- "Just import the sheet" feels like a one-off task; idempotency feels over-engineered until the third re-run.

**How to avoid:**
- **The migration script in `tools/migrate-from-sheet/` (PROJECT.md Active item) MUST be idempotent.** Pattern: every row carries a `source_row_hash` (SHA256 of the canonicalized source cell + canonicalized cells of contextual columns); on re-run, INSERT...ON CONFLICT DO NOTHING. Document the assertion: "Running this script twice on the same sheet snapshot produces the same database state."
- **Pre-flight check:** parse every date cell with `%d/%m/%Y`, fail if any cell doesn't match, surface the failing cell address. Same for every numeric cell (check `#`-prefix).
- **Soldier-archive bridge:** any name in the assignments grid that doesn't match a current `groups`-tab row is INSERTed as `soldier.status='archived'` with a `notes` field saying "Migrated from sheet; row not in current roster. Verify with admin before re-activating." The assignment is then linked. Manual review queue for the admin.
- **Role tag mapping file:** `tools/migrate-from-sheet/role-tag-map.json` is a hand-curated mapping (per-tenant, but for tenant #1 specifically) from the sheet's free-text values to PRD canonical tags. Migration applies this map; unmapped values produce an error, not a silent drop.
- **Display-name normalization:** strip + collapse whitespace + strip U+200E/U+200F/U+202A–U+202E + canonicalize Unicode (NFC) + replace U+2019 with the canonical apostrophe form (per PRD §13.2). Log every transformation in `roster_import_log.error_details` so the user can see "what got changed."
- **Verification step the user MUST do**: run the migration, then a `sample_check.py` script picks 5 random soldier × random week cells from both the sheet and the DB and prints them side by side. The user manually confirms. Document this as "do not consider the migration complete without running sample_check."
- **The script keeps the tenant_id handy and supports `--rollback` (per PRD §13.2 "rolled back via TRUNCATE on the tenant's rows").** Verify the rollback path in a dry run before the real migration.

**Warning signs:**
- Migration's INSERT count != sheet's row count, with no explanation in the log.
- Two consecutive runs produce different `roster_import_log.error_details` — the script is non-deterministic.
- A user audits a sample week and finds a Tuesday assignment shifted to Wednesday — date format misinterpreted.
- The migrated `rule` table has values like `'#REF!'` — formula-error cells leaked through.
- A soldier appears twice in the migrated `soldier` table — whitespace-variant names not deduplicated.

**Phase to address:** **M (Tenant #1 migration)**. Should NOT be on the critical path for v1 launch; it's a one-off for tenant #1. The migration script can be developed in parallel with the platform.

**Severity:** Medium. Data loss in this domain is recoverable (Source-of-truth is still the sheet at migration time) but undermines user trust in the new system.

---

### Pitfall 10: Prior-art beloved-features being copied "verbatim" without preserving the bug-free contract

**What goes wrong:**
PRD §7.13 names features that the user loves from the prior-art sheet: per-person calendar colors, leaderboard with ASCII bars, draft-then-promote workflow, Hebrew daily email. These are explicitly preserved. The pitfall: copying the visual appearance without preserving the "bug-free contract" Shifty implicitly promises.

- **The sheet's "today view" was bugged** ("Bug-free version of the prior-art sheet's broken 'today' view" per PRD §7.13). What specifically broke? PRD doesn't say. The pitfall: re-introducing the same bug because the team doesn't know what it was. (Likely candidates given the smart-quote-COUNTIF lesson: name-based lookup of "today's assignees" failing on smart-quote variants; date string comparison failing across timezone boundaries.)
- **Smart-quote variants are the most-famous bug, but display-name fragility is broader.** PRD R8 acknowledges normalization bugs in DISPLAY logic. Other fragility classes:
  - Two soldiers with the same display name (rare but possible — two "דני" in a unit). Sheet had no way to distinguish; UI in Shifty must show a disambiguator (last-name, role-tag, color) when names collide.
  - Hebrew right-to-left "name with title" (e.g., "סמ"ר דני") containing a quote-like character (U+0022 or U+05F4 Hebrew gershayim). The same canonicalization that strips U+2019 must NOT strip U+05F4 (a legitimate Hebrew punctuation mark in military titles).
- **Per-person calendar colors lookup table.** The sheet has a fixed palette assignment. PRD §7.3 says "24-color preset palette (round-robin, avoiding adjacent-color collisions within a team)." If the algorithm is naive (literally round-robin), a 25-soldier team has two soldiers with the same color; if "avoiding adjacent" isn't well-defined, two soldiers with similar reds make the calendar unreadable. Define "adjacent" formally (e.g., minimum hue distance in HSL ≥ 30°) and test with the kibbutz fixture.
- **ASCII-bar leaderboard accessibility:** the PRD pairs it with an accessible bar chart twin (§7.13). The bug-free contract here is that the two views NEVER show different counts. If they disagree (e.g., the bar chart includes archived soldiers while the ASCII bars don't), users distrust both. Encode "counts must match" as a Playwright assertion.
- **Hebrew daily email:** preserving the sheet's email shape means the daily email LITERALLY copies the sheet's table layout, fonts, spacing. The pitfall: Hebrew email rendering bugs (Outlook, plain text fallback, mobile mail apps) break the layout even if the source HTML is "the same."
- **Draft-then-promote:** preserved as Draft → Publish (PRD §7.7). But the sheet's draft was casual — the user typed in a "draft tab" and copy-pasted to the "prod tab" when ready. Shifty's promote is one-click + audited + fires notifications. The pitfall is the OPPOSITE — making promotion too friction-ful so the user does it less often. UX bias: every blocker before promote (rule violations, missing role-tag soldiers, etc.) makes the manager more reluctant.

**Why it happens:**
- "Preserve what's loved" is a vague brief; without explicit "the contract is X" each feature carries silent assumptions.
- The sheet's bugs are organizational knowledge in the user's head; not in the PRD beyond the smart-quote example.
- Visual parity with the sheet feels like a goal but it's actually a partial requirement — the goal is BEHAVIOR parity (results match what the sheet would produce, for the things the sheet got right).

**How to avoid:**
- **Before Phase D (Dashboard) starts, capture the prior-art sheet's "today view" bug specifically.** Ask the user: "What broke about the today view? Smart quotes? Time-of-day cutoff? Cross-day shifts?" Document the answer in `docs/PRIOR_ART_BUGS.md`. Without this artifact, the bug-free-today-view requirement is unfalsifiable.
- **Display-name normalization in ONE helper.** PRD R8 mitigation. Extend: write a test fixture that includes 10 edge cases (smart-quote, double-space, trailing-space, U+200F, gershayim U+05F4, etc.) and assert every fixture renders + sorts + joins correctly.
- **Color assignment algorithm formal spec:** in `docs/COLOR_PALETTE.md`, define the 24-color palette in HSL space and the "minimum hue distance for adjacent soldiers ≥ 30°" rule. Test against a 25-soldier team (forces palette reuse). Two reused-color soldiers must NOT be adjacent in any sorted view.
- **ASCII-bar vs accessible-bar parity test:** Playwright snapshot tests the leaderboard at every PR; failure if the two views disagree on any soldier's count.
- **Draft-promote UX research with the user:** in Phase L, the user manually walks through one Draft → Publish cycle with all 8 rules active, narrating where it feels "too friction-ful" — capture in `docs/UX_NOTES.md`.

**Warning signs:**
- The user's first reaction to the today view: "This is missing the [X] from my sheet." That [X] is the implicit contract that wasn't captured.
- Two soldiers in the kibbutz fixture have the same calendar color in a side-by-side cell.
- The ASCII-bar leaderboard says soldier X has 8 shifts; the bar chart says 9.
- The manager skips Publish (stays in Draft, sends a screenshot to the WhatsApp group instead) — promotion is too friction-ful.

**Phase to address:** **D (Dashboard)** for the today-view bug capture + ASCII-bar parity; **O (Org & people)** for the display-name normalization + color palette; **L (Schedule lifecycle)** for the Draft → Publish UX check; **N (Notifications)** for the daily email layout.

**Severity:** Medium. Preserves user trust and prevents regression to documented prior-art frustrations.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip Postgres RLS, rely solely on app-layer `tenant_id` filters | Faster Phase F; less Postgres complexity | A single forgotten `tenant_id` filter is a cross-tenant data leak (PRD R4 critical impact) | **Never** for v1 — PRD G5 demands zero leaks. RLS as bottom layer is the safety net |
| Use Lowdefy's default HTTP timeout (30s+) for solver calls instead of `SOLVER_MAX_SECONDS + 5s` | One less config line | Hung solvers manifest as generic 504 to the user; the PRD's solver error envelope never displays | **Never** — the rendering of all 4 statuses + 4 error codes is part of the solver UX contract |
| Single CP-SAT worker for v1, switch to parallel later | Determinism is automatic | Latency target (10s p95 for 30×30×4) tight; future rule additions may push above | **Acceptable for v1** with kibbutz-fixture proof. Promote to `interleave_search` mode in v1.1 |
| Skip the Lowdefy CI grep gate for `tenant_id` | Faster onboarding of new YAML pages | Cross-tenant leak likelihood spikes after the 3rd-4th developer joins; relies on code review attention | **Never** — the gate is cheap to build and the cost of a leak is one of PRD's named success metrics |
| Ship without the assumptions-based infeasibility report (just rule names) | Simpler solver code; PRD §7.8 schema is satisfied | Managers can't act on infeasibility; trial-and-error rule-disabling burns trust | **Not acceptable** unless explicitly deferred with the user. R9 mitigation is too weak; promote the report |
| Use the user's personal phone number for WAHA initially | No new SIM cost; tenant #1 ships sooner | Every time the user uses WhatsApp Web personally, WAHA drops. Repeated downtime erodes trust in WhatsApp delivery | **Not acceptable past the first week** of testing. Buy a dedicated SIM before tenant #2 onboards |
| Skip iCal token rate-limiting; rely on the secret-token mechanism alone | Simpler `/api/ical/<token>` endpoint | A forwarded URL is forever-valid; a leak is silent. PRD R11 documents the risk; rate-limiting + access log makes it auditable | **Acceptable for v1 launch**, NOT for the post-launch hardening sprint |
| Hand-typed migration script with no idempotency | Tenant #1 ships in days | Re-runs after a fix double-import; rollback is `TRUNCATE` (loses any new manual data) | **Acceptable only for tenant #1 specifically.** Document the migration as one-shot. Don't generalize to a re-runnable tool |
| Skip Alpine font installation for Puppeteer; ship "and we'll see" | PDF endpoint deploys faster | Hebrew names render as tofu in the first user-facing export — a high-visibility regression on PRD G1 ("first 5 onboarded units") | **Never** — Hebrew is the default locale |
| Defer the WAHA dedicated-number requirement to v1.1 | One less ops setup | PRD R2's likelihood is already "High"; a personal-number drop cycle would make it ~daily | **Not acceptable** — see "Pitfall 4" |
| Allow `num_search_workers > 1` "because solve time is tight" | Better p95 latency | Loss of determinism; PRD §7.8 explicitly asserts "same seed = same output" | **Never** without switching to `interleave_search` mode |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **Resend (email)** | Treat 200 from `POST /emails` as delivered. Set `notification_log.status='sent'` and move on. | 200 = accepted-for-delivery only. Status transitions to `delivered` via the `email.delivered` webhook (PRD §9). Until then, status is `accepted`. Bounces (`email.bounced`) and complaints (`email.complained`) flip status terminally. PRD R3's per-tenant suspension trigger reads `notification_log.status='bounced'` counts |
| **Resend (email)** | Add external recipients (P4 auditors) by free-text email entry with no verification, daily emails go out, recipient marks as spam, sender reputation tanks | PRD R3 mitigates with bounce-rate threshold. Extend: send a one-time "you've been added as a Shifty report recipient — confirm" email with a confirm/decline link. Only `confirmed` recipients get the recurring reports. Reduces complaint risk |
| **WAHA (WhatsApp)** | Use the user's personal phone number; assume WAHA "stays up" | Dedicated SIM. `WHATSAPP_RESTART_ALL_SESSIONS=true`. Health-check polled by cron. (Pitfall 4) |
| **WAHA (WhatsApp)** | Treat 200 from `/api/sendText` as delivered. Skip the webhook integration | WAHA's 200 means queued. Delivery is reported via inbound webhook (PRD §11.1 `/api/webhook/waha`). The PRD has the endpoint scaffolded but Phase N must actually consume the `message-status` events, not just the `session-status` events. (Pitfall 4) |
| **Web Push (VAPID)** | Generate VAPID keys with the wrong subject format (e.g., a bare URL) | Apple requires the VAPID subject to be `mailto:` OR a full HTTPS URL. Bare URLs return 403. PRD §17 hard-codes `mailto:omernesher@gmail.com` — correct. Document the format requirement in `.env.example` so future tenants don't break this |
| **Web Push (iOS Safari PWA)** | Push subscription gets canceled after 3 notifications fired without `event.waitUntil(...)` (iOS-specific silent-push punishment) | Every service worker `push` event handler MUST wrap `showNotification` in `event.waitUntil(...)`. iOS revokes subscriptions for "silent" pushes (no UI shown). Document in `app/public/sw.js` review checklist |
| **Web Push (delivery rate)** | Assume push is reliable like email | iOS delivery rate ~70-85% vs Android ~90-95%. Email always must be available as the fallback. Don't promote push as "the most reliable" channel |
| **Postgres (Hebrew sort)** | Default `ORDER BY display_name` returns Unicode codepoint order, not Hebrew alphabetic | Use `ORDER BY display_name COLLATE "he-x-icu"` per query OR declare the column with `COLLATE "he-x-icu"`. (Pitfall 5) |
| **Postgres (CITEXT)** | Use CITEXT for Hebrew name case-insensitive search | CITEXT is byte-equality with one folding pass; doesn't handle niqqud or final-form chars. Use ICU collation `und-u-ks-level2` or `he-x-icu` with nondeterministic option for case-insensitive Hebrew |
| **Auth.js (NextAuth)** | Sign user in before the `membership` row is committed; first query fires with NULL tenant_id | The `jwt` callback returns the token AFTER verifying a `tenant_id` claim exists in the DB. No `tenant_id` → refuse the token; re-route to "complete signup" page |
| **Cloudflare Tunnel** | Assume the tunnel is independent of the deploy stack because it runs as a different user | The cloudflared user's autologin/session is its own SPoF. Add a Tailscale-internal probe pinging `https://apps.nesher.co/api/health` from inside the docker network — alerts on tunnel-down separately from app-down |
| **Docker Desktop (Windows)** | Trust `docker compose up -d` to handle restart correctly across reboots | After a reboot, the order matters: claude user logs in (Autologon), Docker Desktop starts (HKCU Run), Compose stack starts (`restart: unless-stopped`). Any link broken — manual ssh-in required. (Pitfall 6) |
| **Cron container (node-cron)** | Use system local time in cron schedules; assume container has TZ=Asia/Jerusalem | Container `TZ` env var must be `Asia/Jerusalem` (PRD §17 `APP_DEFAULT_TIMEZONE`). Without it, `0 7 * * *` fires at 07:00 UTC = 10:00 Israel summer time; daily report 3 hours late |
| **Puppeteer (Alpine container)** | Use Alpine base for the PDF render service; install only chromium | Add `font-noto-hebrew` (or `font-noto-sans-hebrew`) AND `fontconfig`. Verify by rendering an Hebrew-only test page in CI. Alpine 3.20 has a chromium timeout regression; pin to 3.19 if encountered (Pitfall 5) |
| **Lowdefy (request-block auth)** | Set `properties.auth: { roles: [...] }` on a `request` block and trust it's server-evaluated | Validate that the role check is happening on the server (Lowdefy 5.x semantics vary). Add a "client-bypass" pen test: hit the request URL directly with a curl, bypassing the page render. Must 403 |
| **Lowdefy (Postgres connection)** | Use a single shared connection; `SET tenant_id = ...` once per request | A pooled connection retains `SET` across requests; use `SET LOCAL` exclusively (transactional scope). (Pitfall 2) |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Solver fed an over-tight rule set returns `infeasible` for every realistic input | `solver_run.status='infeasible'` rate > 30%; managers stuck | Kibbutz-fixture feasibility gate in CI; tune default rule values against real data before launch | First real-world tenant with > 12 soldiers and full 8-rule activation |
| CP-SAT runs with `num_search_workers > 1` (auto-detect) | Two re-runs of same input produce different schedules | Pin `num_search_workers=1`; document in solver README | Whenever Docker Desktop allocates > 1 core, which is always on hpg5 |
| Lowdefy SSR rebuild on every YAML change blocks the deploy for 3-5 minutes | Slow iteration cycles | Cache base layers in the Dockerfile; build only on `app/` changes; later: prebuilt registry image | After Phase F when 10+ pages exist and YAML iteration is frequent |
| Postgres queries without `tenant_id` filter return all-tenant rows; row count low for v1 but unbounded for v1.1 | Slow dashboards once tenant count grows | RLS + CI grep gate (Pitfall 2) | 10+ tenants; performance dies before security does |
| `notification_log` grows unbounded; queries against it slow over time | Admin "delivery history" page loads in 10s | Index on `(tenant_id, event_type, created_at DESC)`; partition by month if > 1M rows | 3-6 months in production |
| `docker_data.vhdx` grows monotonically | C: drive fills; new container starts fail | Quarterly `Optimize-VHD`; disk-pressure cron monitor | 6-12 months of weekly rebuilds |
| Daily report query joins `assignment × shift_instance × soldier × team` without indexes | Daily 07:00 cron tick spikes Postgres CPU to 100% for 30s | Composite index on `(planning_window_id, date)` for `shift_instance`; analyze EXPLAIN at design time | 30 soldiers × 30-day window per tenant × 100 tenants |
| Notification fan-out for `availability.lock_approaching` blasts 30 messages on three channels at the cron tick | WAHA hits rate-limit; some soldiers get message, some don't | Per-channel rate-limit at dispatcher level; staggered send within a 60s window | 30+ soldiers per team |
| PDF render endpoint blocks the Lowdefy event loop for 5-30 seconds | Concurrent users get 504s while one PDF generates | Move Puppeteer to a separate microservice (v1.1); for v1, the rule is "one PDF at a time" — queue, not parallel | First concurrent PDF request |
| Solver request body exceeds Lowdefy default body limit | Lowdefy returns 413 before the solver sees the request | Cap planning window × roster size at request-assembly time; UX warning at config time | 90-day × 100-soldier × 4-slot windows |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Tenant isolation enforced only at app layer (Lowdefy queries) — no Postgres RLS | A single forgotten `tenant_id` filter (one YAML page, one operator) leaks all tenants' data; PRD's G5 broken | Enable RLS on every domain table from `0002_tenancy_and_org.sql`; CI grep gate + Playwright cross-tenant pen-test (Pitfall 2) |
| `_user`-evaluated request auth in Lowdefy YAML (client-side evaluable) | Attacker overrides JWT claim in DevTools, mutates other tenant's data | Server-only role checks; treat `_user` as untrusted; revalidate against the DB-side `app.tenant_id` setting |
| Magic-link tokens that don't carry tenant binding | A user clicks an old magic link, switches tenants without re-auth | Each magic-link request encodes the target tenant_id in the signed token; mismatch → reject |
| Invite codes are listable through any endpoint without role check | Internal recon → brute force redemption | Per PRD §8.2 — codes not enumerable; add a dedicated rate-limit (5 redemption attempts/hour/IP) on the redemption endpoint |
| iCal subscription URLs are long-lived and indexable (no `noindex`, no rate-limit) | Search engines index a leaked URL; permanent exposure | Endpoint returns `X-Robots-Tag: noindex, nofollow`; per-token rate-limit (5/min); per-token access log with auto-revoke at suspicious patterns (Pitfall 8) |
| CSV/PDF export endpoints use signed URLs instead of session auth | URL pasted into chat = anyone with the URL has the data | Session auth on export endpoints (PRD §11.1 specifies session — confirm implementation matches) |
| `SOLVER_SHARED_SECRET` / `CRON_SHARED_SECRET` / `WAHA_*` secrets logged in debug output | Internal-only secrets exfiltrated via support-ticket attachments or accidental log share | Log-redaction middleware that masks any env-var value matching known secret names (Pitfall 8) |
| Audit logs are not append-only at the DB level (PRD §8.2 says they are, verify) | Manager edits an inconvenient audit row pre-PII-disclosure | `REVOKE UPDATE, DELETE ON schedule_audit FROM <role>` at migration time; verify with a Playwright test that tries to update an audit row as a `team_manager` and fails |
| Postgres `pg_hba.conf` allows host-level connections (e.g., `host all all 0.0.0.0/0`) | Misconfig leaks Postgres to the public docker network bridge | Confirm `pg_hba.conf` only allows the lowdefy docker-network host; never `0.0.0.0/0` |
| WAHA's HTTP API exposed to public docker network without `WAHA_API_KEY` enforced | Anonymous WhatsApp sending; spam; account ban; potential exfiltration of WhatsApp conversations | `WAHA_API_KEY` mandatory in compose; verify at startup; reject calls without it (Pitfall 4) |
| Auth.js EmailProvider (magic link) doesn't expire links aggressively | Lost laptop → email forwarded → account takeover | Magic-link TTL ≤ 30 minutes; single-use enforced; PRD §7.2 doesn't specify TTL — set explicitly |
| Hebrew names in error messages echoed back without escaping | XSS via display name; rare but `<script>` in a name is a real payload | Output-escape every Hebrew string in HTML contexts; Lowdefy default is escape, but custom HTML rendering paths (email templates, PDF templates) need explicit checks |
| `notification_log.provider_response` stores raw responses including auth headers/tokens | Audit-log readers see secrets | Sanitize stored response: drop `Authorization`, `Cookie`, `Set-Cookie` headers; cap body size |
| Docker Desktop credential helper failure (logon type 3) silently masked, all `docker pull` fail | Production stack stays on stale images even after a `git pull` | PsExec wrapper documented (CLAUDE.md); add a CI deploy-test that asserts `docker pull` succeeded (Pitfall 6) |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Solver "Run" button shows a spinner with no feedback for 10s | User assumes the click didn't register and clicks again; duplicate solver_run rows | Idempotency by `solver_run_id` + progress indicator with phase ("Loading availability...", "Optimizing...", "Done") (Pitfall 7) |
| Infeasibility report shows rule names but no soldiers/dates | Manager can't act; tries random rule-disabling | Promote `offending_rules` to include affected soldiers + dates via CP-SAT assumptions (Pitfall 3) |
| Hebrew dates flip in mixed-direction paragraphs (BiDi) | Manager misreads "from 14/05 to 21/05" as flipped | Wrap dates in `<bdi>` or use CSS `unicode-bidi: isolate` (Pitfall 5) |
| Mobile-first soldier dashboard horizontally-scrolls because the calendar grid is wider than viewport | Soldier on a 360px-wide phone can't see Tuesday | PRD §7.5 acceptance requires "no horizontal scroll on mobile"; enforce with Playwright responsive snapshots |
| Soldier turns off all channels for an event and silently gets email anyway (default fallback) | Trust eroded — preferences feel fake | Per-user "channels=[]" honored as do-not-send (Pitfall 8) |
| Manager publishes draft, push notifications fire to 30 soldiers at once, WhatsApp rate-limited, some soldiers never know | Soldiers compare notes and discover not everyone got notified — confidence drop | Per-channel rate-limit; staggered fan-out within 60s; surface "X of Y notified" in publish-confirmation UI |
| Time clock "Check in" button on phone, no visual confirmation of state transition | Soldier taps twice (didn't see first tap register) — duplicate entries | Optimistic update + clear visual transition + haptic feedback if supported; entry-creation succeeds = button label changes |
| Day-list calendar view (v1 plan, deferring the npm-plugin calendar widget) feels regressive vs the sheet's grid | User says "this is worse than my spreadsheet" | Ship a competent day-list with all the data, plus an "open in Google Calendar" link as a workaround; manage expectation that grid view is v1.1 |
| Roster CSV import preview shows ✓/⚠/✗ icons but no count summary | Manager scrolls through 50 rows trying to find errors | Summary banner: "47 will be created, 2 warnings, 1 error — see rows X, Y, Z" |
| Manager hand-edit on draft triggers no rule re-check until publish | Manager publishes a violation they didn't realize they introduced | Inline rule check on every hand-edit; show ⚠ on affected cells in real time (PRD §7.7 says rule violations are "highlighted but not blocking" — confirm the highlighting is immediate, not just at publish) |
| iCal subscription URL is "right there in your profile" — soldier shares it casually | URL ends up in a WhatsApp group; the soldier's full schedule is now public | Surface the URL as `Generate one-time URL` (creates a 24h-TTL token) AND `Generate long-lived URL` (with rotate button always visible); educate via inline copy (Pitfall 8) |
| Daily report email subject line in English ("Daily Schedule for 2026-05-14") even when recipient locale is Hebrew | Recipient's mail client sorts/filters by subject line; English-prefix subject defeats Hebrew filtering | Subject line in recipient locale: "סדר יום - 14/05/2026" |
| Manager runs solver, gets `feasible` (not optimal), UI doesn't distinguish | Manager publishes a suboptimal schedule without realizing | Distinct UI: optimal = green badge "Optimal solution"; feasible = yellow badge "Best found within X seconds — try increasing time or relaxing rules" |

---

## "Looks Done But Isn't" Checklist

- [ ] **Lowdefy app boots:** Container is `Up` AND `curl http://hpg5:8080/` returns 200 AND the home page shows a live Postgres row (not a "compile-time" success only). (Pitfall 1)
- [ ] **Tenant isolation:** Every list page passes a Playwright test where a user from tenant B explicitly tries to read tenant A's URL — must 403. The kibbutz-fixture smart-quote soldier appears in every aggregate. RLS policy exists on every domain table. (Pitfall 2)
- [ ] **Solver passes kibbutz fixture:** 12 soldiers × 64-day window × all 8 rules with PRD defaults returns `optimal` or `feasible` in <10s. If `infeasible`, the rule defaults need re-tuning before launch. (Pitfall 3)
- [ ] **Infeasibility report is actionable:** Report names affected SOLDIERS and DATES, not just rule names. A non-technical manager can read it and identify what to relax. (Pitfall 3)
- [ ] **Determinism verified:** Two consecutive `solver_run` invocations on identical input produce identical assignments. Test with `num_search_workers=1` setting. (Pitfall 3)
- [ ] **WAHA session survives restart:** `docker compose restart waha` and the WhatsApp session auto-resumes within 60s. `WHATSAPP_RESTART_ALL_SESSIONS=true` is in `.env`. (Pitfall 4)
- [ ] **WAHA delivery webhook consumed:** A test message sent via `/api/sendText` produces a `notification_log.status='delivered'` row via the inbound webhook, not just `status='sent'`. (Pitfall 4)
- [ ] **Hebrew sort order correct:** `SELECT display_name FROM soldier ORDER BY display_name COLLATE "he-x-icu"` returns soldiers in Hebrew alphabetic order. Default `text` collation does NOT. (Pitfall 5)
- [ ] **PDF Hebrew rendering verified:** A PDF rendered via the production Puppeteer container shows Hebrew names, not tofu (□). Test in CI. (Pitfall 5)
- [ ] **CSV opens correctly in Excel-Windows:** UTF-8 BOM included; Hebrew names render; columns separate correctly (locale-dependent comma/semicolon — test on a Hebrew Windows locale). (Pitfall 5)
- [ ] **Outlook RTL email tested:** Daily report rendered in Outlook 2019 and Outlook Mac in addition to Gmail. No 1px lines on padded cells. Bullet/numbered lists work or are avoided. (Pitfall 5)
- [ ] **Backups self-verify:** Latest `pg_dump` file passes `pg_restore --list`; the script never overwrites a known-good dump with a bad one. (Pitfall 6)
- [ ] **Cloudflared user is logged in:** A reboot test confirms `apps.nesher.co` returns 200 within 5 minutes of power-on. (Pitfall 6)
- [ ] **Solver-Lowdefy contract: all 8 outcomes rendered:** `optimal | feasible | infeasible | error × 4 error codes` each have a Playwright test that exercises that response path and asserts the UI. (Pitfall 7)
- [ ] **Notification log captures every dispatch:** Per-channel log row written BEFORE the HTTP call to the provider. Crashes mid-batch leave queued rows for cron to retry. (Pitfall 8)
- [ ] **iCal token access logged:** Each subscription poll writes to `signed_url_access_log`. Per-token rate-limit at 5 requests/min. (Pitfall 8)
- [ ] **Migration script is idempotent:** Run the migration twice against the same sheet snapshot, assert byte-equal DB state after each run. (Pitfall 9)
- [ ] **Display-name normalization test fixture:** 10 edge cases (smart-quote, gershayim, RLM, double-space, etc.) all render + sort + join correctly. (Pitfall 10)
- [ ] **Today-view bug captured:** `docs/PRIOR_ART_BUGS.md` exists with the user's explicit description of what was broken in the sheet's today view. (Pitfall 10)
- [ ] **Color palette spec exists:** `docs/COLOR_PALETTE.md` defines the 24-color palette in HSL space and the "minimum hue distance ≥ 30°" rule. Test with a 25-soldier team. (Pitfall 10)
- [ ] **ASCII-bar leaderboard matches accessible-bar leaderboard:** Counts always agree; Playwright snapshot test. (Pitfall 10)
- [ ] **Plaintext email RTL works:** Plaintext fallback for daily report prefixes Hebrew lines with U+200F (RLM) so direction is correct in clients that ignore HTML. (Pitfall 5)
- [ ] **Magic-link TTL set:** Auth.js EmailProvider configured with `maxAge ≤ 1800` (30 min). Single-use enforced.
- [ ] **All env-vars-named-secret redacted in logs:** `SOLVER_SHARED_SECRET`, `WAHA_API_KEY`, `WAHA_WEBHOOK_SECRET`, `CRON_SHARED_SECRET`, `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`, `NEXTAUTH_SECRET`, `POSTGRES_PASSWORD`. (Pitfall 8)

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| **Lowdefy runtime broken at day 5** (Pitfall 1) | HIGH | Day-5 hard checkpoint: switch package manager to npm OR pivot to hand-rolled Next.js + Auth.js + Postgres. The PRD's "Lowdefy locked" stance becomes a re-open conversation with the user |
| **Cross-tenant data leak detected in production** (Pitfall 2) | CRITICAL | Immediate: `REVOKE` the offending role's access on the leaking table. Postgres RLS makes this a one-line statement. Audit `notification_log` and any logs for what the leaker saw. Notify affected tenants per Israeli data-protection law. Patch the missing filter, redeploy, run pen-test suite |
| **Solver returns infeasible for tenant #1's first real solve** (Pitfall 3) | MEDIUM | Disable rules in order: `max_consecutive_nights` → `weekend_separation` → `min_rest_hours_between_shifts`. First feasible result identifies the binding constraint. Manager-side UX: present the rule-relaxation chain in the infeasibility-report UI ("Try relaxing X first") |
| **WAHA session permanent ban** (Pitfall 4) | MEDIUM | Buy new SIM; re-pair WAHA via QR; soldiers re-confirm WhatsApp channel choice (in-app banner: "WhatsApp number changed — re-enable?"); email channel always continues to work |
| **PDF rendering produces tofu in production** (Pitfall 5) | LOW | `docker exec -it shifty-lowdefy fc-list | grep -i hebrew` — if no Hebrew font, rebuild image with `font-noto-hebrew`. PDF endpoint affected; CSV/iCal unaffected. Tell users to use CSV until PDF re-deploy in ~1 hour |
| **Daily report cron missed due to Windows Update reboot** (Pitfall 6) | LOW | Make-up logic in cron (Pitfall 6 prevention) auto-fires when next polled. Manual fallback: `psexec -i 1 ... cmd /c "curl -X POST http://localhost:8080/api/internal/cron/daily_report -H ..."` |
| **`docker_data.vhdx` fills C: drive** (Pitfall 6) | MEDIUM | Stop Docker Desktop + `wsl --shutdown`; `Optimize-VHD -Path ...`; reclaim 10s of GB. App is down for ~10 minutes. Schedule the next compaction quarterly. |
| **Backup file is zero bytes for 3 days** (Pitfall 6) | HIGH | If discovered before disaster, fix the backup script and run a manual `pg_dump` immediately. If discovered after a disaster, restore from the last good backup; lose all data since (up to 24h). Manual replay from `schedule_audit` if needed |
| **Solver stuck in `running` state** (Pitfall 7) | LOW | Cron task scans for `running` rows older than `SOLVER_MAX_SECONDS × 2`; flips to `error` with reason "orphaned". Manager re-clicks "Run solver" |
| **iCal token leaked + indexed** (Pitfall 8) | LOW-MEDIUM | Soldier revokes the token from profile; per-token access log identifies the leak window; if sensitive, rotate the user's HMAC secret seed. Educate via in-app banner |
| **Migration mis-mapped role tags, soldiers ineligible for shifts** (Pitfall 9) | LOW | Run rollback (`TRUNCATE` on tenant rows), fix `role-tag-map.json`, re-run. Sheet remains source-of-truth until migration verified |
| **Migration's "today view bug" recreated** (Pitfall 10) | LOW | Patch and re-deploy; affected users see the bug from publish-time to fix-time only (no data loss) |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| **P1: Lowdefy runtime broken** | F (first week, day-5 hard checkpoint) | `curl http://hpg5:8080/employees` returns 200 with at least one DB-backed row visible; no `ERR_MODULE_NOT_FOUND` in container logs across 10 page loads |
| **P2: Tenant isolation gaps** | F (RLS in migration 0002; CI grep gate in 0002–0003) — extended into every subsequent phase | Playwright cross-tenant pen-test passes for every list/detail/mutation route; `tools/check-queries.mjs` CI gate exists and fails on missing tenant_id |
| **P3: Solver infeasibility / determinism / scaling** | S | Kibbutz-fixture feasibility gate (CI); two consecutive runs produce byte-equal assignments; infeasibility report includes affected soldiers + dates; load test 30×30×8 rules p95 ≤ 10s |
| **P4: WAHA session drops + rate limit + sent-vs-delivered** | N (with OPS pre-req: dedicated SIM, Tailscale-internal WAHA UI) | Test message produces `notification_log.delivered` row via webhook; `WHATSAPP_RESTART_ALL_SESSIONS=true` set; rate-limiter throttles at 15/min |
| **P5: Hebrew/RTL — Bidi, collation, fonts, Outlook** | I (cross-cutting); N (Outlook); E (Puppeteer fonts); O (CSV import direction-mark stripping) | ICU collation declared on `display_name`; Playwright tests Bidi-isolation in mixed strings; Litmus snapshots for every email template; Puppeteer Alpine image installs `font-noto-hebrew`; CSV import test with direction-mark-containing names |
| **P6: hpg5 ops — disk, updates, cloudflared, Defender** | OPS (cross-cutting) with explicit `docs/OPERATIONS.md` runbook artifacts | `docs/OPERATIONS.md` covers Windows Update active hours, VHDX compaction, AV exclusions, cloudflared user, Tailscale probes; backup self-test in F; daily-report make-up logic in R |
| **P7: Solver-Lowdefy contract drift** | S (heartbeat + status rendering); L (UI for all 4 statuses + 4 errors); F (env-rotation deploy script) | Playwright tests exercise each of the 4 statuses × 4 errors; heartbeat banner visible in UI; deploy script restarts both services on shared-secret change |
| **P8: Notification fan-out and signed URLs** | N (per-channel atomic logging, dispatcher recovery); E (signed-URL access log); F (log-redaction middleware); R (cron-event recovery) | `notification_log` rows have per-channel rows; access-log shows iCal polls with rate-limit hits; log redaction tested with grep |
| **P9: Migration from sheet** | M (parallel track, not on critical path for v1 launch) | Two consecutive runs of migration produce byte-equal DB state; user-confirmed sample-week side-by-side; rollback path tested |
| **P10: Prior-art beloved-features preserved with bug-free contract** | D (today view + ASCII-bar parity); O (display-name + color palette); L (Draft → Publish UX); N (daily email layout) | `docs/PRIOR_ART_BUGS.md` exists with user's today-view-bug description; color palette test with 25-soldier roster; ASCII-bar = bar-chart Playwright test |

---

## Sources

### Primary sources (HIGH confidence)
- PRD §15 Risks register: `C:\Projects\shifts manager\docs\PRD.md` — this file extends, not duplicates
- PROJECT.md Active phase definitions: `C:\Projects\shifts manager\.planning\PROJECT.md`
- CLAUDE.md deployment realities + open questions: `C:\Projects\shifts manager\CLAUDE.md`
- [Next.js issue #48017 — Missing dependencies when using standalone output with pnpm 8](https://github.com/vercel/next.js/issues/48017)
- [Next.js issue #65636 — Missing shared workspace dependencies when using standalone output with pnpm](https://github.com/vercel/next.js/issues/65636)
- [Next.js issue #50072 — Dependencies missing in standalone build](https://github.com/vercel/next.js/issues/50072)
- [pnpm + Next.js Standalone + Docker: 5 Failures Before Success — dev.to/kochan](https://dev.to/kochan/pnpm-nextjs-standalone-docker-5-failures-before-success-part-9-g3o)
- [The CP-SAT Primer — d-krupke (Modeling, Parameters chapters)](https://d-krupke.github.io/cpsat-primer/04_modelling.html)
- [OR-Tools #973 — CP-SAT: Best way to find infeasible constraints](https://github.com/google/or-tools/issues/973)
- [OR-Tools #3590 — CP-SAT produces nondeterministic results](https://github.com/google/or-tools/issues/3590)
- [OR-Tools #3943 — Non-deterministic Behavior for CP-SAT with num_workers=1](https://github.com/google/or-tools/issues/3943)
- [WAHA documentation — Sessions API](https://deepwiki.com/devlikeapro/waha/4.1-sessions-api)
- [WAHA Configuration docs](https://waha.devlike.pro/docs/how-to/config/)
- [WAHA Scaling — How to handle 500+ WhatsApp sessions](https://dev.to/waha/waha-scaling-how-to-handle-500-whatsapp-sessions-3fie)
- [Litmus community — dir="rtl" in Outlook & Office365](https://litmus.com/community/discussions/6372-dir-rtl-in-outlook-office365)
- [hteumeuleu/email-bugs #97 — Outlook 1px line with dir attribute](https://github.com/hteumeuleu/email-bugs/issues/97)
- [Microsoft Q&A — How to fix RTL bugs in new Outlook for Mac 16.102](https://learn.microsoft.com/en-in/answers/questions/5606189/how-to-fix-rtl-bugs-in-new-outlook-for-mac-16-102)
- [PostgreSQL Documentation — 23.2 Collation Support](https://www.postgresql.org/docs/current/collation.html)
- [W3C — Strings and Bidi](https://www.w3.org/International/articles/strings-and-bidi/)
- [W3C — Bidi Unicode controls FAQ](https://www.w3.org/International/questions/qa-bidi-unicode-controls.en.html)
- [Puppeteer issue #2230 — Puppeteer doesn't render default fonts](https://github.com/puppeteer/puppeteer/issues/2230)
- [Puppeteer issue #4996 — Arabic font not rendered properly](https://github.com/puppeteer/puppeteer/issues/4996)
- [How to fix iOS push subscriptions getting terminated after 3 notifications](https://dev.to/progressier/how-to-fix-ios-push-subscriptions-being-terminated-after-3-notifications-39a7)
- [Resend — Four Ways to Hurt Your Sender Reputation](https://resend.com/blog/four-ways-to-hurt-your-sender-reputation)
- [Bitsight — The Hidden Cyber Threats of Calendar Subscriptions](https://www.bitsight.com/blog/hidden-dangers-calendar-subscriptions-4-million-devices-risk)
- [Scott Hanselman — Shrink your WSL2 Virtual Disks and Docker Images](https://www.hanselman.com/blog/shrink-your-wsl2-virtual-disks-and-docker-images-and-reclaim-disk-space)
- [AWS Database Blog — Multi-tenant data isolation with PostgreSQL Row Level Security](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)

### Secondary sources (MEDIUM confidence — corroborating examples)
- [Cybertec — Case-insensitive pattern matching in PostgreSQL](https://www.cybertec-postgresql.com/en/case-insensitive-pattern-matching-in-postgresql/)
- [pganalyze — Fuzzy text search & case-insensitive ICU collations](https://pganalyze.com/blog/5mins-postgres-fuzzy-text-search-case-insensitive-ICU-collations)
- [Browserless — How to fix Puppeteer font issues](https://www.browserless.io/blog/puppeteer-print)
- [OneUptime — How to Install Fonts in Docker Images](https://oneuptime.com/blog/post/2026-02-08-how-to-install-fonts-in-docker-images/view)
- [Excel CSV semicolon delimiter — IT Trip](https://en.ittrip.xyz/ms-office/excel/excel-csv-semicolon-fix)
- [NextAuth.js callbacks](https://next-auth.js.org/configuration/callbacks)
- [Auth.js Role Based Access Control guide](https://authjs.dev/guides/role-based-access-control)
- [PWA Push Notifications on iOS in 2026 — what really works](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en)

---
*Pitfalls research for: Shifty — Miluim shift planning SaaS (Hebrew-first, multi-tenant, Lowdefy + CP-SAT + WAHA, single-host hpg5 deployment)*
*Researched: 2026-05-12*
