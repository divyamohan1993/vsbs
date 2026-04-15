import { describe, it, expect } from "vitest";
import {
  ExtendedKalman,
  makeGpsImuEkf,
  makeSocEkf,
  makeCellImbalanceEkf,
} from "./fusion.js";

describe("ExtendedKalman (linear 2-D constant-velocity sanity)", () => {
  it("tracks a linear signal and shrinks covariance on updates", () => {
    const ekf = new ExtendedKalman({
      x0: [0, 0],
      P0: [[1, 0], [0, 1]],
      Q: [[0.01, 0], [0, 0.01]],
      R: [[0.1, 0], [0, 0.1]],
      f: (x, _u, dt) => [x[0]! + x[1]! * dt, x[1]!],
      F: (_x, _u, dt) => [[1, dt], [0, 1]],
      h: (x) => [x[0]!, x[1]!],
      H: () => [[1, 0], [0, 1]],
    });
    let trueX = 0;
    const v = 2;
    const dt = 0.1;
    for (let k = 0; k < 100; k++) {
      trueX += v * dt;
      ekf.predict(dt);
      ekf.update([trueX, v]);
    }
    expect(ekf.x[0]!).toBeCloseTo(trueX, 1);
    expect(ekf.x[1]!).toBeCloseTo(v, 1);
    expect(ekf.P[0]![0]!).toBeLessThan(0.1);
  });
});

describe("makeGpsImuEkf", () => {
  it("converges on a straight line with measured GPS + heading", () => {
    const ekf = makeGpsImuEkf({
      x: 0, y: 0, theta: 0, v: 10,
      posStdM: 1, headingStdRad: 0.05,
      accelStd: 0.1, yawRateStd: 0.01,
    });
    const dt = 0.2;
    for (let k = 0; k < 50; k++) {
      ekf.predict(dt, [0, 0]);
      ekf.update([k * dt * 10 + dt * 10, 0, 0]);
    }
    expect(ekf.x[0]!).toBeGreaterThan(90);
    expect(Math.abs(ekf.x[1]!)).toBeLessThan(1);
    expect(Math.abs(ekf.x[2]!)).toBeLessThan(0.05);
  });
});

describe("makeSocEkf", () => {
  it("tracks coulomb-counting discharge", () => {
    const ekf = makeSocEkf({
      soc0: 0.80,
      rInternal0: 0.05,
      capacityAh: 60,
      kOcv: 0.6,
      ocvIntercept: 3.2,
      currentStd: 0.1,
      voltageStd: 0.02,
    });
    // Discharge at 30 A for 600 s -> delta SoC = 30*600/(3600*60) = 0.0833.
    const dt = 1;
    for (let k = 0; k < 600; k++) {
      ekf.predict(dt, [30]);
      const vTerm = 3.2 + 0.6 * (0.80 - (30 * (k + 1)) / (3600 * 60));
      ekf.update([vTerm]);
    }
    expect(ekf.x[0]!).toBeCloseTo(0.80 - 0.0833, 2);
  });
});

describe("makeCellImbalanceEkf", () => {
  it("converges on per-cell voltages", () => {
    const cells = [3.71, 3.70, 3.72, 3.69];
    const ekf = makeCellImbalanceEkf({ cells, processStd: 0.001, measStd: 0.005 });
    for (let k = 0; k < 30; k++) {
      ekf.predict(1);
      ekf.update(cells);
    }
    for (let i = 0; i < cells.length; i++) {
      expect(ekf.x[i]!).toBeCloseTo(cells[i]!, 2);
    }
  });

  it("flags imbalance in the state vector when one cell sags", () => {
    const cells = [3.71, 3.71, 3.71, 3.71];
    const ekf = makeCellImbalanceEkf({ cells, processStd: 0.001, measStd: 0.005 });
    const sagging = [3.71, 3.71, 3.55, 3.71];
    for (let k = 0; k < 30; k++) {
      ekf.predict(1);
      ekf.update(sagging);
    }
    expect(ekf.x[2]!).toBeLessThan(3.6);
    const delta = Math.max(...ekf.x) - Math.min(...ekf.x);
    expect(delta).toBeGreaterThan(0.1);
  });
});
