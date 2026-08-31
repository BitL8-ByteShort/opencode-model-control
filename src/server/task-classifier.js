const ALLOWED_MODALITIES = new Set(["text", "image", "audio", "video", "pdf"]);
const CODE_PATTERN =
  /\b(code|coding|bug|fix|implement|refactor|typescript|javascript|python|react|api|test|repository|file|function|class|database|sql)\b/iu;
const REVIEW_PATTERN = /\b(review|audit|inspect|security|accessibility|regression|critique|verify)\b/iu;
const LARGE_PATTERN =
  /\b(architecture|migration|many files|multi[- ]file|end[- ]to[- ]end|production[- ]ready|entire|whole repository)\b/iu;
const SMALL_PATTERN = /\b(tiny|small|simple|one line|single file|rename|typo|explain)\b/iu;

export function classifyRouteRequest(input) {
  const description = typeof input?.task === "string" ? input.task.trim() : "";
  if (!description || description.length > 4_000) {
    throw Object.assign(new Error("Task must contain between 1 and 4,000 characters."), {
      code: "INVALID_TASK",
      statusCode: 400,
    });
  }

  const modality = input?.modality ?? "text";
  if (!ALLOWED_MODALITIES.has(modality)) {
    throw Object.assign(new Error("Unsupported task modality."), {
      code: "INVALID_MODALITY",
      statusCode: 400,
    });
  }

  const hasCode = CODE_PATTERN.test(description);
  const hasReview = REVIEW_PATTERN.test(description);
  let kind = "general";
  if (modality !== "text") kind = "vision";
  else if (hasCode && hasReview) kind = "mixed";
  else if (hasReview) kind = "review";
  else if (hasCode) kind = "code";

  let complexity = "medium";
  if (
    description.length < 180 &&
    (SMALL_PATTERN.test(description) || (!hasCode && !hasReview && modality === "text"))
  ) {
    complexity = "small";
  }
  if (description.length > 900 || LARGE_PATTERN.test(description)) complexity = "large";

  return {
    description,
    kind,
    complexity,
    modalities: [modality],
    access: kind === "code" || kind === "mixed" ? "write" : "read",
    cohesive: complexity !== "large",
    requiresReview: hasReview || (hasCode && complexity === "large"),
    delegationDepth: 0,
  };
}
