import { useEffect, useRef, useState } from 'react';
import { useCue } from '../audio/useCue.js';
import { useAudioMode } from '../audio/useAudioMode.js';
import { cuePlayer } from '../audio/cuePlayer.js';
import {
  INSECURE_PAGE_MESSAGE,
  audioDevicesAvailable,
  clearUsbMapping,
  deviceNamesHidden,
  describeInputError,
  describeMapping,
  getUsbMapping,
  inputCount,
  listAudioInputs,
  revealDeviceNames,
  setUsbMapping,
  type UsbInputMapping,
} from '../audio/devices.js';
import type { JSX } from 'react';

/** One choice in the "map to a USB input" list. */
interface InputChoice {
  value: string;
  label: string;
  mapping: UsbInputMapping;
}

/**
 * Per-channel "cue to headphones" toggle.
 *
 *   direct AES67 mode — AES67 channels play from the server's relay.
 *   capture mode (DVS/Dante interface via Companion) — any channel plays from
 *   the cue bus the server captures.
 *   anything else — a receiver with no network audio (an analogue unit patched
 *   into a USB interface) is mapped once to the input it is plugged into, and
 *   then plays straight from that input in this browser (from MicWizard).
 *
 * When a cue is playing the button shows that cue's own level.
 */
export function CueButton({
  channelId,
  transport,
}: {
  channelId: string;
  transport: string;
}): JSX.Element {
  const { state, toggle } = useCue();
  const mode = useAudioMode();
  const serverCueable = mode?.mode === 'capture' || transport === 'aes67';
  const [mapping, setMapping] = useState<UsbInputMapping | null>(() => getUsbMapping(channelId));
  const [choices, setChoices] = useState<InputChoice[] | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const entry = state.cues.find((c) => c.channelId === channelId);
  const status = entry?.status ?? 'idle';
  const active = !!entry && status !== 'error';
  const error = status === 'error' ? (entry?.error ?? 'Cue error') : pickError;

  const cueUsb = (m: UsbInputMapping) => toggle(channelId, { kind: 'usb', mapping: m });

  const onClick = async (): Promise<void> => {
    setPickError(null);
    if (mapping) return cueUsb(mapping);
    if (serverCueable) return toggle(channelId, { kind: 'server', exclusive: mode?.mode === 'capture' });
    // No network audio: choose the USB input it is patched into.
    if (!audioDevicesAvailable()) {
      setPickError(INSECURE_PAGE_MESSAGE);
      return;
    }
    try {
      if (await deviceNamesHidden()) await revealDeviceNames();
      const inputs = await listAudioInputs();
      if (inputs.length === 0) {
        setPickError('No audio inputs found. Plug in the USB interface and try again.');
        return;
      }
      setChoices(
        inputs.flatMap((d) => {
          const label = d.label || 'Audio input';
          const all: InputChoice = {
            value: `${d.deviceId}|all`,
            label: `${label} (all inputs)`,
            mapping: { deviceId: d.deviceId, input: null, label },
          };
          const each = Array.from({ length: inputCount(d) }, (_, i): InputChoice => ({
            value: `${d.deviceId}|${i}`,
            label: `${label} — input ${i + 1}`,
            mapping: { deviceId: d.deviceId, input: i, label },
          }));
          return [all, ...each];
        })
      );
    } catch (err) {
      setPickError(describeInputError(err));
    }
  };

  const pick = (value: string): void => {
    const choice = choices?.find((c) => c.value === value);
    setChoices(null);
    if (!choice) return;
    setUsbMapping(channelId, choice.mapping);
    setMapping(choice.mapping);
    cueUsb(choice.mapping);
  };

  const unmap = (): void => {
    if (entry) cuePlayer.stop(channelId);
    clearUsbMapping(channelId);
    setMapping(null);
    setPickError(null);
  };

  const glyph = status === 'connecting' ? '…' : '🎧';
  const title = error
    ? error
    : active
      ? 'Stop cue'
      : mapping
        ? `Cue to headphones from ${describeMapping(mapping)}`
        : serverCueable
          ? 'Cue to headphones'
          : 'No network audio on this channel: map it to the USB input it is patched into';

  return (
    <span className="cue">
      <button
        className={`cue-btn${active ? ' cue-btn--active' : ''}${error ? ' cue-btn--error' : ''}${
          !mapping && !serverCueable ? ' cue-btn--unmapped' : ''
        }`}
        onClick={onClick}
        title={title}
        aria-pressed={active}
        aria-label={title}
      >
        {glyph}
      </button>
      {choices && (
        <select
          className="cue-map"
          autoFocus
          defaultValue=""
          onChange={(e) => pick(e.target.value)}
          onBlur={() => setChoices(null)}
          aria-label="USB input this channel is patched into"
        >
          <option value="" disabled>
            Map to USB input…
          </option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      {mapping && (
        <button
          className="cue-unmap"
          onClick={unmap}
          title={`Remove the USB mapping (${describeMapping(mapping)})`}
          aria-label="Remove the USB mapping"
        >
          ×
        </button>
      )}
      {status === 'playing' && <CueMeter channelId={channelId} />}
    </span>
  );
}

function CueMeter({ channelId }: { channelId: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      const db = cuePlayer.levelDb(channelId);
      const pct = db === -Infinity ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
      if (ref.current) ref.current.style.width = `${pct}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [channelId]);
  return (
    <span className="cue-meter">
      <span className="cue-meter__fill" ref={ref} />
    </span>
  );
}
