/**
 * Local audio devices for the headphone cue: the output it plays through, and
 * the USB-interface inputs an analogue receiver can be patched into. Ported
 * from MicWizard's usbAudio.ts and usbChannelMap.ts.
 *
 * Two browser rules shape all of this:
 *  - Audio devices exist only on a secure page. `navigator.mediaDevices` (and
 *    the AudioWorklet the server cue plays through) are missing on plain HTTP
 *    unless the host is localhost — so RFutils opened as http://192.168.x.x
 *    can neither cue nor list devices. Open it as http://localhost:<port> on
 *    the machine it runs on, or serve it over HTTPS.
 *  - Device names are hidden until the page has been allowed to use a
 *    microphone. Until then the lists come back with blank labels, so asking
 *    for names means one permission prompt.
 */

export const INSECURE_PAGE_MESSAGE =
  'Cueing needs a secure page: browsers only allow audio devices on https:// or on localhost. ' +
  'Open RFutils as http://localhost:' +
  (typeof location !== 'undefined' && location.port ? location.port : '8420') +
  ' on the machine it runs on.';

/** True where the browser allows audio devices at all (see the module note). */
export function audioDevicesAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.enumerateDevices
  );
}

/** Whether this browser can send Web Audio to a chosen output (Chrome/Edge 110+; not Safari or Firefox). */
export function canChooseOutput(): boolean {
  return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
}

async function listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  if (!audioDevicesAvailable()) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === kind && d.deviceId !== '');
}

export function listAudioOutputs(): Promise<MediaDeviceInfo[]> {
  return listDevices('audiooutput');
}

export function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  return listDevices('audioinput');
}

/** Whether the browser is still hiding device names (no microphone permission yet). */
export async function deviceNamesHidden(): Promise<boolean> {
  if (!audioDevicesAvailable()) return false;
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.some((d) => (d.kind === 'audioinput' || d.kind === 'audiooutput') && !d.label);
}

/**
 * Ask once for microphone permission, purely so device names become visible,
 * and release the stream at once. This is the browser's prompt, not ours.
 */
export async function revealDeviceNames(): Promise<void> {
  if (!audioDevicesAvailable()) throw new Error(INSECURE_PAGE_MESSAGE);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

/** How many inputs a device offers, where the browser says (Chrome); 2 otherwise. */
export function inputCount(device: MediaDeviceInfo): number {
  const caps = (device as InputDeviceInfo).getCapabilities?.() as
    | { channelCount?: { max?: number } }
    | undefined;
  const max = caps?.channelCount?.max;
  return typeof max === 'number' && max >= 1 ? Math.min(max, 32) : 2;
}

/** Human wording for a getUserMedia failure on a mapped input. */
export function describeInputError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The browser refused the microphone permission RFutils needs to listen to a USB input. Allow it in this site’s settings and try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'That USB input is not connected now (or the browser renamed it). Unplug-and-replug, or map the channel again.';
  }
  if (name === 'NotReadableError') {
    return 'The USB input is busy or failed to open — another app may have it exclusively.';
  }
  return err instanceof Error ? err.message : String(err);
}

// --- Which USB input feeds which channel -------------------------------------

/**
 * A channel with no network audio (an analogue receiver patched into a USB
 * interface) is cued from the input it is plugged into. `input` is the
 * zero-based input on that device, or null for the device as the OS presents
 * it (all its inputs, mixed as the OS mixes them).
 */
export interface UsbInputMapping {
  deviceId: string;
  input: number | null;
  /** The device's name when it was mapped, for display only. */
  label: string;
}

const MAP_KEY = 'rfutils:usb-cue-map';

function readMap(): Record<string, UsbInputMapping> {
  try {
    const raw = localStorage.getItem(MAP_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, UsbInputMapping>) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, UsbInputMapping>): void {
  try {
    localStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {
    /* storage refused (private window); the mapping lasts this page only */
  }
}

/** Kept in memory too, so a refused localStorage still works for this page. */
let memory: Record<string, UsbInputMapping> | null = null;

export function getUsbMapping(channelId: string): UsbInputMapping | null {
  memory ??= readMap();
  const entry = memory[channelId];
  return entry && typeof entry.deviceId === 'string' ? entry : null;
}

export function setUsbMapping(channelId: string, mapping: UsbInputMapping): void {
  memory ??= readMap();
  memory[channelId] = mapping;
  writeMap(memory);
}

export function clearUsbMapping(channelId: string): void {
  memory ??= readMap();
  delete memory[channelId];
  writeMap(memory);
}

export function describeMapping(mapping: UsbInputMapping): string {
  const name = mapping.label || 'USB input';
  return mapping.input === null ? `${name} (all inputs)` : `${name}, input ${mapping.input + 1}`;
}
