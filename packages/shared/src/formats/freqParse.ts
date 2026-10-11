/**
 * Shared helpers for parsing frequency values that show up in the wild.
 * Ported verbatim in behaviour from wsm-wwb-bridge/freq_parse.py.
 *
 * RF coordination tools disagree on notation: plain MHz decimals (470.100),
 * Sennheiser's MHz.kHz style (600.768), a comma-decimal variant (600,768),
 * or raw kHz integers (600768). We normalize all of these to MHz as number.
 */

// UHF wireless mic bands run roughly 30-6000 MHz. A raw kHz value in that
// same band would be >= 30000, so this threshold cleanly separates "already
// MHz" from "still needs /1000" without needing to know the source format.
const KHZ_THRESHOLD = 3000.0;

export class FrequencyParseError extends Error {}

export function parseFrequencyToMhz(raw: string): number {
  let text = raw.trim();
  if (!text) {
    throw new FrequencyParseError('empty frequency value');
  }

  // Comma-as-decimal-separator (e.g. "600,768") vs thousands separator.
  // If there's a comma but no dot, treat the comma as a decimal point.
  if (text.includes(',') && !text.includes('.')) {
    text = text.replace(/,/g, '.');
  } else {
    text = text.replace(/,/g, '');
  }

  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new FrequencyParseError(`not a number: ${raw}`);
  }
  return value >= KHZ_THRESHOLD ? value / 1000.0 : value;
}

/**
 * Python's `round()`: nearest integer, with an exact half going to the EVEN
 * neighbour. `Math.round` sends every half up, so 512062.5 became 512063 here
 * where wsm-wwb-bridge wrote 512062. The fractional part of a double is exact,
 * so the tie test is too.
 */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  if (x - floor === 0.5) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(x);
}

/**
 * MHz to three decimals, exactly as wsm-wwb-bridge's `f"{value:.3f}"` writes
 * it — the WWB frequency list, inventory CSV and generic CSV all go through
 * here.
 *
 * Both languages round the double's exact value, so they agree everywhere
 * except an exact tie, where Python goes to even and `toFixed` goes up:
 * 512.0625 is 512.062 from the bridge and was 512.063 here. A double can only
 * sit exactly halfway between two three-decimal values when it is an odd
 * number of sixteenths (x.0625, x.1875, … x.9375), so that is the only case
 * handled specially; `value * 1000` is exact there.
 */
export function formatMhz(value: number): string {
  if (Number.isInteger(value * 16) && !Number.isInteger(value * 8)) {
    return (roundHalfEven(value * 1000) / 1000).toFixed(3);
  }
  return value.toFixed(3);
}

/** kHz as an integer string, as the bridge's `str(int(round(mhz * 1000)))`. */
export function formatKhz(valueMhz: number): string {
  return String(roundHalfEven(valueMhz * 1000));
}

/**
 * WWB writes group/channel as 'G:-- Ch:--' (report, .cws) or '--,--'
 * (.shw device inventory). '--' means unassigned. Returns [group, channel],
 * either of which may be null.
 */
export function parseWwbGroupChannel(
  raw: string | null | undefined
): [string | null, string | null] {
  if (!raw) return [null, null];
  const trimmed = raw.trim();
  let parts: string[];
  if (trimmed.startsWith('G:')) {
    // Python's str.split() with no argument drops empty strings, so
    // "G: 01 Ch: 05" is ("01", "05"). Splitting on /\s+/ kept the empty
    // string before the leading space and returned [null, "01"].
    parts = trimmed
      .replace(/G:/g, '')
      .replace(/Ch:/g, '')
      .split(/\s+/)
      .filter((p) => p !== '');
  } else {
    parts = trimmed.split(',');
  }
  parts = parts.map((p) => p.trim());
  const group = parts.length > 0 && parts[0] !== '' && parts[0] !== '--' ? parts[0]! : null;
  const channel = parts.length > 1 && parts[1] !== '' && parts[1] !== '--' ? parts[1]! : null;
  return [group, channel];
}
