import {
  OPEN_CODE_LIMITATION_WARNINGS,
  previewOpenCodeConfig,
} from "../../src/opencode/index.js";

const existingConfig = {
  $schema: "https://opencode.ai/config.json",
  theme: "system",
};

const preview = previewOpenCodeConfig({ existingConfig });

process.stderr.write("Preview only; no files were read or written.\n");
for (const warning of OPEN_CODE_LIMITATION_WARNINGS) {
  process.stderr.write(`- ${warning}\n`);
}
process.stdout.write(`${JSON.stringify(preview.mergedConfig, null, 2)}\n`);
