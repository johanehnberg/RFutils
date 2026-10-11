import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { CompanionButtonLocation, CompanionCrosspointConfig } from '@rfutils/shared';
import { say } from '../../diag/index.js';

/**
 * Where the user's own companion-routes.json lives. Absence of this file is
 * the default, expected state — RFutils ships with no Dante routing
 * capability until the user opts in by creating it. Ported from MicWizard's
 * routesConfig.ts; Electron's app.getPath('userData') is replaced with a
 * plain config dir: RFUTILS_CONFIG_DIR if set, else ~/.rfutils.
 * See companion-routes.example.json and the README.
 */
export function companionConfigDir(): string {
  return process.env.RFUTILS_CONFIG_DIR ?? path.join(os.homedir(), '.rfutils');
}

export function companionConfigPath(): string {
  return path.join(companionConfigDir(), 'companion-routes.json');
}

/**
 * Where MicWizard kept the same file: Electron's `app.getPath('userData')`,
 * which is the per-user app-data directory plus the product name.
 *
 *   macOS    ~/Library/Application Support/MicWizard/
 *   Windows  %APPDATA%\MicWizard\
 *   Linux    $XDG_CONFIG_HOME/MicWizard/ (default ~/.config/MicWizard/)
 *
 * The file's shape is unchanged between the two apps, so it can be copied
 * across as it is.
 */
export function micWizardConfigPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): string {
  const file = 'companion-routes.json';
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'MicWizard', file);
  }
  if (platform === 'win32') {
    return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'MicWizard', file);
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'MicWizard', file);
}

/**
 * MicWizard's config, if there is one to import: only while RFutils has none
 * of its own, so it is offered once and never over the top of a real config.
 */
export function importableMicWizardConfig(): string | null {
  if (fs.existsSync(companionConfigPath())) return null;
  const legacy = micWizardConfigPath();
  return fs.existsSync(legacy) ? legacy : null;
}

/**
 * Copy MicWizard's companion-routes.json into RFutils' config directory.
 *
 * The bytes are copied as they are, after checking they parse and validate —
 * a file RFutils would refuse to load is not worth importing. An existing
 * RFutils config is never overwritten (`wx`), even if one appeared between
 * the check and the write.
 */
export function importMicWizardConfig(): { importedFrom: string; path: string } {
  const target = companionConfigPath();
  if (fs.existsSync(target)) {
    throw new Error(`${target} already exists — RFutils will not overwrite it.`);
  }
  const source = micWizardConfigPath();
  if (!fs.existsSync(source)) throw new Error(`No MicWizard config found at ${source}.`);
  const text = fs.readFileSync(source, 'utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${source} is not valid JSON, so it was not imported.`);
  }
  if (!validateCompanionConfig(raw)) {
    throw new Error(
      `${source} does not match the expected shape (see companion-routes.example.json), so it was not imported.`
    );
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, { flag: 'wx' });
  say.info(`[companion] imported ${source} -> ${target}`);
  return { importedFrom: source, path: target };
}

export function loadCompanionConfig(): CompanionCrosspointConfig | null {
  const configPath = companionConfigPath();
  if (!fs.existsSync(configPath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    say.error(`[companion] failed to parse ${configPath}`, err);
    return null;
  }

  const parsed = validateCompanionConfig(raw);
  if (!parsed) {
    say.error(
      `[companion] ${configPath} does not match the expected shape — see companion-routes.example.json`
    );
    return null;
  }
  return parsed;
}

/** Pure shape check for a parsed companion-routes.json; exported for unit testing. */
export function validateCompanionConfig(raw: unknown): CompanionCrosspointConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const companion = obj.companion;
  if (typeof companion !== 'object' || companion === null) return null;
  const { host, port } = companion as Record<string, unknown>;
  if (typeof host !== 'string' || typeof port !== 'number') return null;

  if (typeof obj.variablePrefix !== 'string' || obj.variablePrefix.length === 0) return null;

  const makeCrosspointButton = validateLocation(obj.makeCrosspointButton);
  if (!makeCrosspointButton) return null;

  let clearCrosspointButton: CompanionButtonLocation | null = null;
  if (obj.clearCrosspointButton !== undefined && obj.clearCrosspointButton !== null) {
    clearCrosspointButton = validateLocation(obj.clearCrosspointButton);
    if (!clearCrosspointButton) return null;
  }

  return {
    host,
    port,
    variablePrefix: obj.variablePrefix,
    makeCrosspointButton,
    clearCrosspointButton,
  };
}

function validateLocation(raw: unknown): CompanionButtonLocation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { page, row, column } = raw as Record<string, unknown>;
  if (typeof page !== 'number' || typeof row !== 'number' || typeof column !== 'number') return null;
  return { page, row, column };
}
