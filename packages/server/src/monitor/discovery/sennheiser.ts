import net from 'node:net';
import type { DeviceRegistry } from '../deviceRegistry.js';
import type { DeviceChannel } from '@rfutils/shared';

/**
 * UNVERIFIED SKELETON — Sennheiser SSC (newline-delimited JSON over TCP:45).
 *
 * Sennheiser's digital wireless (EW-DX, Digital 6000/9000) exposes "SSC": the
 * JSON's own nested keys are an address path, so
 * `{"osc":{"rx":{"1":{"battery":{"gauge":null}}}}}` reads that path and the
 * device answers with the same shape, value filled in. The metering paths
 * below are best-effort guesses from public SSC examples, not confirmed
 * against a real receiver, and only receiver 1 is read. Correct them against
 * a capture of real SSC traffic (docs/capture-guide.md).
 *
 * Discovery is mDNS (`_ssc._tcp`, see mdns.ts), which hands each address to
 * `SennheiserConnections`. Until MicWizard a52ebe3 nothing ever called
 * `connectSennheiserDevice`, so a Sennheiser receiver was found and then never
 * connected or metered; RFutils inherited that gap until this was wired up.
 */
export const SSC_PORT = 45;

/** How often the metering paths are read again. Whether SSC streams values
 *  after one read or needs an explicit subscription is unverified, so this
 *  simply asks again — a read changes nothing on the device. */
const POLL_INTERVAL_MS = 1000;
/** Identity (name, product) changes rarely; re-read it far less often. */
const IDENTITY_EVERY_N_POLLS = 30;
/** No reply at all for this long and the connection is treated as dead, so a
 *  receiver whose cable was pulled is retried instead of sitting silent. */
const IDLE_TIMEOUT_MS = 15_000;

const IDENTITY_READ = { osc: { rx: { 1: { identity: { name: null, product: null } } } } };
const METERING_READS = [
  { osc: { rx: { 1: { battery: { gauge: null, lifetime: null } } } } },
  { osc: { rx: { 1: { audio: { out1: { level: null } } } } } },
  { osc: { rx: { 1: { rf: { rsqi: null, level: null } } } } },
];

export interface SennheiserDiscoveryHandle {
  stop: () => void;
}

/**
 * Open the SSC connection to one receiver and keep its registry entry fed.
 *
 * `onDisconnected` fires exactly once, on error, close or idle timeout —
 * whichever comes first — so the caller tracking connections by address can
 * drop its entry and let the next mDNS sighting reconnect. Without it a
 * receiver that dropped for any reason (reboot, a network blip) stayed
 * un-monitored until restart (MicWizard a52ebe3).
 */
export function connectSennheiserDevice(
  address: string,
  registry: DeviceRegistry,
  onDisconnected: () => void = () => {},
  port: number = SSC_PORT
): SennheiserDiscoveryHandle {
  const deviceId = sennheiserDeviceId(address);
  const socket = net.createConnection({ host: address, port });
  let buffer = '';
  let disconnected = false;
  let poll: NodeJS.Timeout | null = null;
  let polls = 0;

  const handleDisconnect = (): void => {
    if (disconnected) return;
    disconnected = true;
    if (poll) clearInterval(poll);
    poll = null;
    // Back to "seen, not yet identified" rather than gone: mDNS may still be
    // advertising it (and will reconnect), and if it is not, pruneStale()
    // removes it. Either way the last readings are dropped — a receiver that
    // stopped answering must not go on showing a battery level.
    if (registry.get(deviceId)) registry.upsert({ id: deviceId, identified: false, channels: [] });
    onDisconnected();
  };

  socket.setTimeout(IDLE_TIMEOUT_MS);
  socket.on('timeout', () => socket.destroy());

  socket.on('connect', () => {
    sendPath(socket, IDENTITY_READ);
    for (const read of METERING_READS) sendPath(socket, read);
    poll = setInterval(() => {
      polls += 1;
      if (polls % IDENTITY_EVERY_N_POLLS === 0) sendPath(socket, IDENTITY_READ);
      for (const read of METERING_READS) sendPath(socket, read);
    }, POLL_INTERVAL_MS);
    poll.unref?.();
  });

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      handleLine(line, deviceId, address, port, registry);
      newlineIndex = buffer.indexOf('\n');
    }
  });

  socket.on('error', handleDisconnect);
  socket.on('close', handleDisconnect);

  return {
    stop: () => {
      if (poll) clearInterval(poll);
      poll = null;
      socket.destroy();
    },
  };
}

export function sennheiserDeviceId(address: string): string {
  return `sennheiser:${address}`;
}

/**
 * One SSC connection per receiver address, however many times mDNS reports it.
 *
 * mDNS reports a service on first sight and again on every refresh (mdns.ts),
 * which is what makes reconnection work: a dropped connection removes itself
 * from here, and the next sighting opens a fresh one.
 */
export class SennheiserConnections {
  private readonly active = new Map<string, SennheiserDiscoveryHandle>();

  constructor(
    private readonly registry: DeviceRegistry,
    private readonly connect: typeof connectSennheiserDevice = connectSennheiserDevice
  ) {}

  /** Connect to `address` unless a connection to it is already open. */
  ensure(address: string, port: number = SSC_PORT): void {
    if (this.active.has(address)) return;
    // A holder rather than a const, so the callback can compare against the
    // handle even if a connect implementation reports failure synchronously.
    const own: { handle?: SennheiserDiscoveryHandle; finished: boolean } = { finished: false };
    own.handle = this.connect(
      address,
      this.registry,
      () => {
        own.finished = true;
        // Only forget the connection this callback belongs to; a newer one for
        // the same address may already have replaced it.
        if (this.active.get(address) === own.handle) this.active.delete(address);
      },
      port
    );
    if (!own.finished) this.active.set(address, own.handle);
  }

  has(address: string): boolean {
    return this.active.has(address);
  }

  stopAll(): void {
    const handles = [...this.active.values()];
    this.active.clear();
    for (const handle of handles) handle.stop();
  }
}

function sendPath(socket: net.Socket, path: Record<string, unknown>): void {
  if (!socket.writable) return;
  socket.write(JSON.stringify(path) + '\n');
}

function handleLine(
  line: string,
  deviceId: string,
  address: string,
  port: number,
  registry: DeviceRegistry
): void {
  const existing = registry.get(deviceId);
  const known = existing?.channels.find((c) => c.id === `${deviceId}:1`);
  const parsed = parseSscMessage(line, deviceId, known, existing?.model ?? null);
  if (!parsed) return;

  const channels = existing?.channels.filter((c) => c.id !== parsed.channel.id) ?? [];
  channels.push(parsed.channel);

  registry.upsert({
    id: deviceId,
    vendor: 'sennheiser',
    model: parsed.model,
    name: parsed.channel.name,
    address,
    port,
    transport: 'none',
    identified: true,
    channels,
  });
}

export interface ParsedSscMessage {
  channel: DeviceChannel;
  model: string | null;
}

/**
 * One SSC reply line → receiver 1's channel, or null if it carries nothing
 * about receiver 1 (an error reply, malformed JSON, another path).
 *
 * Each read is answered separately, so one reply holds only the fields that
 * read asked for. Anything the reply does not mention is carried over from
 * `known`: rebuilding the channel from the battery reply alone blanked the
 * name back to "Sennheiser RX" and dropped the RF and audio readings — the
 * same fault parseShureMessage guards against for a Shure SAMPLE.
 */
export function parseSscMessage(
  line: string,
  deviceId: string,
  known?: DeviceChannel,
  knownModel: string | null = null
): ParsedSscMessage | null {
  if (!line.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  const rx1 = dig(parsed, ['osc', 'rx', '1']);
  if (!rx1 || typeof rx1 !== 'object') return null;

  /** Present in this reply wins; otherwise keep what was already known. */
  const reading = (path: string[], previous: number | null | undefined): number | null =>
    has(rx1, path) ? numeric(dig(rx1, path)) : (previous ?? null);

  const name = has(rx1, ['identity', 'name'])
    ? asText(dig(rx1, ['identity', 'name'])) || known?.name || 'Sennheiser RX'
    : (known?.name ?? 'Sennheiser RX');
  const model = has(rx1, ['identity', 'product'])
    ? asText(dig(rx1, ['identity', 'product'])) || knownModel
    : knownModel;

  return {
    channel: {
      id: `${deviceId}:1`,
      name,
      rfLevel: reading(['rf', 'level'], known?.rfLevel),
      audioLevelDb: reading(['audio', 'out1', 'level'], known?.audioLevelDb),
      batteryPercent: reading(['battery', 'gauge'], known?.batteryPercent),
      batteryMinutesRemaining: reading(['battery', 'lifetime'], known?.batteryMinutesRemaining),
      antenna: known?.antenna ?? null,
    },
    model,
  };
}

/** Safely coerce an unknown SSC value to a display string (never "[object Object]"). */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function dig(obj: unknown, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function has(obj: unknown, path: string[]): boolean {
  const parent = dig(obj, path.slice(0, -1));
  return typeof parent === 'object' && parent !== null && path[path.length - 1]! in parent;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
