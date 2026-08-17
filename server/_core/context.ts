import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { SessionUser } from "../localAuth";
import { getSessionUser } from "../localAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: SessionUser | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const user = await getSessionUser(opts.req);

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
