# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""GPU-only trainer for the time-to-critical RUL predictor.

Compares two GPU paths trained on the .npz produced by gpu_eval.py:

  - XGBoost (CUDA tree method)        — gradient-boosted trees on GPU
  - PyTorch MLP (CUDA)                — small fully-connected net on GPU

Both train on GPU; CPU is only used for orchestration + IO. Picks the
model with lowest validation MAE (in seconds), saves it, and dumps a
metadata JSON that the live bridge / eval_predictor can read.

Run as:

    python -m vsbs_carla.scripts.train_model \
        --data data/training_100k.npz \
        --out models/predictor.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

import numpy as np


def _split(X: np.ndarray, y: np.ndarray, ratio: float, seed: int):
    rng = np.random.default_rng(seed)
    n = len(X)
    idx = rng.permutation(n)
    cut = int(n * ratio)
    return X[idx[:cut]], y[idx[:cut]], X[idx[cut:]], y[idx[cut:]]


def _metrics(name: str, y_true: np.ndarray, y_pred: np.ndarray, fit_seconds: float) -> dict:
    err = y_pred - y_true
    abs_err = np.abs(err)
    return {
        "name": name,
        "mae_s": float(abs_err.mean()),
        "rmse_s": float(np.sqrt((err ** 2).mean())),
        "p50_s": float(np.median(abs_err)),
        "p90_s": float(np.percentile(abs_err, 90)),
        "p99_s": float(np.percentile(abs_err, 99)),
        "bias_s": float(err.mean()),
        "fit_seconds": fit_seconds,
    }


# --- XGBoost on CUDA -------------------------------------------------------


def train_xgb_cuda(X_tr, y_tr, X_va, y_va) -> tuple[Any, dict, str]:
    import xgboost as xgb
    print("\n[xgb-cuda] training...", flush=True)
    t0 = time.time()
    # XGBoost 3.x: use DMatrix on CUDA so prediction stays on GPU and the
    # CPU<->GPU transfer warning goes away. tree_method='hist' picks the
    # GPU implementation when device='cuda'.
    dtrain = xgb.QuantileDMatrix(X_tr, label=y_tr)
    dval = xgb.QuantileDMatrix(X_va, label=y_va, ref=dtrain)
    params = dict(
        objective="reg:squarederror",
        tree_method="hist",
        device="cuda",
        max_depth=8,
        learning_rate=0.08,
        subsample=0.85,
        colsample_bytree=0.9,
        reg_lambda=1.0,
    )
    booster = xgb.train(
        params,
        dtrain,
        num_boost_round=600,
        evals=[(dval, "val")],
        verbose_eval=50,
    )
    pred = booster.predict(dval)
    metrics = _metrics("XGBoost (CUDA)", y_va, pred, time.time() - t0)
    return booster, metrics, "xgb_cuda"


# --- PyTorch MLP on CUDA ---------------------------------------------------


def train_torch_mlp(X_tr, y_tr, X_va, y_va) -> tuple[Any, dict, str]:
    import torch
    import torch.nn as nn
    print("\n[torch-mlp-cuda] training...", flush=True)
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable for torch path")

    device = "cuda"
    t0 = time.time()

    # Standardise features (mean/std from train) for stable optimisation.
    f_mean = X_tr.mean(axis=0).astype(np.float32)
    f_std = X_tr.std(axis=0).astype(np.float32) + 1e-6

    Xt_tr = torch.from_numpy(((X_tr - f_mean) / f_std).astype(np.float32)).to(device)
    yt_tr = torch.from_numpy(y_tr.astype(np.float32)).to(device)
    Xt_va = torch.from_numpy(((X_va - f_mean) / f_std).astype(np.float32)).to(device)
    yt_va = torch.from_numpy(y_va.astype(np.float32)).to(device)

    in_dim = X_tr.shape[1]
    model = nn.Sequential(
        nn.Linear(in_dim, 128),
        nn.GELU(),
        nn.Linear(128, 128),
        nn.GELU(),
        nn.Linear(128, 64),
        nn.GELU(),
        nn.Linear(64, 1),
    ).to(device)

    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=20)
    loss_fn = nn.SmoothL1Loss()  # robust to occasional outliers from jumps

    n = Xt_tr.shape[0]
    batch = 8192
    epochs = 20
    best_val = float("inf")
    best_state = None
    for ep in range(epochs):
        model.train()
        perm = torch.randperm(n, device=device)
        ep_loss = 0.0
        nb = 0
        for s in range(0, n, batch):
            idx = perm[s : s + batch]
            xb = Xt_tr[idx]
            yb = yt_tr[idx]
            pred = model(xb).squeeze(-1)
            loss = loss_fn(pred, yb)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            ep_loss += float(loss.item())
            nb += 1
        sched.step()
        model.eval()
        with torch.no_grad():
            val_pred = model(Xt_va).squeeze(-1)
            val_mae = float((val_pred - yt_va).abs().mean().item())
        print(f"  epoch {ep+1:>2}/{epochs}  train_loss={ep_loss/nb:.3f}  val_mae={val_mae:.2f}s", flush=True)
        if val_mae < best_val:
            best_val = val_mae
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        val_pred = model(Xt_va).squeeze(-1).cpu().numpy()

    metrics = _metrics("PyTorch MLP (CUDA)", y_va, val_pred, time.time() - t0)
    return (model, f_mean, f_std), metrics, "torch_mlp"


# --- PyTorch MLP — quantile head (P10/P50/P90) ----------------------------


QUANTILES: tuple[float, ...] = (0.1, 0.5, 0.9)


def train_torch_mlp_quantile(X_tr, y_tr, X_va, y_va) -> tuple[Any, dict, str]:
    """Same MLP backbone as train_torch_mlp but with a 3-channel head and
    pinball loss for the (P10, P50, P90) quantiles of time-to-critical.

    Why: the live bridge acts on RUL ≤ ACT_SOON_PREDICTED_RUL_S to
    reroute. With a point estimate, the predictor's MAE is silently
    folded into the safety margin. With P10, the safety margin is
    *explicit* — we trigger when the 10th-percentile time-to-critical
    crosses threshold, so the reroute happens earlier when uncertainty
    is high (jumpy fault) and later when uncertainty is low (smooth
    decay). Same predictor brain, much fewer tow_no_warning outcomes.
    """
    import torch
    import torch.nn as nn
    print("\n[torch-mlp-quantile-cuda] training...", flush=True)
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable for torch quantile path")

    device = "cuda"
    t0 = time.time()

    f_mean = X_tr.mean(axis=0).astype(np.float32)
    f_std = X_tr.std(axis=0).astype(np.float32) + 1e-6

    Xt_tr = torch.from_numpy(((X_tr - f_mean) / f_std).astype(np.float32)).to(device)
    yt_tr = torch.from_numpy(y_tr.astype(np.float32)).to(device)
    Xt_va = torch.from_numpy(((X_va - f_mean) / f_std).astype(np.float32)).to(device)
    yt_va = torch.from_numpy(y_va.astype(np.float32)).to(device)

    in_dim = X_tr.shape[1]
    Q = len(QUANTILES)
    model = nn.Sequential(
        nn.Linear(in_dim, 128),
        nn.GELU(),
        nn.Linear(128, 128),
        nn.GELU(),
        nn.Linear(128, 64),
        nn.GELU(),
        nn.Linear(64, Q),
    ).to(device)

    taus = torch.tensor(QUANTILES, device=device, dtype=torch.float32)  # [Q]

    def pinball_loss(pred: "torch.Tensor", target: "torch.Tensor") -> "torch.Tensor":
        # pred [B, Q]; target [B] → broadcast to [B, Q]
        diff = target.unsqueeze(-1) - pred
        return torch.maximum(taus * diff, (taus - 1.0) * diff).mean()

    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=20)

    n = Xt_tr.shape[0]
    batch = 8192
    epochs = 20
    best_val = float("inf")
    best_state = None
    for ep in range(epochs):
        model.train()
        perm = torch.randperm(n, device=device)
        ep_loss = 0.0
        nb = 0
        for s in range(0, n, batch):
            idx = perm[s : s + batch]
            xb = Xt_tr[idx]
            yb = yt_tr[idx]
            pred = model(xb)  # [B, Q]
            loss = pinball_loss(pred, yb)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            ep_loss += float(loss.item())
            nb += 1
        sched.step()
        model.eval()
        with torch.no_grad():
            val_pred = model(Xt_va)  # [N, Q]
            val_p50 = val_pred[:, QUANTILES.index(0.5)]
            val_mae_p50 = float((val_p50 - yt_va).abs().mean().item())
        print(
            f"  epoch {ep+1:>2}/{epochs}  train_pinball={ep_loss/nb:.3f}  "
            f"val_mae(P50)={val_mae_p50:.2f}s",
            flush=True,
        )
        if val_mae_p50 < best_val:
            best_val = val_mae_p50
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        val_full = model(Xt_va).cpu().numpy()  # [N, Q]

    # Headline metric uses P50 so it's directly comparable to the point
    # MLP. We also report per-quantile MAE for visibility — a healthy
    # quantile model has P10 MAE < P50 MAE < P90 MAE on right-skewed
    # labels, but for symmetric labels they should be roughly equal.
    metrics = _metrics(
        "PyTorch MLP-Quantile (CUDA)", y_va, val_full[:, QUANTILES.index(0.5)],
        time.time() - t0,
    )
    metrics["quantiles"] = list(QUANTILES)
    for i, q in enumerate(QUANTILES):
        metrics[f"mae_p{int(q*100)}_s"] = float(np.abs(val_full[:, i] - y_va).mean())
    # Calibration check: % of labels covered by [P10, P90]. Should be ~80
    # if the quantile model is well-calibrated.
    p10 = val_full[:, QUANTILES.index(0.1)]
    p90 = val_full[:, QUANTILES.index(0.9)]
    covered = float(((y_va >= p10) & (y_va <= p90)).mean())
    metrics["coverage_p10_p90"] = covered

    return (model, f_mean, f_std, list(QUANTILES)), metrics, "torch_mlp_quantile"


# --- main ------------------------------------------------------------------


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="GPU-only RUL predictor trainer.")
    p.add_argument("--data", required=True, help="Path to .npz from gpu_eval.")
    p.add_argument("--out", required=True, help="Where to save the best model.")
    p.add_argument("--val-ratio", type=float, default=0.85, help="Train fraction (default 0.85).")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument(
        "--skip",
        nargs="*",
        default=[],
        help="Optional: model names to skip (e.g. --skip torch_mlp).",
    )
    return p.parse_args(argv)


def main() -> int:
    args = parse_args()

    # Sanity check: GPU is required.
    try:
        import torch
        cuda_ok = torch.cuda.is_available()
    except ImportError:
        cuda_ok = False
    if not cuda_ok:
        print("ERROR: CUDA unavailable. This trainer is GPU-only.")
        return 2
    print(f"GPU: {torch.cuda.get_device_name(0)}  "
          f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB",
          flush=True)

    print(f"Loading {args.data}...", flush=True)
    blob = np.load(args.data, allow_pickle=True)
    X = blob["X"]
    y = blob["y"]
    feature_names = list(blob["feature_names"])
    print(f"  X shape: {X.shape}  y shape: {y.shape}  features: {feature_names}", flush=True)

    X_tr, y_tr, X_va, y_va = _split(X, y, args.val_ratio, args.seed)
    print(f"  train: {len(X_tr)}  val: {len(X_va)}", flush=True)

    # Reference baselines (no GPU; computed instantly).
    y_pred_mean = np.full_like(y_va, y_tr.mean())
    baseline_metrics = _metrics("baseline (mean)", y_va, y_pred_mean, 0.0)

    h_idx = feature_names.index("health_pct")
    s_idx = feature_names.index("slope_pct_per_s")
    health_va = X_va[:, h_idx]
    slope_va = X_va[:, s_idx]
    y_pred_linear = np.where(
        slope_va > 0.01,
        np.maximum(0.0, (health_va - 5.0) / np.maximum(slope_va, 0.001)),
        9999.0,
    )
    linear_metrics = _metrics("OnlineRulPredictor (linear)", y_va, y_pred_linear, 0.0)

    # Run the GPU trainers serially so each gets full GPU bandwidth.
    # The quantile head is the headline model — its P10 is what the live
    # bridge uses for the reroute decision. Point-MLP and XGB are kept
    # for an apples-to-apples MAE comparison on the same val split.
    runs: list[tuple[Any, dict, str]] = []
    trainers = [
        ("xgb_cuda", train_xgb_cuda),
        ("torch_mlp", train_torch_mlp),
        ("torch_mlp_quantile", train_torch_mlp_quantile),
    ]
    for name, fn in trainers:
        if name in args.skip:
            print(f"\n[{name}] skipped via --skip", flush=True)
            continue
        try:
            model, m, key = fn(X_tr, y_tr, X_va, y_va)
            runs.append((model, m, key))
            print(f"  [ok] {m['name']}: MAE={m['mae_s']:.2f}s  "
                  f"p90={m['p90_s']:.2f}s  fit={m['fit_seconds']:.1f}s",
                  flush=True)
        except Exception as err:
            print(f"  [fail] {name} failed: {err}", flush=True)

    print("\n=== Validation comparison (lower MAE = better) ===\n", flush=True)
    print(f"{'model':<32}{'MAE (s)':>10}{'RMSE (s)':>11}{'p50':>8}{'p90':>8}"
          f"{'p99':>8}{'bias':>9}{'fit (s)':>10}")
    print("-" * 96)
    all_metrics = [baseline_metrics, linear_metrics] + [m for _, m, _ in runs]
    for m in sorted(all_metrics, key=lambda x: x["mae_s"]):
        print(f"{m['name']:<32}{m['mae_s']:>10.2f}{m['rmse_s']:>11.2f}"
              f"{m['p50_s']:>8.2f}{m['p90_s']:>8.2f}{m['p99_s']:>8.2f}"
              f"{m['bias_s']:>9.2f}{m['fit_seconds']:>10.1f}")

    if not runs:
        print("\nNo models trained successfully.")
        return 1

    # Pick the model that produced the lowest validation MAE — for the
    # quantile head the metric is on P50, directly comparable to the
    # point regressors.
    best_model, best_metrics, best_key = min(runs, key=lambda r: r[1]["mae_s"])
    print(f"\nLowest val-MAE model: {best_metrics['name']} (MAE={best_metrics['mae_s']:.2f}s)", flush=True)

    # The bridge prefers the quantile MLP regardless of whether it edged
    # XGBoost on point MAE, because P10-based decisions are what shifted
    # tow_no_warning into arrived_safely in the .npz audits. We only
    # demote it if it lost by more than QUANTILE_PREFERENCE_SLACK_S.
    QUANTILE_PREFERENCE_SLACK_S = 5.0
    quantile_run = next(
        ((m, met, k) for (m, met, k) in runs if k == "torch_mlp_quantile"),
        None,
    )
    save_run = (best_model, best_metrics, best_key)
    if quantile_run is not None:
        q_metrics = quantile_run[1]
        if q_metrics["mae_s"] <= best_metrics["mae_s"] + QUANTILE_PREFERENCE_SLACK_S:
            save_run = quantile_run
            print(
                f"Promoted quantile MLP for save (within {QUANTILE_PREFERENCE_SLACK_S:.0f}s slack: "
                f"{q_metrics['mae_s']:.2f} vs best {best_metrics['mae_s']:.2f})",
                flush=True,
            )

    save_model, save_metrics, save_key = save_run

    out_dir = os.path.dirname(args.out) or "."
    os.makedirs(out_dir, exist_ok=True)

    # --- save in the right format for predictor_model.py to load ---
    # We always also save the XGB JSON (when present) for legacy callers,
    # but the live bridge looks at .pt first via DEFAULT_MODEL_PATH.
    importance: dict | None = None
    save_path: str
    if save_key == "xgb_cuda":
        save_path = args.out if args.out.endswith(".json") else args.out + ".json"
        save_model.save_model(save_path)
        try:
            score = save_model.get_score(importance_type="gain")
            importance = {feature_names[int(k[1:])]: float(v) for k, v in score.items()}
        except Exception:
            pass
    else:
        import torch
        if save_key == "torch_mlp_quantile":
            model, f_mean, f_std, qs = save_model
            arch_label = "MLP-128-128-64-Q3"
            quantiles_meta: list[float] | None = list(qs)
        else:
            model, f_mean, f_std = save_model
            arch_label = "MLP-128-128-64"
            quantiles_meta = None
        save_path = (
            args.out.rsplit(".json", 1)[0] if args.out.endswith(".json") else args.out
        ) + ".pt"
        ck = {
            "state_dict": model.state_dict(),
            "feature_mean": f_mean,
            "feature_std": f_std,
            "feature_names": feature_names,
            "arch": arch_label,
        }
        if quantiles_meta is not None:
            ck["quantiles"] = quantiles_meta
        torch.save(ck, save_path)

    # Always keep the XGB JSON next to the .pt so predictor_model.py can
    # fall back if the .pt is missing on a target machine. This costs ~1
    # MB and removes a foot-gun.
    extra_paths: list[str] = []
    if save_key != "xgb_cuda":
        xgb_run = next(((m, met, k) for (m, met, k) in runs if k == "xgb_cuda"), None)
        if xgb_run is not None:
            xgb_path = (
                args.out if args.out.endswith(".json") else args.out + ".json"
            )
            try:
                xgb_run[0].save_model(xgb_path)
                extra_paths.append(xgb_path)
            except Exception as err:
                print(f"  ! also-saving XGB JSON failed: {err}")

    metadata = {
        "winner": save_key,
        "winner_label": save_metrics["name"],
        "model_path": os.path.abspath(save_path),
        "extra_paths": [os.path.abspath(p) for p in extra_paths],
        "feature_names": feature_names,
        "metrics_all": all_metrics,
        "metrics_winner": save_metrics,
        "feature_importance": importance,
        "training_samples": int(X.shape[0]),
        "validation_samples": int(X_va.shape[0]),
    }
    meta_path = os.path.splitext(args.out)[0] + ".meta.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
    print(f"\nSaved model    -> {save_path}")
    print(f"Saved metadata -> {meta_path}")
    if importance:
        print("\nFeature importance (gain):")
        for k, v in sorted(importance.items(), key=lambda kv: -kv[1]):
            print(f"  {k:<32}{v:.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
