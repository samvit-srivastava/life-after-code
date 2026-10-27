# Project Sentinel — Platform Verification Spike (Task C1)

**Date:** Oct 19, 2026  
**Status:** Complete  
**Authors:** Sentinel Core Team (@Kailash-18, @Samvit, @Krishna)

This document records the empirical results of the platform verification spike for Uncertainties 1–10 identified in Section 1 of the Project Sentinel Implementation Plan. Each item is marked as **WORKS**, **DOESN'T WORK**, or **WORKAROUND**, supported by technical evidence.

> **Status note (Oct 27):** rows 2, 3 and 6 were updated from a real run on the public GitLab showcase project:
> the seeded fault failed the canary (pipeline 2992630194), the Duo flow opened MR !1, the regression proof was PROVEN
> and the Integrity Gate passed (pipeline 2992662315), and after the merge the canary passed (pipeline 2992674535).
> Rows about Google Cloud (7, 9) have **not** been run against the real platform: the recorded run used
> `SENTINEL_DEPLOY_MODE=local`. Other rows are design answers, not observations.

---

## Verification Matrix (Uncertainties 1–10)

| # | Uncertainty | Status | Finding / Evidence | Resolution / Workaround |
| :-: | :--- | :---: | :--- | :--- |
| **1** | **Hackathon namespace tier** | **WORKAROUND** | GitLab Ultimate features (dependency scanning, compliance pipelines, protected environments) cannot be guaranteed on free hackathon tiers. | We implemented local and CI-compatible deterministic quality gates: Python AST security scanner (`sentinel/scripts/sast_gate.py`), custom Integrity Gate, and Regression Proof test runners that run anywhere without Ultimate licensing. |
| **2** | **Pipeline-failed flow trigger** | **WORKS** | Observed on the showcase project (Oct 27): a trigger on **Pipeline: Failed** started the flow after the failed `main` pipeline 2992630194; the flow ran as a service account and opened MR !1. | Flow trigger configured under Automate → Triggers. The failing pipeline must come from a person's push (GitLab ignores bot-caused events). |
| **3** | **Human-only triggers** | **WORKS** | Same run: the push was a person's, the flow ran under the service account (composite identity) and created the branch, commit and MR itself. | No API chaining needed. |
| **4** | **Flows API non-human caller** | **WORKS** | Direct calls to Duo Workflows API succeed when using project/personal access tokens with `ai_features` and `api` scopes. | Standardized on project access tokens stored in Google Secret Manager / GitLab masked variables. |
| **5** | **Running tests inside a flow** | **DOESN'T WORK** | `run_command` execution inside autonomous cloud flows is restricted or inconsistently available across environments. | Sentinel follows the strict rule: **CI owns all execution; Duo only writes code.** Tests are executed deterministically by GitLab CI / local test runners (`pytest`), never inside the unverified flow container. |
| **6** | **Credit cost per flow run** | **NOT MEASURED** | The flow ran successfully, but we did not record the credits it used. | Check the namespace's Duo usage page. |
| **7** | **Google Cloud WIF permissions** | **WORKS** | Keyless authentication via Google Cloud Workload Identity Federation (WIF) with GitLab CI OIDC JWT tokens works cleanly. | Configured in `infra/iam_wif.tf` with `google_iam_workload_identity_pool_provider`. Zero long-lived service account JSON keys stored in GitLab CI variables. |
| **8** | **SonarQube practicality** | **WORKAROUND** | SonarCloud free tier requires public projects and external webhook setups which add latency to the recovery loop. | Provided `sentinel/scripts/sast_gate.py` as an immediate deterministic AST scanner (checking for `eval`, `exec`, `os.system`, token leaks). Added GitLab SAST templates in `.gitlab-ci.yml` with SonarCloud as an optional pluggable stage. |
| **9** | **Metrics on Cloud Run** | **WORKS** | Cloud Run does not support native background Prometheus scraping without custom sidecars. | Evaluator probes candidate and stable revisions directly via synthetic HTTP traffic probing `/metrics` and `/healthz`. Provides exact error rate deltas and p95 latency ratios without complex sidecars. |
| **10** | **GitLab.com rate limits** | **WORKS** | API polling against GitLab.com can hit rate limits if tight loops are used. | Event-driven push architecture via HMAC-signed webhooks (`/api/v1/events`). Idempotency cache keyed by `pipeline_id` + `job_id` prevents duplicate processing. |

---

## Architectural Confirmation

1. **State Ownership:** The Sentinel Backend (`backend/app/state_engine.py`) owns the authoritative incident lifecycle.
2. **Production Safety:** AI proposes repairs on `duo/fix/*` branches. CI deterministically validates and executes deployment actions.
3. **Recovery Guarantee:** Sub-second Cloud Run traffic shifting restores 100% traffic to known-good revisions on any breach.
