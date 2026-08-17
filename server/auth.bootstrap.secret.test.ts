import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import { LOCAL_SESSION_COOKIE } from "./localAuth";

describe("local admin bootstrap", () => {
  it("bootstraps and accepts the configured admin password", async () => {
    const password = process.env.DASHBOARD_ADMIN_PASSWORD ?? "";
    expect(password.length).toBeGreaterThanOrEqual(12);

    const cookies: string[] = [];
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        cookie: (name: string, value: string) => {
          if (name === LOCAL_SESSION_COOKIE) cookies.push(value);
        },
      } as TrpcContext["res"],
    };

    const result = await appRouter.createCaller(ctx).auth.login({
      username: process.env.DASHBOARD_ADMIN_USERNAME?.trim() || "admin",
      password,
    });

    expect(result).toMatchObject({ username: process.env.DASHBOARD_ADMIN_USERNAME?.trim() || "admin", role: "admin" });
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toBeTruthy();
  });
});
