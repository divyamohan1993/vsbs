# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Headless 10k-iteration validator for the stochastic-fault model and
the online RUL predictor used by the test-drive bridge.

This script does NOT touch CARLA, the API, or any HTTP endpoint. It just
plays the same `StochasticFaultModel` (random degradation) into the same
`OnlineRulPredictor` that the live bridge uses, applies the same
reroute/tow decision rules, and tallies the outcomes across N runs.

Run as:

    python -m vsbs_carla.scripts.eval_predictor --iterations 10000

Outcome taxonomy (one per run):

  arrived_safely      Predictor fired reroute and the simulated drive
                      to the service centre completed before the actual
                      health crossed the critical threshold.
  tow_after_warning   Predictor fired reroute, but actual health crossed
                      critical before the simulated SC arrival. The
                      booking would have been towed mid-route.
  tow_no_warning     ★ Critical fired without the predictor ever
                      triggering a reroute. This is the "predictor
                      missed it" failure mode.
  no_failure          The 10-minute simulation budget elapsed without
                      either reroute or critical firing — the
                      stochastic process happened to stay benign.
"""

from __future__ import annotations

import argparse
import math
import random
import statistics
import sys
import time
from collections import Counter
from dataclasses import dataclass
from typing import Optional

# Re-use the *exact* model + predictor classes the live bridge runs.
from .test_drive import (
    ACT_SOON_PREDICTED_RUL_S,
    CRITICAL_HEALTH_PCT,
    FEATURE_NAMES,
    PREDICTOR_MIN_OBS_FOR_REROUTE,
    OnlineRulPredictor,
    StochasticFaultModel,
)


# Simulated drive-to-SC time. The real bridge can take 90-150 s depending
# on traffic + distance; we use a fixed value here so the test scores the
# *predictor's lead time* rather than CARLA pathing variance.
DRIVE_TO_SC_SECONDS = 60.0
TICK_HZ = 20  # match live bridge
TICK_DT = 1.0 / TICK_HZ
SIM_BUDGET_SECONDS = 600.0  # hard cap per run


SAMPLE_INTERVAL_TICKS = 20  # 1 s of sim time at TICK_HZ=20
MIN_OBS_FOR_TRAINING = 20  # don't dump samples before predictor has data


@dataclass
class Outcome:
    label: str
    health_at_reroute: Optional[float]
    rul_at_reroute: Optional[float]
    t_reroute: Optional[float]
    t_critical: Optional[float]
    lead_time: Optional[float]  # t_critical - t_reroute (positive = predictor was early)
    final_mae: float
    final_health: float
    observations: int
    errors_scored: int
    # If --dump-training was set, these hold per-tick feature vectors and
    # the time-to-critical label for each. Empty if critical never fired
    # in this run (no useful training signal).
    samples: Optional[list[tuple[float, list[float]]]] = None  # (t_obs, features)


# Per-worker model cache so we load joblib/xgboost once per process.
_MODEL_CACHE: dict[str, Optional[object]] = {}


def _get_predictor_fn(model_path: Optional[str]):
    if not model_path:
        return None
    if model_path not in _MODEL_CACHE:
        from ..predictor_model import load_predictor
        _MODEL_CACHE[model_path] = load_predictor(model_path)
    return _MODEL_CACHE[model_path]


def simulate_one(args: tuple) -> Outcome:
    """Single-run simulation. `args = (seed, dump_training, model_path)` so
    the function can run inside multiprocessing.Pool.imap with one arg.
    `model_path` is None to use the linear OnlineRulPredictor; a path
    swaps in the trained model's RUL prediction for the reroute decision.
    """
    if len(args) == 3:
        seed, dump_training, model_path = args
    else:  # back-compat with older 2-tuple callers
        seed, dump_training = args
        model_path = None
    predict_fn = _get_predictor_fn(model_path)
    rng = random.Random(seed)
    fault = StochasticFaultModel(rng)
    pred = OnlineRulPredictor()

    t_reroute: Optional[float] = None
    t_critical: Optional[float] = None
    health_at_reroute: Optional[float] = None
    rul_at_reroute: Optional[float] = None
    final_health = 100.0
    samples: list[tuple[float, list[float]]] = []

    n_ticks = int(SIM_BUDGET_SECONDS / TICK_DT)
    for i in range(n_ticks):
        t = i * TICK_DT
        h, _ = fault.step(t, TICK_DT)
        pred.observe(t, h)
        final_health = h

        # --- decision: reroute ---
        if t_reroute is None and pred.observation_count >= PREDICTOR_MIN_OBS_FOR_REROUTE:
            if predict_fn is not None:
                rul_now = max(0.0, predict_fn(pred.feature_vector(t, h)))
            else:
                rul_now = pred.predict_rul_seconds(h)
            if rul_now <= ACT_SOON_PREDICTED_RUL_S:
                t_reroute = t
                health_at_reroute = h
                rul_at_reroute = rul_now

        # --- training sample capture ---
        if (
            dump_training
            and i % SAMPLE_INTERVAL_TICKS == 0
            and pred.observation_count >= MIN_OBS_FOR_TRAINING
        ):
            samples.append((t, pred.feature_vector(t, h)))

        # --- ground truth: critical ---
        if t_critical is None and h <= CRITICAL_HEALTH_PCT:
            t_critical = t
            break

    # Classify outcome. arrived_safely requires reroute fired AND the
    # simulated drive-to-SC window completed before critical (or critical
    # never happened in budget).
    if t_critical is None and t_reroute is None:
        label = "no_failure"
        lead = None
    elif t_critical is None and t_reroute is not None:
        label = "arrived_safely"  # reroute fired, critical never happened in budget
        lead = None
    elif t_critical is not None and t_reroute is None:
        label = "tow_no_warning"  # silent failure — predictor missed
        lead = None
    else:
        # Both fired. Did the ego arrive before critical?
        assert t_critical is not None and t_reroute is not None
        lead = t_critical - t_reroute
        if lead >= DRIVE_TO_SC_SECONDS:
            label = "arrived_safely"
        elif lead > 0:
            label = "tow_after_warning"
        else:
            # Predictor fired *after* critical — should be impossible since
            # we break on critical, but guard for it anyway.
            label = "tow_no_warning"

    return Outcome(
        label=label,
        health_at_reroute=health_at_reroute,
        rul_at_reroute=rul_at_reroute,
        t_reroute=t_reroute,
        t_critical=t_critical,
        lead_time=lead,
        final_mae=pred.mae,
        final_health=final_health,
        observations=pred.observation_count,
        errors_scored=pred.errors_scored,
        # Only useful if critical actually fired — gives a real label
        # (time-to-critical from each sample's t_obs).
        samples=samples if (dump_training and t_critical is not None) else None,
    )


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Headless predictor validator.")
    p.add_argument("--iterations", type=int, default=10000)
    p.add_argument("--seed-base", type=int, default=0)
    p.add_argument("--workers", type=int, default=1, help="Process count for parallelism.")
    p.add_argument(
        "--first-failure-detail",
        action="store_true",
        help="Print the first tow_no_warning case in detail, then continue.",
    )
    p.add_argument(
        "--dump-training",
        type=str,
        default=None,
        metavar="PATH",
        help="If set, write a .npz with feature/label arrays for every "
             "sample whose run reached critical. Used to train the model.",
    )
    p.add_argument(
        "--use-model",
        type=str,
        default=None,
        metavar="PATH",
        help="If set, the reroute decision uses this trained model's "
             "RUL prediction instead of the linear OnlineRulPredictor. "
             "Path is what train_model.py wrote to disk.",
    )
    return p.parse_args(argv)


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return float("nan")
    s = sorted(values)
    k = (len(s) - 1) * q
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] * (c - k) + s[c] * (k - f)


def _summarise(outcomes: list[Outcome]) -> None:
    counts = Counter(o.label for o in outcomes)
    total = len(outcomes)
    print(f"\n=== Summary across {total} iterations ===\n")
    print(f"{'outcome':<22}{'count':>10}{'%':>8}")
    print("-" * 42)
    for label in ("arrived_safely", "tow_after_warning", "tow_no_warning", "no_failure"):
        n = counts.get(label, 0)
        print(f"{label:<22}{n:>10}{(100.0 * n / total):>7.2f}%")

    # Predictor lead-time distribution (only for runs that hit critical and had a reroute).
    leads = [o.lead_time for o in outcomes if o.lead_time is not None]
    print("\n=== Predictor lead time (t_critical - t_reroute), seconds ===")
    if leads:
        print(f"  count = {len(leads)}")
        print(f"  mean  = {statistics.mean(leads):.2f}")
        print(f"  stdev = {statistics.stdev(leads):.2f}" if len(leads) > 1 else "  stdev = n/a")
        print(f"  p10   = {_percentile(leads, 0.10):.2f}")
        print(f"  p50   = {_percentile(leads, 0.50):.2f}")
        print(f"  p90   = {_percentile(leads, 0.90):.2f}")
        print(f"  >= drive-time ({DRIVE_TO_SC_SECONDS:.0f} s): "
              f"{sum(1 for x in leads if x >= DRIVE_TO_SC_SECONDS)}/{len(leads)} "
              f"({100.0 * sum(1 for x in leads if x >= DRIVE_TO_SC_SECONDS) / len(leads):.2f}%)")
    else:
        print("  no runs reached critical with a prior reroute.")

    # Final-MAE distribution.
    maes = [o.final_mae for o in outcomes if o.errors_scored > 0]
    print("\n=== Final predictor MAE (% health), across runs that scored forecasts ===")
    if maes:
        print(f"  count = {len(maes)}")
        print(f"  mean  = {statistics.mean(maes):.3f}")
        print(f"  p50   = {_percentile(maes, 0.50):.3f}")
        print(f"  p90   = {_percentile(maes, 0.90):.3f}")
        print(f"  p99   = {_percentile(maes, 0.99):.3f}")

    # Health at reroute.
    h_at_r = [o.health_at_reroute for o in outcomes if o.health_at_reroute is not None]
    print("\n=== Health at reroute trigger (%) ===")
    if h_at_r:
        print(f"  mean  = {statistics.mean(h_at_r):.2f}")
        print(f"  p10   = {_percentile(h_at_r, 0.10):.2f}")
        print(f"  p50   = {_percentile(h_at_r, 0.50):.2f}")
        print(f"  p90   = {_percentile(h_at_r, 0.90):.2f}")

    # Decision-quality verdict.
    safe = counts.get("arrived_safely", 0)
    near_miss = counts.get("tow_after_warning", 0)
    miss = counts.get("tow_no_warning", 0)
    benign = counts.get("no_failure", 0)
    print("\n=== Decision-quality verdict ===")
    if total - benign > 0:
        denom = total - benign
        print(f"  on runs that exhibited a fault ({denom}):")
        print(f"    correct (arrived_safely)        = {100.0 * safe / denom:.2f}%")
        print(f"    near-miss (tow_after_warning)   = {100.0 * near_miss / denom:.2f}%")
        print(f"    silent failure (tow_no_warning) = {100.0 * miss / denom:.2f}%")
    print(f"  benign (no_failure)             = {100.0 * benign / total:.2f}% of all runs")


def main() -> int:
    args = parse_args()
    n = max(1, args.iterations)
    print(f"Running {n} iterations (seed_base={args.seed_base}, workers={args.workers})...")
    started = time.time()
    outcomes: list[Outcome] = []

    dump_path = args.dump_training
    model_path = args.use_model
    if model_path:
        # Validate the model loads in the main process before we fork.
        from ..predictor_model import load_predictor
        test_fn = load_predictor(model_path)
        if test_fn is None:
            print(f"ERROR: could not load model from {model_path}")
            return 2
        print(f"Using trained model: {model_path}")
    inputs = [(args.seed_base + i, dump_path is not None, model_path) for i in range(n)]
    # Streamed sample collection — extract samples as outcomes arrive,
    # then drop them from the Outcome to keep memory bounded.
    feats: list[list[float]] = []
    labels: list[float] = []

    def _consume(o: Outcome) -> Outcome:
        if o.samples and o.t_critical is not None:
            tc = o.t_critical
            for t_obs, fv in o.samples:
                feats.append(fv)
                labels.append(tc - t_obs)
            o.samples = None
        return o

    if args.workers <= 1:
        for i, arg in enumerate(inputs):
            outcomes.append(_consume(simulate_one(arg)))
            if (i + 1) % max(1, n // 20) == 0:
                pct = 100.0 * (i + 1) / n
                print(f"  [{i+1}/{n}] {pct:.1f}%", flush=True)
    else:
        from multiprocessing import Pool
        with Pool(processes=args.workers) as pool:
            for i, o in enumerate(
                pool.imap_unordered(simulate_one, inputs, chunksize=64)
            ):
                outcomes.append(_consume(o))
                if (i + 1) % max(1, n // 20) == 0:
                    pct = 100.0 * (i + 1) / n
                    print(f"  [{i+1}/{n}] {pct:.1f}%", flush=True)

    elapsed = time.time() - started
    print(f"\nDone. Wall time: {elapsed:.1f} s ({n / elapsed:.0f} runs/s)")
    _summarise(outcomes)

    # Optional: write training data (already collected during streaming).
    if dump_path:
        try:
            import numpy as np
        except ImportError:
            print("\n!! numpy missing; cannot dump training data.")
            return 0
        if not feats:
            print("\n!! no samples collected (no run reached critical).")
            return 0
        X = np.asarray(feats, dtype=np.float32)
        y = np.asarray(labels, dtype=np.float32)
        print(f"\nDumping {len(feats)} samples -> {dump_path}")
        np.savez_compressed(
            dump_path,
            X=X,
            y=y,
            feature_names=np.array(FEATURE_NAMES, dtype=object),
        )
        print(f"  X shape={X.shape} y shape={y.shape}; size={(X.nbytes + y.nbytes) / 1e6:.1f} MB uncompressed")

    if args.first_failure_detail:
        first_miss = next((o for o in outcomes if o.label == "tow_no_warning"), None)
        if first_miss:
            print("\n=== First silent-failure run (tow_no_warning) ===")
            for k, v in first_miss.__dict__.items():
                print(f"  {k:<22} {v}")
        else:
            print("\nNo silent-failure runs in this batch.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
