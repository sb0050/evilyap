import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const supabaseServiceRoleKey = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
).trim();
const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is required to initialize Supabase clients");
}

if (!supabaseServiceRoleKey) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is required to initialize supabaseAdmin",
  );
}

if (!supabaseAnonKey) {
  throw new Error("SUPABASE_ANON_KEY is required to initialize supabaseForUser");
}

/**
 * Supabase client with service-role privileges.
 *
 * This client bypasses Row Level Security and must stay restricted to trusted
 * server flows such as webhooks, cron jobs, and explicit admin operations.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);

/**
 * Builds a Supabase client that enforces Row Level Security policies.
 *
 * Why this factory exists:
 * - Supabase evaluates RLS from the JWT contained in `Authorization`.
 * - A Clerk JWT (via third-party auth) carries the user identity in `sub`.
 * - Using the anon key ensures requests do not bypass policies.
 *
 * @param token Clerk JWT token extracted from the incoming request.
 * @returns Supabase client scoped to this user token and constrained by RLS.
 * @throws If the token is empty, because RLS cannot be evaluated safely.
 */
export function supabaseForUser(token: string): SupabaseClient {
  const bearerToken = String(token || "").trim();
  if (!bearerToken) {
    throw new Error("Clerk token is required to initialize supabaseForUser");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
