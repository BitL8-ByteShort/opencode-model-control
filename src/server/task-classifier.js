const ALLOWED_MODALITIES = new Set(["text", "image", "audio", "video", "pdf"]);
const CODE_CONTEXT_PATTERN =
  /\b(api|app|bug|class|code|coding|component|css|database|file|front[- ]?end|function|html|interface|javascript|jsx|layout|python|react|repository|sql|style(?:sheet)?|test|typescript|tsx|ui|website|webpage)\b/iu;
const STANDALONE_TEXT_CODE_ACTION_PATTERN = /\b(fix|implement|refactor)\b/iu;
const CODE_CHANGE_PATTERN =
  /\b(add|build|change|create|debug|develop|edit|fix|implement|migrate|patch|refactor|remove|repair|test|update|write)\b/iu;
const REVIEW_PATTERN = /\b(review|audit|inspect|security|accessibility|regression|critique|verify)\b/iu;
const EXPLANATION_PATTERN =
  /\b(describe|explain|how does|summarize|what is|why)\b/iu;
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

  const hasCodeContext =
    CODE_CONTEXT_PATTERN.test(description) ||
    (modality === "text" && STANDALONE_TEXT_CODE_ACTION_PATTERN.test(description));
  const hasReview = REVIEW_PATTERN.test(description);
  const hasCodeChange = hasCodeContext && (
    CODE_CHANGE_PATTERN.test(description) ||
    (!hasReview && !EXPLANATION_PATTERN.test(description) && /\b(code|coding)\b/iu.test(description))
  );
  let kind = "general";
  if (hasCodeChange && hasReview) kind = "mixed";
  else if (hasCodeChange) kind = "code";
  else if (modality !== "text") kind = "vision";
  else if (hasReview) kind = "review";

  let complexity = "medium";
  if (
    description.length < 180 &&
    (SMALL_PATTERN.test(description) || (!hasCodeChange && !hasReview && modality === "text"))
  ) {
    complexity = "small";
  }
  if (description.length > 900 || LARGE_PATTERN.test(description)) complexity = "large";

  return {
    description,
    kind,
    complexity,
    modalities: modality === "text" ? ["text"] : ["text", modality],
    access: kind === "code" || kind === "mixed" ? "write" : "read",
    cohesive: complexity !== "large",
    requiresReview: hasReview || hasCodeChange,
    delegationDepth: 0,
  };
}
