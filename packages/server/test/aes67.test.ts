/** RTP payload decoding for AES67 (L16/L24). Ported from MicWizard's test/aes67.test.mts. */

import { describe, it, expect } from 'vitest';
import { decodeRtpAudio } from '../src/monitor/audio/aes67.js';

function buildRtpPacket(payload: Buffer): Buffer {
  const header = Buffer.alloc(12);
  header[0] = 0x80; // version 2, no padding/extension/CSRC
  header[1] = 97; // payload type
  return Buffer.concat([header, payload]);
}

describe('decodeRtpAudio', () => {
  it('rejects packets with no payload beyond the RTP header', () => {
    expect(decodeRtpAudio(buildRtpPacket(Buffer.alloc(0)), 2, 2)).toBeNull();
  });

  it('rejects a packet shorter than the RTP header itself', () => {
    expect(decodeRtpAudio(Buffer.alloc(8), 2, 2)).toBeNull();
  });

  it('rejects a non-v2 RTP packet', () => {
    const header = Buffer.alloc(12); // version 0
    expect(decodeRtpAudio(Buffer.concat([header, Buffer.alloc(8)]), 2, 2)).toBeNull();
  });

  it('deinterleaves L16 (16-bit BE) stereo correctly', () => {
    // frame 0: ch0=+16384 (0.5 fs), ch1=-16384 (-0.5 fs); frame 1: ch0=0, ch1=full scale
    const payload = Buffer.alloc(8);
    payload.writeInt16BE(16384, 0);
    payload.writeInt16BE(-16384, 2);
    payload.writeInt16BE(0, 4);
    payload.writeInt16BE(32767, 6);

    const channels = decodeRtpAudio(buildRtpPacket(payload), 2, 2)!;
    expect(channels).toHaveLength(2);
    expect(channels[0]).toHaveLength(2);
    expect(channels[0]![0]).toBeCloseTo(0.5, 3);
    expect(channels[1]![0]).toBeCloseTo(-0.5, 3);
    expect(channels[0]![1]).toBe(0);
    expect(channels[1]![1]).toBeCloseTo(32767 / 32768, 3);
  });

  it('deinterleaves L24 (24-bit BE) mono, including negative sign extension', () => {
    const payload = Buffer.alloc(6); // two 3-byte frames, 1 channel
    payload.writeUIntBE(0x400000, 0, 3); // +0.5 fs
    payload.writeUIntBE(0xc00000, 3, 3); // -0.5 fs (0xc00000 - 0x1000000 = -0x400000)

    const channels = decodeRtpAudio(buildRtpPacket(payload), 3, 1)!;
    expect(channels).toHaveLength(1);
    expect(channels[0]![0]).toBeCloseTo(0.5, 4);
    expect(channels[0]![1]).toBeCloseTo(-0.5, 4);
  });

  it('truncates a partial trailing frame rather than reading out of bounds', () => {
    // 2 channels * 2 bytes = 4 bytes/frame; 5 bytes = 1 full frame + 1 stray byte
    const payload = Buffer.alloc(5);
    payload.writeInt16BE(1000, 0);
    payload.writeInt16BE(-1000, 2);

    const channels = decodeRtpAudio(buildRtpPacket(payload), 2, 2)!;
    expect(channels[0]).toHaveLength(1);
    expect(channels[1]).toHaveLength(1);
  });
});
