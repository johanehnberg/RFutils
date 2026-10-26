import { describe, it, expect } from 'vitest';
import { builtinCatalog, deriveCoordDefaults } from '@rfutils/shared';

describe('Finland (Traficom) band presets', () => {
  const { bandPresets } = builtinCatalog();
  const fi = bandPresets.filter((b) => b.region === 'FI');
  const ids = fi.map((b) => b.id);

  it('covers the two licensed camera/link bands and seven licence-exempt mic bands', () => {
    // The 470–694 TV-shared band and the deregulated 863–865 band are the ones a
    // coordinator reaches for first, so they must be present.
    expect(ids).toContain('fi-mic-470-694');
    expect(ids).toContain('fi-mic-863-865');
    expect(fi.filter((b) => b.licence === 'exempt').length).toBe(7);
    expect(fi.filter((b) => b.licence === 'required').length).toBe(2);
  });

  it('records provenance and equipment for every Finnish band', () => {
    for (const b of fi) {
      expect(b.source).toBeTruthy();
      expect(b.retrieved).toBeTruthy();
      expect(b.equipment?.length).toBeGreaterThan(0);
    }
  });

  it('states a power limit only on the licence-exempt mic bands (as the source does)', () => {
    // Traficom publishes per-band power caps for mics only; the camera/link
    // bands are licensed per-event and carry no fixed figure, so they must not
    // claim one.
    for (const b of fi) {
      const isMic = b.licence === 'exempt';
      expect(b.maxPowerMw === undefined).toBe(!isMic);
      if (isMic) {
        expect(b.maxPowerMw).toBeGreaterThan(0);
        expect(b.powerBasis).toBeTruthy();
      }
    }
    // The band shared with terrestrial TV must flag its coexistence duty.
    const tv = fi.find((b) => b.id === 'fi-mic-470-694');
    expect(tv?.notes).toMatch(/television|TV/i);
  });
});

describe('equipment profile catalog', () => {
  const { profiles, bandPresets } = builtinCatalog();

  it('has unique profile and band ids', () => {
    expect(new Set(profiles.map((p) => p.id)).size).toBe(profiles.length);
    expect(new Set(bandPresets.map((b) => b.id)).size).toBe(bandPresets.length);
  });

  it('has sane profile values', () => {
    for (const p of profiles) {
      expect(p.tuningStepKhz).toBeGreaterThan(0);
      expect(p.occupiedBandwidthKhz).toBeGreaterThan(0);
      expect(p.recommendedSpacingMhz).toBeGreaterThan(0);
    }
  });

  it('claims verified only where the default mode cites vendor documentation', () => {
    for (const p of profiles) {
      const basis = p.modes?.[0]?.spacing.basis;
      // `verified` is a claim about provenance, not a decoration — it must track
      // the default mode's spacing basis exactly.
      expect(p.verified).toBe(basis === 'vendor-doc');
      if (p.verified) {
        expect(p.modes?.[0]?.spacing.source).toBeTruthy();
        expect(p.modes?.[0]?.spacing.retrieved).toBeTruthy();
      }
    }
  });

  it('headline numbers agree with the default mode', () => {
    for (const p of profiles) {
      const mode = p.modes?.[0];
      if (!mode) continue;
      expect(p.recommendedSpacingMhz).toBeCloseTo(mode.minSpacingKhz / 1000, 6);
      if (mode.occupiedBandwidthKhz !== undefined) {
        expect(p.occupiedBandwidthKhz).toBe(mode.occupiedBandwidthKhz);
      }
    }
  });

  it('has valid, ascending band-preset ranges', () => {
    for (const b of bandPresets) {
      expect(b.ranges.length).toBeGreaterThan(0);
      for (const r of b.ranges) {
        expect(r.endMhz).toBeGreaterThan(r.startMhz);
      }
    }
  });

  it('profile defaultBandPresetId always resolves to a real preset', () => {
    const ids = new Set(bandPresets.map((b) => b.id));
    for (const p of profiles) {
      if (p.defaultBandPresetId) expect(ids.has(p.defaultBandPresetId)).toBe(true);
    }
  });
});

describe('deriveCoordDefaults', () => {
  const catalog = builtinCatalog();

  it('falls back to generic defaults with no profiles', () => {
    expect(deriveCoordDefaults([undefined, undefined], catalog)).toEqual({
      minSpacingMhz: 0.4,
      stepMhz: 0.025,
    });
  });

  it('takes the widest recommended spacing across the gear mix', () => {
    // Both now sit at Sennheiser's published 600 kHz equidistant grid in their
    // default (standard) modes, so the mix stays at 0.6.
    const d = deriveCoordDefaults(['sennheiser-ewd', 'sennheiser-ewdx'], catalog);
    expect(d.minSpacingMhz).toBe(0.6);
    expect(d.stepMhz).toBe(0.025);
    expect(d.bandPresetId).toBe('uk-uhf-core');
  });
});
