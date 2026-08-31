export type EvidenceState = "qualified" | "provisional" | "unverified" | string;

export interface ModelEvidence {
  status?: EvidenceState;
  state?: EvidenceState;
  label?: string;
  summary?: string;
  sampleSize?: number;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface CatalogModel {
  id: string;
  label?: string;
  displayName?: string;
  provider?: string;
  free?:
    | boolean
    | {
        verified?: boolean;
        inputUsdPerMillion?: number;
        outputUsdPerMillion?: number;
        verifiedAt?: string;
        [key: string]: unknown;
      };
  status?: string | boolean;
  available?: boolean;
  provisional?: boolean;
  enabledByDefault?: boolean;
  enabled?: boolean;
  modalities?:
    | string[]
    | {
        input?: string[];
        output?: string[];
        [key: string]: unknown;
      };
  inputModalities?: string[];
  capabilities?: string[];
  access?: string | string[];
  canOrchestrate?: boolean;
  roles?: string[] | Record<string, number | boolean | undefined>;
  evidence?: ModelEvidence | EvidenceState | null;
  [key: string]: unknown;
}

export interface RoleAssignments {
  orchestrator?: string;
  "code-worker"?: string;
  "vision-worker"?: string;
  codeWorker?: string;
  visionWorker?: string;
  reviewer?: string;
  [key: string]: string | undefined;
}

export interface ModelControl {
  enabled: boolean;
  available?: boolean;
}

export interface RouterSettings {
  schemaVersion?: number;
  costPreference: "free-first" | "paid-first";
  costPolicy: "free-only" | "known-cost";
  freeOnly?: boolean;
  roleAssignments: RoleAssignments;
  modelControls: Record<string, ModelControl>;
  maxDelegationDepth: number;
  maxFallbacksPerAssignment: number;
  makeRouterDefault: boolean;
  [key: string]: unknown;
}

export interface SystemState {
  localOnly?: boolean;
  freeOnly?: boolean;
  costPreference?: "free-first" | "paid-first";
  costPolicy?: "free-only" | "known-cost";
  opencode?: {
    installed?: boolean;
    version?: string;
  };
  openCode?: {
    installed?: boolean;
    version?: string;
  };
  catalog?: {
    source?: string;
    lastRefreshed?: string;
    stale?: boolean;
    complete?: boolean;
    warning?: string | null;
  };
}

export interface ModelControlState {
  schemaVersion?: number;
  system?: SystemState;
  catalog: CatalogModel[];
  settings: RouterSettings;
}

export interface RouteResponse {
  route?: string;
  primary?: string | { id?: string; model?: string; reason?: string };
  workers?: Array<string | { id?: string; model?: string; role?: string; reason?: string }>;
  /** @deprecated Older route shapes used this for an unimplemented model fallback. */
  fallback?: string | string[] | null;
  assignments?: RouteAssignment[];
  policy?: {
    /** Legacy persisted name for the maximum review-driven repair passes. */
    maxFallbacksPerAssignment?: number;
    [key: string]: unknown;
  };
  reasons?: string[];
  integrationWarning?: string | null;
  [key: string]: unknown;
}

export interface RouteAssignment {
  role?: string;
  modelId?: string;
  /** Legacy route-contract field. The planner always returns null. */
  fallbackModelId?: string | null;
  /** Legacy route-contract field. The planner always returns zero. */
  fallbackCount?: number;
  selection?: string;
  mayDelegate?: boolean;
  [key: string]: unknown;
}

export type RouteModality = "text" | "image" | "audio" | "video" | "pdf";

export interface OpenCodeConfigResponse {
  config?: unknown;
  text?: string;
  warnings?: string[];
}

export interface OpenCodeIntegrationStatus {
  schemaVersion?: number;
  installed: boolean;
  managed: boolean;
  healthy: boolean;
  requiresAttention: boolean;
  configExists?: boolean;
  configPath?: string;
  code?: string;
  message: string;
  changed?: boolean;
  backupCreated?: boolean;
  defaultAgent?: string | null;
  defaultAgentManaged?: boolean;
  defaultAgentPreserved?: boolean;
}

export interface OpenCodeConfigActionResponse {
  action: "open" | "reveal";
  configPath: string;
  opened: true;
}

export interface BenchmarkRoleSummary {
  id?: string;
  role?: string;
  modelId?: string;
  model?: string;
  qualifiedModelId?: string | null;
  status?: string;
  score?: number;
  passRate?: number;
  runs?: number;
  [key: string]: unknown;
}

export interface BenchmarkSummary {
  status?: string;
  evidenceStatus?: string;
  provisional?: boolean;
  generatedAt?: string;
  lastRun?: string;
  methodology?: string;
  sampleSize?: number;
  headline?: string;
  explanation?: string;
  roles?: BenchmarkRoleSummary[];
  caveats?: string[];
  [key: string]: unknown;
}

export interface RuntimeQualificationResult {
  id: string;
  modelId: string;
  status: "passed" | "failed";
  evidenceType: "runtime-access-only";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  openCodeVersion: string | null;
  providerRequestAttempted: boolean | null;
  externalPluginsDisabled: true;
  isolatedWorkingDirectory: true;
  promptKind: "fixed-synthetic-sentinel";
  responseMatched: boolean;
  exitCode: number | null;
  failure: { code: string; message: string } | null;
}

export interface RuntimeQualificationSummary {
  schemaVersion: 1;
  automatic: false;
  action: "manual-provider-request";
  evidenceType: "runtime-access-only";
  benchmarkPromotion: false;
  running: boolean;
  warning: string | null;
  updatedAt: string | null;
  results: RuntimeQualificationResult[];
  boundaries: string[];
}

export type UsageWindow = "7d" | "30d" | "90d" | "all";

export interface UsageTokens {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface ModelUsage {
  id: string;
  providerId: string;
  modelId: string;
  sessions: number;
  messages: number;
  costUsd: number;
  tokens: UsageTokens;
}

export interface OpenCodeUsage {
  schemaVersion: 1;
  source: "opencode-local-accounting";
  accounting: "provider-reported";
  window: UsageWindow;
  windowDays: number | null;
  generatedAt: string;
  totals: {
    sessions: number;
    messages: number;
    costUsd: number;
    tokens: UsageTokens;
  };
  byModel: ModelUsage[];
  diagnostics: {
    modelsSeen: number;
    modelsReturned: number;
    modelsTruncated: boolean;
    unattributedMessages: number;
    zeroTokenMessages: number;
    earliestMessageAt: string | null;
    latestMessageAt: string | null;
  };
  caveats: string[];
}
