# Feature Landscape — Shifty (Miluim Shift Planning SaaS)

**Domain:** Multi-tenant workforce scheduling SaaS, narrowed to military reserve (miluim) teams of 6–200, Hebrew-first, self-hosted, free of branding paywalls.
**Researched:** 2026-05-12
**Scope:** Validate PRD §13 v1 scope against the broader shift-scheduling SaaS category. Categorize PRD features. Cross-check PRD §14 deferrals. Surface PRD-required features that are uncommon in this category (the differentiator wedge).
**Confidence:** MEDIUM-HIGH on category norms (multiple independent comparison sites converge); LOW on miluim-specific competition (no direct competitor found — confirms the wedge).

---

## Reading guide

Every feature carries a status marker tying it back to the PRD:

| Marker | Meaning |
|--------|---------|
| ✓ | Already specified in PRD v1 (§7 / §13) |
| ⚠ | Deferred to v1.1 / v2 (PRD §13.1.1 / §14) |
| ✗ | Explicitly out of scope (PRD §14, with stated rationale) |
| ? | Not in PRD — potential gap (evaluated below) |

Confidence column for category-norm claims:
- **HIGH** — confirmed across 3+ competitor sources
- **MEDIUM** — 1–2 sources or strong inference from category
- **LOW** — single source or category-adjacent reasoning

---

## 1. Table Stakes

Features users will *expect* and will leave (or never adopt) if missing. These are the table-stakes baseline for any modern workforce-scheduling SaaS in 2026.

| Feature | Why expected | PRD status | Complexity | Confidence |
|---------|--------------|------------|------------|------------|
| Roster / people CRUD | First thing every user does. Without it nothing else works. | ✓ §7.3 | Low | HIGH |
| Shift schema (slots, times, headcount) | Templates from 2x12 / 3x8 + custom. Every scheduling product ships this. | ✓ §7.4 | Low | HIGH |
| Self-service availability declaration | Soldier/employee tells the system when they can't work — universal. | ✓ §7.5 | Medium | HIGH |
| Auto-scheduling with constraints | When I Work, Deputy, Sling, Shiftboard, Snap Schedule all ship rule-aware auto-scheduling. Soldiers will not return to manual after seeing it. | ✓ §7.6 + §7.8 | High | HIGH |
| Manual schedule editing / drag-and-drop | Fundamental escape valve; every product treats auto-scheduling as a draft that humans must be able to tune. | ✓ §7.7 (manager hand-edit) | Medium | HIGH |
| Publish / unpublish state machine | "Draft → Publish" is the canonical pattern across the category. | ✓ §7.7 | Medium | HIGH |
| Shift swap workflow (1-for-1) | When I Work, Sling, Shyft, Deputy, Snap Schedule, Evolia all ship this. Soldiers expect to negotiate among themselves. | ✓ §7.10 | Medium | HIGH |
| Push / email notifications on schedule events | Schedule-published, swap-proposed, swap-approved, etc. Universal table stakes. | ✓ §7.11 | Medium | HIGH |
| Mobile-friendly UI for soldiers (PWA OK) | Soldiers are mobile-first; desktop-only schedulers are dead on arrival. | ✓ §7.13 (mobile-first soldier dashboard) | Medium | HIGH |
| Calendar view of the schedule | Day / week view of who-works-when is the home screen of every competitor. | ✓ §7.13 (today / week) | Medium | HIGH |
| Time clock (check-in / check-out) | When I Work, Deputy, Sling, Homebase, Connecteam all ship this; opt-in is fine, omitting is not. | ✓ §7.9 | Low | HIGH |
| iCal export / calendar subscription | Every competitor with calendar export ships .ics. Without it, "my schedule in my phone calendar" doesn't happen. | ✓ §7.14 | Low | HIGH |
| CSV export | Tabular dump for spreadsheet handoff is universal. | ✓ §7.14 | Low | HIGH |
| Role-based access control | Manager / member at minimum. Multi-team org requires admin role too. | ✓ §8.3 (4 roles) | Medium | HIGH |
| Audit trail on critical state changes | Schedule publish, swap approvals, manual overrides — without audit, dispute resolution is impossible. | ✓ §7.7 + §7.10 + §8.2 | Medium | HIGH |
| Self-signup / onboarding flow | If users can't get from landing page to first useful action without a salesperson, free-tier SaaS dies. | ✓ §7.1 + §12.1 | Medium | HIGH |
| Roster import (CSV) | Bulk-loading existing rosters from a spreadsheet is the de-facto first action for any new tenant. | ✓ §7.3.1 (elevated from v1.1 to v1.0) | Medium | HIGH |
| Schedule conflict detection (rule violations highlighted) | "Don't double-book", "respect rest hours" — table stakes for any auto-scheduler. | ✓ §7.6 + §7.7 (highlights, not blocks) | Medium | HIGH |
| In-app notification inbox | Bell icon + queue is universal. Replaces relying on email being seen. | ✓ §7.11 (in-app channel) | Low | HIGH |
| Daily / weekly schedule recap email | "What's happening today" digest is shipped by Homebase, When I Work, Deputy, Sling. Auditor persona alone justifies it. | ✓ §7.12 | Medium | HIGH |

**Verdict:** **Every table-stakes feature is in PRD v1.** No gaps in this band.

---

## 2. Differentiators

Features that set Shifty *apart* from When I Work / Deputy / Sling / Shiftboard. These are PRD-required and uncommon-in-category — they are the wedge into the Israeli miluim market.

| Feature | Value proposition | PRD status | Confidence | Why this matters |
|---------|-------------------|------------|------------|------------------|
| **Hebrew RTL UI as the default locale** | Competitors are English-first with RTL bolted on (or absent). Hebrew users live with broken layouts, mojibake names, English-only error messages. Shifty puts Hebrew at the centre. | ✓ §7 + §8.5 + §10 | HIGH | Direct: no global SaaS does this end-to-end (Auto Shift Planner, Deputy, When I Work do not natively ship Hebrew RTL templates for email + push + in-app simultaneously). |
| **Miluim weekend semantics (Fri+Sat hardcoded weekend; weekend-separation rule)** | Israeli weekend is Fri-Sat, not Sat-Sun. The `weekend_separation` rule ("if you worked weekend N, you don't work N+1") is a miluim-specific fairness norm that no global SaaS encodes. | ✓ §7.6 `weekend_separation` rule | HIGH | Generic schedulers treat weekend as Sat-Sun and have no concept of "rotating weekend off" as a hard rule. |
| **Hebrew daily-email "today's assignments" report shape** | Replicates the cherished prior-art Google Sheet daily report. Hebrew, RTL, today-focused, plain-text-fallback for Outlook. P4 auditor (no-login battalion commander) lives or dies on this. | ✓ §7.12 + R5 mitigation | HIGH | Competitors send English digests; almost none ship plain-text fallback for RTL email-client bugs. |
| **ASCII-bar leaderboard preserved from prior art** | `█████░░░░░ Daniel: 5 shifts` rendered in monospaced font + accompanying accessible bar chart. Beloved feature from the spreadsheet; emotional anchor for tenant #1. | ✓ §7.13 + §7.12 | HIGH | No competitor ships this. It's a cultural artifact of the prior-art sheet. Cheap to build, high emotional value. |
| **Per-person calendar colors (24-color preset, soldier-overridable)** | "My color" identity across calendar cells, leaderboard bars, swap avatars. Preserved from prior art. | ✓ §7.3 + §7.13 | HIGH | Competitors offer colors-by-role or colors-by-shift-type; per-person color identity is uncommon and is a beloved spreadsheet feature. |
| **UUID PKs with display-name-never-a-join-key invariant** | Hardened against the smart-quote bug (U+2019 vs U+0027) that silently dropped COUNTIFs in the prior-art sheet. Encoded as fixture (`kibbutz.sql`) to keep regressions out. | ✓ §7.3 + §10 + Context | HIGH | Most SaaS uses UUID PKs but doesn't write *fixtures that intentionally seed smart-quoted names* to enforce the invariant. This is a defensive engineering culture marker, not a flashy feature, but matters for product quality. |
| **Manager manual override post-publish with `force_override` audit + reason field** | The escape hatch for reserve-duty reality (no-shows, last-minute pulls). Distinct from swap negotiation — it's a unilateral edit. Force-override on rule violation is captured in audit `payload`. | ✓ §7.7 "Manager manual override" | HIGH | Competitors offer post-publish editing, but few capture `force_override: true` as a discrete audit field with operator-typed reason. This is the kind of detail that survives a dispute six months later. |
| **Per-recipient locale (not per-tenant)** | Mixed-locale tenants (Hebrew-default tenant with a few English-speaking auditors) are real and not theoretical. Stored on `app_user.locale` / `report_recipient.locale`. | ✓ §7.11 + §7.12 + Key Decision | HIGH | Most SaaS sets locale per-account or per-tenant. Per-recipient is rarer and is exactly right for the auditor (P4) pattern. |
| **Solver infeasibility report names offending rules** | When the solver says "impossible", it tells the manager *which rule combination* caused it. v1.1 will add soldier-level attribution. | ✓ §7.6 + §7.8 + R9 mitigation | HIGH | Many auto-schedulers give up silently or say "no solution found"; surfacing the constraint(s) is a manager UX win. |
| **Per-soldier override that can only tighten** | A team's `max_consecutive_nights=4` can be overridden to `2` for one soldier; cannot be loosened to `6`. Encoded semantics, not a wiki note. Swap auto-approval is evaluated with overrides applied. | ✓ §7.6 + §7.10 + Key Decision | HIGH | Most schedulers allow per-employee constraints but don't formally encode "override can only tighten"; the semantic guarantee is what makes auto-approve safe. |
| **OR-Tools CP-SAT solver with explicit fairness objective (`count_variance` / `hours_variance` / `night_variance` / `off`)** | Manager picks the fairness metric. The solver minimizes variance. This is *explicit* fairness, not an opaque "AI-optimized" black box. Reproducible by seed. | ✓ §7.6 + §7.8 | HIGH | Competitors talk about "AI fairness" without exposing the objective function. Shifty's transparency is a differentiator for organizations whose leaders need to defend their schedule to soldiers ("the solver minimized X, which is why your count is Y"). |
| **Apache-2.0 + self-hosted, no "Powered by X" paywall** | Lowdefy chosen specifically because Appsmith/Budibase/ToolJet gate branding removal behind paid Business plans. Shifty has no paywall. | ✓ Context + Tech Stack | HIGH | This is the *reason the project exists* on Lowdefy. Self-hosted scheduling with zero vendor branding is essentially absent from the SaaS competitor set (Staffjoy is dead; Auto Shift Planner is a desktop algorithm tool, not a SaaS). |
| **Constraint-lock with 24h-pre-lock notification** | Soldiers know when availability declaration is due. Lock prevents writes by non-managers. Manager override after lock is audited. | ✓ §7.5 + §7.11 (`availability.lock_approaching`) | MEDIUM | Competitors have "schedule freeze" dates but the 24h-pre-lock proactive nudge is less common. |
| **WhatsApp as a first-class notification channel (via WAHA, self-hosted)** | In Israel, WhatsApp is *the* messaging channel. Email goes unread; SMS costs money; WhatsApp is universal. WAHA gives a self-hosted, no-Business-API path. | ✓ §7.11 + Tech Stack | HIGH | Global SaaS competitors push email + SMS + push. WhatsApp-first is the right wedge for Israeli market. (Risk R2 documented re: WAHA session-drop.) |
| **iCal subscription URL signed with HMAC, per-token revocable from soldier profile** | Calendar app integration without OAuth (Google Calendar 2-way is deferred to v1.1). The signed-URL-with-revoke is a thoughtful security posture for a calendar feed. | ✓ §7.14 + R11 + §17 | MEDIUM | Most schedulers ship one-shot .ics download but not subscription URLs at all, let alone revocable signed ones. |
| **Hebrew-aware PDF rendering (Puppeteer + correct font + RTL CSS + A4/A3)** | Server-side rendering with Puppeteer chosen for Hebrew correctness (wkhtmltopdf is flaky on RTL). Israeli date format `DD/MM/YYYY`. | ✓ §7.14 + §15 Open #1 | MEDIUM | Generic PDF exporters produce broken Hebrew; this is one of the engine-choice decisions that separates "ships" from "ships well". |
| **Roster CSV import with smart-quote canonicalization at write time** | Smart-quote variants stripped before writing `soldier.display_name`. Prior-art sheet bug encoded as a defense. | ✓ §7.3.1 + §13.2 migration script | HIGH | No global SaaS specifically defends against U+2019 (curly apostrophe) name pollution at import time. It's a parochial Hebrew-Excel-on-Windows problem. |

**Differentiator narrative:** Shifty's wedge is "the schedule planner for Israeli miluim units that already work in Hebrew, on WhatsApp, with the prior-art sheet on a manager's laptop." None of When I Work, Deputy, Sling, Shiftboard, Snap Schedule, Connecteam, Homebase, or Workforce.com would feel native to that user. The differentiators above are exactly what makes Shifty's first 12 soldiers stay vs. churning back to the spreadsheet.

---

## 3. Anti-Features (explicitly do NOT build)

Things competitors ship that Shifty deliberately does NOT — with reasoning rooted in Shifty's positioning (military reserve, Hebrew-first, self-hosted, free-tier-friendly, single-host operationally).

| Anti-feature | Why competitors ship it | Why Shifty deliberately skips | What to do instead | PRD ref |
|--------------|-------------------------|-------------------------------|---------------------|---------|
| **Geofenced time clock** | Restaurant/retail employers want to prevent buddy-punching. | Privacy hostile in a military context; soldiers' locations are sensitive; no compelling v1 use case; adds OS-permissions complexity. | Button + manual time pickers. No location data captured. | ✗ §14 #5 + §7.9 |
| **Payroll integration** | US/EU SaaS lives or dies on payroll because shifts → hours → wages. | Miluim duty isn't paid hourly by the unit. Out of domain. | CSV export of `time_clock_entries`; downstream system can ingest if needed. | ✗ §14 #4 |
| **Predictive scheduling / fair-workweek compliance enforcement** | US labor laws (Oregon, NYC, SF, Seattle) require predictability pay, 14-day advance notice, etc. Deputy ships a "Fair Workweek" SKU. | These laws don't apply to Israeli reserve duty. Building compliance infrastructure for laws the user isn't subject to is dead weight. | Document the v1.1 hook if non-IDF tenants emerge. | ? (not in PRD; correctly absent) |
| **Labor cost forecasting / budget enforcement** | For-profit employers want to cap labor cost vs. forecasted demand. | Miluim labor cost isn't a tenant concern; the unit doesn't have a budget knob. | None. Out of domain. | ? (not in PRD; correctly absent) |
| **Demand forecasting / sales-vs-staffing correlation** | Retail and hospitality SaaS correlates POS sales data with staffing. | No POS data exists; demand is operational (number of soldiers required for a slot), not commercial. | Static `headcount` per slot. | ? (not in PRD; correctly absent) |
| **Shift bidding marketplace ("open shifts" employees bid on)** | Hospital nursing, retail, hospitality use this for voluntary overtime fills. | Miluim assignments are *imposed* by call-up, not voluntarily picked. Shift swap (negotiated 1-for-1) is the right paradigm; bidding is the wrong one. | 1-for-1 swap workflow. Manager manual override for unilateral reassignment. | ✗ Implicit; not in v1; surfaced as gap then dismissed below |
| **SMS auth** | Carrier-backed authentication. | Adds carrier integration cost; magic-link via Resend works; soldiers all have email + WhatsApp. | Magic link via NextAuth EmailProvider. | ✗ §14 #6 |
| **Phone-call notifications** | Some products call employees for urgent missed shifts. | Out of domain; voice infrastructure is high-effort, low-value. | Push + WhatsApp covers urgency. | ✗ §14 #7 |
| **Rules expression DSL** | Power users in enterprise want arbitrary rules. | 8-rule catalog covers prior-art needs. DSL is "future escape valve". Adds parser, syntax errors, debugging surface. | Frozen 8-rule catalog with per-soldier override (tightening). DSL is v2 horizon. | ✗ §14 #8 |
| **Cross-team / cross-tenant coverage** | "Borrow a nurse from ICU to cover ER" patterns. | Membership + availability complexity; not validated in miluim discovery. | One-user-one-team membership in v1; multi-team within a tenant. Cross-team is v2 horizon. | ✗ §14 #2 |
| **Multi-org membership for one user** | Some employees moonlight across employers. | Auth + RLS simplicity. Reservists don't moonlight across units. | One user = one tenant. v2 horizon. | ✗ §14 #3 |
| **Native mobile apps (iOS/Android)** | App store distribution, push notification reliability, offline. | PWA + Web Push covers v1-scale use case; building two native apps doubles team. | PWA, Web Push, mobile-friendly Hebrew RTL UI. v2 may revisit. | ✗ §14 #1 |
| **Google Calendar two-way sync** | "Block out time in Google Calendar and have it appear as availability." | iCal subscription covers the read-side need; bidirectional requires OAuth, webhook handling, conflict resolution. Deferred to v1.1. | iCal subscription (read-only) for v1. | ⚠ §14 #9 (v1.1) |
| **Calendar widget via Lowdefy npm plugin (FullCalendar)** | Looks pretty. | Adds an unstable plugin dependency. v1 uses a simpler day-list view. | Day-list view in v1; FullCalendar widget v1.1. | ⚠ §14 #10 (v1.1) |
| **Multi-language UI beyond Hebrew + English** | Multinational SaaS supports 10+ locales. | No discovery signal for Arabic, Russian, French, etc. | ICU MessageFormat, CI parity check, easy to add post-v1 if demand emerges. | ✗ §14 #11 |
| **In-app team chat / direct messages between soldiers** | When I Work, Sling, Microsoft Shifts, Breakroom all bundle messaging. | Soldiers already have WhatsApp groups. Adding a chat UI duplicates a tool people already use. Notifications are one-way (system → user); two-way chat is not in scope. | Out-of-band: rely on existing WhatsApp groups for soldier-to-soldier chat. Swap-request UI carries the only required two-way communication. | ? (not in PRD; correctly absent — see "evaluated gaps" below) |
| **Shift broadcast / "find a replacement" marketplace** | Connecteam, Shyft, WorkJam ship a "broadcast my shift to anyone qualified, first-tap wins" feature. | Conflates the swap negotiation (1-for-1, two named parties) with a shift-marketplace (one-to-many auction). The latter is wrong for miluim where assignments are commanded. | Manager manual override does the same job: if a soldier can't show, the manager reassigns unilaterally. | ? (not in PRD; correctly absent — see below) |
| **Photo-verified clock-in (selfie at check-in)** | When I Work ships this to prevent buddy-punching. | Privacy hostile in a military context; reservists wouldn't accept. | Trust + manual edit + manager audit. | ? (not in PRD; correctly absent) |
| **AI-generated schedule explanations / natural-language schedule narration** | Emerging trend in 2024-2025 SaaS. | Adds LLM dependency; non-deterministic; not requested. | Solver `infeasibility_report.offending_rules` is the explanation. | ? (not in PRD; correctly absent) |
| **VAPID key rotation in v1** | Security-best-practice rotation periodically invalidates push subscriptions. | Rotation invalidates all push subs → forces every soldier to re-subscribe → support burden during early adoption. Acceptable v1 trade-off. | No rotation. Documented as Key Decision; revisit v1.1. | ✗ Key Decision (Context) |
| **PITR (point-in-time recovery)** | Enterprise expects WAL archiving. | Single-host single-tenant operationally; nightly `pg_dump` + 24h RPO is acceptable for v1. | `pg_dump` cron in v1; WAL archiving v1.1. | ⚠ Context (v1.1) |

---

## 4. Evaluated Gaps (features NOT in PRD; potential additions vs. correct omissions)

Per quality gate: at least 3 gaps surfaced and evaluated. Below are seven category-norm features that competitor research surfaced but PRD does not list. Each gets a yes/no recommendation.

### Gap 4.1 — Open-shift broadcast / "find a replacement" feature

**Category context:** Connecteam, Shyft, WorkJam, ZoomShift all ship a "broadcast this shift, qualified people see it, first-to-accept wins" feature. It's a marketplace-style fill.

**Should Shifty build it?** **NO.**
- **Reasoning:** In miluim, assignments are imposed by call-up. A soldier who can't make their shift escalates to the commander (P2 manager), who either: (a) negotiates a 1-for-1 swap with the soldier on the commander's behalf via the existing swap workflow, or (b) uses **manager manual override** to unilaterally reassign someone else. The broadcast paradigm — first-tap-wins from a pool of qualified volunteers — conflicts with the chain-of-command model.
- **What if a non-military tenant wants it later?** It would be a clean addition to the PRD §7.10 swap module: a `swap_request` with `counterparty_soldier_id=null` and a broadcast event firing instead of a direct notification. Not needed for v1.
- **Confirmation:** Correctly omitted. Anti-feature.

### Gap 4.2 — In-app messaging / team chat between soldiers

**Category context:** When I Work, Sling, Microsoft Shifts, Breakroom, Snap Schedule all bundle 1:1 + group messaging.

**Should Shifty build it?** **NO.**
- **Reasoning:** Israeli reserve teams have *already-existing* WhatsApp groups (per the discovery / persona pain-points). Adding a chat UI inside Shifty duplicates a tool people will not abandon. The only two-way communication Shifty *needs* is swap-request accept/decline, and that's already in PRD §7.10.
- **What about the "request a swap" comment thread?** The `swap_request.manager_decision_reason` field + audit log captures the relevant business communication. Free-form chatter belongs on WhatsApp.
- **Confirmation:** Correctly omitted. Anti-feature.

### Gap 4.3 — Overtime alerts / max-hours alarm

**Category context:** When I Work, Deputy, Workforce.com, Sling all surface a UI warning when an assignment would push someone over an hours threshold. Often tied to labor-law compliance.

**Should Shifty build it?** **PARTIAL — already covered, but could be elevated.**
- **Reasoning:** PRD §7.6 includes the `max_weekly_hours` (default 60) and `max_shifts_per_period` rules. The solver respects them, and a **hand-edit that violates them produces a highlighted warning** per §7.7. So the functionality is present, but the *UX framing* is "rule violation highlighted in red on the draft view" rather than "overtime alert".
- **Recommendation:** No PRD change required. v1.1 might consider an event-driven notification when manager hand-edits push a soldier over a threshold (`schedule.overtime_warning`), but that's polish.
- **Confirmation:** Substantively in PRD; UX could mature. **No gap requiring re-elevation.**

### Gap 4.4 — Mobile PWA install prompt

**Category context:** All mobile-first scheduling apps prompt the user to "Add to Home Screen" so subsequent loads feel native.

**Should Shifty build it?** **YES, but it's already deferred to v1.1.**
- **Reasoning:** PRD §13.1.1 ("Mobile PWA install prompt") lists this as v1.1 work. The dashboard is mobile-friendly (§7.13), but the install-prompt nudge isn't shipped in v1.
- **Recommendation:** Keep v1.1 placement. Low risk to v1 if absent; iOS Safari supports add-to-home-screen without a prompt anyway.
- **Confirmation:** Correctly deferred. **No gap requiring re-elevation.**

### Gap 4.5 — Bulk operations (bulk invite, bulk archive, bulk role change)

**Category context:** Standard in HR-adjacent SaaS at scale.

**Should Shifty build it?** **NO for v1.**
- **Reasoning:** v1 ships **CSV roster import** (§7.3.1), which is the main bulk operation. Other bulk ops (bulk invite-code generation, bulk archive) are listed for v1.1 (§13.1.1). Tenant #1 has 12 soldiers — bulk archive is not a 12-soldier problem.
- **Confirmation:** Correctly deferred. **No gap requiring re-elevation.**

### Gap 4.6 — Multi-week recurring shift templates ("alternating weekends" pattern)

**Category context:** Hospital nursing software ships "every other Friday off" templates. Snap Schedule and Shifton both do this.

**Should Shifty build it?** **NO for v1.**
- **Reasoning:** Listed in PRD §13.1.1 (v1.1). The miluim use case is a single planning window (typically 2-4 weeks); recurring templates across windows are a v1.1 quality-of-life gain, not a v1 blocker. `weekend_separation` rule already enforces the *spirit* of alternating weekends.
- **Confirmation:** Correctly deferred. **No gap requiring re-elevation.**

### Gap 4.7 — Soldier-level "preferred days off" soft preference

**Category context:** Standard in mature schedulers: a preference layer that *informs fairness* but doesn't enforce hard blockouts.

**Should Shifty build it?** **NO for v1.**
- **Reasoning:** Listed in PRD §13.1.1 (v1.1). v1's hybrid availability UI (range blockout + per-slot override) already covers hard constraints; preferences add a solver dimension that complicates the objective function. Defer until v1's fairness objective is field-tested.
- **Confirmation:** Correctly deferred. **No gap requiring re-elevation.**

### Gap 4.8 — Compliance / labor-law guardrails (predictive-scheduling pay, advance-notice enforcement)

**Category context:** US/EU SaaS ships extensive labor-law modules.

**Should Shifty build it?** **NO.**
- **Reasoning:** Israeli reserve duty is not subject to US Fair Workweek laws. Israeli employment law has its own (different) constraints (e.g., the Israeli Employment of Reservists Act handles employer-side obligations, not unit-side scheduling). Building generic compliance infrastructure for non-applicable jurisdictions is wasted effort.
- **Confirmation:** Correctly omitted. Anti-feature for Shifty's positioning. Re-evaluate if a non-IDF tenant (e.g., a civilian-shift-work tenant) emerges.

### Gap 4.9 — Tenant analytics dashboard for *cross-tenant* insights (admin-of-Shifty view)

**Category context:** SaaS platforms often build a meta-admin dashboard for the platform operator.

**Should Shifty build it?** **NO for v1.**
- **Reasoning:** PRD §7.13 covers *within-tenant* admin dashboard (invite-code stats, active users, etc.). A *platform operator's* cross-tenant view is for Shifty-the-business, not for tenants. The user is also the platform operator and can query Postgres directly.
- **Confirmation:** Correctly omitted. Not a gap for v1.

### Gap 4.10 — Photo-verified clock-in

**Category context:** When I Work ships this; some retail SaaS makes it default.

**Should Shifty build it?** **NO.**
- **Reasoning:** Privacy hostile in a reserve-duty context. Soldiers are unlikely to accept "take a selfie to prove you're at the shift." Trust + audit is the right model.
- **Confirmation:** Correctly omitted. Anti-feature.

**Net gap analysis verdict:** **Zero gaps require re-elevation into v1.** PRD §13 v1 scope is comprehensive against industry norms within Shifty's chosen positioning. PRD §14 deferrals are correctly placed.

---

## 5. Feature Dependencies (for downstream roadmap)

```
[Migrations 0001-0007]
        |
        v
[Tenancy + Auth + RBAC]
        |
        +------- [Org tree (units/platoons/teams)] -----+
                        |                                |
                        v                                |
                 [Soldier CRUD]                          |
                        |                                |
                        +--- [CSV Roster Import] <-------+
                        |
                        v
                 [Shift Slots + Templates]
                        |
                        v
                 [Planning Window + Shift Instances]
                        |
                        v
                 [Availability UI + Constraint Lock] <-- [Notifications dispatcher (parallel)]
                        |                                          |
                        v                                          v
                 [Rules Engine Config]                       [Cron Service + Daily/Weekly]
                        |
                        v
                 [Solver Service /solve]
                        |
                        v
                 [Draft Generation + Manager Edit]
                        |
                        v
                 [Publish + Assignment View]
                        |
            +-----------+-----------+----------------+
            v           v           v                v
       [Swap Wkfl]  [Mgr Override] [Time Clock] [Dashboard + ASCII bars]
                                          |                  |
                                          +-----> [Exports: iCal / CSV / PDF]
```

(Source: PRD §13.1, reproduced for the FEATURES context.)

**Notable dependency callouts:**
- **CSV Roster Import depends on Soldier CRUD** but **gates onboarding of every subsequent tenant** — it's a long-pole feature for v1 GA. Prioritize early.
- **Notification dispatcher can build in parallel** with the schedule pipeline because it has no schedule-domain dependency; it just needs the four channels working.
- **Manager Manual Override** has the same dependency profile as the swap workflow (both mutate published assignments) — they should be built together to share the audit-log code path.
- **Dashboard charts** depend on closed/published assignments existing — they are correctly the **last-mile** features and can ship right before GA.

---

## 6. MVP Recommendation

Per PRD §13 phasing, the v1 MVP ships every feature in §13.1.1. The MVP is **not a feature-cut version of v1**; v1 itself is the MVP. The non-negotiables for first-tenant productive use:

1. **Foundations + RBAC + tenant isolation** (PRD G5 zero-leak)
2. **Org + people + CSV import** (the user's existing roster has to land)
3. **Availability + rules + solver** (the headline value: solver replaces 4-hour spreadsheet work)
4. **Schedule lifecycle (draft → publish → close) + manager manual override + audit**
5. **Notifications via email + WhatsApp + push + in-app, Hebrew-RTL templates**
6. **Daily-email + weekly digest cron** (P4 auditor lives on this; G4 success signal)
7. **Dashboard: today view + ASCII-bar leaderboard + team calendar** (preserved prior-art beloved features)
8. **iCal subscription + CSV export + PDF (Puppeteer for Hebrew correctness)**
9. **Hebrew RTL default + English LTR alternative**

**Hardest single milestone:** Phase 4 (Solver + Schedule). The solver-Lowdefy integration, the draft-publish-edit lifecycle, and the audit log all converge here.

**Most likely first-to-fail:** Phase 6 (Notifications). WAHA self-hosted is the highest delivery-risk dependency (R2). Build fallback (push + in-app always present) before WhatsApp confidence is validated.

---

## 7. Cross-Reference to PRD Sections

| PRD section | Feature category | Featured in this doc |
|-------------|------------------|----------------------|
| §3 Vision & Goals (G1-G5) | Anchors | All "differentiators" tie to G1, G2, G3, G4, G5 |
| §6 User Stories U1–U4 | Table stakes + differentiators | §1, §2 |
| §7.1 Tenant & org | Table stakes (multi-tenant) | §1 |
| §7.2 Auth & invite codes | Table stakes + differentiator (Crockford base32 codes) | §1, §2 |
| §7.3 + §7.3.1 People + CSV import | Differentiator (smart-quote defense) | §2 |
| §7.4 Shift schemas | Table stakes | §1 |
| §7.5 Availability | Table stakes + differentiator (hybrid UI + constraint lock) | §1, §2 |
| §7.6 Rules engine | Differentiator (8-rule frozen catalog, tighten-only override, weekend semantics) | §2 |
| §7.7 Schedule lifecycle | Table stakes + differentiator (manager manual override + force_override audit) | §1, §2 |
| §7.8 Solver | Differentiator (CP-SAT, explicit fairness objective, infeasibility report) | §2 |
| §7.9 Time clock | Table stakes (anti-feature: no geofence, no photo) | §1, §3 |
| §7.10 Swap requests | Table stakes (anti-feature: no broadcast marketplace) | §1, §3 |
| §7.11 Notifications | Differentiator (WhatsApp first-class, per-recipient locale) | §2 |
| §7.12 Reporting | Differentiator (Hebrew daily email shape, per-recipient locale) | §2 |
| §7.13 Dashboard | Differentiator (ASCII bars, per-person colors, four chart views) | §2 |
| §7.14 Exports | Differentiator (signed iCal subscription, BOM-CSV, Puppeteer Hebrew PDF) | §2 |
| §14 Out of scope | Anti-features | §3 |
| §13.1.1 v1.1 | Deferred (anti-features for v1) | §3 + Gap evaluation §4 |

---

## 8. Sources

### Competitor and category research (MEDIUM confidence — multiple sources agree)
- [When I Work — Smarter Employee Scheduling](https://wheniwork.com/) — auto-scheduling, WorkChat, photo clock-in
- [Sling vs When I Work comparison](https://wheniwork.com/blog/getsling-vs-wheniwork) — feature comparison
- [Sling — Free Employee Scheduling](https://getsling.com/) — drag-and-drop, free tier up to 30 users
- [Deputy](https://www.deputy.com/fair-workweek) — fair workweek compliance, AI scheduling
- [Shiftboard](https://www.shiftboard.com/) — enterprise compliance, predictive labor forecasting
- [Snap Schedule — Open Shifts and Bidding](https://www.snapschedule.com/docs/ss365/scheduler-manual/Employee_Remote_Access/Open-Shifts-And-Open-Shift-Bids.html) — shift bidding mechanics
- [Connecteam — Sling alternative review](https://connecteam.com/reviews/sling/) — find-replacement, shift broadcast
- [Workforce.com — Shift Bidding](https://www.workforce.com/software/shift-bidding) — bidding workflows
- [Microsoft Shifts](https://www.microsoft.com/en-us/microsoft-teams/staff-scheduling-shift-management/) — Teams-integrated scheduling
- [Shyft — Shift Marketplace](https://www.myshyft.com/shift-marketplace/) — open-shift marketplace and fairness algorithms
- [SelectHub — Shiftboard vs Sling](https://www.selecthub.com/employee-scheduling-software/shiftboard-vs-sling/) — enterprise vs SMB comparison
- [SelectHub — Deputy vs Shiftboard](https://www.selecthub.com/employee-scheduling-software/deputy-vs-shiftboard/) — capability matrix
- [SelectHub — Top Shiftboard alternatives](https://www.selecthub.com/employee-scheduling-software/shiftboard/alternatives/) — competitor map
- [People Managing People — 30 Best Shift Scheduling Software 2026](https://peoplemanagingpeople.com/tools/best-employee-shift-scheduling-software/) — category overview
- [Zelos — Shift marketplace](https://getzelos.com/glossary/shift-marketplace) — marketplace mechanics
- [WorkJam — Flexible Shift Management](https://www.workjam.com/products/flexible-shift-management/) — broadcast / VTO patterns
- [Evolia — Shift Swaps](https://evolia.com/shift-swaps-software/) — swap mechanics with manager approval

### Fair-workweek / predictive scheduling (MEDIUM confidence)
- [Workforce.com — Fair Workweek Laws Explained 2026](https://www.workforce.com/news/predictive-scheduling-laws)
- [Paycom — Predictive Scheduling Laws by State (2026)](https://www.paycom.com/resources/blog/predictive-scheduling-laws/)
- [Deputy — Fair Workweek Compliance Software](https://www.deputy.com/fair-workweek)

### Fairness algorithms in scheduling (LOW-MEDIUM confidence; single-vendor source)
- [Shyft — Fair Distribution Algorithms For Equitable Employee Scheduling](https://www.myshyft.com/blog/fair-distribution-algorithms/)
- [Shyft — Schedule Fairness Metrics](https://www.myshyft.com/blog/schedule-fairness-metrics/)
- [PMC — Nurse perspectives on AI-based shift scheduling for fairness](https://pmc.ncbi.nlm.nih.gov/articles/PMC12406402/) — academic, HIGH confidence on methodology

### Hebrew RTL UI design (MEDIUM-HIGH confidence)
- [Tomedes — Optimize UI/UX in Hebrew Software Interfaces](https://www.tomedes.com/translator-hub/optimize-ui-ux-hebrew-software)
- [Gett Engineering — SupportsRtl: native Hebrew speaker perspective](https://medium.com/gett-engineering/be-a-pal-supportsrtl-81a88dae5132)
- [PageOneFormula — Implementing RTL Language Support](https://pageoneformula.com/implementing-right-to-left-language-support/)
- [Placeholder Text — Complete Guide to RTL Layout Testing](https://placeholdertext.org/blog/the-complete-guide-to-rtl-right-to-left-layout-testing-arabic-hebrew-more/)

### Open-source / self-hosted scheduling (HIGH confidence — confirms wedge)
- [AutoShiftPlanner — Open Source Roster Scheduling](https://betaiotazeta.github.io/AutoShiftPlanner/) — heuristic algorithm, desktop tool (NOT a SaaS)
- [OptaWeb Employee Rostering with OptaPlanner](https://www.optaplanner.org/) — self-hosted optimizer, enterprise-flavored
- [Staffjoy — Open-Source Scheduling Software](https://www.staffjoy.com/) — abandoned project
- [Clockwise — Top Open Source Employee Scheduling Software for 2025](https://www.getclockwise.com/blog/open-source-scheduling-software) — survey
- [MiHCM — Open-source shift scheduling guide](https://mihcm.com/resources/blog/open-source-shift-scheduling-software-a-comprehensive-guide/) — best practices

### Miluim / IDF reserves (HIGH confidence on context; confirms no direct competition)
- [Wikipedia — Reserve duty (Israel)](https://en.wikipedia.org/wiki/Reserve_duty_(Israel)) — institutional context
- [Herzog Law — Military Reserve Service](https://herzoglaw.co.il/en/news-and-insights/client-update-military-reserve-service/) — Israeli employment-law context
- [Hasbara — Israel's Mandatory Military Service and Reserve System](https://hasbara.co.il/resources/idf-history-and-structure/israel-s-mandatory-military-service-and-reserve-system) — system overview
- No miluim-specific scheduling SaaS competitor found in search — confirms the wedge

### Internal references (HIGH confidence — authoritative)
- `C:\Projects\shifts manager\docs\PRD.md` (§3, §6, §7, §13, §14, §15)
- `C:\Projects\shifts manager\.planning\PROJECT.md`
- `C:\Projects\shifts manager\CLAUDE.md`

---

*End of FEATURES.md — feeds requirements definition step. Categories are clean; v1 PRD scope verified comprehensive against industry; PRD §14 deferrals reaffirmed; 10 potential gaps surfaced and dismissed with reasoning.*
