#!/usr/bin/env python3
"""
Project Sentinel — Authoritative Rollback & Known-Good Revision Controller (Task K6)
Instantly diverts 100% traffic back to the last known-good revision upon an evaluator breach.
Executes an authoritative post-rollback synthetic health probe before certifying recovery state.
Emits rollback.started and rollback.completed events to the Sentinel backend.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
import urllib.request

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sentinel.scripts.emit_event import emit_event


def get_known_good_revision(
    service_name: str,
    explicit_revision: str | None = None,
    backend_url: str | None = None,
) -> str:
    if explicit_revision:
        return explicit_revision

    env_rev = os.environ.get("SENTINEL_KNOWN_GOOD_REVISION")
    if env_rev:
        return env_rev

    # Query backend /api/v1/status for current known-good release if available
    backend = (backend_url or os.environ.get("SENTINEL_BACKEND_URL", "http://localhost:8000")).rstrip("/")
    try:
        with urllib.request.urlopen(f"{backend}/api/v1/status", timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            curr_rel = data.get("current_release")
            if curr_rel and curr_rel.get("revision_name"):
                return curr_rel["revision_name"]
    except Exception:
        pass

    # Fallback default known-good tag for demo/simulation
    return f"{service_name}-known-good-rev001"


def execute_cloud_run_traffic_shift(
    service_name: str,
    target_revision: str,
    region: str = "us-central1",
    dry_run: bool = False,
) -> dict[str, Any]:
    print(f"[*] Shifting 100% traffic to known-good revision: {target_revision} on service {service_name}...")
    if dry_run or os.environ.get("SENTINEL_SIMULATION_MODE") == "true":
        print(f"[+] [SIMULATION] gcloud run services update-traffic {service_name} --to-revisions={target_revision}=100")
        return {"success": True, "revisions": {target_revision: 100}, "mode": "simulation"}

    cmd = [
        "gcloud", "run", "services", "update-traffic", service_name,
        f"--to-revisions={target_revision}=100",
        f"--region={region}",
        "--format=json",
    ]
    try:
        out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT)
        return {"success": True, "output": out, "mode": "gcloud"}
    except Exception as e:
        # Never record a rollback that did not happen: report the failure instead.
        print(f"[-] gcloud traffic shift failed ({e}); traffic was NOT moved.", file=sys.stderr)
        return {"success": False, "mode": "failed", "error": str(e)}


def run_post_rollback_probe(
    stable_url: str,
    sample_count: int = 15,
    timeout: float = 3.0,
) -> dict[str, Any]:
    print(f"[*] Executing post-rollback authoritative health probe against {stable_url} ({sample_count} samples)...")
    successes = 0
    errors = 0
    endpoints = ["/healthz", "/api/v1/orders"]

    for i in range(sample_count):
        ep = endpoints[i % len(endpoints)]
        url = f"{stable_url.rstrip('/')}{ep}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Sentinel-Rollback-Verifier/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status in (200, 201):
                    successes += 1
                else:
                    errors += 1
        except Exception:
            errors += 1
        time.sleep(0.05)

    probe_ok = (errors == 0) and (successes > 0)
    return {
        "samples": sample_count,
        "successes": successes,
        "errors": errors,
        "error_rate": float(errors) / float(sample_count) if sample_count > 0 else 0.0,
        "probe_ok": probe_ok,
    }


def execute_rollback(
    service_name: str,
    stable_url: str = "http://localhost:8080",
    known_good_rev: str | None = None,
    candidate_rev: str = "rev-candidate-001",
    region: str = "us-central1",
    pipeline_id: str | None = None,
    job_id: str | None = None,
    commit_sha: str | None = None,
    release_id: str | None = None,
    incident_id: str | None = None,
    s3_snapshot_id: str | None = None,
    emit_to_backend: bool = True,
    dry_run: bool = False,
    local: bool = False,
) -> dict[str, Any]:
    s3_snapshot_data = None
    if s3_snapshot_id:
        print(f"[*] S3 Snapshot Rollback requested with Snapshot ID: {s3_snapshot_id}")
        try:
            from sentinel.scripts.s3_state_manager import S3StateManager

            mgr = S3StateManager()
            verify_res = mgr.verify_state_integrity(s3_snapshot_id)
            if verify_res.get("status") == "PASS":
                print(f"[+] S3 Snapshot SHA-256 integrity verified: {verify_res.get('computed_sha256')[:16]}...")
                cache_file = Path(f"artifacts/state_cache/{s3_snapshot_id}.json")
                if cache_file.exists():
                    s3_snapshot_data = json.loads(cache_file.read_text(encoding="utf-8"))
                    meta = s3_snapshot_data.get("metadata", {})
                    st = s3_snapshot_data.get("state", {})
                    snapshot_rev = meta.get("restored_revision") or meta.get("revision_name") or st.get("revision_name")
                    if snapshot_rev:
                        known_good_rev = snapshot_rev
                        print(f"[+] Target revision extracted from S3 snapshot: {known_good_rev}")
            else:
                print(f"[!] Warning: S3 snapshot verification failed ({verify_res})", file=sys.stderr)
        except Exception as e:
            print(f"[!] Warning: S3 snapshot lookup error: {e}", file=sys.stderr)

    target_rev = get_known_good_revision(service_name, known_good_rev)

    # 1. Emit rollback.started
    if emit_to_backend:
        try:
            emit_event(
                event_type="rollback.started",

                source="sentinel-rollback:automated",
                pipeline_id=pipeline_id,
                job_id=job_id,
                commit_sha=commit_sha,
                release_id=release_id,
                incident_id=incident_id,
                data={
                    "revision_name": target_rev,
                    "traffic_percent": 100,
                    "target": "stable",
                },
            )
        except Exception as e:
            print(f"[!] Warning: could not emit rollback.started: {e}", file=sys.stderr)

    # 2. Divert traffic in Cloud Run. In local mode (SENTINEL_DEPLOY_MODE=local) there is no traffic
    # split: the CI job has already stopped the candidate, so the stable app is the only one serving.
    # The probe below still has to prove that stable app healthy before a rollback is reported.
    if local:
        print(f"[*] Local mode: candidate {candidate_rev} stopped by the CI job; {target_rev} keeps serving.")
        traffic_res = {"success": True, "mode": "local", "revisions": {target_rev: 100}}
    else:
        traffic_res = execute_cloud_run_traffic_shift(
            service_name=service_name,
            target_revision=target_rev,
            region=region,
            dry_run=dry_run,
        )

    # 3. Post-Rollback Authoritative Probe
    simulated = dry_run or os.environ.get("SENTINEL_SIMULATION_MODE") == "true"
    if simulated:
        # A simulation proves nothing: no probe result is invented and no event is sent.
        probe_res = {"samples": 0, "successes": 0, "errors": 0, "error_rate": 0.0, "probe_ok": False, "simulated": True}
    else:
        probe_res = run_post_rollback_probe(stable_url=stable_url, sample_count=15)
    probe_ok = bool(traffic_res.get("success")) and bool(probe_res["probe_ok"]) and not simulated

    status_str = "SIMULATED (not a rollback)" if simulated else "SUCCESSFUL" if probe_ok else "FAILED" if not traffic_res.get("success") else "UNHEALTHY"
    print(f"\n[+] Rollback verification complete: {status_str}")
    print(f"    Restored Revision: {target_rev} (100% traffic)")
    print(f"    Post-Rollback Probe OK: {probe_ok} (Errors: {probe_res['errors']}/{probe_res['samples']})")

    report = {
        "status": "SIMULATED" if simulated else ("ROLLED_BACK" if probe_ok else "ROLLBACK_FAILED"),
        "timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "service": service_name,
        "candidate_revision": candidate_rev,
        "restored_revision": target_rev,
        "traffic_percent": 100,
        "post_rollback_probe_ok": probe_ok,
        "probe_details": probe_res,
        "traffic_res": traffic_res,
    }

    if s3_snapshot_id:
        report["s3_snapshot_id"] = s3_snapshot_id
        report["s3_snapshot_verified"] = s3_snapshot_data is not None

    artifact_dir = Path("artifacts")
    artifact_dir.mkdir(exist_ok=True)
    report_path = artifact_dir / "rollback-report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    # 4. Emit rollback.completed (only for a real attempt; the backend decides from post_rollback_probe_ok)
    if emit_to_backend and not simulated:
        try:
            emit_event(
                event_type="rollback.completed",
                source="sentinel-rollback:automated",
                pipeline_id=pipeline_id,
                job_id=job_id,
                commit_sha=commit_sha,
                release_id=release_id,
                incident_id=incident_id,
                artifact_url=f"file://{report_path.resolve()}",
                data={
                    "revision_name": target_rev,
                    "traffic_percent": 100,
                    "post_rollback_probe_ok": probe_ok,
                    "target": "stable",
                    "s3_snapshot_id": s3_snapshot_id,
                    "rollback_mode": traffic_res.get("mode"),
                },
            )
        except Exception as e:
            print(f"[!] Warning: could not emit rollback.completed: {e}", file=sys.stderr)

    return report


run_rollback = execute_rollback


def main() -> None:
    parser = argparse.ArgumentParser(description="Sentinel Rollback Controller")
    parser.add_argument("--service", default=os.environ.get("TARGET_APP_SERVICE", "sentinel-target-app"), help="Cloud Run service name")
    parser.add_argument("--stable-url", required=True, help="URL of known-good service endpoint")
    parser.add_argument("--known-good-rev", help="Target revision to restore (100 percent traffic)")
    parser.add_argument("--candidate-rev", default="rev-candidate-001", help="Faulty candidate revision")
    parser.add_argument("--region", default=os.environ.get("GCP_REGION", "us-central1"), help="Google Cloud region")
    parser.add_argument("--s3-snapshot-id", help="Rollback using an authoritative S3 state snapshot ID")
    parser.add_argument("--use-latest-s3-snapshot", action="store_true", help="Automatically rollback using the latest verified S3 state snapshot")
    parser.add_argument("--pipeline-id", help="GitLab CI Pipeline ID")
    parser.add_argument("--job-id", help="GitLab CI Job ID")
    parser.add_argument("--commit-sha", help="Git commit SHA")
    parser.add_argument("--release-id", help="Sentinel release ID")
    parser.add_argument("--incident-id", help="Sentinel incident ID")
    parser.add_argument("--dry-run", action="store_true", help="Run in simulation mode without gcloud")
    parser.add_argument("--no-emit", action="store_true", help="Do not emit events to backend")
    parser.add_argument("--local", action="store_true", help="Local deploy mode: the candidate was stopped by CI; only probe the stable app")

    args = parser.parse_args()

    target_snapshot_id = args.s3_snapshot_id
    if args.use_latest_s3_snapshot and not target_snapshot_id:
        try:
            from backend.app.s3_state_store import s3_state_store

            snaps = s3_state_store.list_snapshots(limit=1)
            if snaps:
                target_snapshot_id = snaps[0]["snapshot_id"]
        except Exception:
            pass

    report = execute_rollback(
        service_name=args.service,
        stable_url=args.stable_url,
        known_good_rev=args.known_good_rev,
        candidate_rev=args.candidate_rev,
        region=args.region,
        s3_snapshot_id=target_snapshot_id,
        pipeline_id=args.pipeline_id,
        job_id=args.job_id,
        commit_sha=args.commit_sha,
        release_id=args.release_id,
        incident_id=args.incident_id,
        emit_to_backend=not args.no_emit,
        dry_run=args.dry_run,
        local=args.local,
    )


    if not report["post_rollback_probe_ok"]:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
