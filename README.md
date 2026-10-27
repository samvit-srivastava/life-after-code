# Project Sentinel

**AI proposes. Deterministic gates decide. Production evidence proves the outcome.**

Sentinel is a deployment-safety and production-recovery loop built on GitLab for the GitLab Transcend
"Life After Code" hackathon (Path A). When a release makes the running service unhealthy, Sentinel:

1. detects it with measured health signals from a canary;
2. rolls back to the last known-good release, and a probe confirms the rollback;
3. seals a redacted evidence bundle (SHA-256);
4. asks a **GitLab Duo flow** to investigate and propose a fix plus a regression test, as a merge request;
5. **proves** the fix with deterministic gates:
   - the new test must fail with an assertion on the broken commit and pass on the fix;
   - the Integrity Gate blocks any attempt to weaken or skip tests;
6. merges and redeploys through a canary, and records **RECOVERED** only when the post-redeploy evaluator says so.

The AI can never mark a repair as successful, bypass a gate, or make a failing pipeline look green.

## Evidence: a real run on this project

| Step | Link |
|---|---|
| A healthy release, with every job green | [pipeline 2992617972](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43057900/showcase/-/pipelines/2992617972) |
| A faulty commit (`refactor(orders): simplify tier discount lookup`). The canary fails (16.67 % errors on the candidate, 0 % on stable), and the evidence is collected | [pipeline 2992630194](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43057900/showcase/-/pipelines/2992630194) |
| The failed pipeline triggers the Duo flow, which opens the repair MR | [MR !1](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43057900/showcase/-/merge_requests/1) |
| On the MR, the regression proof is **PROVEN** and the Integrity Gate gives **PASS** | [pipeline 2992662315](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43057900/showcase/-/pipelines/2992662315) |
| After the merge, the merge commit passes the canary: 0.00 % errors on the candidate, against 16.67 % on the old broken release | [pipeline 2992674535](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43057900/showcase/-/pipelines/2992674535) |

Full technical documentation, with diagrams: [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Repository

| Path | What it is | Owner |
|---|---|---|
| `app/` | Demo target service (FastAPI orders API). `docs/demo/fault-discount-lookup.patch` is the seeded fault | Krishna |
| `backend/` | Sentinel API: HMAC-signed CI event ingestion, evidence-gated state machine, read API for the UI | Krishna |
| `frontend/` | Mission Control: seven read-only consoles plus a labelled demo mode | Samvit |
| `.gitlab/duo/flows/` | Duo investigation + repair flow ([setup](docs/duo-flow.md)) | Samvit |
| `sentinel/scripts/` | Regression proof, Integrity Gate, gate reporting (Samvit); evaluator, rollback, evidence, auto-merge, emitter (Kailash) | Team |
| `.gitlab-ci.yml`, `infra/` | Pipeline and Terraform for Cloud Run | Kailash |
| `docs/contracts/` | OpenAPI, event, analysis and evidence-bundle schemas | Team |

## Deploy modes

The deploy mode is set by `SENTINEL_DEPLOY_MODE` in `.gitlab-ci.yml`.

- **`local`** is the default, and the run above used it.
  - The job `canary:local-evaluate` starts two copies of the app: the current commit as the candidate (port 8081), and the previous commit as the stable release (port 8080).
  - The real evaluator sends real requests to both and compares their error rate and p95 latency.
  - This mode needs no cloud account.
- **`cloudrun`** deploys to Google Cloud Run.
  - It builds the image and deploys it as a tagged Cloud Run revision.
  - It shifts traffic 10 → 50 → 100 % and runs an evaluation at each step.
  - If a step breaches its thresholds, it rolls back to the stable revision.
  - It needs a GCP project and a service account (see `docs/deployment_guide.md` and `infra/`).

## Run it locally

Requires Python 3.11+ and Node 20+.

```bash
# 1. Demo target app (port 8080)
cd app && pip install -r requirements.txt && uvicorn app.main:app --port 8080

# 2. Sentinel backend (port 8000, Swagger at /docs)
cd backend && pip install -r requirements.txt
SENTINEL_HMAC_SECRET=<any-local-secret> uvicorn app.main:app --port 8000

# 3. Mission Control (http://localhost:5173, proxies /api to :8000)
cd frontend && npm install && npm run dev
```

- **Labelled demo without a backend:** open `http://localhost:5173/?demo`, or `?demo=fail` for the path where the gates block the repair.
- **Drive a real incident through the local backend:**
  `SENTINEL_API_URL=http://localhost:8000 SENTINEL_HMAC_SECRET=<same> python backend/scripts/smoke_e2e.py`.
  It sends synthetic events, so never point it at the demo backend.

## Tests

```bash
pip install -r backend/requirements.txt -r app/requirements.txt jsonschema pyyaml requests boto3 ruff
python -m pytest tests          # gates, CI scripts, Duo flow wiring
(cd backend && python -m pytest)
(cd app && python -m pytest)
ruff check .
(cd frontend && npx tsc -p tsconfig.json --noEmit && npm run build)
```

## GitLab setup

- **Masked + protected CI/CD variables:**
  - `SENTINEL_HMAC_SECRET` (same value as the backend's)
  - `SENTINEL_BACKEND_URL`
  - `GITLAB_PROJECT_TOKEN` (auto-merge)
  - Google Cloud credentials via Workload Identity Federation (`infra/iam_wif.tf`)
- **Backend:**
  - `GITLAB_PROJECT_ID` and `GITLAB_READ_TOKEN` (to read the AI's `analysis.json`)
  - `GITLAB_WEBHOOK_SECRET`, and a project webhook for merge-request and pipeline events
- **Duo flow:** paste `.gitlab/duo/flows/sentinel-investigate-repair.yml` under **Automate → Flows**, then add a
  **Pipeline: Failed** trigger. Details in [docs/duo-flow.md](docs/duo-flow.md).

Open items and team status are in [docs/REMAINING.md](docs/REMAINING.md).

## Honest limits

- The recorded run used the `local` deploy mode. The Cloud Run path is implemented and unit-tested with a fake `gcloud`, but it was not part of the recorded run.
- Some panels on the System page (saboteur, candidates, shadow replay, carbon) show simulated, reference or derived values. Each panel is labelled with its data source, and no unmeasured value is presented as measured.
- The Duo analysis is advisory. Only the gates count as proof.
- In the recorded run no Sentinel backend was reachable from GitLab CI, so the jobs logged "could not emit" and carried on. Mission Control was shown against a local backend. MR !1 was merged by a person after both gates passed, because no `GITLAB_PROJECT_TOKEN` was set for auto-merge.

## Team

- Krishna Singh: backend, integration, GitLab CI and the Duo flow
- Samvit Srivastava: frontend and AI
- Kailash Ambadipudi: CI/CD and cloud

## Licence

[MIT](LICENSE)
