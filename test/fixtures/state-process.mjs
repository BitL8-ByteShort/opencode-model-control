import { writeSettings } from "../../src/server/settings-store.js";
import { ControlService } from "../../src/server/service.js";
import { acquireFileLock } from "../../src/server/state-lock.js";
import { readFile, appendFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { publicFixture, liveModel } from "./public-metadata.js";
const [mode, path, revision, field] = process.argv.slice(2);
if (mode === "cas") {
  const input = JSON.parse(await readFile(path, "utf8"));
  input[field] = field === "makeRouterDefault" ? false : 0;
  try {
    await writeSettings(input, { path, expectedRevision: revision });
    process.stdout.write("saved");
  } catch (error) {
    process.stdout.write(String(error.statusCode));
  }
}
if (mode === "refresh") {
  const service = await new ControlService({
    settingsPath: path,
    discovery: async () => ({
      installed: true,
      complete: true,
      error: null,
      models: [liveModel("new/model")],
    }),
    metadataFetch: async () => {
      await appendFile(`${path}.attempts`, "fetch\n");
      await delay(150);
      return new Response(JSON.stringify(publicFixture([{ id: "new/model" }])));
    },
  }).initialize();
  process.stdout.write(service.getState().catalogRevision);
  await service.close();
}
if (mode === "hold") {
  await acquireFileLock(`${path}.lock`);
  process.stdout.write("locked");
  await delay(60000);
}
if (mode === "hold-reaper") {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(`${path}.reaper-${process.pid}-abandoned`, { mode: 0o700 });
  process.stdout.write("reaping");
  await delay(60000);
}
