# Duo investigation + repair flow (tasks S3, S4)

File: `.gitlab/duo/flows/sentinel-investigate-repair.yml` (flow registry v1, `environment: ambient`).

**AI proposes. Deterministic gates decide.** The flow reads evidence and opens a merge request. It never
merges, deploys, runs tests or sets an incident status. Tools that could do any of that are not in its
toolset, and `tests/test_duo_flow.py` fails if one is added.

## What it does

| Step | Component | Reads | Writes |
|---|---|---|---|
| 1 | `investigator` | Failed-pipeline payload → `evidence:collect` job → `artifacts/evidence-bundle.json`; the source files the diff and logs point to | `analysis.json` content (facts with evidence refs, hypotheses with confidence, missing evidence, outcome) |
| 2 | `repairer` | The analysis | `fix_proposed`: branch `duo/fix/<incident_id>` with the fix, `tests/regressions/test_<incident_id>.py` (dashes become underscores) and `sentinel/incidents/<incident_id>/analysis.json`, plus an MR. `no_fix_found`: branch `duo/analysis/<incident_id>` with the analysis only, no MR |

The repair MR then runs `gate:regression-proof` and `gate:integrity-gate` (in `.gitlab-ci.yml`). Each job reports
its verdict to the backend through `sentinel/scripts/report_gate_verdict.py`, and the merge job only runs if both pass.

## Set it up on GitLab (one time, Maintainer role)

1. **Automate → Flows → New flow.** Name it "Sentinel investigate + repair", visibility Private, paste the YAML, then **Create flow** and **Enable**.
2. **AI → Triggers → New flow trigger.** Choose the flow, event **Pipeline → Failed**, and a service account as the identity.
   GitLab ignores events caused by bots, so the pipeline must come from a person's push.
3. The service account needs Developer access to create branches and merge requests.
4. CI variables (masked): `SENTINEL_BACKEND_URL` and `SENTINEL_HMAC_SECRET`, used by the gate jobs to report verdicts.

## Check it locally

```
python -m pytest tests/test_duo_flow.py tests/test_integrity_gate.py tests/test_regression_proof.py
```

What has been verified, and what has not:

- **Verified locally:** both gates run against a seeded broken commit and a matching repair branch. A correct fix
  is PROVEN and passes the Integrity Gate. A repair that weakens `app/tests/test_orders.py` is blocked by
  RULE_01, RULE_04 and RULE_08. Signed verdicts reach the backend and appear in Mission Control.
- **Verified on GitLab:** a failed `main` pipeline (pipeline 2992630194, canary FAIL on the seeded discount fault)
  triggered the flow, which opened MR !1 with the fix, a regression test and `analysis.json`. On the MR pipeline
  (2992662315), the regression proof was PROVEN and the Integrity Gate passed. After the merge, the canary passed on the
  merge commit (pipeline 2992674535).
