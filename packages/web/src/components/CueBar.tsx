import { useCallback, useEffect, useState } from 'react';
import { useCue } from '../audio/useCue.js';
import { useAudioMode } from '../audio/useAudioMode.js';
import {
  INSECURE_PAGE_MESSAGE,
  audioDevicesAvailable,
  canChooseOutput,
  deviceNamesHidden,
  describeInputError,
  listAudioOutputs,
  revealDeviceNames,
} from '../audio/devices.js';
import type { JSX } from 'react';

/**
 * The cue's own controls, above the device list: which output it plays
 * through, Solo or Mix, and stop-all. Ported from MicWizard's MonitorBar.
 * This is the local headphone cue only — nothing here touches Dante routing.
 */
export function CueBar(): JSX.Element {
  const { state, stop, setSolo, setOutputDevice } = useCue();
  const mode = useAudioMode();
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [namesHidden, setNamesHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secure = audioDevicesAvailable();
  const choosable = secure && canChooseOutput();

  const refresh = useCallback(async () => {
    if (!choosable) return;
    setOutputs(await listAudioOutputs());
    setNamesHidden(await deviceNamesHidden());
  }, [choosable]);

  useEffect(() => {
    if (!choosable) return;
    const onChange = (): void => void refresh();
    onChange();
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
  }, [choosable, refresh]);

  const showNames = async (): Promise<void> => {
    setError(null);
    try {
      await revealDeviceNames();
      await refresh();
    } catch (err) {
      setError(describeInputError(err));
    }
  };

  const playing = state.cues.filter((c) => c.status !== 'error').length;
  // The saved output may not be in the list (unplugged); show it as default then.
  const selected = outputs.some((o) => o.deviceId === state.outputDeviceId) ? state.outputDeviceId : '';

  return (
    <section className="cue-bar" aria-label="Headphone cue">
      <span className="cue-bar__title">Headphone cue</span>
      {choosable && (
        <label className="cue-bar__field">
          Output
          <select value={selected} onChange={(e) => setOutputDevice(e.target.value)}>
            <option value="">System default</option>
            {outputs
              .filter((o) => o.deviceId !== 'default')
              .map((o, i) => (
                <option key={o.deviceId} value={o.deviceId}>
                  {o.label || `Output ${i + 1}`}
                </option>
              ))}
          </select>
        </label>
      )}
      {choosable && namesHidden && (
        <button className="cue-bar__button" onClick={showNames} title="The browser hides device names until it may use a microphone">
          Show device names
        </button>
      )}
      <label className="cue-bar__toggle" title="Solo: a new cue replaces the last one, like a PFL bus. Off: cues mix.">
        <input type="checkbox" checked={state.solo} onChange={(e) => setSolo(e.target.checked)} />
        Solo (one channel at a time)
      </label>
      <button className="cue-bar__button" onClick={() => stop()} disabled={state.cues.length === 0}>
        Stop all{playing > 0 ? ` (${playing})` : ''}
      </button>

      {!secure && <p className="cue-bar__note">{INSECURE_PAGE_MESSAGE}</p>}
      {secure && !canChooseOutput() && (
        <p className="cue-bar__note">
          This browser plays the cue through the system output. Chrome and Edge can choose another
          output here.
        </p>
      )}
      {!state.solo && mode?.mode === 'capture' && (
        <p className="cue-bar__note">
          Capture mode has one cue bus, so network channels still replace each other; Mix adds USB
          inputs on top.
        </p>
      )}
      {(error ?? state.outputError) && (
        <p className="cue-bar__note cue-bar__note--error">{error ?? state.outputError}</p>
      )}
    </section>
  );
}
