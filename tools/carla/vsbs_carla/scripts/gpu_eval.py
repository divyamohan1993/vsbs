# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""GPU-batched evaluator. Runs the stochastic fault model in parallel
across all iterations as a single tensor batch on CUDA, then post-
processes trajectories on GPU to extract (features, labels). Output
matches eval_predictor.py's .npz format so train_model.py works on
either source.

Run as:

    python -m vsbs_carla.scripts.gpu_eval \
        --iterations 100000 \
        --dump-training data/training_100k.npz

Why GPU? CPU multiprocessing kept all 12 cores busy. With CUDA we run
the same simulation as one batched op pipeline — O(seconds) for 100k
iterations on an RTX 3050, with CPU mostly idle.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections import Counter
from typing import Optional

import numpy as np

# Match the per-tick parameters in test_drive.py exactly.
from .test_drive import (
    ACT_SOON_PREDICTED_RUL_S,
    CRITICAL_HEALTH_PCT,
    DEGRADATION_TREND_INIT_RANGE,
    FEATURE_NAMES,
    JUMP_DETECT_PCT,
    JUMP_LOOKBACK_S,
    JUMP_MAGNITUDE_RANGE_PCT,
    JUMP_PROB_PER_SEC,
    NOISE_STDEV_PCT,
    PLATEAU_DURATION_RANGE_S,
    PLATEAU_PROB_PER_SEC,
    PLATEAU_SLOPE_THRESHOLD,
    PLATEAU_VOL_THRESHOLD,
    PREDICTOR_MIN_OBS_FOR_REROUTE,
    TICK_HZ,
    TREND_DRIFT_STDEV_PER_S,
)


# Sim parameters — kept identical to eval_predictor's CPU baseline so
# results are comparable.
TICK_DT = 1.0 / TICK_HZ           # 0.05 s per fine-tick
SAMPLE_TICKS = 20                 # one sample per simulated second
SAMPLE_DT = SAMPLE_TICKS * TICK_DT  # 1.0 s
SIM_BUDGET_S = 600.0
N_FINE_TICKS = int(SIM_BUDGET_S / TICK_DT)        # 12000
N_SAMPLES = N_FINE_TICKS // SAMPLE_TICKS          # 600
DRIVE_TO_SC_S = 60.0


def _gpu_sim(B: int, device: str, seed: int) -> tuple:
    """Vectorised stochastic-fault simulation. Returns:

        traj         [B, N_SAMPLES]    health % at each 1-Hz sample
        t_critical   [B]                first time h<=5 (inf if never)
    """
    import torch
    gen = torch.Generator(device=device).manual_seed(seed)

    health = torch.full((B,), 100.0, device=device)
    trend = (
        torch.empty(B, device=device).uniform_(
            DEGRADATION_TREND_INIT_RANGE[0], DEGRADATION_TREND_INIT_RANGE[1],
            generator=gen,
        )
    )
    plateau_end_t = torch.full((B,), -1.0, device=device)
    t_critical = torch.full((B,), float("inf"), device=device)

    traj = torch.empty(B, N_SAMPLES, device=device)

    INF = torch.tensor(float("inf"), device=device)
    plateau_min = float(PLATEAU_DURATION_RANGE_S[0])
    plateau_max = float(PLATEAU_DURATION_RANGE_S[1])
    jump_min = float(JUMP_MAGNITUDE_RANGE_PCT[0])
    jump_max = float(JUMP_MAGNITUDE_RANGE_PCT[1])

    sample_idx = 0
    for i in range(N_FINE_TICKS):
        t_now = i * TICK_DT

        # 1. Trend drift (autocorrelated random walk).
        trend_noise = torch.randn(B, generator=gen, device=device) * (TREND_DRIFT_STDEV_PER_S * TICK_DT)
        trend = torch.clamp(trend + trend_noise, 0.05, 1.5)

        # 2. Plateau status.
        in_plateau = plateau_end_t > t_now

        # 3. New plateau check (only when not currently in one).
        new_plateau = (~in_plateau) & (
            torch.rand(B, generator=gen, device=device) < (PLATEAU_PROB_PER_SEC * TICK_DT)
        )
        plateau_dur = torch.empty(B, device=device).uniform_(plateau_min, plateau_max, generator=gen)
        plateau_end_t = torch.where(new_plateau, t_now + plateau_dur, plateau_end_t)
        in_plateau = in_plateau | new_plateau

        # 4. Health delta — base trend or muted noise during plateau.
        base_noise = torch.randn(B, generator=gen, device=device) * (NOISE_STDEV_PCT * TICK_DT)
        plateau_noise = torch.randn(B, generator=gen, device=device) * (NOISE_STDEV_PCT * 0.4 * TICK_DT)
        delta = torch.where(in_plateau, plateau_noise, trend * TICK_DT + base_noise)

        # 5. Sudden drop event.
        new_jump = (~in_plateau) & (
            torch.rand(B, generator=gen, device=device) < (JUMP_PROB_PER_SEC * TICK_DT)
        )
        jump_size = torch.empty(B, device=device).uniform_(jump_min, jump_max, generator=gen)
        delta = delta + torch.where(new_jump, jump_size, torch.zeros_like(delta))

        # 6. Apply.
        health = torch.clamp(health - delta, 0.0, 100.0)

        # 7. Critical detection.
        crossed = (health <= CRITICAL_HEALTH_PCT) & torch.isinf(t_critical)
        t_critical = torch.where(crossed, torch.tensor(t_now, device=device), t_critical)

        # 8. Sample for trajectory output.
        if i % SAMPLE_TICKS == 0:
            traj[:, sample_idx] = health
            sample_idx += 1
            if sample_idx >= N_SAMPLES:
                break

    return traj, t_critical


def _extract_features(traj, t_critical):
    """Vectorised feature extraction matching FEATURE_NAMES.

    traj: [B, T] health %
    t_critical: [B] first critical time (inf if none)

    Returns (X, y, valid_mask) — all torch tensors on the same device.
    valid_mask is True only where the run reached critical, sample is
    after the warmup, and label > 0.
    """
    import torch
    B, T = traj.shape
    device = traj.device

    K_SLOPE = 8           # 8 samples (= 8 s) for slope estimate
    K_DROP = 5            # 5-sample window for max drop
    K_VOL = 4             # chunk size for volatility std

    # --- slope (closed-form least squares, K=8) ---
    x = torch.arange(K_SLOPE, dtype=torch.float32, device=device)
    x_centered = x - x.mean()
    x_var_sum = (x_centered ** 2).sum()
    win_slope = traj.unfold(1, K_SLOPE, 1)                              # [B, T-K+1, K]
    y_centered = win_slope - win_slope.mean(dim=2, keepdim=True)
    slope_signed = (x_centered * y_centered).sum(dim=2) / x_var_sum     # [B, T-K+1]
    slope = torch.clamp(-slope_signed, min=0.0)                         # positive degradation rate
    pad_left = torch.zeros(B, K_SLOPE - 1, device=device)
    slope = torch.cat([pad_left, slope], dim=1)                         # [B, T]

    # --- max drop in last K_DROP samples ---
    diffs = traj[:, :-1] - traj[:, 1:]                                  # [B, T-1] (positive = drop)
    drops = diffs.clamp(min=0.0)
    drops_aligned = torch.cat([torch.zeros(B, 1, device=device), drops], dim=1)  # [B, T]
    win_drop = drops_aligned.unfold(1, K_DROP, 1)                       # [B, T-K_DROP+1, K_DROP]
    max_drop = win_drop.max(dim=2).values                               # [B, T-K_DROP+1]
    pad_l = torch.zeros(B, K_DROP - 1, device=device)
    max_drop = torch.cat([pad_l, max_drop], dim=1)                      # [B, T]

    # --- slope volatility — std of slopes computed over rolling chunks of K_VOL ---
    # Reuse slope_signed (no clamp) to capture both positive/negative excursions.
    slope_raw = -slope_signed
    pad_raw = torch.zeros(B, K_SLOPE - 1, device=device)
    slope_raw_full = torch.cat([pad_raw, slope_raw], dim=1)             # [B, T]
    win_vol = slope_raw_full.unfold(1, K_VOL, 1)                        # [B, T-K_VOL+1, K_VOL]
    vol = win_vol.std(dim=2, unbiased=False)                            # [B, T-K_VOL+1]
    pad_v = torch.zeros(B, K_VOL - 1, device=device)
    vol = torch.cat([pad_v, vol], dim=1)                                # [B, T]

    # --- t_since_fault ---
    t_axis = torch.arange(T, device=device, dtype=torch.float32) * SAMPLE_DT  # [T]
    t_since = t_axis.unsqueeze(0).expand(B, T)                                # [B, T]

    # --- predictor MAE (cannot vectorise the online MAE; set to 0) ---
    mae = torch.zeros_like(traj)

    # --- observation count saturating at 80 (matches PREDICTOR_WINDOW) ---
    obs = torch.clamp(t_axis * float(TICK_HZ), max=80.0).unsqueeze(0).expand(B, T)

    # --- engineered features added 2026-05-09 -----------------------------
    # 1. time_since_last_jump  — t_axis − cummax(t at jumps); SIM_BUDGET_S
    #    sentinel before the first jump so the model sees "no jump yet".
    # 2. recent_jump_count_10s — rolling sum of jump-indicator over a 10-
    #    sample window (1 sample = 1 s, so this is jumps in the last 10 s).
    # 3. plateau_active        — slope < PLATEAU_SLOPE_THRESHOLD AND
    #    volatility < PLATEAU_VOL_THRESHOLD (boolean as float).
    # 4. slope_x_health_margin — slope × max(0, health − CRIT). The linear
    #    closed-form RUL inverse, given as an explicit interaction so the
    #    network doesn't have to relearn it from health and slope alone.

    jump_indicator = (drops_aligned > float(JUMP_DETECT_PCT)).float()        # [B, T]
    NEG_INF_TIME = -1e6
    t_at_jump = torch.where(
        jump_indicator > 0.5,
        t_axis.unsqueeze(0).expand(B, T),
        torch.full((B, T), NEG_INF_TIME, device=device),
    )
    last_jump_t = torch.cummax(t_at_jump, dim=1).values                      # [B, T]
    SENTINEL_NO_JUMP = float(SIM_BUDGET_S)
    time_since_last_jump = torch.where(
        last_jump_t > (NEG_INF_TIME * 0.5),
        t_axis.unsqueeze(0) - last_jump_t,
        torch.full((B, T), SENTINEL_NO_JUMP, device=device),
    )

    # Rolling jump count over the last JUMP_LOOKBACK_S samples.
    K_JUMP = max(1, int(round(JUMP_LOOKBACK_S / SAMPLE_DT)))
    pad_jump = torch.zeros(B, K_JUMP - 1, device=device)
    jumps_padded = torch.cat([pad_jump, jump_indicator], dim=1)
    recent_jump_count = jumps_padded.unfold(1, K_JUMP, 1).sum(dim=2)         # [B, T]

    plateau_active = (
        (slope < float(PLATEAU_SLOPE_THRESHOLD))
        & (vol < float(PLATEAU_VOL_THRESHOLD))
    ).float()                                                                # [B, T]

    slope_x_health_margin = slope * torch.clamp(
        traj - float(CRITICAL_HEALTH_PCT), min=0.0
    )                                                                        # [B, T]

    # Stack in FEATURE_NAMES order. Must match test_drive.FEATURE_NAMES
    # exactly — the trainer reads .feature_names from the .npz to label
    # rows and the loaded model expects this column ordering.
    X = torch.stack(
        [
            traj,
            slope,
            vol,
            max_drop,
            t_since,
            mae,
            obs,
            time_since_last_jump,
            recent_jump_count,
            plateau_active,
            slope_x_health_margin,
        ],
        dim=2,
    )                                                                        # [B, T, 11]

    # Labels — time to critical from each sample point.
    t_crit_b = t_critical.unsqueeze(1).expand(B, T)
    y = t_crit_b - t_axis.unsqueeze(0).expand(B, T)

    # Validity:
    #  - critical did fire in this run (t_crit finite)
    #  - sample is before t_critical
    #  - predictor would have had enough warmup obs (>= MIN_OBS_FOR_REROUTE)
    valid = (
        torch.isfinite(t_crit_b)
        & (y > 0.0)
        & (obs >= float(PREDICTOR_MIN_OBS_FOR_REROUTE))
    )

    return X, y, valid


def _classify_outcomes(traj, t_critical, slope_for_decision, X, y, valid, model_rul=None):
    """Replay the reroute decision in vectorised form, mirroring
    eval_predictor.simulate_one's outcome taxonomy.

    `model_rul`: optional [B, T] tensor of model-predicted RUL, used in
    place of the linear formula when present.
    """
    import torch
    B, T = traj.shape
    device = traj.device

    # RUL source: trained model if provided, else linear formula.
    if model_rul is not None:
        rul = torch.clamp(model_rul, min=0.0)
    else:
        h = X[..., 0]
        s = X[..., 1]
        rul = torch.where(
            s > 0.01,
            torch.clamp((h - CRITICAL_HEALTH_PCT) / torch.clamp(s, min=0.001), min=0.0),
            torch.full_like(h, float("inf")),
        )
    eligible = (X[..., FEATURE_NAMES.index("observation_count")] >= float(PREDICTOR_MIN_OBS_FOR_REROUTE))
    triggered = eligible & (rul <= ACT_SOON_PREDICTED_RUL_S)

    # First triggered sample per row; if none, set to T (sentinel).
    big = T + 10
    idx_grid = torch.arange(T, device=device).unsqueeze(0).expand(B, T)
    masked_idx = torch.where(triggered, idx_grid, torch.full_like(idx_grid, big))
    first_trigger_idx = masked_idx.min(dim=1).values        # [B]
    has_reroute = first_trigger_idx < T

    t_axis = torch.arange(T, device=device, dtype=torch.float32) * SAMPLE_DT
    t_reroute = torch.where(
        has_reroute,
        t_axis[first_trigger_idx.clamp(max=T - 1)],
        torch.full_like(t_critical, float("inf")),
    )

    # Outcome counts.
    has_critical = torch.isfinite(t_critical)
    arrived = has_reroute & ((~has_critical) | ((t_critical - t_reroute) >= DRIVE_TO_SC_S))
    tow_after = has_reroute & has_critical & ((t_critical - t_reroute) > 0) & ((t_critical - t_reroute) < DRIVE_TO_SC_S)
    tow_silent = has_critical & (~has_reroute)
    no_failure = (~has_critical) & (~has_reroute)

    counts = {
        "arrived_safely": int(arrived.sum().item()),
        "tow_after_warning": int(tow_after.sum().item()),
        "tow_no_warning": int(tow_silent.sum().item()),
        "no_failure": int(no_failure.sum().item()),
    }
    return counts, has_reroute, t_reroute


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="GPU-batched headless evaluator.")
    p.add_argument("--iterations", type=int, default=100000)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--device", default="cuda", help="cuda or cpu")
    p.add_argument("--batch", type=int, default=20000,
                   help="Mini-batch size (split iterations to fit VRAM).")
    p.add_argument("--dump-training", type=str, default=None, metavar="PATH")
    p.add_argument(
        "--use-model",
        type=str,
        default=None,
        metavar="PATH",
        help="Use a trained model's predicted RUL for reroute decisions "
             "(instead of the linear OnlineRulPredictor formula).",
    )
    return p.parse_args(argv)


def _model_predict_rul_batched(model_path: str, X_flat: np.ndarray, device: str):
    """Vectorised RUL prediction over a flat [N, F] feature array.
    Returns numpy array of length N. Quantile heads return the P10
    (conservative) channel — that's what the live bridge acts on.
    Loads the model once.
    """
    if model_path.endswith(".json") and os.path.isfile(model_path):
        try:
            import xgboost as xgb
            booster = xgb.Booster()
            booster.load_model(model_path)
            dmat = xgb.DMatrix(X_flat)
            return booster.predict(dmat)
        except Exception as err:
            print(f"  ! xgboost model load failed: {err}")
    # Fall through to PyTorch .pt
    pt_path = (
        model_path if model_path.endswith(".pt")
        else os.path.splitext(model_path)[0] + ".pt"
    )
    if os.path.isfile(pt_path):
        import torch
        import torch.nn as nn
        ck = torch.load(pt_path, map_location="cpu", weights_only=False)
        state = ck["state_dict"]
        in_dim = X_flat.shape[1]
        # Detect output dim from the last layer's bias so we rebuild the
        # right architecture for both point (out=1) and quantile (out=Q)
        # heads. Sequential keys look like "0.weight", "2.weight", etc.
        bias_keys = sorted(
            (k for k in state.keys() if k.endswith(".bias")),
            key=lambda k: int(k.split(".")[0]),
        )
        out_dim = int(state[bias_keys[-1]].shape[0])
        quantiles = ck.get("quantiles", None)
        model = nn.Sequential(
            nn.Linear(in_dim, 128), nn.GELU(),
            nn.Linear(128, 128), nn.GELU(),
            nn.Linear(128, 64), nn.GELU(),
            nn.Linear(64, out_dim),
        )
        model.load_state_dict(state)
        model.eval().to(device)
        f_mean = torch.tensor(ck["feature_mean"], device=device).view(1, -1)
        f_std = torch.tensor(ck["feature_std"], device=device).view(1, -1)

        # Decision channel — P10 if this is a quantile head; otherwise
        # the only output. P10 is the conservative time-to-critical so
        # it errs on the side of triggering reroute earlier.
        decision_channel = 0
        if quantiles and out_dim > 1:
            qs = list(quantiles)
            decision_channel = int(min(range(len(qs)), key=lambda i: qs[i]))
            print(f"  model: quantile MLP (out={out_dim}, qs={qs}); "
                  f"using P{int(qs[decision_channel] * 100)} for decisions")
        else:
            print(f"  model: point MLP (out={out_dim})")

        # Chunk the inference to keep intermediate activations within VRAM
        # budget. 256k rows * 128-channel hidden = ~130 MB activations.
        chunk = 262_144
        out = np.empty(X_flat.shape[0], dtype=np.float32)
        with torch.no_grad():
            for s in range(0, X_flat.shape[0], chunk):
                e = min(s + chunk, X_flat.shape[0])
                x = torch.from_numpy(X_flat[s:e].astype(np.float32)).to(device)
                x = (x - f_mean) / f_std
                pred = model(x)  # [chunk, out_dim]
                if out_dim > 1:
                    pred = pred[:, decision_channel]
                else:
                    pred = pred.squeeze(-1)
                out[s:e] = pred.detach().cpu().numpy()
                del x, pred
            torch.cuda.empty_cache()
        return out
    raise FileNotFoundError(f"no loadable model at {model_path}")


def main() -> int:
    import torch
    args = parse_args()
    device = args.device
    # Project policy: ML training and inference run on GPU. The CPU is
    # reserved for orchestration only. Refuse to silently fall back.
    if device == "cuda" and not torch.cuda.is_available():
        print("ERROR: CUDA unavailable. gpu_eval is GPU-only.")
        return 2

    print(f"Device = {device}")
    if device == "cuda":
        print(f"  GPU: {torch.cuda.get_device_name(0)}  "
              f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    n_total = args.iterations
    batch = args.batch
    n_batches = (n_total + batch - 1) // batch
    print(f"Running {n_total} iterations in {n_batches} batches of up to {batch}")

    started = time.time()
    cumulative_counts: Counter = Counter()
    cumulative_lead: list[float] = []
    feats_chunks: list[np.ndarray] = []
    labels_chunks: list[np.ndarray] = []

    for bi in range(n_batches):
        B = min(batch, n_total - bi * batch)
        seed = args.seed + bi * 1_000_003     # large prime to decorrelate batches
        traj, t_crit = _gpu_sim(B, device, seed)
        X, y, valid = _extract_features(traj, t_crit)

        # Optionally run the trained model over every (batch, t) feature
        # vector and use its RUL for the reroute decision.
        model_rul = None
        if args.use_model:
            X_np = X.reshape(-1, X.shape[-1]).cpu().numpy()
            preds = _model_predict_rul_batched(args.use_model, X_np, device)
            import torch
            model_rul = torch.from_numpy(preds).to(device).reshape(B, -1)

        counts, has_rer, t_rer = _classify_outcomes(
            traj, t_crit, X[..., 1], X, y, valid, model_rul=model_rul,
        )
        for k, v in counts.items():
            cumulative_counts[k] += v
        # Lead time on runs that hit both reroute + critical.
        finite_crit = torch.isfinite(t_crit)
        lead_mask = has_rer & finite_crit & (t_crit - t_rer >= 0)
        if lead_mask.any():
            leads = (t_crit - t_rer)[lead_mask].cpu().numpy()
            cumulative_lead.extend(leads.tolist())

        if args.dump_training:
            X_keep = X[valid].cpu().numpy().astype(np.float32)
            y_keep = y[valid].cpu().numpy().astype(np.float32)
            feats_chunks.append(X_keep)
            labels_chunks.append(y_keep)

        del traj, t_crit, X, y, valid, has_rer, t_rer
        if device == "cuda":
            torch.cuda.empty_cache()
        print(f"  batch {bi+1}/{n_batches} done ({(bi+1) * batch:>7}/{n_total}); "
              f"running totals: {dict(cumulative_counts)}", flush=True)

    elapsed = time.time() - started
    print(f"\nDone. Wall time: {elapsed:.1f} s ({n_total / elapsed:.0f} iter/s)")

    print("\n=== Outcomes ===")
    for k in ("arrived_safely", "tow_after_warning", "tow_no_warning", "no_failure"):
        v = cumulative_counts[k]
        print(f"  {k:<22} {v:>8}  {100.0 * v / n_total:>6.2f}%")

    if cumulative_lead:
        arr = np.array(cumulative_lead)
        print("\n=== Predictor lead time (s) — runs where both fired ===")
        print(f"  count = {len(arr)}")
        print(f"  mean  = {arr.mean():.2f}")
        print(f"  p10   = {np.percentile(arr, 10):.2f}")
        print(f"  p50   = {np.percentile(arr, 50):.2f}")
        print(f"  p90   = {np.percentile(arr, 90):.2f}")
        print(f"  >= drive-time {DRIVE_TO_SC_S}s: "
              f"{int((arr >= DRIVE_TO_SC_S).sum())}/{len(arr)} "
              f"({100.0 * (arr >= DRIVE_TO_SC_S).mean():.2f}%)")

    if args.dump_training:
        if not feats_chunks:
            print("\n!! no samples (no run reached critical).")
            return 0
        X_all = np.concatenate(feats_chunks)
        y_all = np.concatenate(labels_chunks)
        os.makedirs(os.path.dirname(args.dump_training) or ".", exist_ok=True)
        print(f"\nDumping {X_all.shape[0]} samples -> {args.dump_training}")
        np.savez_compressed(
            args.dump_training,
            X=X_all,
            y=y_all,
            feature_names=np.array(FEATURE_NAMES, dtype=object),
        )
        print(f"  X shape={X_all.shape} y shape={y_all.shape}; "
              f"size={(X_all.nbytes + y_all.nbytes) / 1e6:.1f} MB uncompressed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
