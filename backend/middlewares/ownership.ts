import type { NextFunction, Request, RequestHandler, Response } from "express";
import { clerkClient } from "@clerk/express";
import { createClient } from "@supabase/supabase-js";
import { getAuthContext } from "./requireAuth";

export type StoreOwnershipRecord = {
  id: number;
  slug: string;
  name?: string | null;
  clerk_id?: string | null;
  owner_email?: string | null;
};

type StoreLookupSource = "params" | "query" | "body";
type StoreLookupColumn = "id" | "slug";

export type RequireStoreOwnerOptions = {
  source: StoreLookupSource;
  key: string;
  column?: StoreLookupColumn;
  allowOwnerEmailFallback?: boolean;
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase environment variables for ownership middleware");
}

const supabase = createClient(supabaseUrl, supabaseKey);

function getRequestValue(
  req: Request,
  source: StoreLookupSource,
  key: string,
): string {
  const container = req[source] as Record<string, unknown> | undefined;
  return String(container?.[key] || "").trim();
}

function getOwnershipCache(res: Response): Map<string, StoreOwnershipRecord> {
  if (!res.locals.storeOwnershipCache) {
    res.locals.storeOwnershipCache = new Map<string, StoreOwnershipRecord>();
  }
  return res.locals.storeOwnershipCache as Map<string, StoreOwnershipRecord>;
}

async function userOwnsStoreByEmail(
  userId: string,
  ownerEmail?: string | null,
): Promise<boolean> {
  const normalizedOwnerEmail = String(ownerEmail || "").trim().toLowerCase();
  if (!normalizedOwnerEmail) return false;

  const user = await clerkClient.users.getUser(userId);
  return (user.emailAddresses || []).some(
    (email) =>
      String(email.emailAddress || "").trim().toLowerCase() ===
      normalizedOwnerEmail,
  );
}

/**
 * Ensures the authenticated Clerk user owns the referenced store.
 *
 * The middleware fetches only ownership columns and caches the result in
 * `res.locals` for this request. This removes duplicate Supabase reads inside
 * handlers without risking stale cross-request authorization data.
 */
export function requireStoreOwner(
  options: RequireStoreOwnerOptions,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    let userId: string;
    try {
      userId = getAuthContext(res).userId;
    } catch {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const column = options.column || "slug";
    const rawValue = getRequestValue(req, options.source, options.key);
    const value =
      column === "id" ? Number(rawValue) : decodeURIComponent(rawValue);

    if (
      (column === "id" &&
        (!Number.isFinite(value) || Number(value) <= 0)) ||
      !String(value).trim()
    ) {
      return res.status(400).json({ error: "Store identifier is required" });
    }

    const cacheKey = `${column}:${String(value)}`;
    const cache = getOwnershipCache(res);

    try {
      let store = cache.get(cacheKey);

      if (!store) {
        const { data, error } = await supabase
          .from("stores")
          .select("id, slug, name, clerk_id, owner_email")
          .eq(column, value)
          .maybeSingle();

        if (error) {
          console.error("requireStoreOwner Supabase lookup failed", {
            column,
            value,
            error,
          });
          return res.status(500).json({ error: "Store lookup failed" });
        }
        if (!data) {
          return res.status(404).json({ error: "Store not found" });
        }

        store = data as StoreOwnershipRecord;
        cache.set(cacheKey, store);
      }

      const ownsByClerkId =
        Boolean(store.clerk_id) && String(store.clerk_id) === userId;
      const ownsByEmail =
        !ownsByClerkId && options.allowOwnerEmailFallback
          ? await userOwnsStoreByEmail(userId, store.owner_email)
          : false;

      if (!ownsByClerkId && !ownsByEmail) {
        return res.status(403).json({ error: "Forbidden" });
      }

      res.locals.store = store;
      return next();
    } catch (error) {
      console.error("requireStoreOwner failed", {
        column,
        value,
        userId,
        error,
      });
      return res.status(500).json({ error: "Ownership check failed" });
    }
  };
}
