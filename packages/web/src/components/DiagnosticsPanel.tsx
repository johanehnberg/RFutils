import { useState } from 'react';
import { collectDiagnostics, openLogFolder } from '../api.js';
import type { JSX } from 'react';

/**
 * "Something went wrong, send me the details" — as one button. Ported from
 * MicWizard's DiagnosticsPanel.
 *
 * The bundle is one JSON file: the logs, the build identity, the settings with
 * anything password-shaped removed, and any recent crash report (see
 * docs/diagnostics.md). The server writes it, and this browser downloads a
 * copy — the browser may be on another machine, or the server in a container.
 * Collapsed by default: a support tool, not something anyone needs mid-show.
 */
export function DiagnosticsPanel(): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const collect = async (): Promise<void> => {
    setBusy(true);
    setStatus(null);
    try {
      const { blob, fileName, savedAt } = await collectDiagnostics();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus(
        `Downloaded ${fileName} — attach it to your bug report.` +
          (savedAt ? ` A copy is also saved on the RFutils machine at ${savedAt}.` : '')
      );
    } catch (err) {
      setStatus(`Could not collect diagnostics: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const openFolder = async (): Promise<void> => {
    try {
      const { path } = await openLogFolder();
      setStatus(`Opened ${path}.`);
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  return (
    <section className="diagnostics-panel">
      <button
        className="diagnostics-panel__toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        Diagnostics
      </button>
      {expanded && (
        <div className="diagnostics-panel__body">
          <p>
            If something goes wrong, collect diagnostics and attach the file to your bug report. It
            holds the logs, the app version, your settings with any passwords removed, and details of
            any recent crash.
          </p>
          <div className="diagnostics-panel__actions">
            <button onClick={collect} disabled={busy}>
              {busy ? 'Collecting…' : 'Collect diagnostics'}
            </button>
            <button onClick={openFolder}>Open log folder</button>
          </div>
          {status && <p className="diagnostics-panel__status">{status}</p>}
        </div>
      )}
    </section>
  );
}
