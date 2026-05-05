import type { NextFunction, Request, RequestHandler, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseForUser } from "../lib/supabase";

export type AuthContext = {
  userId: string;
  sessionId?: string | null;
  stripeCustomerId?: string | null;
  role?: string | null;
  clerkToken?: string | null;
};

const AUTH_ERROR = { error: "Unauthorized" } as const;
const FORBIDDEN_ERROR = { error: "Forbidden" } as const;

/**
 * Returns the authenticated request context populated by auth middlewares.
 *
 * @param res Express response carrying request-scoped locals.
 * @returns The normalized authenticated user context.
 * @throws When the route forgot to run one of the auth middlewares first.
 */
export function getAuthContext(res: Response): AuthContext {
  const auth = res.locals.auth as AuthContext | undefined;
  if (!auth?.userId) {
    throw new Error("Auth context is missing. Did you forget requireAuth()?");
  }
  return auth;
}

/**
 * Requires a valid Clerk session and stores the normalized identity in
 * `res.locals.auth` so handlers do not call `getAuth(req)` independently.
 */
export function requireAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json(AUTH_ERROR);
    }

    res.locals.auth = {
      ...(res.locals.auth || {}),
      userId: auth.userId,
      sessionId: auth.sessionId || null,
    } satisfies AuthContext;

    return next();
  };
}

/**
 * Extracts a Clerk bearer token from the incoming request.
 *
 * Why this helper matters:
 * - We keep token parsing in one place to avoid subtle header parsing bugs.
 * - RLS-backed Supabase calls require a valid JWT in `Authorization`.
 *
 * @param req Express request containing authentication headers.
 * @returns The raw JWT token (without `Bearer`) when present, otherwise null.
 */
export function extractClerkToken(req: Request): string | null {
  const authorizationHeader = String(req.headers.authorization || "").trim();
  if (!authorizationHeader) return null;

  const matches = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!matches?.[1]) return null;

  const token = String(matches[1] || "").trim();
  return token || null;
}

/**
 * Requires an authenticated Clerk session and prepares request-scoped Supabase
 * access that enforces RLS.
 *
 * Side effects:
 * - Populates `res.locals.auth` with normalized identity + token.
 * - Populates `res.locals.supabase` with a user-scoped Supabase client.
 *
 * This middleware intentionally builds the Supabase client once per request so
 * downstream handlers can reuse it without recreating clients repeatedly.
 */
export function requireAuthWithSupabase(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json(AUTH_ERROR);
    }

    const clerkToken = extractClerkToken(req);
    if (!clerkToken) {
      return res.status(401).json({ error: "Missing Clerk bearer token" });
    }

    let supabase: SupabaseClient;
    try {
      supabase = supabaseForUser(clerkToken);
    } catch (error) {
      console.error("requireAuthWithSupabase failed to create Supabase client", {
        userId: auth.userId,
        error,
      });
      return res.status(500).json({ error: "Supabase auth initialization failed" });
    }

    res.locals.auth = {
      ...(res.locals.auth || {}),
      userId: auth.userId,
      sessionId: auth.sessionId || null,
      clerkToken,
    } satisfies AuthContext;
    res.locals.supabase = supabase;

    return next();
  };
}

/**
 * Requires a Clerk session linked to a Stripe customer.
 *
 * This middleware is intentionally reserved for customer-owned resources,
 * because it performs one Clerk API lookup to read the canonical `stripe_id`.
 */
export function requireAuthWithStripe(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json(AUTH_ERROR);
    }

    try {
      const user = await clerkClient.users.getUser(auth.userId);
      const stripeCustomerId = String(
        (user.publicMetadata as Record<string, unknown> | undefined)
          ?.stripe_id || "",
      ).trim();

      if (!stripeCustomerId) {
        return res.status(403).json({ error: "Stripe customer is not linked" });
      }

      res.locals.auth = {
        ...(res.locals.auth || {}),
        userId: auth.userId,
        sessionId: auth.sessionId || null,
        stripeCustomerId,
      } satisfies AuthContext;

      return next();
    } catch (error) {
      console.error("requireAuthWithStripe failed", {
        userId: auth.userId,
        error,
      });
      return res.status(500).json({ error: "Authentication lookup failed" });
    }
  };
}

/**
 * Requires the current Clerk user to be an administrator.
 *
 * Private metadata wins over public metadata so privileged roles can be moved
 * away from client-readable metadata without changing route code later.
 */
export function requireAdmin(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json(AUTH_ERROR);
    }

    try {
      const user = await clerkClient.users.getUser(auth.userId);
      const publicRole = String(
        (user.publicMetadata as Record<string, unknown> | undefined)?.role ||
          "",
      )
        .trim()
        .toLowerCase();
      const privateRole = String(
        (user.privateMetadata as Record<string, unknown> | undefined)?.role ||
          "",
      )
        .trim()
        .toLowerCase();
      const role = privateRole || publicRole;

      if (role !== "admin") {
        return res.status(403).json(FORBIDDEN_ERROR);
      }

      res.locals.auth = {
        ...(res.locals.auth || {}),
        userId: auth.userId,
        sessionId: auth.sessionId || null,
        role,
      } satisfies AuthContext;

      return next();
    } catch (error) {
      console.error("requireAdmin failed", { userId: auth.userId, error });
      return res.status(500).json({ error: "Admin lookup failed" });
    }
  };
}
