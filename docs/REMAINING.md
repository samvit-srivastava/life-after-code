# What's left before submission

Deadline: **Oct 27, 13:00 UTC (18:30 IST)**. Aim to submit Oct 26.
Status as of Oct 26: the loop works **locally** end to end. A seeded bad commit was taken through signed events,
the real backend, both gates and Mission Control, with one incident recovered and one blocked. No GitLab pipeline or Duo flow run is recorded in the repo yet.

## Status on Oct 27 (morning)

The loop ran for real on the public GitLab project
`gitlab-ai-hackathon/transcend-october-2026/43057900/showcase`, in `SENTINEL_DEPLOY_MODE=local`:

| Step | Evidence |
|---|---|
| Seeded fault fails the canary (16.67 % vs 0 %), evidence collected | pipeline 2992630194 |
| Duo flow triggered by the failed pipeline, opens MR !1 (fix + regression test + analysis.json) | MR !1 |
| Regression proof PROVEN, Integrity Gate PASS | pipeline 2992662315 |
| Merged; canary passes on the merge commit (0.00 %) | pipeline 2992674535 |
| Final code (`ae76d86`): all jobs green, 180 root + 173 backend + 7 app tests, ruff clean | pipeline 2992702938 |

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | Public GitLab project, MIT licence, pipeline history | Krishna | **Done** |
| 2 | Real pipeline run on GitLab | Krishna | **Done** (local deploy mode) |
| 3 | Duo flow run on GitLab | Krishna | **Done** (MR !1) |
| 4 | Cloud Run deploy of backend + app, hosted frontend | Kailash + Samvit | Not done. Optional; the code and Terraform are in the repo |
| 5 | Backend reachable from GitLab CI (`SENTINEL_BACKEND_URL`, `SENTINEL_HMAC_SECRET`) and `GITLAB_PROJECT_TOKEN` for auto-merge | Team | Not done. The CI jobs log "could not emit" and carry on, so Mission Control is fed only by local runs; MR !1 was merged by a person after the gates passed |
| 6 | Demo video < 3 min, Devpost text, submit before 18:30 IST | Krishna | In progress |

## Earlier status table (Oct 23–26, kept for the record)

| # | Item | Owner | Done when |
|---|---|---|---|
| 1 | **Move the repo to GitLab.** The rules require a public GitLab project with visible pipeline history; ours is on GitHub. | Team | Public GitLab project; MIT licence shows in About |
| 2 | **Make CI run for real.** Deploy, rollback, evidence and merge all use `--dry-run`. The `${VAR:-default}` values in `variables:` are not GitLab syntax. Jobs only run on `main`, but our default branch is `master`. | Kailash | One pipeline on GitLab deploys a canary, catches the fault, rolls back and collects evidence <br>**Done (Kailash, Oct 26):** `.gitlab-ci.yml` variable blocks corrected to standard GitLab CI syntax; branch rules updated to allow `$CI_DEFAULT_BRANCH`, `master`, and `main`; canary deploy, rollback, and evidence jobs updated with dynamic `$SENTINEL_DRY_RUN` execution flags. |
| 3 | **Carry one incident ID through every job.** The evaluator, rollback, evidence and gate jobs must all send the same `incident_id`. | Kailash + Krishna | The backend shows one incident moving through each stage <br>**Backend side done (Krishna, Oct 24):** jobs no longer need to pass the id. The backend opens `inc-<pipeline_id>` from the evaluator FAIL and links rollback, evidence (its own id becomes an alias), the `duo/fix/*` MR, gates, merge and the redeploy on the merge commit. Proven with Kailash's real `emit_event.py` in `backend/tests/test_team_pipeline_integration.py`. Still needed from CI: real (non `--dry-run`) jobs and the MR webhook configured. |
| 4 | **Run the Duo flow once on GitLab.** Paste the flow, add a "Pipeline: Failed" trigger, run it on the seeded fault and record the credit cost. | Samvit | The flow opens `duo/fix/inc-…`, and the gates run on that MR |
| 5 | **Fix the backend truth gaps.** `/status` invents health numbers; releases never update; a rollback with no probe result counts as healthy; `/state/rollback`, `/restore` and `/snapshot` are unauthenticated (and rollback reports SUCCESS on failure); `detected_at` is empty; state is in memory and is lost on restart. | Krishna | `/status` and `/releases` come from recorded events only, and the state routes are removed or need auth <br>**Done (Krishna, Oct 24)** except restart persistence: `/status`, `/releases` from events only; rollback needs `post_rollback_probe_ok`; `detected_at` set; `/state/*` writes need the CI HMAC and rollback reports `STATE_RESTORED_TRAFFIC_NOT_SHIFTED` unless gcloud really moved traffic. Storage is SQLite in the container: still lost on restart until Firestore/Cloud SQL is decided. |
| 6 | **Store the AI analysis.** The flow commits `sentinel/incidents/<id>/analysis.json`; the backend should attach it to the attempt (merge-request webhook or the gate job). Until then, the "AI proposes" section stays empty in live mode. | Krishna | Analysis shows in the incident room <br>**Done (Krishna, Oct 24)**: on the `duo/fix/<id>` MR webhook (or `repair.proposed`) the backend fetches `analysis.json` at the fix SHA, validates it and stores it as advisory. Needs `GITLAB_PROJECT_ID` + `GITLAB_READ_TOKEN` on the backend. |
| 7 | **Deploy.** Run the backend and target app on Cloud Run, and the frontend on hosting with `VITE_API_BASE` set. Keep it up until about Nov 16 for the bonus. | Kailash (+ Samvit for the frontend) | Public links work |
| 8 | **Demo video** (under 3 min, public YouTube), Devpost text, README with run steps. | Unassigned | Submitted |

## Local end-to-end run with the real scripts (Krishna, Oct 24)

Demo app (healthy + seeded fault), the real `evaluator.py`, `rollback.py`, `evidence_collector.py`,
`regression_proof.py`, `integrity_gate.py` and `report_gate_verdict.py`, against the real backend.
Only GitLab itself (MR open/merge webhooks) was simulated.

Result: one incident went DETECTED → ROLLED_BACK → EVIDENCE_COLLECTED → (inferred) INVESTIGATING →
REPAIR_PROPOSED → VERIFYING → MERGED → REDEPLOYING → RECOVERED, and a healthy release opened no incident.

Found and fixed on the way (Kailash, please review):
- `sentinel/policy.yaml` POST probe used `sku`/`tier`, which the demo app rejects (422): even the
  healthy app failed with 48 % errors. Now `item_id`/`customer_tier`, with mixed-case tiers so the
  seeded fault is visible (faulty release: 16.7 % errors).
- `evaluator.py`: the candidate is probed first and paid client warm-up, so its p95 was ~15× the
  stable one and every release failed the latency ratio. Added unmeasured warm-up requests. The
  latency ratio and the Mann-Whitney test now also need a p95 slowdown > `latency_ratio_min_delta_ms`
  (50 ms). Before: healthy release falsely failed 4/12 runs; after: 25/25 PASS, faulty 10/10 FAIL.

Fixed after review (Samvit, Oct 25):
- `rollback.py` no longer reports `success` when gcloud fails, and never invents a healthy probe: a dry run
  is labelled `SIMULATED` and sends no event; a failed traffic shift is `ROLLBACK_FAILED`.
- `auto_merge.py` no longer fakes a merge or a merge SHA. It merges only when both gate reports exist on disk
  and passed (no `SENTINEL_*_PASSED` env overrides), and emits `merge.completed` only for a merge GitLab confirmed.
  The CI merge job now runs for real (`needs` both gate jobs; requires masked `GITLAB_PROJECT_TOKEN`).
- `integrity_gate.py` / `regression_proof.py`: removed `--dry-run` and `SENTINEL_SIMULATION_MODE`, which made
  both gates PASS without checking. A repair MR could set that variable in its own pipeline.
  `regression_proof.py` no longer guesses "the newest test file"; it uses `--test` or the `duo/fix/<id>` branch.
- `run_recovery_simulation.py` sends its rollback and merge events labelled `sentinel-simulation:*`.
- Root tests use the in-memory store (`tests/conftest.py`), so a leftover `sentinel.db` no longer breaks reruns.
- Mission Control shows events the backend refused as "refused" and never lets them light a stage.

## Backend audit (Krishna, Oct 24) — fixed

- **Backend container could not start:** the state store created `artifacts/state_cache` at import, which the
  non-root image user cannot write → `PermissionError`. Cache dir is now `SENTINEL_STATE_CACHE_DIR`
  (`/tmp/sentinel-state` in the image) and an unwritable path disables the cache instead of crashing.
- **Snapshots were always empty** (the incident proxy serialised as `{}`), and **restore changed nothing**
  while reporting success. Snapshots now hold the real incidents; restore writes them back.
- `/state/storage` claimed S3, versioning and DynamoDB locking that were never checked; now reports what is real.
- Snapshot files grew without limit (Cloud Run disk is memory): one per state change, capped at 50.
- A deploy or a stale evaluator FAIL for a commit other than the fix no longer moves the incident.
- An incident whose flow never opens a repair MR now times out (`SENTINEL_REPAIR_TIMEOUT_MINUTES`, 60).
- Background tasks and requests can no longer overwrite each other's incident updates (one lock).
- A commit that fails again after its incident closed opens a fresh incident instead of being lost.
- GitLab pipeline/job webhooks now appear on the incident timeline; event bodies over 256 KB are refused.

## CI fixes (Krishna, Oct 25)

- `variables:` used `${VAR:-default}`, which GitLab does not support there; now plain defaults
  that project CI/CD variables override.
- The HMAC secret had a default value in this public file. Removed: set `SENTINEL_HMAC_SECRET` as a
  protected + masked project variable. The old value is in git history, so never use it as the real secret.
- Deploy / evaluate / rollback / evidence jobs ran only on `main` while the default branch is `master`;
  rules now use `$CI_DEFAULT_BRANCH`.
- Still open (Kailash): those jobs still pass `--dry-run`, and the evaluator probes the placeholder URL
  `http://sentinel-target-app:8080`. Until they deploy and probe the real Cloud Run URLs, an incident
  cannot get past DETECTED on GitLab (a dry-run rollback now honestly sends no event).

## Should fix

- **Signing secrets.** Remove the hard-coded HMAC fallbacks (`.gitlab-ci.yml`, `backend/app/config.py`, `emit_event.py`). Set a masked CI variable and a Secret Manager entry instead. (Kailash, Krishna)
- **`docs/verification.md`.** It reports results nobody ran. Replace each row with what was actually observed in items 2–4. (Team)
- **Scope.** Keep the eBPF, FinOps, carbon, multi-region and S3 extras out of the demo; the judges score the end-to-end loop. (Team)

## Done (Samvit, this week)

- Mission Control: 7 consoles, calmer motion, a labelled demo mode, and live mode checked against the real backend.
- Gate jobs fixed in CI; gate verdicts reach the backend through `report_gate_verdict.py`.
- The Integrity Gate now protects nested `app/tests/`.
- Duo flow written (`.gitlab/duo/flows/`) with wiring tests; setup steps in `docs/duo-flow.md`.
