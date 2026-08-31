export const MODEL_ROLES = Object.freeze([
  "orchestrator",
  "code-worker",
  "vision-worker",
  "reviewer",
]);

export const ROUTES = Object.freeze([
  "direct",
  "orchestrator",
  "code-worker",
  "vision-worker",
  "reviewer",
]);

export const TASK_KINDS = Object.freeze([
  "general",
  "code",
  "vision",
  "review",
  "mixed",
]);

export const COMPLEXITIES = Object.freeze(["small", "medium", "large"]);
export const ACCESS_MODES = Object.freeze(["read", "write"]);
export const MODALITIES = Object.freeze([
  "text",
  "image",
  "audio",
  "video",
  "pdf",
]);

export const COST_PREFERENCES = Object.freeze(["free-first", "paid-first"]);
export const COST_POLICIES = Object.freeze(["free-only", "known-cost"]);
export const PRICING_CLASSES = Object.freeze(["free", "paid", "unknown"]);

export const KNOWN_MODEL_IDS = Object.freeze([
  "opencode/big-pickle",
  "opencode/ling-3.0-flash-fin-free",
  "opencode/mimo-v2.5-free",
  "opencode/muse-spark-1.2-contributor-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/nemotron-3.5-lightning-free",
]);

export const ROLE_REQUIREMENTS = Object.freeze({
  orchestrator: Object.freeze({ modalities: Object.freeze(["text"]), access: "write" }),
  "code-worker": Object.freeze({ modalities: Object.freeze(["text"]), access: "write" }),
  "vision-worker": Object.freeze({
    modalities: Object.freeze(["text", "image"]),
    access: "read",
  }),
  reviewer: Object.freeze({ modalities: Object.freeze(["text"]), access: "read" }),
});

export const CURRENT_SETTINGS_VERSION = 2;
export const CURRENT_CATALOG_VERSION = 1;
export const CURRENT_PLAN_VERSION = 1;
export const CURRENT_RESULT_VERSION = 1;
export const AUTO_ASSIGNMENT = "auto";
