import * as filesystem from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
// Recovery fences have unique names: a crashed reaper cannot leave a permanent
// mutex, and no later process can reuse a fence removed by a concurrent reaper.
async function hasRecoveryFence(path, fs) {
  const directory = dirname(path),
    prefix = `${basename(path)}.reaper-`;
  let live = false;
  for (const name of await fs.readdir(directory)) {
    if (!name.startsWith(prefix)) continue;
    const pid = Number(name.slice(prefix.length).split("-")[0]);
    if (processAlive(pid)) live = true;
    else await fs.rm(join(directory, name), { recursive: true, force: true });
  }
  return live;
}

// Cooperating catalog/settings readers and writers share this short lock.
// Metadata refresh holds a separate lease while bounded discovery runs.
export async function acquireFileLock(
  path,
  { waitMs = 10000, fs = filesystem } = {},
) {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomUUID(),
    started = Date.now();
  for (;;) {
    if (!(await hasRecoveryFence(path, fs))) {
      try {
        await fs.mkdir(path, { mode: 0o700 });
        if (await hasRecoveryFence(path, fs))
          await fs.rm(path, { recursive: true, force: true });
        else {
          const temporary = join(path, `.owner-${process.pid}-${token}.tmp`);
          try {
            await fs.writeFile(
              temporary,
              JSON.stringify({ pid: process.pid, token }),
              { flag: "wx", mode: 0o600 },
            );
            // Linking publishes complete bytes exclusively. A delayed publisher
            // cannot overwrite an owner that acquired a reclaimed directory.
            await fs.link(temporary, join(path, "owner.json"));
          } finally {
            await fs.unlink(temporary).catch(() => {});
          }
          return async () => {
            try {
              const owner = JSON.parse(
                await fs.readFile(join(path, "owner.json"), "utf8"),
              );
              if (owner.token === token)
                await fs.rm(path, { recursive: true, force: true });
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
          };
        }
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const fence = `${path}.reaper-${process.pid}-${token}`;
      await fs.mkdir(fence, { mode: 0o700 });
      try {
        let dead = false;
        try {
          const owner = JSON.parse(
            await fs.readFile(join(path, "owner.json"), "utf8"),
          );
          if (
            !owner ||
            !Number.isSafeInteger(owner.pid) ||
            owner.pid < 1 ||
            owner.pid > 2147483647 ||
            typeof owner.token !== "string" ||
            !owner.token
          )
            throw new SyntaxError("Malformed lock owner.");
          dead = !processAlive(owner.pid);
        } catch (error) {
          if (error.code === "ENOENT" || error instanceof SyntaxError) {
            try {
              // Legacy truncated records and interrupted unpublished records
              // never establish valid ownership. Give writes a grace period;
              // a currently live atomic publisher remains protected throughout.
              const pending = (await fs.readdir(path)).filter((name) =>
                /^\.owner-\d+-.*\.tmp$/.test(name),
              );
              const publishing = pending.some((name) =>
                processAlive(Number(name.split("-")[1])),
              );
              dead =
                !publishing &&
                Date.now() - (await fs.stat(path)).mtimeMs > 10000;
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
          } else throw error;
        }
        if (dead) await fs.rm(path, { recursive: true, force: true });
      } finally {
        await fs.rm(fence, { recursive: true, force: true });
      }
    }
    if (Date.now() - started >= waitMs) return null;
    await delay(15);
  }
}
export async function withStateLock(settingsPath, operation) {
  const release = await acquireFileLock(`${settingsPath}.lock`);
  if (!release)
    throw Object.assign(
      new Error("Local state is busy; retry the operation."),
      { code: "STATE_BUSY", statusCode: 409 },
    );
  try {
    return await operation();
  } finally {
    await release();
  }
}
