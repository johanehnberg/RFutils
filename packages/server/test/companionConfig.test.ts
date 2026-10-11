/**
 * companion-routes.json: shape validation (ported from MicWizard's
 * test/validateCompanionConfig.test.mts) and the one-time import of the file
 * MicWizard left behind.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  companionConfigPath,
  importableMicWizardConfig,
  importMicWizardConfig,
  loadCompanionConfig,
  micWizardConfigPath,
  validateCompanionConfig,
} from '../src/monitor/companion/routesConfig.js';

// Shape of the raw JSON file (companion-routes.example.json) - nested "companion" block.
const VALID = {
  companion: { host: '127.0.0.1', port: 8000 },
  variablePrefix: 'dante',
  makeCrosspointButton: { page: 1, row: 0, column: 0 },
  clearCrosspointButton: { page: 1, row: 0, column: 1 },
};

// What validateCompanionConfig returns - host/port flattened onto the top level.
const EXPECTED = {
  host: '127.0.0.1',
  port: 8000,
  variablePrefix: 'dante',
  makeCrosspointButton: { page: 1, row: 0, column: 0 },
  clearCrosspointButton: { page: 1, row: 0, column: 1 },
};

describe('validateCompanionConfig', () => {
  it('accepts a config matching companion-routes.example.json, flattening host/port', () => {
    expect(validateCompanionConfig(VALID)).toEqual(EXPECTED);
  });

  it('accepts a config with no clearCrosspointButton (optional)', () => {
    const { clearCrosspointButton: _omit, ...withoutClear } = VALID;
    expect(validateCompanionConfig(withoutClear)!.clearCrosspointButton).toBeNull();
  });

  it('accepts an explicit null clearCrosspointButton', () => {
    expect(
      validateCompanionConfig({ ...VALID, clearCrosspointButton: null })!.clearCrosspointButton
    ).toBeNull();
  });

  it('rejects non-object input', () => {
    expect(validateCompanionConfig(null)).toBeNull();
    expect(validateCompanionConfig('a string')).toBeNull();
    expect(validateCompanionConfig(42)).toBeNull();
    expect(validateCompanionConfig(undefined)).toBeNull();
  });

  it('rejects a missing companion block', () => {
    const { companion: _omit, ...rest } = VALID;
    expect(validateCompanionConfig(rest)).toBeNull();
  });

  it('rejects a non-numeric port', () => {
    expect(
      validateCompanionConfig({ ...VALID, companion: { host: '127.0.0.1', port: '8000' } })
    ).toBeNull();
  });

  it('rejects an empty variablePrefix', () => {
    expect(validateCompanionConfig({ ...VALID, variablePrefix: '' })).toBeNull();
  });

  it('rejects a missing variablePrefix', () => {
    const { variablePrefix: _omit, ...rest } = VALID;
    expect(validateCompanionConfig(rest)).toBeNull();
  });

  it('rejects a missing makeCrosspointButton', () => {
    const { makeCrosspointButton: _omit, ...rest } = VALID;
    expect(validateCompanionConfig(rest)).toBeNull();
  });

  it('rejects a makeCrosspointButton missing a field', () => {
    expect(
      validateCompanionConfig({ ...VALID, makeCrosspointButton: { page: 1, row: 0 } })
    ).toBeNull();
  });

  it('rejects a malformed clearCrosspointButton rather than silently ignoring it', () => {
    expect(
      validateCompanionConfig({
        ...VALID,
        clearCrosspointButton: { page: 'one', row: 0, column: 1 },
      })
    ).toBeNull();
  });
});

describe("MicWizard's config path", () => {
  it("is Electron's userData directory for the product name on each platform", () => {
    expect(micWizardConfigPath('darwin', {}, '/Users/a')).toBe(
      path.join('/Users/a', 'Library', 'Application Support', 'MicWizard', 'companion-routes.json')
    );
    expect(micWizardConfigPath('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a')).toBe(
      path.join('C:\\Users\\a\\AppData\\Roaming', 'MicWizard', 'companion-routes.json')
    );
    expect(micWizardConfigPath('linux', {}, '/home/a')).toBe(
      path.join('/home/a', '.config', 'MicWizard', 'companion-routes.json')
    );
    expect(micWizardConfigPath('linux', { XDG_CONFIG_HOME: '/xdg' }, '/home/a')).toBe(
      path.join('/xdg', 'MicWizard', 'companion-routes.json')
    );
  });
});

describe('importing the MicWizard config', () => {
  let tmp: string;
  const saved = {
    RFUTILS_CONFIG_DIR: process.env.RFUTILS_CONFIG_DIR,
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    APPDATA: process.env.APPDATA,
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rfutils-companion-'));
    process.env.RFUTILS_CONFIG_DIR = path.join(tmp, 'rfutils');
    // micWizardConfigPath() defaults to the real home directory; point every
    // platform's lookup at the temp dir instead so the test never reads or
    // writes the user's own files.
    process.env.HOME = tmp;
    process.env.XDG_CONFIG_HOME = path.join(tmp, '.config');
    process.env.APPDATA = path.join(tmp, 'AppData');
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const legacyPath = () => micWizardConfigPath(process.platform, process.env, tmp);
  const writeLegacy = (text: string) => {
    fs.mkdirSync(path.dirname(legacyPath()), { recursive: true });
    fs.writeFileSync(legacyPath(), text);
  };

  it('offers nothing when MicWizard left no config', () => {
    expect(importableMicWizardConfig()).toBeNull();
  });

  it('offers the MicWizard file while RFutils has none, and imports it byte for byte', () => {
    const text = JSON.stringify(VALID, null, 2) + '\n';
    writeLegacy(text);
    expect(importableMicWizardConfig()).toBe(legacyPath());

    const result = importMicWizardConfig();
    expect(result).toEqual({ importedFrom: legacyPath(), path: companionConfigPath() });
    expect(fs.readFileSync(companionConfigPath(), 'utf8')).toBe(text);
    expect(loadCompanionConfig()).toEqual(EXPECTED);
    // Offered once: RFutils now has its own.
    expect(importableMicWizardConfig()).toBeNull();
  });

  it('never overwrites a config RFutils already has', () => {
    writeLegacy(JSON.stringify(VALID));
    fs.mkdirSync(path.dirname(companionConfigPath()), { recursive: true });
    fs.writeFileSync(companionConfigPath(), '{"mine":true}');
    expect(() => importMicWizardConfig()).toThrow(/will not overwrite/);
    expect(fs.readFileSync(companionConfigPath(), 'utf8')).toBe('{"mine":true}');
  });

  it('refuses a MicWizard file RFutils would not load', () => {
    writeLegacy('{"companion":{"host":"x"}}');
    expect(() => importMicWizardConfig()).toThrow(/expected shape/);
    expect(fs.existsSync(companionConfigPath())).toBe(false);
  });
});
