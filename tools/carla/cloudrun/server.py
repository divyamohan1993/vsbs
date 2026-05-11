"""VSBS chaos-driver Cloud Run wrapper.

Exposes a tiny HTTP surface that lets an admin caller spawn the chaos
scenario (``vsbs_carla.scripts.run_chaos_demo``) against any deployed VSBS
API. The container has no CARLA, no Unreal, no Vulkan, no GPU — it just
POSTs synthetic ``LiveTelemetryFrame`` ingest + 51-event perception
timeline at 10 Hz, exactly like the live bridge would.

Endpoints
---------
Public:
  GET  /            — landing/status JSON (safe to expose to the public DNS).
  GET  /healthz     — liveness probe.
  GET  /readyz      — readiness probe.

Bearer-token-guarded (``Authorization: Bearer $ADMIN_RUN_TOKEN``):
  POST   /run               — start a scenario in the background.
  GET    /jobs               — list known jobs (in-memory only).
  GET    /jobs/{job_id}      — poll a running/finished job.
  DELETE /jobs/{job_id}      — request a job to stop.

Deployment posture: the Cloud Run service is fronted by a public DNS
(``vsbs.dmj.one``) and is therefore deployed with
``--allow-unauthenticated``. Anonymous callers see the landing JSON and
the probes; every mutating or job-inspection endpoint is gated by the
``ADMIN_RUN_TOKEN`` secret (Secret-Manager-mounted env var). The token
must be a long, random, high-entropy value; if unset the protected
endpoints fail closed with HTTP 503.

Author: Divya Mohan / dmj.one — Apache-2.0.
"""

from __future__ import annotations

import hmac
import logging
import os
import threading
import time
import uuid
from typing import Any, Dict, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from vsbs_carla.scripts.run_chaos_demo import PHASES, run_scenario_loop

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("vsbs.chaos.cloudrun")

SCENARIO_MAX_S = float(PHASES[-1].end_s)
HARD_DURATION_CAP_S = float(os.getenv("HARD_DURATION_CAP_S", "1800"))
ADMIN_RUN_TOKEN = (os.getenv("ADMIN_RUN_TOKEN") or "").strip()

app = FastAPI(
    title="VSBS chaos driver",
    description="Cloud Run wrapper around the GPU-free CARLA chaos scenario.",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


def require_admin_token(request: Request) -> None:
    """Constant-time bearer-token check for protected endpoints.

    The Cloud Run service is publicly exposed (via the ``vsbs.dmj.one``
    domain), so anonymous callers MUST be blocked at the app layer for
    every endpoint that can spawn work or read job state. Fails closed
    with HTTP 503 when ``ADMIN_RUN_TOKEN`` is not configured — better to
    reject than to silently accept any caller.
    """
    if not ADMIN_RUN_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="ADMIN_RUN_TOKEN is not configured on this revision",
        )
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="bearer token required")
    presented = auth[7:].strip()
    if not hmac.compare_digest(presented, ADMIN_RUN_TOKEN):
        raise HTTPException(status_code=401, detail="invalid token")


class RunRequest(BaseModel):
    bookingId: str = Field(..., min_length=1, max_length=64)
    apiBase: str = Field(..., description="VSBS API base URL the scenario POSTs to")
    scenarioId: str = Field("chaos-default", min_length=1, max_length=64)
    seed: int = Field(42, ge=0, le=2**31 - 1)
    speed: float = Field(1.0, gt=0.0, le=10.0, description="Wall-clock speed multiplier")
    durationS: Optional[int] = Field(
        None,
        ge=1,
        le=int(HARD_DURATION_CAP_S),
        description="Hard ceiling in seconds; if omitted, scenario runs to its natural end (~600 s).",
    )
    loop: bool = Field(False, description="Restart scenario when it ends. Requires durationS.")

    @field_validator("apiBase")
    @classmethod
    def _validate_base(cls, v: str) -> str:
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("apiBase must start with http:// or https://")
        return v.rstrip("/")


class JobRecord(BaseModel):
    jobId: str
    status: str
    request: RunRequest
    startedAt: float
    endedAt: Optional[float] = None
    rc: Optional[int] = None
    error: Optional[str] = None


JOBS: Dict[str, Dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()


@app.get("/")
def landing() -> Dict[str, Any]:
    """Public landing — safe to expose. No secrets, no job state."""
    return {
        "service": "vsbs-chaos-driver",
        "version": app.version,
        "description": "Synthetic GPU-free CARLA chaos-scenario driver for VSBS dashboards.",
        "author": "Divya Mohan / dmj.one",
        "license": "Apache-2.0",
        "scenarioMaxS": SCENARIO_MAX_S,
        "endpoints": {
            "public": ["GET /", "GET /healthz", "GET /readyz"],
            "guarded": ["POST /run", "GET /jobs", "GET /jobs/{id}", "DELETE /jobs/{id}"],
        },
        "auth": "Bearer ADMIN_RUN_TOKEN on every guarded endpoint",
    }


@app.get("/healthz")
def healthz() -> Dict[str, Any]:
    return {"ok": True, "scenarioMaxS": SCENARIO_MAX_S}


@app.get("/readyz")
def readyz() -> Dict[str, Any]:
    return {
        "ok": True,
        "service": "vsbs-chaos-driver",
        "version": app.version,
        "tokenConfigured": bool(ADMIN_RUN_TOKEN),
    }


@app.post("/run", status_code=202, dependencies=[Depends(require_admin_token)])
def run_scenario(req: RunRequest) -> Dict[str, Any]:
    if req.loop and req.durationS is None:
        raise HTTPException(
            status_code=400,
            detail="loop=true requires durationS to bound the run",
        )

    job_id = uuid.uuid4().hex[:12]
    stop_box = {"stop": False}

    def _stop_fn() -> bool:
        return stop_box["stop"]

    def _log_fn(msg: str) -> None:
        log.info("job=%s %s", job_id, msg)

    def _runner() -> None:
        with JOBS_LOCK:
            JOBS[job_id]["status"] = "running"
        rc: Optional[int] = None
        err: Optional[str] = None
        try:
            rc = run_scenario_loop(
                base=req.apiBase,
                booking=req.bookingId,
                seed=req.seed,
                speed=req.speed,
                loop=req.loop,
                max_seconds=req.durationS,
                stop=_stop_fn,
                log=_log_fn,
                headers={"x-vsbs-scenario-id": req.scenarioId, "x-vsbs-job-id": job_id},
            )
        except Exception as e:
            log.exception("job=%s scenario crashed", job_id)
            err = str(e)
        with JOBS_LOCK:
            j = JOBS[job_id]
            j["endedAt"] = time.time()
            j["rc"] = rc
            if err is not None:
                j["status"] = "error"
                j["error"] = err
            elif stop_box["stop"]:
                j["status"] = "cancelled"
            elif rc == 0:
                j["status"] = "complete"
            else:
                j["status"] = "error"
                j["error"] = f"scenario exited rc={rc}"

    with JOBS_LOCK:
        JOBS[job_id] = {
            "jobId": job_id,
            "status": "queued",
            "request": req.model_dump(),
            "startedAt": time.time(),
            "endedAt": None,
            "rc": None,
            "error": None,
            "_stop_box": stop_box,
        }

    threading.Thread(target=_runner, daemon=True, name=f"chaos-{job_id}").start()
    log.info("job=%s queued booking=%s apiBase=%s", job_id, req.bookingId, req.apiBase)
    return {"jobId": job_id, "status": "queued", "dashboardHint": f"/autonomy/{req.bookingId}"}


@app.get("/jobs/{job_id}", dependencies=[Depends(require_admin_token)])
def get_job(job_id: str) -> Dict[str, Any]:
    with JOBS_LOCK:
        j = JOBS.get(job_id)
        if not j:
            raise HTTPException(status_code=404, detail="job not found")
        return {k: v for k, v in j.items() if not k.startswith("_")}


@app.delete("/jobs/{job_id}", dependencies=[Depends(require_admin_token)])
def stop_job(job_id: str) -> Dict[str, Any]:
    with JOBS_LOCK:
        j = JOBS.get(job_id)
        if not j:
            raise HTTPException(status_code=404, detail="job not found")
        j["_stop_box"]["stop"] = True
        return {"ok": True, "jobId": job_id, "status": j["status"]}


@app.get("/jobs", dependencies=[Depends(require_admin_token)])
def list_jobs() -> Dict[str, Any]:
    with JOBS_LOCK:
        return {
            "jobs": [
                {k: v for k, v in j.items() if not k.startswith("_")}
                for j in JOBS.values()
            ]
        }
