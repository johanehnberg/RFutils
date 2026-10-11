/**
 * Sennheiser SSC: reply parsing, the per-address connection tracker that mDNS
 * feeds, and one real-socket run against a fake receiver on localhost.
 *
 * The SSC paths themselves are unverified guesses (see sennheiser.ts). These
 * tests pin what RFutils does with a reply, not that a real EW-DX sends one.
 */

import net from 'node:net';
import { once } from 'node:events';
import { describe, it, expect } from 'vitest';
import { DeviceRegistry } from '../src/monitor/deviceRegistry.js';
import {
  connectSennheiserDevice,
  parseSscMessage,
  SennheiserConnections,
  type SennheiserDiscoveryHandle,
} from '../src/monitor/discovery/sennheiser.js';

const ID = 'sennheiser:10.0.0.9';

describe('parseSscMessage', () => {
  it('reads identity, battery, audio and RF from replies', () => {
    const identity = parseSscMessage(
      '{"osc":{"rx":{"1":{"identity":{"name":"Lead Vox","product":"EW-DX EM 2"}}}}}',
      ID
    );
    expect(identity!.channel.name).toBe('Lead Vox');
    expect(identity!.model).toBe('EW-DX EM 2');
    expect(identity!.channel.id).toBe(`${ID}:1`);

    const battery = parseSscMessage(
      '{"osc":{"rx":{"1":{"battery":{"gauge":70,"lifetime":215}}}}}',
      ID,
      identity!.channel,
      identity!.model
    );
    expect(battery!.channel.batteryPercent).toBe(70);
    expect(battery!.channel.batteryMinutesRemaining).toBe(215);
  });

  it('keeps everything a reply does not mention (regression)', () => {
    // Each read is answered on its own line. Rebuilding the channel from one
    // reply blanked the name to "Sennheiser RX" and dropped the other readings.
    const known = parseSscMessage(
      '{"osc":{"rx":{"1":{"identity":{"name":"Lead Vox","product":"EW-DX EM 2"},"battery":{"gauge":70}}}}}',
      ID
    )!;
    const rf = parseSscMessage(
      '{"osc":{"rx":{"1":{"rf":{"rsqi":90,"level":-62}}}}}',
      ID,
      known.channel,
      known.model
    )!;
    expect(rf.channel.name).toBe('Lead Vox');
    expect(rf.model).toBe('EW-DX EM 2');
    expect(rf.channel.batteryPercent).toBe(70);
    expect(rf.channel.rfLevel).toBe(-62);
  });

  it('a reply that names a field but carries no number reports it absent', () => {
    const parsed = parseSscMessage('{"osc":{"rx":{"1":{"battery":{"gauge":null}}}}}', ID, {
      id: `${ID}:1`,
      name: 'Lead Vox',
      rfLevel: null,
      audioLevelDb: null,
      batteryPercent: 40,
      batteryMinutesRemaining: null,
      antenna: null,
    });
    expect(parsed!.channel.batteryPercent).toBeNull();
  });

  it('never shows an object as a name', () => {
    const parsed = parseSscMessage('{"osc":{"rx":{"1":{"identity":{"name":{"x":1}}}}}}', ID);
    expect(parsed!.channel.name).toBe('Sennheiser RX');
  });

  it('ignores error replies, other paths, blank lines and malformed JSON', () => {
    expect(parseSscMessage('{"osc":{"error":[{"rx":{"1":{"battery":404}}}]}}', ID)).toBeNull();
    expect(parseSscMessage('{"osc":{"rx":{"2":{"battery":{"gauge":5}}}}}', ID)).toBeNull();
    expect(parseSscMessage('   ', ID)).toBeNull();
    expect(parseSscMessage('{"osc":', ID)).toBeNull();
  });
});

describe('SennheiserConnections', () => {
  function fakeConnect() {
    const calls: Array<{ address: string; port: number; drop: () => void; stopped: boolean }> = [];
    const connect = (
      address: string,
      _registry: DeviceRegistry,
      onDisconnected: () => void = () => {},
      port = 45
    ): SennheiserDiscoveryHandle => {
      const call = { address, port, drop: onDisconnected, stopped: false };
      calls.push(call);
      return { stop: () => (call.stopped = true) };
    };
    return { calls, connect };
  }

  it('opens one connection per address however often mDNS reports it', () => {
    const { calls, connect } = fakeConnect();
    const connections = new SennheiserConnections(new DeviceRegistry(), connect);
    connections.ensure('10.0.0.9', 45);
    connections.ensure('10.0.0.9', 45);
    connections.ensure('10.0.0.10', 45);
    expect(calls.map((c) => c.address)).toEqual(['10.0.0.9', '10.0.0.10']);
  });

  it('reconnects on the next sighting after a drop (regression)', () => {
    // Without the disconnect callback the stale entry blocked every later
    // sighting, so a receiver that rebooted stayed un-monitored until restart.
    const { calls, connect } = fakeConnect();
    const connections = new SennheiserConnections(new DeviceRegistry(), connect);
    connections.ensure('10.0.0.9', 45);
    calls[0]!.drop();
    expect(connections.has('10.0.0.9')).toBe(false);
    connections.ensure('10.0.0.9', 45);
    expect(calls).toHaveLength(2);
  });

  it('a late callback from an old connection does not forget the new one', () => {
    const { calls, connect } = fakeConnect();
    const connections = new SennheiserConnections(new DeviceRegistry(), connect);
    connections.ensure('10.0.0.9', 45);
    calls[0]!.drop();
    connections.ensure('10.0.0.9', 45);
    calls[0]!.drop(); // the first connection's close arriving twice, late
    expect(connections.has('10.0.0.9')).toBe(true);
  });

  it('passes the advertised port through and stops everything', () => {
    const { calls, connect } = fakeConnect();
    const connections = new SennheiserConnections(new DeviceRegistry(), connect);
    connections.ensure('10.0.0.9', 4545);
    connections.stopAll();
    expect(calls[0]!.port).toBe(4545);
    expect(calls[0]!.stopped).toBe(true);
    expect(connections.has('10.0.0.9')).toBe(false);
  });
});

describe('connectSennheiserDevice against a fake receiver on localhost', () => {
  it('meters the receiver, then drops its readings when the connection ends', async () => {
    // Answers each read with the same shape, values filled in — the SSC model.
    const values: Record<string, unknown> = {
      identity: { name: 'Pastor 1', product: 'EW-DX EM 4' },
      battery: { gauge: 80, lifetime: 300 },
      audio: { out1: { level: -18 } },
      rf: { rsqi: 95, level: -55 },
    };
    const requests: string[] = [];
    let serverSide: net.Socket | null = null;
    const server = net.createServer((socket) => {
      serverSide = socket;
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let nl = buf.indexOf('\n');
        while (nl !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          requests.push(line);
          const asked = Object.keys(JSON.parse(line).osc.rx['1'])[0]!;
          socket.write(JSON.stringify({ osc: { rx: { 1: { [asked]: values[asked] } } } }) + '\n');
          nl = buf.indexOf('\n');
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as net.AddressInfo).port;

    const registry = new DeviceRegistry();
    let disconnects = 0;
    const handle = connectSennheiserDevice('127.0.0.1', registry, () => disconnects++, port);

    try {
      // All four first replies have arrived once the RF reading is in.
      await waitFor(() => registry.get('sennheiser:127.0.0.1')?.channels[0]?.rfLevel === -55);
      const device = registry.get('sennheiser:127.0.0.1')!;
      expect(device.identified).toBe(true);
      expect(device.model).toBe('EW-DX EM 4');
      expect(device.port).toBe(port);
      expect(device.channels).toEqual([
        {
          id: 'sennheiser:127.0.0.1:1',
          name: 'Pastor 1',
          rfLevel: -55,
          audioLevelDb: -18,
          batteryPercent: 80,
          batteryMinutesRemaining: 300,
          antenna: null,
        },
      ]);
      expect(requests[0]).toBe('{"osc":{"rx":{"1":{"identity":{"name":null,"product":null}}}}}');

      // Metering is read again, not once: a later battery value arrives.
      values.battery = { gauge: 79, lifetime: 296 };
      await waitFor(() => registry.get('sennheiser:127.0.0.1')?.channels[0]?.batteryPercent === 79);

      serverSide!.destroy();
      await waitFor(() => disconnects === 1);
      const after = registry.get('sennheiser:127.0.0.1')!;
      expect(after.identified).toBe(false);
      expect(after.channels).toEqual([]);
    } finally {
      handle.stop();
      server.close();
    }
    expect(disconnects).toBe(1);
  }, 10_000);
});

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}
