import { z } from "zod";
const timestamp = z.iso.datetime().nullable();
const ratePath =
  /^(?:(?:context:\d+|context_over_200k|mode:[a-z0-9_-]{1,80})\.)?(?:input|output|reasoning|cache_read|cache_write|input_audio|output_audio)$/i;
export const apiIdentitySchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9@~][a-z0-9._:+/@~-]*$/i)
    .nullable(),
  npm: z
    .string()
    .regex(/^[@a-z0-9][@a-z0-9/._-]*$/i)
    .nullable(),
  url: z.string().url().nullable(),
});
export const pricingSchema = z.object({
  class: z.enum(["free", "paid", "unknown"]),
  source: z.enum(["https://models.dev/api.json", "reported-paid"]).nullable(),
  rates: z.record(
    z.string().regex(ratePath),
    z.number().finite().nonnegative(),
  ),
  reasons: z.array(z.string().regex(/^[a-z-]+$/)),
  digest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  fetchedAt: timestamp,
  expiresAt: timestamp,
});
const tri = z.boolean().nullable();
const modalities = z.object({
  text: tri,
  image: tri,
  audio: tri,
  video: tri,
  pdf: tri,
});
const limit = z.number().int().positive().nullable();
export const capabilitySchema = z.object({
  source: z.enum(["opencode", "models.dev", "legacy"]),
  observedAt: timestamp,
  toolCall: tri,
  reasoning: tri,
  structuredOutput: tri,
  temperature: tri,
  attachment: tri,
  interleaved: z
    .union([
      z.boolean(),
      z.object({
        field: z.enum([
          "reasoning",
          "reasoning_content",
          "reasoning_text",
          "reasoning_details",
        ]),
      }),
    ])
    .nullable(),
  reasoningOptions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("toggle") }),
        z.object({
          type: z.literal("effort"),
          values: z.array(
            z
              .enum([
                "none",
                "minimal",
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
                "default",
              ])
              .nullable(),
          ),
        }),
        z.object({
          type: z.literal("budget_tokens"),
          min: z.number().min(-1).optional(),
          max: z.number().nonnegative().optional(),
        }),
      ]),
    )
    .nullable(),
  input: modalities,
  output: modalities,
  contextWindowTokens: limit,
  inputLimitTokens: limit,
  outputLimitTokens: limit,
});
export const capabilityDetailsSchema = z.object({
  effective: capabilitySchema,
  supplemental: capabilitySchema.nullable(),
});
export const publicSnapshotSchema = z.object({
  source: z.literal("https://models.dev/api.json"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  fetchedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  models: z.record(
    z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9@~][a-z0-9._:+/@~-]*$/i),
    z.object({
      api: apiIdentitySchema,
      pricing: pricingSchema.pick({ class: true, rates: true, reasons: true }),
      capabilities: capabilitySchema,
    }),
  ),
});
