export const BENCHMARK_SUMMARY = Object.freeze({
  methodologyVersion: "0.1.0",
  status: "not-run",
  generatedAt: null,
  headline: "No models have been benchmark-promoted yet.",
  explanation:
    "Initial assignments use reported metadata as routing candidates. A manual runtime check proves only one provider response; a model earns qualified evidence only after the published, repeatable benchmark gate passes.",
  roles: [
    { id: "orchestrator", status: "provisional", qualifiedModelId: null },
    { id: "code-worker", status: "provisional", qualifiedModelId: null },
    { id: "vision-worker", status: "capability-only", qualifiedModelId: null },
    { id: "reviewer", status: "experimental", qualifiedModelId: null },
  ],
});
