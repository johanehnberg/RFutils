import { useEffect, useState } from 'react';
import { cuePlayer, type CueRequest, type CueState } from './cuePlayer.js';

/** React binding for the app-wide cue player. */
export function useCue(): {
  state: CueState;
  toggle: (channelId: string, request?: CueRequest) => void;
  stop: (channelId?: string) => void;
  setSolo: (solo: boolean) => void;
  setOutputDevice: (deviceId: string) => void;
} {
  const [state, setState] = useState<CueState>(cuePlayer.state());
  useEffect(() => cuePlayer.subscribe(setState), []);
  return {
    state,
    toggle: (channelId, request) => void cuePlayer.toggle(channelId, request),
    stop: (channelId) => cuePlayer.stop(channelId),
    setSolo: (solo) => cuePlayer.setSolo(solo),
    setOutputDevice: (deviceId) => void cuePlayer.setOutputDevice(deviceId),
  };
}
