import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

describe("telemetry routes", () => {
  it("requires a local dashboard session before contacting the bot", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);

    await expect(caller.telemetry.health()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.logs.list({ limit: 5 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
