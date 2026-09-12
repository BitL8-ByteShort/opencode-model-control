// Historic labels use only the captured observation, never today's connection metadata.
export function attributedUsageGroups(observations = []) {
  const groups = new Map();
  const connections = new Map();
  for (const observation of observations) {
    const identity = observation.connectionId;
    if (identity && !connections.has(identity)) connections.set(identity, connections.size + 1);
    const key = JSON.stringify([identity, observation.bindingRevision, observation.billingKind, observation.billingSource, observation.recordedCost?.currency ?? null]);
    if (!groups.has(key)) groups.set(key, {key, connectionLabel: identity ? `Captured connection ${connections.get(identity)}` : "Connection not attributed", billingKind: observation.billingKind, billingSource: observation.billingSource, currency: observation.recordedCost?.currency ?? null, messages: 0, cost: 0, tokens: {input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0}});
    const group = groups.get(key);
    group.messages++;
    group.cost = group.cost === null || observation.recordedCost?.amount == null ? null : group.cost + observation.recordedCost.amount;
    for (const field of Object.keys(group.tokens)) group.tokens[field] = group.tokens[field] === null || observation.tokens?.[field] == null ? null : group.tokens[field] + observation.tokens[field];
  }
  return [...groups.values()];
}

export function attributionCoverageWarning(coverage) {
  if (coverage?.lastFailureCode === "ATTRIBUTION_READ_FAILED") return "Captured usage could not be read. Historical accounting remains separate; no zero usage was substituted.";
  if (coverage?.lastFailureCode === "ATTRIBUTION_WRITE_FAILED" || coverage?.failedWriteCount > 0) return "Some captured usage could not be saved. This window has incomplete attribution.";
  return coverage?.partial ? "Capture is incomplete: pending records or retention gaps affect this window." : "";
}
