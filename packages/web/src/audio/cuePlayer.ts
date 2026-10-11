import type { AudioServerMessage } from '@rfutils/shared';
import {
  INSECURE_PAGE_MESSAGE,
  audioDevicesAvailable,
  canChooseOutput,
  describeInputError,
  type UsbInputMapping,
} from './devices.js';

/**
 * The headphone cue: plays cued channels through this browser.
 *
 * Two kinds of source end up in one Web Audio graph:
 *  - **server** — the browser can't join AES67 multicast, so the server relays
 *    one channel over /ws/audio as PCM16 mono (or, in capture mode, the cue bus
 *    Companion routed it to). It is fed into an AudioWorklet ring buffer.
 *  - **usb** — an analogue receiver patched into a local USB interface, read
 *    with getUserMedia (ported from MicWizard). Nothing goes via the server.
 *
 * **Solo** (the default) behaves like a hardware PFL bus: a new cue replaces
 * whatever was cued. **Mix** lets cues add up. The output can be any device
 * the OS offers where the browser supports `AudioContext.setSinkId`.
 *
 * Every cue gets its own gain and analyser, so each button can show its own
 * meter in Mix, all into one master gain.
 */

export type CueStatus = 'connecting' | 'playing' | 'error';
export type CueSourceKind = 'server' | 'usb';

export interface CueEntry {
  channelId: string;
  source: CueSourceKind;
  status: CueStatus;
  error?: string;
}

export interface CueState {
  /** Every channel currently cued, connecting or failed, oldest first. */
  cues: CueEntry[];
  solo: boolean;
  /** '' is the system default output. */
  outputDeviceId: string;
  /** Set when the chosen output could not be used; playback fell back to the default. */
  outputError?: string;
}

/**
 * What to cue. `exclusive` is for capture mode, where the server has one cue
 * bus: a second server cue would only re-route that same bus, so even in Mix
 * it replaces the other server cues (USB cues still mix).
 */
export type CueRequest =
  | { kind: 'server'; exclusive?: boolean }
  | { kind: 'usb'; mapping: UsbInputMapping };

const WORKLET_URL = '/pcm-player-worklet.js';
const SOLO_KEY = 'rfutils:cue-solo';
const OUTPUT_KEY = 'rfutils:cue-output';

interface Cue extends CueEntry {
  gain: GainNode | null;
  analyser: AnalyserNode | null;
  /** Releases whatever this cue holds: socket, stream, nodes. Idempotent. */
  release: () => void;
}

type ContextWithSink = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a refused store just means the choice lasts this page only */
  }
}

/**
 * Linear-interpolating rate converter, kept across chunks so there is no click
 * at each chunk boundary. Only used in Mix when a server stream's rate differs
 * from the context's (e.g. a 96 kHz AES67 flow joining a 48 kHz cue); fine for
 * checking a mic, not a mastering-grade resampler.
 */
class LinearResampler {
  private pos = 0;
  private prev = 0;

  constructor(private readonly ratio: number) {}

  push(input: Float32Array): Float32Array<ArrayBuffer> {
    const out: number[] = [];
    // Interpolate over [prev, ...input]; pos is a fractional index into it.
    while (this.pos < input.length) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i === 0 ? this.prev : input[i - 1]!;
      const b = input[i]!;
      out.push(a + (b - a) * frac);
      this.pos += this.ratio;
    }
    this.pos -= input.length;
    if (input.length > 0) this.prev = input[input.length - 1]!;
    const result = new Float32Array(out.length);
    result.set(out);
    return result;
  }
}

class CuePlayer {
  private ctx: ContextWithSink | null = null;
  private workletReady: Promise<void> | null = null;
  private master: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private cues = new Map<string, Cue>();
  private solo = readPref(SOLO_KEY) !== 'mix';
  private outputDeviceId = readPref(OUTPUT_KEY) ?? '';
  private outputError?: string;
  private volume = 1;
  private listeners = new Set<(s: CueState) => void>();
  private meterBuf = new Float32Array(1024);

  state(): CueState {
    return {
      cues: [...this.cues.values()].map(({ channelId, source, status, error }) => ({
        channelId,
        source,
        status,
        error,
      })),
      solo: this.solo,
      outputDeviceId: this.outputDeviceId,
      outputError: this.outputError,
    };
  }

  subscribe(fn: (s: CueState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state());
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s = this.state();
    for (const fn of this.listeners) fn(s);
  }

  isCued(channelId: string): boolean {
    const cue = this.cues.get(channelId);
    return !!cue && cue.status !== 'error';
  }

  /** Cue if not already cueing this channel, else stop it. A failed cue is retried. */
  async toggle(channelId: string, request: CueRequest = { kind: 'server' }): Promise<void> {
    if (this.isCued(channelId)) {
      this.stop(channelId);
      return;
    }
    await this.cue(channelId, request);
  }

  async cue(channelId: string, request: CueRequest = { kind: 'server' }): Promise<void> {
    this.stop(channelId, false);
    for (const other of [...this.cues.values()]) {
      const replace =
        this.solo ||
        other.status === 'error' ||
        (request.kind === 'server' && request.exclusive && other.source === 'server');
      if (replace) this.stop(other.channelId, false);
    }
    if (request.kind === 'server') this.startServerCue(channelId);
    else await this.startUsbCue(channelId, request.mapping);
  }

  /** Stop one channel's cue, or every cue when no channel is given. */
  stop(channelId?: string, notify = true): void {
    const targets = channelId ? [this.cues.get(channelId)].filter(Boolean) : [...this.cues.values()];
    for (const cue of targets as Cue[]) {
      cue.release();
      this.cues.delete(cue.channelId);
    }
    if (notify) this.emit();
  }

  getSolo(): boolean {
    return this.solo;
  }

  /** Switching to Solo with several cues up keeps only the newest. */
  setSolo(solo: boolean): void {
    this.solo = solo;
    writePref(SOLO_KEY, solo ? 'solo' : 'mix');
    if (solo) {
      const all = [...this.cues.values()];
      for (const cue of all.slice(0, -1)) {
        cue.release();
        this.cues.delete(cue.channelId);
      }
    }
    this.emit();
  }

  /** Route the cue to an output device ('' for the system default). */
  async setOutputDevice(deviceId: string): Promise<void> {
    this.outputDeviceId = deviceId;
    this.outputError = undefined;
    writePref(OUTPUT_KEY, deviceId);
    await this.applyOutput();
    this.emit();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /**
   * Output level in dBFS: one cue's, or the whole mix's when no channel is
   * given. -Infinity when silent or idle.
   */
  levelDb(channelId?: string): number {
    const analyser = channelId ? this.cues.get(channelId)?.analyser : this.masterAnalyser;
    if (!analyser) return -Infinity;
    analyser.getFloatTimeDomainData(this.meterBuf);
    let sum = 0;
    for (const s of this.meterBuf) sum += s * s;
    const rms = Math.sqrt(sum / this.meterBuf.length);
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }

  // --- graph ---------------------------------------------------------------

  /**
   * The shared context. A server cue asks for its stream's rate so a single
   * cue plays with no conversion at all; the context is only rebuilt at a new
   * rate when nothing else is playing through it, and otherwise the stream is
   * converted (LinearResampler).
   */
  private async context(preferredRate: number | null, forCue: Cue): Promise<ContextWithSink> {
    if (this.ctx && preferredRate !== null && this.ctx.sampleRate !== preferredRate) {
      const othersPlaying = [...this.cues.values()].some((c) => c !== forCue && c.gain);
      if (!othersPlaying) {
        const old = this.ctx;
        this.ctx = null;
        this.workletReady = null;
        this.master = null;
        this.masterAnalyser = null;
        await old.close().catch(() => {});
      }
    }
    if (!this.ctx) {
      const ctx: ContextWithSink = new AudioContext(
        preferredRate !== null ? { sampleRate: preferredRate } : undefined
      );
      const master = ctx.createGain();
      master.gain.value = this.volume;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      master.connect(analyser).connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.masterAnalyser = analyser;
      await this.applyOutput();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  private async applyOutput(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !canChooseOutput() || typeof ctx.setSinkId !== 'function') return;
    try {
      // setSinkId takes '' for the system default, not the 'default' id that
      // enumerateDevices() reports for it.
      await ctx.setSinkId(this.outputDeviceId === 'default' ? '' : this.outputDeviceId);
    } catch (err) {
      // The saved device is gone (unplugged, renamed): play through the
      // default rather than not at all, and say so.
      this.outputError = `Could not use the chosen output (${(err as Error).message}); playing through the system default.`;
      await ctx.setSinkId('').catch(() => {});
    }
  }

  private connectCue(cue: Cue, input: AudioNode, ctx: AudioContext): void {
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    input.connect(gain).connect(analyser).connect(this.master!);
    cue.gain = gain;
    cue.analyser = analyser;
  }

  private fail(cue: Cue, message: string): void {
    if (this.cues.get(cue.channelId) !== cue) return;
    cue.release();
    cue.status = 'error';
    cue.error = message;
    this.emit();
  }

  // --- server cue (AES67 relay or the capture bus) -------------------------

  private startServerCue(channelId: string): void {
    let ws: WebSocket | null = null;
    let node: AudioWorkletNode | null = null;
    let resampler: LinearResampler | null = null;
    const cue: Cue = {
      channelId,
      source: 'server',
      status: 'connecting',
      gain: null,
      analyser: null,
      release: () => {
        if (ws) {
          try {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
            ws.onclose = null;
            ws.close();
          } catch {
            /* ignore */
          }
          ws = null;
        }
        node?.disconnect();
        node = null;
        cue.gain?.disconnect();
        cue.analyser?.disconnect();
        cue.gain = null;
        cue.analyser = null;
      },
    };
    this.cues.set(channelId, cue);
    this.emit();

    // The AudioWorklet this plays through exists only on a secure page.
    if (!window.isSecureContext) {
      this.fail(cue, INSECURE_PAGE_MESSAGE);
      return;
    }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}/ws/audio`);
    socket.binaryType = 'arraybuffer';
    ws = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'cue', channelId }));
    socket.onerror = () => this.fail(cue, 'Audio connection error');
    socket.onclose = () => {
      if (this.cues.get(channelId) !== cue) return;
      // Server or network ended the stream: a playing cue just stops, one that
      // never started says why.
      if (cue.status === 'playing') this.stop(channelId);
      else if (cue.status === 'connecting') this.fail(cue, 'The audio connection closed before the cue started.');
    };
    socket.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') {
        if (!(ev.data instanceof ArrayBuffer) || !node) return;
        const i16 = new Int16Array(ev.data);
        let f32 = new Float32Array(i16.length);
        for (let i = 0; i < i16.length; i++) f32[i] = i16[i]! / 0x8000;
        if (resampler) f32 = resampler.push(f32);
        node.port.postMessage(f32, [f32.buffer]);
        return;
      }
      let msg: AudioServerMessage;
      try {
        msg = JSON.parse(ev.data) as AudioServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'audio-error') {
        this.fail(cue, msg.message);
        return;
      }
      if (msg.type !== 'audio-format') return;
      void (async () => {
        try {
          const ctx = await this.context(msg.sampleRate, cue);
          this.workletReady ??= ctx.audioWorklet.addModule(WORKLET_URL);
          await this.workletReady;
          // Stopped, replaced or failed while setting up.
          if (this.cues.get(channelId) !== cue || cue.status !== 'connecting') return;
          node = new AudioWorkletNode(ctx, 'pcm-player', { outputChannelCount: [2] });
          resampler =
            ctx.sampleRate === msg.sampleRate ? null : new LinearResampler(msg.sampleRate / ctx.sampleRate);
          this.connectCue(cue, node, ctx);
          cue.status = 'playing';
          this.emit();
        } catch (e) {
          this.fail(cue, e instanceof Error ? e.message : String(e));
        }
      })();
    };
  }

  // --- USB input cue (analogue receivers) ----------------------------------

  private async startUsbCue(channelId: string, mapping: UsbInputMapping): Promise<void> {
    let stream: MediaStream | null = null;
    const nodes: AudioNode[] = [];
    const cue: Cue = {
      channelId,
      source: 'usb',
      status: 'connecting',
      gain: null,
      analyser: null,
      release: () => {
        for (const track of stream?.getTracks() ?? []) track.stop();
        stream = null;
        for (const n of nodes) n.disconnect();
        nodes.length = 0;
        cue.gain?.disconnect();
        cue.analyser?.disconnect();
        cue.gain = null;
        cue.analyser = null;
      },
    };
    this.cues.set(channelId, cue);
    this.emit();

    if (!audioDevicesAvailable()) {
      this.fail(cue, INSECURE_PAGE_MESSAGE);
      return;
    }

    try {
      const opened = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: mapping.deviceId },
          // A cue should sound like the mic, not like a video call.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          ...(mapping.input !== null ? { channelCount: { ideal: mapping.input + 1 } } : {}),
        },
      });
      stream = opened;
      if (this.cues.get(channelId) !== cue || cue.status !== 'connecting') {
        cue.release(); // stopped while the permission prompt was up
        return;
      }

      const ctx = await this.context(null, cue);
      const source = ctx.createMediaStreamSource(opened);
      nodes.push(source);
      let tap: AudioNode = source;

      if (mapping.input !== null) {
        // One input of a multi-input interface, sent to both ears.
        const channels = opened.getAudioTracks()[0]?.getSettings().channelCount ?? source.channelCount;
        if (mapping.input >= channels) {
          throw new Error(
            `The browser opened ${channels} input${channels === 1 ? '' : 's'} of ${mapping.label || 'this device'}, ` +
              `so input ${mapping.input + 1} is not available. Map the channel to “all inputs” instead.`
          );
        }
        const splitter = ctx.createChannelSplitter(Math.max(channels, mapping.input + 1));
        const mono = ctx.createGain(); // one channel in; up-mixed to both ears downstream
        source.connect(splitter);
        splitter.connect(mono, mapping.input, 0);
        nodes.push(splitter, mono);
        tap = mono;
      }

      this.connectCue(cue, tap, ctx);
      cue.status = 'playing';
      this.emit();
    } catch (err) {
      this.fail(cue, describeInputError(err));
    }
  }
}

export const cuePlayer = new CuePlayer();

// Dev/testing aid: expose the singleton so headless checks can read levelDb().
if (typeof window !== 'undefined') {
  (window as unknown as { __rfutilsCue?: CuePlayer }).__rfutilsCue = cuePlayer;
}
