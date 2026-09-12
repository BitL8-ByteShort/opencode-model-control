import { loadModelCatalog } from "../../src/core/index.js";

export function publicFixture(
  models = loadModelCatalog().models.map((m) => ({
    id: m.id,
    input: 0,
    output: 0,
  })),
) {
  const raw = {};
  for (const model of models) {
    const [provider, ...parts] = model.id.split("/");
    const key = parts.join("/");
    raw[provider] ??= {
      id: provider,
      npm: "@ai-sdk/openai-compatible",
      models: {},
    };
    raw[provider].models[key] = {
      id: key,
      cost: { input: model.input ?? 0, output: model.output ?? 0 },
    };
  }
  return raw;
}
export async function publicMetadataFetch() {
  return new Response(JSON.stringify(publicFixture()), { status: 200 });
}
export const noPublicMetadataFetch = async () =>
  new Response("{}", { status: 503 });
export const sdkDefaultEndpointShapes = Object.freeze({
  absent: {},
  nullUrl: { url: null },
  emptyUrl: { url: "" },
  explicitDefault: { url: "https://api.x.ai/v1" },
  customGateway: { url: "https://gateway.example/v1" },
  malformed: { url: "not a url" },
  whitespace: { url: "   " },
  cachedInvalid: { url: null, urlValid: false },
});

export function liveModel(id, extra = {}) {
  return {
    id,
    name: id,
    inputModalities: ["text"],
    outputModalities: ["text"],
    status: "active",
    api: {
      id: id.slice(id.indexOf("/") + 1),
      npm: "@ai-sdk/openai-compatible",
      url: null,
      urlValid: true,
    },
    inputCost: 0,
    outputCost: 0,
    inputCostVerified: true,
    outputCostVerified: true,
    toolCall: true,
    ...extra,
  };
}
