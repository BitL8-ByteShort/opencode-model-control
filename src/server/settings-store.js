import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_SETTINGS_BYTES = 64 * 1024;

export function resolveSettingsPath(env = process.env) {
  const base =
    env.OMC_CONFIG_DIR ||
    join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode-model-control");
  return join(base, "settings.json");
}

export async function readSettings({ path = resolveSettingsPath(), migrate }) {
  try {
    const metadata = await stat(path);
    if (metadata.size > MAX_SETTINGS_BYTES) {
      throw Object.assign(new Error("Settings file is too large."), {
        code: "SETTINGS_TOO_LARGE",
      });
    }

    const raw = await readFile(path, "utf8");
    return migrate(JSON.parse(raw));
  } catch (error) {
    if (error?.code === "ENOENT") return migrate(undefined);
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error("Settings file is not valid JSON."), {
        code: "SETTINGS_INVALID_JSON",
      });
    }
    throw error;
  }
}

export async function writeSettings(settings, { path = resolveSettingsPath() } = {}) {
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
    await writeFile(temporaryPath, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
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
