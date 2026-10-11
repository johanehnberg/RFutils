/**
 * The AES67 pipeline end to end over real UDP multicast on this machine — not
 * mocks. Hand-crafts a SAP announcement and RTP packets the way a Dante/AES67
 * sender puts them on the wire, and checks the decoded amplitude. Ported from
 * MicWizard's test/integration.aes67-pipeline.test.mts.
 *
 * Needs a multicast-capable interface with loopback enabled (the OS default).
 */

import dgram from 'node:dgram';
import { describe, it, expect } from 'vitest';
import { SapListener, type Aes67SessionInfo } from '../src/monitor/audio/sap.js';
import { monitorAes67Stream } from '../src/monitor/audio/aes67.js';

const MULTICAST_ADDR = '239.5.5.5';
const RTP_PORT = 16004;
const SAMPLE_RATE = 48000;
const CHANNEL_COUNT = 2;
const TONE_HZ = 440;
const TONE_PEAK = 16000; // of 32768 -> |sample| ≈ 0.488

function buildSapPacket(): Buffer {
  const sdp = [
    'v=0',
    'o=- 424242 0 IN IP4 192.168.1.50',
    's=Integration Test Stream',
    `c=IN IP4 ${MULTICAST_ADDR}/32`,
    `m=audio ${RTP_PORT} RTP/AVP 97`,
    `a=rtpmap:97 L16/${SAMPLE_RATE}/${CHANNEL_COUNT}`,
    '',
  ].join('\r\n');
  const header = Buffer.from([0x00, 0x00, 0x00, 0x01, 127, 0, 0, 1]);
  return Buffer.concat([header, Buffer.from(sdp, 'utf8')]);
}

function buildRtpPacket(seq: number, frameCount: number): Buffer {
  const header = Buffer.alloc(12);
  header[0] = 0x80;
  header[1] = 97;
  header.writeUInt16BE(seq, 2);
  header.writeUInt32BE(seq * frameCount, 4);
  header.writeUInt32BE(0xdeadbeef, 8);

  const payload = Buffer.alloc(frameCount * 2 * CHANNEL_COUNT);
  for (let i = 0; i < frameCount; i++) {
    const t = (seq * frameCount + i) / SAMPLE_RATE;
    payload.writeInt16BE(Math.round(Math.sin(2 * Math.PI * TONE_HZ * t) * TONE_PEAK), i * 4);
    payload.writeInt16BE(0, i * 4 + 2); // channel 1: silence
  }
  return Buffer.concat([header, payload]);
}

describe('AES67 over real UDP multicast', () => {
  it('decodes a SAP-announced RTP stream end to end', async () => {
    const sapListener = new SapListener();
    const sender = dgram.createSocket('udp4');

    try {
      const session = await new Promise<Aes67SessionInfo>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for SAP session')), 5000);
        sapListener.on('session', (s: Aes67SessionInfo) => {
          clearTimeout(timer);
          resolve(s);
        });
        sapListener.start();
        sender.bind(() => {
          sender.setMulticastLoopback(true);
          sender.setMulticastTTL(1);
          sender.send(buildSapPacket(), 9875, '224.2.127.254');
        });
      });

      expect(session.sessionId).toBe('424242');
      expect(session.multicastAddress).toBe(MULTICAST_ADDR);
      expect(session.encoding).toBe('L16');
      expect(session.channelCount).toBe(2);

      const { levelsReceived, samplesReceived, maxAbsSample } = await new Promise<{
        levelsReceived: number;
        samplesReceived: number;
        maxAbsSample: number;
      }>((resolve) => {
        let levelsReceived = 0;
        let samplesReceived = 0;
        let maxAbsSample = 0;
        const handle = monitorAes67Stream(
          session,
          () => {
            levelsReceived++;
          },
          (_channelIndex, samples) => {
            samplesReceived++;
            for (const s of samples) maxAbsSample = Math.max(maxAbsSample, Math.abs(s));
          }
        );
        handle.setSampleStreaming(0, true); // only channel 0 carries the tone

        let seq = 0;
        const rtpInterval = setInterval(() => {
          sender.send(buildRtpPacket(seq++, 480), RTP_PORT, MULTICAST_ADDR);
        }, 20);
        setTimeout(() => {
          clearInterval(rtpInterval);
          handle.stop();
          resolve({ levelsReceived, samplesReceived, maxAbsSample });
        }, 1500);
      });

      expect(levelsReceived).toBeGreaterThan(0);
      expect(samplesReceived).toBeGreaterThan(0);
      expect(Math.abs(maxAbsSample - TONE_PEAK / 32768)).toBeLessThan(0.01);
    } finally {
      sapListener.stop();
      sender.close();
    }
  }, 10_000);
});
