export const BENCHMARK_SUMMARY = Object.freeze({
  methodologyVersion: "0.1.0",
  status: "not-run",
  generatedAt: null,
  headline: "No models have been benchmark-promoted yet.",
  explanation:
    "Initial assignments are capability-safe candidates. A model earns an active role only after the published, repeatable benchmark gate passes.",
  roles: [
    { id: "orchestrator", status: "provisional", qualifiedModelId: null },
    { id: "code-worker", status: "provisional", qualifiedModelId: null },
    { id: "vision-worker", status: "capability-only", qualifiedModelId: null },
    { id: "reviewer", status: "experimental", qualifiedModelId: null },
  ],
});
