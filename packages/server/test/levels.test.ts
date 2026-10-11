/** dBFS metering and smoothing. Ported from MicWizard's test/levels.test.mts. */

import { describe, it, expect } from 'vitest';
import { computeLevels, dbFromLinear, LevelSmoother } from '../src/monitor/audio/levels.js';

describe('dbFromLinear', () => {
  it('floors silence at -96 dB, negative input included', () => {
    expect(dbFromLinear(0)).toBe(-96);
    expect(dbFromLinear(-1)).toBe(-96);
  });

  it('reads full scale as 0 dB', () => {
    expect(dbFromLinear(1)).toBe(0);
  });

  it('reads half amplitude as about -6 dB', () => {
    expect(dbFromLinear(0.5)).toBeCloseTo(-6.02, 2);
  });
});

describe('computeLevels', () => {
  it('reports the floor for both rms and peak on a silent buffer', () => {
    expect(computeLevels(new Float32Array(480))).toEqual({ rmsDb: -96, peakDb: -96 });
  });

  it('reports 0 dB peak and rms for a full-scale square wave', () => {
    const { rmsDb, peakDb } = computeLevels(new Float32Array(480).fill(1));
    expect(peakDb).toBe(0);
    expect(rmsDb).toBe(0);
  });

  it('matches the expected dBFS for a known sine amplitude', () => {
    // A -6 dBFS sine (0.5 peak) has RMS 0.5/sqrt(2) ≈ 0.3536, i.e. ≈ -9.03 dBFS.
    const frameCount = 480;
    const samples = new Float32Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      samples[i] = 0.5 * Math.sin((2 * Math.PI * 37 * i) / frameCount);
    }
    const { rmsDb, peakDb } = computeLevels(samples);
    expect(Math.abs(peakDb - -6.02)).toBeLessThan(0.1);
    expect(Math.abs(rmsDb - -9.03)).toBeLessThan(0.2);
  });
});

describe('LevelSmoother', () => {
  it('attacks fast and releases slow, rather than just averaging', () => {
    const smoother = new LevelSmoother(0.6, 0.1);
    const afterAttack = smoother.push(0); // from the floor (-96) toward 0
    const attackMove = afterAttack - -96;
    const afterRelease = smoother.push(-96);
    const releaseMove = Math.abs(afterRelease - afterAttack);
    expect(attackMove).toBeGreaterThan(0);
    expect(releaseMove).toBeLessThan(attackMove);
  });

  it('converges toward a sustained input over repeated pushes', () => {
    const smoother = new LevelSmoother();
    let value = -96;
    for (let i = 0; i < 50; i++) value = smoother.push(-20);
    expect(Math.abs(value - -20)).toBeLessThan(0.5);
  });
});
