import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  AI_FUNCTIONS,
  AIFunctionId,
  createProvider,
  deleteProvider,
  getAssignments,
  listProviders,
  setAssignment,
  testProvider,
  toPublic,
  updateProvider,
} from "../services/aiRegistry";
import { listPrompts, setPrompt, resetPrompt, PROMPT_DEFAULTS } from "../services/promptRegistry";

const providerTypeEnum = z.enum(["claude", "openai", "gemini"]);

const functionIdEnum = z.enum(["market_analysis", "experiment_advisor"] as [AIFunctionId, ...AIFunctionId[]]);

export const aiIntegrationRouter = router({

  // List all providers (keys redacted)
  listProviders: protectedProcedure.query(async () => {
    try {
      const providers = await listProviders();
      return providers.map(toPublic);
    } catch (e) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(e) });
    }
  }),

  // Add a new provider
  addProvider: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(100),
      type: providerTypeEnum,
      apiKey: z.string().min(1).max(4096),
      baseUrl: z.string().url().max(500).nullable().optional(),
      model: z.string().trim().min(1).max(200),
      enabled: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const id = await createProvider({
          name: input.name,
          type: input.type,
          apiKey: input.apiKey,
          baseUrl: input.baseUrl ?? null,
          model: input.model,
          enabled: input.enabled,
        });
        return { id };
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(e) });
      }
    }),

  // Update provider (sending empty apiKey means "don't change the key")
  updateProvider: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().trim().min(1).max(100).optional(),
      type: providerTypeEnum.optional(),
      apiKey: z.string().max(4096).optional(),
      baseUrl: z.string().url().max(500).nullable().optional(),
      model: z.string().trim().min(1).max(200).optional(),
      enabled: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      try {
        await updateProvider(id, data);
        return { ok: true };
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(e) });
      }
    }),

  // Delete provider
  deleteProvider: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        await deleteProvider(input.id);
        return { ok: true };
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(e) });
      }
    }),

  // Test provider connectivity
  testProvider: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        return await testProvider(input.id);
      } catch (e) {
        return { ok: false, latency_ms: 0, message: String(e) };
      }
    }),

  // Get current assignments {functionId: providerIds[]}
  getAssignments: protectedProcedure.query(async () => {
    try {
      const assignments = await getAssignments();
      return { assignments, functions: AI_FUNCTIONS };
    } catch (e) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(e) });
    }
  }),

  // Set which providers are assigned to a function
  setAssignment: protectedProcedure
    .input(z.object({
      functionId: functionIdEnum,
      providerIds: z.array(z.number().int().positive()),
    }))
    .mutation(async ({ input }) => {
      try {
        await setAssignment(input.functionId, input.providerIds);
        return { ok: true };
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(e) });
      }
    }),

  // ─── Prompt management ───────────────────────────────────────────────────

  listPrompts: protectedProcedure.query(async () => {
    try {
      return listPrompts();
    } catch (e) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(e) });
    }
  }),

  updatePrompt: protectedProcedure
    .input(z.object({
      id: z.string().refine(id => id in PROMPT_DEFAULTS, { message: "Prompt desconhecido" }),
      content: z.string().min(10).max(20000),
    }))
    .mutation(async ({ input }) => {
      try {
        await setPrompt(input.id, input.content);
        return { ok: true };
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(e) });
      }
    }),

  resetPrompt: protectedProcedure
    .input(z.object({
      id: z.string().refine(id => id in PROMPT_DEFAULTS, { message: "Prompt desconhecido" }),
    }))
    .mutation(async ({ input }) => {
      try {
        await resetPrompt(input.id);
        return { ok: true };
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(e) });
      }
    }),
});
