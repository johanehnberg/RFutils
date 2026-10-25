import { useEffect, useState } from 'react';
import type { CoordinationRadio, ExportFormat, FreqRange, ProfileCatalog } from '@rfutils/shared';
import {
  channelNames,
  defaultCoordinationParams,
  deriveCoordDefaults,
  EXPORT_FORMATS,
  findMode,
  findVariant,
} from '@rfutils/shared';
import { usePlanStore, type Allocation } from '../planStore.js';
import { coordinateRadioSet, exportModel, getProfiles } from '../api.js';
import type { JSX } from 'react';

function download(text: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Allocation: pair coordinated frequencies with talent / inventory channels.
 * Reads the last coordination result (or coordinates straight from the
 * inventory) and lets you name and reorder assignments, then export them.
 */
export function AllocationTab(): JSX.Element {
  const items = usePlanStore((s) => s.items);
  const coordination = usePlanStore((s) => s.coordination);
  const allocations = usePlanStore((s) => s.allocations);
  const setAllocations = usePlanStore((s) => s.setAllocations);
  const setCoordination = usePlanStore((s) => s.setCoordination);
  const loadInventory = usePlanStore((s) => s.load);
  const loaded = usePlanStore((s) => s.loaded);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('generic-csv');

  useEffect(() => {
    if (!loaded) void loadInventory();
  }, [loaded, loadInventory]);

  // Initialise allocations from a fresh coordination result.
  useEffect(() => {
    if (coordination && allocations.length === 0) {
      setAllocations(
        coordination.assigned.map((a) => ({ frequencyMhz: a.frequencyMhz, name: a.name, locked: a.locked }))
      );
    }
  }, [coordination, allocations.length, setAllocations]);

  const coordinateFromInventory = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const names = channelNames({ items });
      if (names.length === 0) {
        setError('No inventory channels flagged for coordination. Add equipment on the Inventory tab.');
        return;
      }
      const params = defaultCoordinationParams();
      let catalog: ProfileCatalog | null = null;
      try {
        catalog = await getProfiles();
      } catch {
        /* fall back to defaults if the catalog can't be fetched */
      }

      // Build one radio per channel, each carrying the band variant it was
      // assigned on the Inventory tab — its real tunable spectrum, raster,
      // required spacing and placement strategy. That is what constrains each
      // channel to its own band instead of one shared preset.
      const radios: CoordinationRadio[] = [];
      const rangeKeys = new Map<string, FreqRange>();
      let nameIdx = 0;
      for (const item of items) {
        if (!item.coordinate) continue;
        const q = Math.max(0, Math.floor(item.quantity) || 0);
        if (q === 0) continue;
        const profile = catalog?.profiles.find((p) => p.id === item.profileId);
        const variant = findVariant(profile?.bandVariants, item.band);
        const mode = findMode(profile?.modes);
        if (variant) {
          for (const r of variant.ranges) {
            rangeKeys.set(`${r.startMhz}-${r.endMhz}`, { startMhz: r.startMhz, endMhz: r.endMhz });
          }
        }
        for (let i = 0; i < q; i++) {
          radios.push({
            name: names[nameIdx++] ?? item.label,
            tuningRanges: variant?.ranges,
            tuningStepKhz: variant?.tuningStepKhz ?? profile?.tuningStepKhz,
            minSpacingMhz: mode ? mode.minSpacingKhz / 1000 : undefined,
            occupiedBandwidthKhz: mode?.occupiedBandwidthKhz,
            strategy: mode?.strategy,
            productId: profile?.id,
            bandCode: variant?.code,
            modeId: mode?.id,
          });
        }
      }
      const variantRanges = [...rangeKeys.values()];

      // Derive the fallback settings from the gear mix (widest spacing, finest
      // step, most common band) — only what a channel without its own values
      // needs. When the inventory declares real band variants, the working
      // ranges are the union of those, so each channel keeps its own band;
      // otherwise fall back to the most common band preset.
      if (catalog) {
        const derived = deriveCoordDefaults(
          items.filter((i) => i.coordinate).map((i) => i.profileId),
          catalog
        );
        params.minSpacingMhz = derived.minSpacingMhz;
        params.stepMhz = derived.stepMhz;
        if (variantRanges.length > 0) {
          params.ranges = variantRanges;
        } else {
          const band = derived.bandPresetId
            ? catalog.bandPresets.find((b) => b.id === derived.bandPresetId)
            : undefined;
          if (band) params.ranges = band.ranges;
        }
      }

      const res = await coordinateRadioSet(radios, params);
      setCoordination(res);
      setAllocations(
        res.assigned.map((a) => ({ frequencyMhz: a.frequencyMhz, name: a.name, locked: a.locked }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const nameFromInventory = (): void => {
    const names = channelNames({ items });
    setAllocations(allocations.map((a, i) => (names[i] ? { ...a, name: names[i] } : a)));
  };

  const setName = (idx: number, name: string): void => {
    setAllocations(allocations.map((a, i) => (i === idx ? { ...a, name } : a)));
  };

  const doExport = async (): Promise<void> => {
    try {
      const list = {
        channels: allocations.map((a) => ({ name: a.name, frequencyMhz: a.frequencyMhz })),
        sourceFormat: 'allocation',
      };
      const info = EXPORT_FORMATS.find((f) => f.id === exportFormat)!;
      const blob = await exportModel(list, exportFormat);
      download(await blob.text(), `allocation.${info.extension}`, info.mimeType);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="tab-panel">
      <p className="tab-panel__intro">
        Assign coordinated frequencies to talent / inventory channels, then export. Program them to
        devices on the <strong>Deployment</strong> tab.
      </p>

      <div className="export-bar">
        <button className="btn btn--primary" onClick={coordinateFromInventory} disabled={busy}>
          {busy ? 'Coordinating…' : 'Coordinate from inventory'}
        </button>
        {allocations.length > 0 && (
          <button className="btn" onClick={nameFromInventory}>
            Name from inventory
          </button>
        )}
      </div>
      {error && <p className="status status--error">{error}</p>}

      {allocations.length === 0 ? (
        <p className="device-list__empty">
          No allocations yet. Run coordination (Coordination tab) or coordinate straight from your
          inventory above.
        </p>
      ) : (
        <>
          <div className="export-bar">
            <label>
              Export as
              <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as ExportFormat)}>
                {EXPORT_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                    {f.experimental ? ' — experimental' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" onClick={doExport}>
              Download
            </button>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Frequency (MHz)</th>
                  <th>Allocated to</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a: Allocation, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td className="mono">{a.frequencyMhz.toFixed(3)}</td>
                    <td>
                      <input className="cell" value={a.name} onChange={(e) => setName(i, e.target.value)} />
                    </td>
                    <td>{a.locked ? 'locked' : 'coordinated'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
