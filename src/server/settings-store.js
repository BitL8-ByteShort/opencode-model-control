import {
  chmod,
  mkdir,
  readFile,
  rename,
  lstat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { withStateLock } from "./state-lock.js";

export const MAX_SETTINGS_BYTES = 4 * 1024 * 1024;

export const settingsRevision = (value) =>
  createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
export function settingsConflict(
  code = "SETTINGS_CONFLICT",
  reasons = ["Settings changed in another process."],
) {
  return Object.assign(new Error(reasons[0]), {
    code,
    statusCode: 409,
    reasons: reasons.slice(0, 8),
  });
}

export function resolveSettingsPath(env = process.env) {
  const base =
    env.OMC_CONFIG_DIR ||
    join(
      env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      "opencode-model-control",
    );
  return join(base, "settings.json");
}

export async function readRawSettings(path) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw Object.assign(new Error("Settings must be a regular file."), {
        code: "SETTINGS_INVALID_FILE",
      });
    if (metadata.size > MAX_SETTINGS_BYTES)
      throw Object.assign(new Error("Settings file is too large."), {
        code: "SETTINGS_TOO_LARGE",
      });
    const raw = await readFile(path, "utf8");
    if (Buffer.byteLength(raw) > MAX_SETTINGS_BYTES)
      throw Object.assign(new Error("Settings file is too large."), {
        code: "SETTINGS_TOO_LARGE",
      });
    return { raw, value: JSON.parse(raw) };
  } catch (error) {
    if (error.code === "ENOENT") return { raw: null, value: undefined };
    if (error instanceof SyntaxError)
      throw Object.assign(new Error("Settings file is not valid JSON."), {
        code: "SETTINGS_INVALID_JSON",
      });
    throw error;
  }
}

export async function readSettings({
  path = resolveSettingsPath(),
  migrate,
  locked = false,
}) {
  const read = async () => {
    const { raw, value } = await readRawSettings(path);
    const migrated = migrate(value);
    if (value && value.schemaVersion !== migrated.schemaVersion) {
      const backup = `${path}.v${value.schemaVersion ?? 0}.backup-${randomUUID()}`;
      await writeFile(backup, raw, { flag: "wx", mode: 0o600 });
      await writeSettings(migrated, { path, locked: true });
    }
    return migrated;
  };
  return locked ? read() : withStateLock(path, read);
}

export async function writeSettings(
  settings,
  { path = resolveSettingsPath(), expectedRevision, locked = false } = {},
) {
  if (!locked)
    return withStateLock(path, () =>
      writeSettings(settings, { path, expectedRevision, locked: true }),
    );
  if (
    expectedRevision !== undefined &&
    settingsRevision((await readRawSettings(path)).value) !== expectedRevision
  )
    throw settingsConflict();
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const temporaryPath = join(directory, `.settings-${randomUUID()}.tmp`);
  const payload = `${JSON.stringify(settings, null, 2)}\n`;
  if (Buffer.byteLength(payload) > MAX_SETTINGS_BYTES) {
    throw Object.assign(new Error("Settings payload is too large."), {
      code: "SETTINGS_TOO_LARGE",
    });
  }

  try {
    await writeFile(temporaryPath, payload, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(temporaryPath);
    } catch {
      // Best-effort cleanup; the original error is more useful to the caller.
    }
    throw error;
  }

  return settings;
}
