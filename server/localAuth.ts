import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { SignJWT, jwtVerify } from "jose";
import type { Request, Response } from "express";
import type { DashboardUser } from "../drizzle/schema";
import {
  createDashboardUser,
  getAnyDashboardUser,
  getDashboardUserByUsername,
  touchDashboardUserSignIn,
} from "./db";

const scrypt = promisify(scryptCallback);
export const LOCAL_SESSION_COOKIE = "dashboard_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export type SessionUser = Pick<DashboardUser, "id" | "username" | "role">;

function jwtSecret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters");
  }
  return new TextEncoder().encode(value);
}

function cookieOptions(req: Request) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const secure = req.protocol === "https" || forwardedProto === "https";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS * 1000,
  };
}

function parseCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  return header.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && timingSafeEqual(expectedBuffer, actual);
}

export async function createSessionToken(user: SessionUser) {
  return new SignJWT({ username: user.username, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(jwtSecret());
}

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = parseCookie(req.headers.cookie, LOCAL_SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    const id = Number(payload.sub);
    const username = payload.username;
    const role = payload.role;
    if (!Number.isInteger(id) || typeof username !== "string" || (role !== "admin" && role !== "operator")) {
      return null;
    }
    return { id, username, role };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, req: Request, token: string) {
  res.cookie(LOCAL_SESSION_COOKIE, token, cookieOptions(req));
}

export function clearSessionCookie(res: Response, req: Request) {
  res.clearCookie(LOCAL_SESSION_COOKIE, { ...cookieOptions(req), maxAge: -1 });
}

export async function bootstrapDashboardAdmin() {
  const existing = await getAnyDashboardUser();
  if (existing) return { created: false, user: existing };
  const password = process.env.DASHBOARD_ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("DASHBOARD_ADMIN_PASSWORD must have at least 12 characters before first login");
  }
  const username = process.env.DASHBOARD_ADMIN_USERNAME?.trim() || "admin";
  const passwordHash = await hashPassword(password);
  await createDashboardUser({ username, passwordHash, role: "admin" });
  const user = await getDashboardUserByUsername(username);
  if (!user) throw new Error("Admin bootstrap did not persist the user");
  return { created: true, user };
}

export async function loginDashboardUser(username: string, password: string) {
  await bootstrapDashboardAdmin();
  const user = await getDashboardUserByUsername(username);
  if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
  await touchDashboardUserSignIn(user.id);
  return user;
}
