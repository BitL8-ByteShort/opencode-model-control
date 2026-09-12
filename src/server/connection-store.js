import { randomUUID, createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CURRENT_CONNECTION_STORE_VERSION,
  validateConnectionSnapshot,
} from "../core/connections.js";
import { withStateLock } from "./state-lock.js";

const MAX_CONNECTION_SNAPSHOT_BYTES = 1024 * 1024;

export function resolveConnectionSnapshotPath(settingsPath) {
  return join(dirname(settingsPath), "connections.json");
}

function emptySnapshot() {
  const connections = [];
  return {
    schemaVersion: CURRENT_CONNECTION_STORE_VERSION,
    revision: createHash("sha256").update(JSON.stringify(connections)).digest("hex"),
    scopeId: randomUUID(),
    connections,
  };
}

export async function readConnectionSnapshot({
  settingsPath,
  path = resolveConnectionSnapshotPath(settingsPath),
  locked = false,
} = {}) {
  const read = async () => {
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw Object.assign(new Error("Connection snapshot must be a regular file."), {
          code: "CONNECTION_SNAPSHOT_INVALID",
        });
      }
      if (metadata.size > MAX_CONNECTION_SNAPSHOT_BYTES) {
        throw Object.assign(new Error("Connection snapshot is too large."), {
          code: "CONNECTION_SNAPSHOT_TOO_LARGE",
        });
      }
      return validateConnectionSnapshot(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") {
        const snapshot = emptySnapshot();
        await writeConnectionSnapshot({
          settingsPath,
          snapshot,
          path,
          locked: true,
        });
        return snapshot;
      }
      if (error instanceof SyntaxError) {
        throw Object.assign(new Error("Connection snapshot is not valid JSON."), {
          code: "CONNECTION_SNAPSHOT_INVALID_JSON",
        });
      }
      throw error;
    }
  };
  return locked ? read() : withStateLock(settingsPath, read);
}

export async function writeConnectionSnapshot({
  settingsPath,
  snapshot,
  path = resolveConnectionSnapshotPath(settingsPath),
  locked = false,
} = {}) {
  const write = async () => {
    const normalized = validateConnectionSnapshot(snapshot);
    const payload = `${JSON.stringify(normalized, null, 2)}\n`;
    if (Buffer.byteLength(payload) > MAX_CONNECTION_SNAPSHOT_BYTES) {
      throw Object.assign(new Error("Connection snapshot is too large."), {
        code: "CONNECTION_SNAPSHOT_TOO_LARGE",
      });
    }
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporaryPath = join(
      directory,
      `.connections-${randomUUID()}.tmp`,
    );
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
        await unlink(temporaryPath);
      } catch {
        /* original error is more useful */
      }
      throw error;
    }
    return normalized;
  };
  return locked ? write() : withStateLock(settingsPath, write);
}
