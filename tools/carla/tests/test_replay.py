# SPDX-License-Identifier: Apache-2.0
"""Verify the trace replayer is deterministic and shape-consistent."""

from __future__ import annotations

from pathlib import Path

import pytest

from vsbs_carla.replay import DeterministicEgo, TraceFrame, TraceReplayer
from vsbs_carla.scripts.record_trace import generate


def test_generate_writes_expected_frame_count(tmp_path: Path):
    out = tmp_path / "trace.jsonl"
    n = generate(out, fault_name="brake-pad-wear", duration_s=10.0, tick_hz=10.0)
    assert n == 100
    frames = list(TraceReplayer(out).frames())
    assert len(frames) == 100
    assert isinstance(frames[0], TraceFrame)


def test_generate_is_deterministic(tmp_path: Path):
    out_a = tmp_path / "a.jsonl"
    out_b = tmp_path / "b.jsonl"
    generate(out_a, fault_name="brake-pad-wear", duration_s=5.0, tick_hz=10.0)
    generate(out_b, fault_name="brake-pad-wear", duration_s=5.0, tick_hz=10.0)
    a = list(TraceReplayer(out_a).frames())
    b = list(TraceReplayer(out_b).frames())
    assert len(a) == len(b)
    for fa, fb in zip(a, b, strict=True):
        assert fa == fb


def test_brake_pad_pct_decreases_over_time(tmp_path: Path):
    out = tmp_path / "trace.jsonl"
    generate(out, fault_name="brake-pad-wear", duration_s=120.0, tick_hz=5.0)
    frames = list(TraceReplayer(out).frames())
    early = frames[10].brake_pad_pct
    late = frames[-1].brake_pad_pct
    assert late < early


def test_replayer_raises_on_missing_file(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        TraceReplayer(tmp_path / "nope.jsonl")


def test_deterministic_ego_advances_with_dt():
    ego = DeterministicEgo()
    x0, y0 = ego.x, ego.y
    ego.step(0.1)
    assert (ego.x, ego.y) != (x0, y0)


def test_bundled_trace_has_2400_frames():
    bundled = Path(__file__).resolve().parents[1] / "replay" / "town10hd-brake-failure.jsonl"
    if not bundled.exists():
        pytest.skip("bundled trace not present (likely a partial checkout)")
    frames = list(TraceReplayer(bundled).frames())
    assert len(frames) == 2400
    assert frames[0].brake_pad_pct == 70.0
    # By the end the brake-pad ramp has bottomed out.
    assert frames[-1].brake_pad_pct <= 12.5
