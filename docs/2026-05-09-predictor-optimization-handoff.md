# Predictor optimization — handoff (2026-05-09)

**Author:** Divya Mohan / dmj.one (session: Claude Opus 4.7)
**Status:** partially landed. Threshold bump shipped end-to-end. Quantile-MLP needs one more fix + retrain before it earns its keep in the live bridge.

---

## TL;DR

- Bumped reroute threshold 90 s → **150 s**. This single change moved the linear predictor from ~64 s expected lead → ~125 s, eliminating tow-after-warning near-misses on the gpu_eval baseline.
- Added 4 engineered features to the predictor (`time_since_last_jump_s`, `recent_jump_count_10s`, `plateau_active`, `slope_x_health_margin`) — wired through both the live `OnlineRulPredictor.feature_vector` and the GPU-vectorised `_extract_features`.
- Added a **quantile-regression head** (P10 / P50 / P90, pinball loss) to the MLP. The bridge now acts on the conservative P10 for reroute decisions and exposes the full quantile band on the dashboard.
- Trained on 38.9 M samples on the RTX 3050 6 GB. Quantile model picked up at validation (P50-MAE = 25.14 s, P10/P90 coverage 80.04% — well-calibrated).
- All training and inference moved to GPU. CPU is reserved for orchestration (CARLA loop, HTTP fan-out).
- End-to-end smoke ran in CARLA: ego (Tesla Model 3, Town10HD) spawned, fault injected (brake-pad-wear), telemetry streamed at 10 Hz.
- **Caught a real bug just before stopping**: feature-semantics mismatch between gpu_eval (`t_since_fault_s = 0…600 s` from sim start) and the bridge (`t_since_fault_s = warmup + elapsed`, so 68…540 s). Model extrapolates wildly, P10 returns ~629 k seconds, reroute never fires in CARLA. Threshold-bump win is **proven on the simulator only**; live-CARLA reroute will not work until this is patched and the model retrained.
- Fixed UI: dashboard log spam moved to a collapsed **"Debug · CARLA bridge log"** drawer at the bottom of `/autonomy/[id]`, with `httpx INFO HTTP Request:` per-tick noise filtered out.

---

## What landed (with paths and line refs)

### Predictor — features + threshold

- [tools/carla/vsbs_carla/scripts/test_drive.py](../tools/carla/vsbs_carla/scripts/test_drive.py)
  - L149: `ACT_SOON_PREDICTED_RUL_S = 150.0` (was 90.0).
  - L153–161: new constants `JUMP_DETECT_PCT`, `JUMP_LOOKBACK_S`, `PLATEAU_SLOPE_THRESHOLD`, `PLATEAU_VOL_THRESHOLD`.
  - `OnlineRulPredictor.__init__`: now tracks `last_jump_t` and `recent_jumps`.
  - `OnlineRulPredictor.observe`: detects single-step health drops > `JUMP_DETECT_PCT` and prunes the lookback.
  - `OnlineRulPredictor.feature_vector`: returns 11 features (was 7). New: `time_since_last_jump_s`, `recent_jump_count_10s`, `plateau_active`, `slope_x_health_margin`.
  - `FEATURE_NAMES`: extended to 11.
  - `DEFAULT_MODEL_PATH`: now `models/predictor.pt` (the quantile MLP). XGB JSON kept as a fallback.
  - The bridge's main loop now also surfaces the **quantile spread** (`rul_quantiles`) on the reroute event and on every telemetry frame's `testDrive` block (`rulP10Seconds`, `rulP50Seconds`, `rulP90Seconds`).
  - Fixed an existing `NameError` on the "Test drive started" event (`deg_mult` → `initialTrendPctPerS` + `rerouteThresholdRulS`).

### GPU-vectorised feature extraction

- [tools/carla/vsbs_carla/scripts/gpu_eval.py](../tools/carla/vsbs_carla/scripts/gpu_eval.py)
  - Imports the new constants from `test_drive`.
  - `_extract_features`: stacks 11 features in `FEATURE_NAMES` order. Adds vectorised `time_since_last_jump`, `recent_jump_count`, `plateau_active`, `slope_x_health_margin`.
  - `_model_predict_rul_batched`: detects out-dim from the last layer's bias; if quantile, picks the smallest-tau channel (P10) for the reroute decision and prints which channel was chosen.
  - GPU policy hardened: refuses to run on CPU instead of silently falling back.

### Quantile MLP trainer

- [tools/carla/vsbs_carla/scripts/train_model.py](../tools/carla/vsbs_carla/scripts/train_model.py)
  - New `train_torch_mlp_quantile` — same MLP backbone (128-128-64) but a 3-channel head with pinball loss for `(0.1, 0.5, 0.9)`. Validation reports per-quantile MAE plus P10/P90 coverage.
  - Trainer now runs three models in series: XGB-CUDA, point MLP, quantile MLP.
  - Saving promotes the quantile MLP within a 5 s slack on P50-MAE (since the safety win is in the P10 channel, not in P50). Also saves the XGB JSON next to the .pt as a fallback.

### Predictor loader

- [tools/carla/vsbs_carla/predictor_model.py](../tools/carla/vsbs_carla/predictor_model.py)
  - Detects single-head vs quantile from the checkpoint's `quantiles` field and the last layer's bias shape.
  - Quantile head returns a callable that yields the **conservative P10** for the reroute decision; attaches `.quantiles(features) -> {"p10","p50","p90"}` for telemetry.
  - GPU-only inference. If CUDA is unavailable, prints a warning and returns None so the bridge falls back to the linear baseline (CPU is for orchestration only).

### Dashboard UI

- [apps/web/src/components/autonomy/TestDrivePanel.tsx](../apps/web/src/components/autonomy/TestDrivePanel.tsx) — split into:
  - `TestDrivePanel` (top of dashboard): just the test-drive header + predictor row. Predictor row now shows the **P10 / P50 / P90 band** when present.
  - `TestDriveDebugLog` (new export): collapsed `<details>` drawer, default closed, with the live bridge log SSE — but per-tick `httpx INFO HTTP Request:` lines are filtered out via the shared `HTTPX_NOISE` regex. The summary line shows live-status, line count, and a "clear" link.
- [apps/web/src/app/autonomy/\[id\]/AutonomyDashboard.tsx](../apps/web/src/app/autonomy/[id]/AutonomyDashboard.tsx)
  - Imports `TestDriveDebugLog` and mounts it once at the very end of the dashboard, after `CommandGrantCard`, so the log can never crowd out KPI/sensor/PHM sections.

### Models / data

- `tools/carla/data/training_200k.npz` — 38.9 M rows × 11 features (~1.87 GB uncompressed).
- `tools/carla/models/predictor.pt` — quantile MLP (out=3, qs=[0.1, 0.5, 0.9]). 11-feature input.
- `tools/carla/models/predictor.json` — XGBoost CUDA fallback (point estimate).
- `tools/carla/models/predictor.meta.json` — full metric table for all three trainers.

---

## Headline numbers (gpu_eval, 200 k iterations, threshold=150 s)

| variant | arrived_safely | tow_after_warning | tow_no_warning | mean lead | P10 lead |
|---|---:|---:|---:|---:|---:|
| linear baseline | 99.98 % | 0.02 % | 0.00 % | 177 s | 113 s |
| trained quantile (P10) | **100.00 %** | 0.00 % | 0.00 % | **193 s** | **127 s** |

Validation metrics (5.8 M rows held out from the 38.9 M):

| model | MAE (s) | P50 abs (s) | P90 abs (s) | P99 abs (s) | bias (s) |
|---|---:|---:|---:|---:|---:|
| baseline (mean) | 57.77 | 52.32 | 103.78 | 194.18 | 0.03 |
| OnlineRulPredictor (linear) | 1185.70 | 77.69 | 4607.93 | 9967.25 | 1155.09 |
| XGBoost (CUDA) | 25.33 | 18.13 | 57.13 | 112.51 | 0.01 |
| PyTorch MLP (CUDA, point) | 25.13 | 17.52 | 57.35 | 117.38 | -4.11 |
| **PyTorch MLP-Quantile (CUDA)** | **25.14** (on P50) | 17.53 | 57.34 | 117.24 | -4.02 |
| └ P10 / P50 / P90 MAE: | 39.53 / 25.14 / 47.47 | | | | |
| └ P10/P90 coverage: | **0.8004** (target: 0.80) | | | | |

Translation: pinball loss put exactly 80 % of labels inside `[P10, P90]`, exactly as it should. The quantile model's P50 is essentially tied with the point MLP — the win is the calibrated uncertainty band, not the P50.

---

## What does NOT yet work in live CARLA

**Feature-semantics mismatch on `t_since_fault_s`.** This is the next thing to fix; everything below is downstream of it.

- Training data (`gpu_eval._extract_features`): `t_since_fault_s = t_axis = arange(T) * SAMPLE_DT`, i.e. seconds from sim start. There is no warmup in gpu_eval, so this is also seconds from fault injection. Range across training rows: `[1.5, 600]` (gated by `obs >= MIN_OBS_FOR_REROUTE=30`).
- Bridge (`OnlineRulPredictor.feature_vector`): returns `float(t_now)` where `t_now = time.time() - t_start` — wall-clock since the loop started, **including the 60–80 s warmup before fault injection**. Range during inference: `[~70, ~540]`.

So the model is asked to score samples it has never seen at the post-fault times the bridge actually visits. It extrapolates badly: a sampled probe of the live bridge (`health=98.15`, `slope=0.062`, `obs=80`, `t_since_fault=72`) returned **P10 ≈ 629 k s, P50 ≈ 254 k s, P90 ≈ −1.7 M s** — the quantiles are also crossing, which a calibrated quantile model never does on in-distribution inputs.

**Symptom in the live bridge:** P10 stays orders of magnitude above the 150 s threshold for the entire run. The reroute branch never fires. Health drops to ≤ 5 % → vehicle halts → tow. Silent failure.

**On the simulator** the same predictor file prints `arrived_safely 100.00%` because gpu_eval feeds in-distribution `t_axis` values — the bug is invisible there.

---

## What needs to happen next

Pick up here in the next session:

1. **Fix the feature semantics in [test_drive.py](../tools/carla/vsbs_carla/scripts/test_drive.py).** Two equally clean options:
   - In `OnlineRulPredictor`: add `_first_obs_t: Optional[float]`. Set on the first `observe()` call. In `feature_vector`, return `float(t_now - self._first_obs_t)` instead of `float(t_now)`.
   - Or pass `fault_injected_at` from the main loop into `feature_vector(t_now, current_health, fault_injected_at)` and subtract there.

   Either makes the bridge's `t_since_fault_s` match gpu_eval's `t_axis` semantics. No change needed in `gpu_eval._extract_features` — its computation is already correct.

2. **Add a sanity clamp + fallback in [predictor_model.py](../tools/carla/vsbs_carla/predictor_model.py).** Even after the fix, future feature drift could re-create this. After the quantile model's `_torch_predict_p10` returns its float, clamp to `[0, 1.5 * SIM_BUDGET_S]` (i.e. 0–900 s). If the raw model output exceeds that band, log a warning and have the loader's wrapper fall back to the linear `predict_rul_seconds` for that tick. The bridge already has a try/except fallback path; route through it.

3. **Regenerate training data** (no real changes needed in gpu_eval, but a sanity rerun is cheap):
   ```powershell
   $env:PYTHONPATH = "$(Get-Location)\tools\carla"
   & "tools\carla\.venv\Scripts\python.exe" -m vsbs_carla.scripts.gpu_eval `
       --iterations 200000 --batch 25000 `
       --dump-training "tools\carla\data\training_200k.npz"
   ```

4. **Retrain.** Roughly 11 minutes total on the RTX 3050:
   ```powershell
   & "tools\carla\.venv\Scripts\python.exe" -m vsbs_carla.scripts.train_model `
       --data "tools\carla\data\training_200k.npz" `
       --out "tools\carla\models\predictor.json"
   ```
   Confirm in `predictor.meta.json` that the winner is `torch_mlp_quantile` and `coverage_p10_p90` is in `[0.78, 0.82]`.

5. **Re-eval with `--use-model`.** This is the safety regression test:
   ```powershell
   & "tools\carla\.venv\Scripts\python.exe" -m vsbs_carla.scripts.gpu_eval `
       --iterations 100000 --use-model "tools\carla\models\predictor.pt"
   ```
   Expect `arrived_safely ≥ 99.98 %`, `tow_no_warning = 0`, mean lead ≥ 175 s, P10 lead ≥ 110 s.

6. **Live CARLA smoke.** Boot the API + CARLA (see "How to resume" below), POST `/v1/scenarios/test-drive/start`, open `/autonomy/{bookingId}`, watch:
   - Predictor row at the top shows P10/P50/P90 climbing/falling sensibly (P10 < P50 < P90, all in 0–600 s).
   - "Rerouting to {SC name}" event fires before health crosses critical.
   - "Arrived" event fires; recording video downloads.
   - The "Debug · CARLA bridge log" drawer at the bottom stays collapsed by default and is genuinely readable when expanded (httpx noise filtered).

---

## How to resume next session

```powershell
# Add bun + node to PATH for this shell
$env:PATH = "C:\Users\SPANDAN\.bun\bin;C:\Users\SPANDAN\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.15.0-win-x64;$env:PATH"

# 1. Start the API in sim mode (port 8787)
$env:LLM_PROFILE = "sim"; $env:PORT = "8787"
cd C:\Users\SPANDAN\Downloads\vsbs\apps\api
bun src\server.ts

# 2. Start the web dev server (port 3000) — separate shell
cd C:\Users\SPANDAN\Downloads\vsbs\apps\web
pnpm dev

# 3. Start CARLA — separate shell (low-quality so the 6 GB GPU doesn't choke)
& "C:\Users\SPANDAN\Downloads\CARLA_0.9.16\CarlaUE4.exe" `
    -carla-rpc-port=2000 -quality-level=Low -ResX=1280 -ResY=720 -windowed

# 4. Trigger a test drive
$resp = Invoke-RestMethod -Method POST -Uri http://localhost:8787/v1/scenarios/test-drive/start `
    -ContentType "application/json" -Body "{}"
Start-Process "http://localhost:3000/autonomy/$($resp.data.bookingId)"
```

The trained quantile model auto-loads from `tools/carla/models/predictor.pt`. To force the linear baseline (no model), set `$env:CARLA_PREDICTOR_MODEL = ""` before the bridge spawns.

---

## Processes that may still be running on this machine

When this doc was written:

- `bun.exe` PID **10764** — the VSBS API on port 8787 (sim mode). Stop with `Get-Process bun | Stop-Process` if you want to free the port.
- `CarlaUE4.exe` PID **9936** + child `CarlaUE4-Win64-Shipping.exe` — Town10HD, low-quality. Stop with `Get-Process CarlaUE4 | Stop-Process; Get-Process CarlaUE4-Win64-Shipping | Stop-Process`.
- A `python.exe` from `tools\carla\.venv` (PID **10720**) — the test-drive bridge for booking `6da767f1-fcad-493d-ac52-a093157a0773`. Will exit on its own when the scenario ends (TOW or ARRIVED + 45 s hold), but you can kill it with `Get-Process python | Stop-Process` to free the CARLA seat.
- The Next.js dev server on port 3000 (PID **22956**) is unchanged from before this session — leave it alone.

The booking id of the in-flight (broken) run is `6da767f1-fcad-493d-ac52-a093157a0773` if you want to scrub its frames/recordings:
- `apps/web/public/cameras/6da767f1-fcad-493d-ac52-a093157a0773/`
- `apps/web/public/recordings/6da767f1-fcad-493d-ac52-a093157a0773/`
- `logs/bridge/6da767f1-fcad-493d-ac52-a093157a0773.log`

---

## Files changed this session

- `tools/carla/vsbs_carla/scripts/test_drive.py` — features, threshold, quantile passthrough, `deg_mult` bug fix.
- `tools/carla/vsbs_carla/scripts/gpu_eval.py` — vectorised features, GPU-strict, quantile-aware model loader.
- `tools/carla/vsbs_carla/scripts/train_model.py` — quantile MLP + pinball loss + quantile-promoting save logic.
- `tools/carla/vsbs_carla/predictor_model.py` — full rewrite to support quantile heads + GPU-only inference.
- `apps/web/src/components/autonomy/TestDrivePanel.tsx` — split into `TestDrivePanel` + `TestDriveDebugLog`; added P10/P50/P90 row; httpx noise filter.
- `apps/web/src/app/autonomy/[id]/AutonomyDashboard.tsx` — mount the new debug-log drawer at the page foot.
- `tools/carla/models/predictor.pt`, `tools/carla/models/predictor.json`, `tools/carla/models/predictor.meta.json` — saved.
- `tools/carla/data/training_200k.npz` — 38.9 M-row training set with the new 11-feature schema.
- `tools/carla/data/eval_use_model.log` — text capture of the eval-with-model run.

Files NOT changed but inspected for context: `apps/api/src/routes/scenarios.ts`, `apps/web/src/components/TestDriveButton.tsx`, `tools/carla/requirements.txt`, `tools/carla/pyproject.toml`, `tools/carla/README.md`.
