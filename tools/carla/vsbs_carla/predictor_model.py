# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Loader for the trained RUL predictor.

Supports:

  * XGBoost native JSON (`predictor.json`)            — point estimate
  * PyTorch MLP `.pt`, single-head regression         — point estimate
  * PyTorch MLP `.pt`, 3-head quantile regression     — P10/P50/P90;
                                                        loader returns a
                                                        callable that
                                                        emits the
                                                        conservative
                                                        P10 for the
                                                        reroute decision
                                                        and exposes
                                                        `.quantiles(features) -> dict`
                                                        for telemetry.

Per project policy, ML inference runs on GPU. If CUDA is unavailable
when a `.pt` model is requested, this module returns None so callers
fall back to the linear OnlineRulPredictor — the CPU is reserved for
orchestration, never for ML.

Usage:

    from vsbs_carla.predictor_model import load_predictor
    predict = load_predictor("models/predictor.pt")
    rul_p10_s = predict(features_list)
    if hasattr(predict, "quantiles"):
        q = predict.quantiles(features_list)  # {"p10": .., "p50": .., "p90": ..}
"""

from __future__ import annotations

import os
from typing import Callable, Optional

import numpy as np


def load_predictor(path: str) -> Optional[Callable[[list[float]], float]]:
    """Load a trained model from disk and return a `predict(features)`
    callable. Returns None if the file isn't found or can't be loaded.

    Tries paths in order:
      1. `<path>` itself
      2. `<path-without-ext>.pt` (preferred — quantile MLP lives here)
      3. `<path-without-ext>.json` (XGBoost fallback)
      4. `<path-without-ext>.joblib` (legacy)
    """
    if not path:
        return None

    base, _ext = os.path.splitext(path)
    candidates: list[str] = [path]
    for alt in (base + ".pt", base + ".json", base + ".joblib"):
        if alt not in candidates:
            candidates.append(alt)

    for candidate in candidates:
        if not os.path.isfile(candidate):
            continue

        # PyTorch checkpoint (.pt) — single-head or quantile MLP.
        if candidate.endswith(".pt"):
            loaded = _load_torch(candidate)
            if loaded is not None:
                return loaded
            continue

        # XGBoost native JSON.
        if candidate.endswith(".json"):
            try:
                import xgboost as xgb
                booster = xgb.Booster()
                booster.load_model(candidate)

                def _xgb_predict(features: list[float], _b=booster) -> float:
                    arr = np.asarray([features], dtype=np.float32)
                    dmat = xgb.DMatrix(arr)
                    return float(_b.predict(dmat)[0])

                return _xgb_predict
            except Exception:
                continue

        # joblib pickle (sklearn / lightgbm).
        if candidate.endswith(".joblib"):
            try:
                import joblib
                model = joblib.load(candidate)

                def _generic_predict(features: list[float], _m=model) -> float:
                    arr = np.asarray([features], dtype=np.float32)
                    return float(_m.predict(arr)[0])

                return _generic_predict
            except Exception:
                continue

    return None


def _load_torch(candidate: str) -> Optional[Callable[[list[float]], float]]:
    """Load a PyTorch MLP checkpoint. Detects single-head vs quantile by
    inspecting the last layer's bias shape. Quantile heads return a
    callable that yields the conservative P10 plus a `.quantiles`
    attribute that returns the full {p10, p50, p90} dict.

    Returns None if CUDA is unavailable (project policy: ML on GPU only).
    """
    try:
        import torch
        import torch.nn as nn
    except ImportError:
        return None

    if not torch.cuda.is_available():
        print(
            f"[predictor_model] CUDA unavailable; refusing to load {candidate}. "
            "ML must run on GPU; falling back to the linear baseline.",
            flush=True,
        )
        return None

    try:
        ck = torch.load(candidate, map_location="cpu", weights_only=False)
    except Exception as err:
        print(f"[predictor_model] torch.load failed for {candidate}: {err}", flush=True)
        return None

    state = ck.get("state_dict")
    if not state:
        return None

    # Sequential keys are "0.weight", "2.weight", … — sort numerically.
    bias_keys = sorted(
        (k for k in state.keys() if k.endswith(".bias")),
        key=lambda k: int(k.split(".")[0]),
    )
    weight_keys = sorted(
        (k for k in state.keys() if k.endswith(".weight")),
        key=lambda k: int(k.split(".")[0]),
    )
    if not bias_keys or not weight_keys:
        return None

    in_dim = int(state[weight_keys[0]].shape[1])
    out_dim = int(state[bias_keys[-1]].shape[0])
    quantiles_meta = ck.get("quantiles")
    is_quantile = bool(quantiles_meta) and out_dim == len(quantiles_meta)

    model = nn.Sequential(
        nn.Linear(in_dim, 128), nn.GELU(),
        nn.Linear(128, 128), nn.GELU(),
        nn.Linear(128, 64), nn.GELU(),
        nn.Linear(64, out_dim),
    )
    try:
        model.load_state_dict(state)
    except Exception as err:
        print(f"[predictor_model] state_dict mismatch for {candidate}: {err}", flush=True)
        return None
    model.eval()

    device = "cuda"
    model = model.to(device)
    f_mean = torch.tensor(ck["feature_mean"], device=device).view(1, -1)
    f_std = torch.tensor(ck["feature_std"], device=device).view(1, -1)

    if is_quantile:
        qs = list(quantiles_meta)
        # Index of the most-conservative quantile (smallest tau → P10).
        p10_idx = int(min(range(len(qs)), key=lambda i: qs[i]))

        @torch.no_grad()
        def _torch_predict_p10(
            features: list[float],
            _m=model, _mu=f_mean, _sd=f_std, _d=device, _i=p10_idx,
        ) -> float:
            x = torch.tensor([features], dtype=torch.float32, device=_d)
            x = (x - _mu) / _sd
            out = _m(x).squeeze(0)  # [Q]
            return float(out[_i].item())

        @torch.no_grad()
        def _torch_predict_quantiles(
            features: list[float],
            _m=model, _mu=f_mean, _sd=f_std, _d=device, _q=tuple(qs),
        ) -> dict[str, float]:
            x = torch.tensor([features], dtype=torch.float32, device=_d)
            x = (x - _mu) / _sd
            out = _m(x).squeeze(0).detach().cpu().numpy()
            return {f"p{int(round(q * 100))}": float(out[i]) for i, q in enumerate(_q)}

        # Attach the full-quantile fn so the live bridge can surface
        # the uncertainty band on the dashboard.
        _torch_predict_p10.quantiles = _torch_predict_quantiles  # type: ignore[attr-defined]
        _torch_predict_p10.quantile_levels = tuple(qs)            # type: ignore[attr-defined]
        return _torch_predict_p10

    # Single-head regression (legacy or non-quantile).
    @torch.no_grad()
    def _torch_predict(
        features: list[float],
        _m=model, _mu=f_mean, _sd=f_std, _d=device,
    ) -> float:
        x = torch.tensor([features], dtype=torch.float32, device=_d)
        x = (x - _mu) / _sd
        return float(_m(x).squeeze().item())

    return _torch_predict
