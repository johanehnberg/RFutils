/** SAP announcement → SDP → session parsing. Ported from MicWizard's test/sap.test.mts. */

import { describe, it, expect } from 'vitest';
import { extractSdp, parseSdp } from '../src/monitor/audio/sap.js';

const VALID_SDP = [
  'v=0',
  'o=- 999888 0 IN IP4 192.168.1.50',
  's=Console Output',
  'c=IN IP4 239.1.1.1/32',
  'm=audio 6004 RTP/AVP 97',
  'a=rtpmap:97 L16/48000/2',
  '',
].join('\r\n');

describe('extractSdp', () => {
  it('finds the v=0 boundary and drops the SAP header bytes before it', () => {
    expect(extractSdp('\x00\x00garbage-bytes' + VALID_SDP)).toBe(VALID_SDP);
  });

  it('returns null when there is no v=0 anywhere', () => {
    expect(extractSdp('not an sdp payload at all')).toBeNull();
  });
});

describe('parseSdp', () => {
  it('extracts every field from a well-formed AES67 announcement', () => {
    expect(parseSdp(VALID_SDP)).toEqual({
      sessionId: '999888',
      name: 'Console Output',
      originAddress: '192.168.1.50',
      multicastAddress: '239.1.1.1',
      port: 6004,
      payloadType: 97,
      encoding: 'L16',
      sampleRate: 48000,
      channelCount: 2,
    });
  });

  it('defaults channel count to 1 when the rtpmap omits it', () => {
    expect(parseSdp(VALID_SDP.replace('L16/48000/2', 'L16/48000'))!.channelCount).toBe(1);
  });

  it('strips the /32 (or any) subnet suffix from the connection address', () => {
    expect(parseSdp(VALID_SDP.replace('239.1.1.1/32', '239.1.1.1'))!.multicastAddress).toBe(
      '239.1.1.1'
    );
  });

  it('falls back to the session id as the name when s= is missing', () => {
    const sdp = VALID_SDP.split('\r\n')
      .filter((l) => !l.startsWith('s='))
      .join('\r\n');
    expect(parseSdp(sdp)!.name).toBe('999888');
  });

  it('accepts L24 (a different byte width, handled in aes67.ts)', () => {
    expect(parseSdp(VALID_SDP.replace('L16/48000/2', 'L24/48000/2'))!.encoding).toBe('L24');
  });

  it('returns null for an unsupported codec', () => {
    expect(parseSdp(VALID_SDP.replace('L16/48000/2', 'opus/48000/2'))).toBeNull();
  });

  it('returns null when required lines are missing entirely', () => {
    expect(parseSdp('v=0\r\no=- 1 0 IN IP4 1.2.3.4\r\n')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseSdp('not sdp at all')).toBeNull();
  });
});
