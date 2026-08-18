import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { systemRouter } from "./_core/systemRouter";
import { bootstrapDashboardAdmin, clearSessionCookie, createSessionToken, loginDashboardUser, setSessionCookie } from "./localAuth";
import { aiRouter } from "./routers/ai";
import { aiIntegrationRouter } from "./routers/aiIntegration";
import { arbRouter } from "./routers/arb";
import { easypanelRouter } from "./routers/easypanel";
import { experimentRouter } from "./routers/experiment";
import { logsRouter } from "./routers/logs";
import { paperRouter } from "./routers/paper";
import { scannerRouter } from "./routers/scanner";
import { telemetryRouter } from "./routers/telemetry";
import { publicProcedure, router } from "./_core/trpc";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    bootstrap: publicProcedure.mutation(async () => {
      const result = await bootstrapDashboardAdmin();
      return { created: result.created, username: result.user.username };
    }),
    login: publicProcedure
      .input(z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(512) }))
      .mutation(async ({ ctx, input }) => {
        const user = await loginDashboardUser(input.username, input.password);
        if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Usuário ou senha inválidos" });
        const token = await createSessionToken(user);
        setSessionCookie(ctx.res, ctx.req, token);
        return { id: user.id, username: user.username, role: user.role };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      clearSessionCookie(ctx.res, ctx.req);
      return {
        success: true,
      } as const;
    }),
  }),
  telemetry: telemetryRouter,
  logs: logsRouter,
  infrastructure: easypanelRouter,
  paper: paperRouter,
  ai: aiRouter,
  scanner: scannerRouter,
  arb: arbRouter,
  experiment: experimentRouter,
  aiIntegration: aiIntegrationRouter,
});

export type AppRouter = typeof appRouter;
