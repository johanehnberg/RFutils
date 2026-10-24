/**
 * AKG band variants and RF modes.
 *
 * The WMS470 is analog FM. AKG does not publish a minimum channel spacing;
 * instead it ships precalculated IM-safe channel groups. The 400 kHz spacing
 * used here is the conservative floor: the large majority of separations in
 * those groups are ≥400 kHz, with 375/350/300 kHz appearing only in the
 * narrow 11.8/12 MHz bands (III-K, V-D) and the Japan-B groups of V-B.
 *
 * Band codes are the Roman numerals printed on the device. Suffixes (−A, −B,
 * −D, −K, −U, −ISM) denote regional/regulatory variants of the same hardware
 * family and are treated as distinct products.
 *
 * Ranges from the AKG WMS470 frequency chart and cutsheet, read 2026-10-24.
 */

import type { BandVariant, Provenance, RfMode } from './types.js';

const RETRIEVED = '2026-10-24';

const FREQ_CHART =
  'https://au.akg.com/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw99912afa/pdfs/Frequency%20chart%20WMS470.pdf';

const doc = (source: string, note?: string): Provenance => ({
  basis: 'vendor-doc',
  source,
  retrieved: RETRIEVED,
  note,
});

/** Build variants from a compact [code, segments, notes?] table. */
function variants(
  rows: [string, number[][], string?][],
  provenance: Provenance
): BandVariant[] {
  return rows.map(([code, ranges, notes]) => ({
    code,
    ranges: ranges.map(([startMhz, endMhz]) => ({ startMhz: startMhz!, endMhz: endMhz! })),
    notes,
    provenance,
  }));
}

// ---------------------------------------------------------------------------
// WMS470
// ---------------------------------------------------------------------------

export const AKG_WMS470_MODES: RfMode[] = [
  {
    id: 'standard',
    name: 'Standard',
    minSpacingKhz: 400,
    occupiedBandwidthKhz: 136,
    strategy: 'im-search',
    spacing: doc(
      FREQ_CHART,
      'Verified against the full frequency chart (1,200+ tokens, 131 columns): the large ' +
        'majority of group separations are ≥400 kHz; 375 kHz in the six Japan-B groups of ' +
        'Band V-B, 350 kHz in III-K 3.C and V-D 5.C, and 300 kHz in the narrow 11.8/12 MHz ' +
        'bands III-K (3.D, 3.2) and V-D (5.D). 400 kHz is the conservative floor that covers ' +
        'every group except the densest narrow-band ones.'
    ),
    bandwidth: {
      basis: 'derived',
      source:
        'https://www.jpleisure.co.uk/info-JP94602.html',
      retrieved: RETRIEVED,
      note:
        "Carson's rule: 2 × (48 + 20) = 136 kHz. Audio bandwidth 35–20,000 Hz; peak deviation " +
        '48 kHz per the J.P. Leisure WMS470 listing (not an official AKG figure, but consistent ' +
        'with broadcast-quality FM).',
    },
  },
];

export const AKG_WMS470_BANDS: BandVariant[] = variants(
  [
    ['VII', [[500.1, 530.5]]],
    ['VIII', [[570.1, 600.5]]],
    ['IX', [[600.1, 605.9], [614.1, 630.5]], 'Gap at 605.9–614.1 MHz.'],
    ['IX-U', [[600.1, 630.5]], 'Same span as IX without the gap.'],
    ['I', [[650.1, 680]]],
    ['II', [[680, 710]]],
    ['III', [[720, 750]]],
    ['III-K', [[740.1, 751.9]], 'Extends 1.9 MHz beyond Band III.'],
    ['IV', [[760, 790]]],
    ['V', [[790, 829]]],
    ['V-A', [[790.1, 819.9]]],
    ['V-D', [[794.1, 805.9]]],
    ['V-B', [[806.125, 809.75]]],
    ['X', [[823.1, 831.9]]],
    ['M', [[826.3, 831.9]], 'Subset of Band X.'],
    ['VI', [[835, 865]]],
    ['VI-A-ISM', [[835.1, 861.9], [863.1, 864.9]], 'Gap at 861.9–863.1 MHz.'],
    ['D', [[863.1, 864.9]], 'Subset of Band VI.'],
  ],
  doc(
    FREQ_CHART,
    'AKG WMS470 frequency ranges. Band codes as printed on the device (Roman numerals). ' +
      'Suffixes denote regional/regulatory variants.'
  )
);
