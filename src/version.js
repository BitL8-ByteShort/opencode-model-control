import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

if (typeof packageJson.version !== "string" || !packageJson.version) {
  throw new Error("The package version is unavailable.");
}

export const PACKAGE_VERSION = packageJson.version;
