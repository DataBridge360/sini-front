import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "./env";

export type SupabaseService = {
  readonly admin: SupabaseClient;
  readonly publicAuth: SupabaseClient;
};

let instance: SupabaseService | null = null;

// Un solo par de clientes por instancia de la función (se reusa entre requests).
export function getSupabase(): SupabaseService {
  if (!instance) {
    const env = serverEnv();
    instance = {
      admin: createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      }),
      publicAuth: createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    };
  }
  return instance;
}
