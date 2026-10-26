/**
 * Equipment profiles + band presets for coordination.
 *
 * A profile captures the coordination-relevant characteristics of a product:
 * which control protocol RFutils can talk to it with, the tuning raster, the
 * occupied bandwidth, and the carrier spacing to coordinate at.
 *
 * Two kinds of range live here and they answer different questions:
 *
 *   - `bandVariants` — what *this radio* can tune. A ULX-D is not "470–608"; it
 *     is a G51 (470–534) or an H50 (534–598) or a K51 (606–670), and several
 *     variants are discontiguous. Sourced from vendor documentation; see
 *     `src/rf/`.
 *   - `BAND_PRESETS` — what *your licence* allows in a region. Still separate,
 *     because that is a regulatory question, not a product one.
 *
 * A coordination is constrained by the intersection of the two.
 *
 * ⚠️ Check `verified` and, for detail, the `provenance` on each band variant and
 * the `spacing`/`bandwidth` provenance on each mode. `vendor-doc` means the
 * figure is quoted from the manufacturer; `derived` means it was computed from
 * published figures; `assumed` means there is no source. Band-preset ranges
 * depend on your licence and local spectrum regardless. The catalog is
 * user-extensible: drop a profiles.json in RFUTILS_CONFIG_DIR to add or
 * override entries.
 */

import { BUILTIN_PLUGINS, type ProductPlugin, type TransportId } from './plugins.js';
import type { BandVariant, RfMode } from './rf/types.js';

/** Control protocol RFutils can use to talk to (and program) a device. */
export type DeviceProtocol =
  | 'shure-command-strings' // Shure TCP :2202 — discover, monitor, program
  | 'sennheiser-ssc' // Sennheiser SSC — discover, monitor
  | 'aes67' // Dante/AES67 audio (no RF control)
  | 'analog' // IR-sync / no networked control — file export only
  | 'other';

export type EquipmentCategory = 'mic' | 'iem' | 'other';

export interface EquipmentProfile {
  id: string;
  manufacturer: string;
  model: string;
  category: EquipmentCategory;
  protocol: DeviceProtocol;
  /** Tuning raster in kHz (25 kHz for essentially all modern UHF wireless). */
  tuningStepKhz: number;
  /** Typical occupied RF bandwidth per carrier, kHz. */
  occupiedBandwidthKhz: number;
  /** Recommended minimum carrier-to-carrier spacing, MHz. */
  recommendedSpacingMhz: number;
  /** Default band preset id to pair with (a sensible starting range). */
  defaultBandPresetId?: string;
  /**
   * Frequency-range variants this product is sold in (G51, S1-10, B2 …), with
   * their real tunable spectrum. Present only for researched products.
   */
  bandVariants?: BandVariant[];
  /** Operating modes with their own required spacing. First is the default. */
  modes?: RfMode[];
  /** True when the default mode's spacing is quoted from vendor documentation. */
  verified: boolean;
  notes?: string;
}

/**
 * The regulatory region a band preset's ranges assume. Coarse by design — a
 * preset is "what your licence allows in a region", so 'UK' and 'US' are
 * single-country jurisdictions just as much as 'EU' or 'Global'. Country codes
 * are added as real, sourced templates are added (e.g. 'FI' for the
 * Traficom-designated Finnish bands).
 */
export type Region = 'UK' | 'EU' | 'US' | 'Global' | 'FI';

/** Equipment class a band is designated for, where the regulator distinguishes. */
export type BandEquipment = 'mic' | 'camera' | 'video-link';

/** Whether a regulatory power figure is stated as ERP or EIRP. */
export type PowerBasis = 'ERP' | 'EIRP';

export interface BandPreset {
  id: string;
  name: string;
  /** Regulatory region this preset's ranges assume. */
  region: Region;
  ranges: { startMhz: number; endMhz: number }[];
  notes?: string;
  /**
   * Whether a radio licence is needed to transmit in this band. `exempt`
   * bands are licence-exempt (e.g. every Finnish wireless-mic band);
   * `required` bands need a licence from the national regulator. Absent where
   * the preset does not record it.
   */
  licence?: 'exempt' | 'required';
  /** Equipment the regulator designates this band for, where it distinguishes. */
  equipment?: BandEquipment[];
  /** Maximum effective radiated power, mW, where the regulator sets one. */
  maxPowerMw?: number;
  /** Whether `maxPowerMw` is stated as ERP or EIRP. */
  powerBasis?: PowerBasis;
  /** Where the designation came from — a regulator page or a regulation. */
  source?: string;
  /** ISO date `source` was read. */
  retrieved?: string;
}

/**
 * Regional operating bands (the "where can I tune" ranges). Licence-dependent —
 * verify against your PMSE/FCC authorisation. UHF cores are given as broad
 * spans; narrow them to your cleared DTT gaps in the Coordination form.
 */

/** The Traficom page these Finnish band designations are quoted from. */
const TRAFICOM =
  'https://www.traficom.fi/fi/radioluvat-ja-taajuudet/radiotaajuuksien-kaytto/langattomien-kameroiden-videolinkkien-ja-mikrofonien-taajuudet';

export const BAND_PRESETS: BandPreset[] = [
  {
    id: 'uk-ch38',
    name: 'UK Ch38 (shared)',
    region: 'UK',
    ranges: [{ startMhz: 606.5, endMhz: 614 }],
    notes: 'UK shared PMSE coordination band (TV channel 38).',
  },
  {
    id: 'uk-uhf-core',
    name: 'UK UHF PMSE (470–608)',
    region: 'UK',
    ranges: [{ startMhz: 470, endMhz: 608 }],
    notes: 'Licensed UHF PMSE core. Exclude occupied local DTT muxes for your area.',
  },
  {
    id: 'uk-ch70',
    name: 'UK/EU Ch70 (863–865, licence-exempt)',
    region: 'EU',
    ranges: [{ startMhz: 863, endMhz: 865 }],
    notes: 'Deregulated 863–865 MHz — ~4 usable channels, no licence.',
  },
  {
    id: 'us-uhf-core',
    name: 'US UHF (470–608)',
    region: 'US',
    ranges: [{ startMhz: 470, endMhz: 608 }],
    notes: 'Post-repack US UHF. Avoid the 600 MHz duplex gap/guard per FCC rules.',
  },
  {
    id: 'ism-2g4',
    name: '2.4 GHz ISM (2400–2483.5)',
    region: 'Global',
    ranges: [{ startMhz: 2400, endMhz: 2483.5 }],
    notes: 'Licence-exempt 2.4 GHz (e.g. Shure GLX-D). Usually auto-coordinated by the system.',
  },

  // ——— Finland (Traficom) ———
  // Designated per the Traficom page and Määräys 15 AW/2026M (effective
  // 31 Mar 2026). Wireless-mic use is licence-exempt in every band below;
  // wireless-camera / video-link use needs a Traficom licence. In 470–694 the
  // band is primarily terrestrial TV, so clear it against local transmitters
  // with Traficom's microphone frequency search service before relying on it.
  //
  // ⚠️ DRAFT MODEL — the flat per-band BandPreset shape below is provisional
  // and does not match how licences actually work. Real-world licences do not
  // follow this format: a user picks a *regulatory domain* (a country/regulator),
  // which is made up of several frequency *areas*, each either licensed (and the
  // licence depends on the occasion — a one-off event vs. a permanent install) or
  // free-to-use. This preset list does not express that domain→areas structure,
  // and `licence: 'required'` is too coarse to capture "licensed per occasion".
  // Revisit the model with upstream before treating it as the design — see
  // docs/NOTES.md.
  {
    id: 'fi-link-2320-2400',
    name: 'FI camera/video link (2320–2400)',
    region: 'FI',
    ranges: [{ startMhz: 2320, endMhz: 2400 }],
    licence: 'required',
    equipment: ['camera', 'video-link'],
    source: TRAFICOM,
    retrieved: '2026-10-26',
    notes:
      'Licence-required, shared-use band for wireless cameras and video links: any frequency may be used, but it must be coordinated with other camera/link users. Licences are generally long-term and valid for several years.',
  },
  {
    id: 'fi-link-2200-2290',
    name: 'FI camera/video link (2200–2290, event)',
    region: 'FI',
    ranges: [{ startMhz: 2200, endMhz: 2290 }],
    licence: 'required',
    equipment: ['camera', 'video-link'],
    source: TRAFICOM,
    retrieved: '2026-10-26',
    notes:
      'Licence-required band for wireless cameras and video links used at events; the licence is valid only for the duration of the event concerned.',
  },
  {
    id: 'fi-mic-174-195',
    name: 'FI mic (174–195)',
    region: 'FI',
    ranges: [{ startMhz: 174, endMhz: 195 }],
    licence: 'exempt',
    equipment: ['mic'],
    maxPowerMw: 50,
    powerBasis: 'ERP',
    source: TRAFICOM,
    retrieved: '2026-10-26',
    notes: 'Licence-exempt wireless-mic band, ≤ 50 mW ERP.',
  },
  {
    id: 'fi-mic-216-225',
    name: 'FI mic (216–225)',
    region: 'FI',
    ranges: [{ startMhz: 216, endMhz: 225 }],
    licence: 'exempt',
    equipment: ['mic'],
    maxPowerMw: 50,
    powerBasis: 'ERP',
    source: TRAFICOM,
    retrieved: '2026-10-26',
    notes: 'Licence-exempt wireless-mic band, ≤ 50 mW ERP.',
  },
  {
    id: 'fi-mic-470-694',
    name: 'FI mic (470–694, clear local TV)',
    region: 'FI',
    ranges: [{ startMhz: 470, endMhz: 694 }],
    licence: 'exempt',
    equipment: ['mic'],
    maxPowerMw: 50,
    powerBasis: 'ERP',
    source: TRAFICOM,
    retrieved: '2026-10-26',
    notes:
      'Licence-exempt, ≤ 50 mW ERP, but 470–694 is designated primarily for terrestrial television and secondarily for mics: use must not cause interference to TV reception. Clear the band against local transmitters and the reserved reportter links (470–478 / 486–494) with Traficom’s microphone frequency search service before use.',
  },
  {
    id: 'fi-mic-821-826',
    name: 'FI mic (821.5–826)',
    region: 'FI',
    ranges: [{ startMhz: 821.5, endMhz: 826 }],
    licence: 'exempt',
    equipment: ['mic'],
    maxPowerMw: 20,
    powerBasis: 'EIRP',
    source: TRAFICOM,
    retrieved: '2026-10-26',
    notes: 'Licence-exempt, ≤ 20 mW EIRP; body-worn wireless mics ≤ 100 mW EIRP.',
  },
  {
    id: 'fi-mic-826-832',
    name: 'FI mic (826–832)',
    region: 'FI',
    ranges: [{ startMhz: 826, endMhz: 832 }],
    licence: 'exempt',
    equipment: ['mic'],
    maxPowerMw: 100,
    powerBasis: 'EIRP',
    source: TRAFICOM,
    retrieved: '2026-10-26',
    notes: 'Licence-exempt wireless-mic band, ≤ 100 mW EIRP.',
  },
  {
    id: 'fi-mic-863-865',
    name: 'FI mic (863–865)',
    region: 'FI',
    ranges: [{ startMhz: 863, endMhz: 865 }],
    licence: 'exempt',
    equipment: ['mic'],
    maxPowerMw: 10,
    powerBasis: 'ERP',
    source: TRAFICOM,
    retrieved: '2026-10-26',
    notes: 'Licence-exempt wireless-mic band, ≤ 10 mW ERP.',
  },
  {
    id: 'fi-mic-1785-1804',
    name: 'FI mic (1785–1804.8)',
    region: 'FI',
    ranges: [{ startMhz: 1785, endMhz: 1804.8 }],
    licence: 'exempt',
    equipment: ['mic'],
    maxPowerMw: 20,
    powerBasis: 'EIRP',
    source: TRAFICOM,
    retrieved: '2026-10-26',
    notes:
      'Licence-exempt, ≤ 20 mW EIRP; body-worn wireless mics ≤ 50 mW EIRP, and mics with frequency scanning (SSP) ≤ 50 mW EIRP.',
  },
];

/** Map a product plugin's transport to the coarse DeviceProtocol the UI shows. */
function transportToProtocol(t: TransportId | undefined): DeviceProtocol {
  switch (t) {
    case 'shure-command-strings':
      return 'shure-command-strings';
    case 'sennheiser-ssc':
      return 'sennheiser-ssc';
    default:
      return 'other';
  }
}

/** A coordination-facing view of a product plugin (backward-compatible shape). */
export function pluginToProfile(p: ProductPlugin): EquipmentProfile {
  return {
    id: p.id,
    manufacturer: p.manufacturer,
    model: p.model,
    category: p.category,
    protocol: transportToProtocol(p.control?.transport),
    tuningStepKhz: p.tuningStepKhz,
    occupiedBandwidthKhz: p.occupiedBandwidthKhz,
    recommendedSpacingMhz: p.recommendedSpacingMhz,
    defaultBandPresetId: p.defaultBandPresetId,
    bandVariants: p.bandVariants,
    modes: p.modes,
    verified: p.verified,
    notes: p.notes,
  };
}

/** The built-in equipment profiles, derived from the product-plugin catalog. */
export const EQUIPMENT_PROFILES: EquipmentProfile[] = BUILTIN_PLUGINS.map(pluginToProfile);

export interface ProfileCatalog {
  profiles: EquipmentProfile[];
  bandPresets: BandPreset[];
}

export function builtinCatalog(): ProfileCatalog {
  return { profiles: EQUIPMENT_PROFILES, bandPresets: BAND_PRESETS };
}

export interface DerivedCoordDefaults {
  /** Most conservative recommended spacing across the gear (so all are happy). */
  minSpacingMhz: number;
  /** Finest tuning raster across the gear. */
  stepMhz: number;
  /** Most common suggested band preset among the gear, if any. */
  bandPresetId?: string;
}

/**
 * Derive coordination defaults from a mix of equipment profiles: the widest
 * recommended spacing, the finest step, and the most common suggested band.
 * Falls back to safe generic defaults when nothing matches.
 */
export function deriveCoordDefaults(
  profileIds: (string | undefined)[],
  catalog: ProfileCatalog
): DerivedCoordDefaults {
  const profiles = profileIds
    .map((id) => (id ? catalog.profiles.find((p) => p.id === id) : undefined))
    .filter((p): p is EquipmentProfile => !!p);
  if (profiles.length === 0) return { minSpacingMhz: 0.4, stepMhz: 0.025 };

  const minSpacingMhz = Math.max(...profiles.map((p) => p.recommendedSpacingMhz));
  const stepMhz = Math.min(...profiles.map((p) => p.tuningStepKhz)) / 1000;

  const counts = new Map<string, number>();
  for (const p of profiles) {
    if (p.defaultBandPresetId) counts.set(p.defaultBandPresetId, (counts.get(p.defaultBandPresetId) ?? 0) + 1);
  }
  let bandPresetId: string | undefined;
  let best = 0;
  for (const [id, c] of counts) {
    if (c > best) {
      best = c;
      bandPresetId = id;
    }
  }
  return { minSpacingMhz, stepMhz, bandPresetId };
}
