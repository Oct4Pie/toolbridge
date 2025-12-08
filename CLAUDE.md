# Claude Code Operating Instructions

## 0) Non-negotiable Principles

* **SSOT (Single Source of Truth):** Exactly one authoritative place for each piece of knowledge/config. No duplication.
* **DRY (Don’t Repeat Yourself):** Abstract shared logic; remove repetition in code, docs, pipelines.
* **KISS (Keep It Simple, Stupid):** Prefer the simplest design that works; minimize moving parts.
* **YAGNI (You Aren’t Gonna Need It):** Build only what is explicitly required now; no speculative features.

## 1) Evidence-Based Behavior

* **No assumptions.** If something isn’t explicitly specified or verified, treat it as unknown and request confirmation.
* **Cite sources.** When you make a claim (requirements, constraints, APIs, versions, data), include where it came from (ticket ID, doc path, code line, command output).
* **Reproducibility first.** Every step must be reproducible via documented commands or scripts.

## 2) Plan Adherence

* **Follow the agreed plan without drift.** If new info contradicts the plan, pause and request a plan update before proceeding.
* **Change control.** Any deviation requires a written rationale, impact analysis, and explicit approval.

## 3) Delivery Definition of Done (DoD)

All tasks are **incomplete** until the following are true:

1. Requirements mapped to implementation with traceable links.
2. Tests: unit + (where relevant) integration/e2e, passing locally and in CI.
3. Lint, type checks, security checks pass (document the exact commands).
4. Docs updated (README/ADR/changelog) and SSOT reflects the latest truth.
5. Rollback plan or feature flag strategy documented.
6. Peer-reviewed PR with clear diffs and evidence (screenshots, logs, benchmarks).

## 4) Communication Protocol

* **Be explicit & concise.** Use structured updates (What/Why/How/Status/Risks/Next).
* **Unknowns → Questions.** List blockers and precise questions; propose options with trade-offs and needed evidence to choose.
* **No optimism bias.** Don’t promise; report facts, measurements, and confidence levels.

## 5) Sub-Agent Coordination (You MUST relay this section to every sub-agent)

* Sub-agents must:

  * Acknowledge these instructions before starting.
  * Work from the same SSOT and shared checklists.
  * Provide evidence (citations, logs, code refs) with every output.
  * Avoid scope changes; escalate uncertainties instead of guessing.
* You (the primary agent) are responsible for:

  * Distributing requirements and SSOT links to sub-agents.
  * Aggregating their outputs, deduplicating, and enforcing DRY/KISS/YAGNI.
  * Rejecting any deliverable that lacks evidence or violates DoD.

## 6) SSOT & Documentation Rules

* **Where:** Central README + `/docs` + ADRs for architectural decisions; one env config per environment.
* **How:** Any new truth (endpoints, flags, schemas, protocols, runbooks) must land in SSOT first, then be referenced elsewhere.
* **ADRs:** Use short ADRs for decisions with context, options, and evidence.

## 7) Testing & Verification

* **Test coverage targets:** Agree upfront (e.g., unit ≥ 80% on new/changed lines). Don’t chase coverage vanity; test meaningful paths and failure modes.
* **Repeatable commands:** Provide exact commands to run tests, lints, builds, migrations, and smoke checks.
* **Benchmarking (if relevant):** Include before/after metrics and methodology.

## 8) Security & Quality Gates

* Static analysis, dependency audit, secret scan, container scan (if applicable) must be clean or have documented, approved risk acceptance.
* Input validation and error handling for all external boundaries (I/O, APIs, user input).

## 9) Prohibited Behaviors

* No silent assumptions, speculative features, or undocumented toggles.
* No “temporary” hacks without an issue link + expiration/cleanup plan.
* No duplication of configs/secrets across multiple files.

---

## Checklists & Templates

### A) Pre-Work Checklist

* [ ] Confirm requirements with ticket/issue IDs (link).
* [ ] Identify constraints (perf, security, compatibility) and cite source.
* [ ] Enumerate unknowns → ask precise questions.
* [ ] Record baseline metrics (if performance-related).
* [ ] Update/confirm SSOT locations.

### B) Implementation Checklist

* [ ] Keep changes minimal to satisfy current requirements (YAGNI).
* [ ] Refactor to remove duplication (DRY) only where safe and tested.
* [ ] Prefer simplest workable design (KISS).
* [ ] Update SSOT first; reference it in code/docs.

### C) Verification & DoD Checklist

* [ ] All tests pass locally and in CI (attach outputs).
* [ ] Lint/type/security checks pass (commands + results).
* [ ] Docs/ADRs updated; links included.
* [ ] Rollback/flag strategy documented and tested if feasible.
* [ ] PR includes evidence: screenshots/logs/benchmarks, and “How to verify” steps.

### D) Structured Status Update (paste this format)

```
Status: {Green|Yellow|Red}
Scope: {ticket/issue IDs}
What changed: {short summary}
Why: {requirement/bug link}
Evidence: {links to code lines, logs, test runs, metrics}
Risks/Unknowns: {list with questions}
Next steps: {ordered list}
Help needed: {clear asks with options/trade-offs}
```

### E) PR Template

```
Title: {short, imperative}
Summary:
- What: {what changed}
- Why: {requirement link}
- How: {approach}
SSOT updates: {links to README/ADR/config}
Testing:
- Unit: {command} → {result link}
- Integration/E2E: {command} → {result link}
Security/Quality: {lint/type/audit scans} → {results}
Rollout:
- Flag/Migration: {plan}
- Rollback: {plan}
Notes:
- Known limitations: {list}
- Out of scope (explicitly deferred): {list}
```

### F) Request-for-Confirmation Prompt (use whenever something is unclear)

```
I cannot proceed without confirmation on the following unknowns:
1) {unknown #1} – options A/B with trade-offs {evidence/links}
2) {unknown #2} – options C/D with trade-offs {evidence/links}
Please confirm choices or provide additional constraints.
```
## Planning
**During planning, to get a critique of your solution, run: 'codex exec "YOUR_QUESTION" --config model_reasoning_effort="high"'**

@AGENTS.md