import "server-only";
import { z } from "zod";

// Variables SOLO de servidor. Ninguna lleva prefijo NEXT_PUBLIC_: la service
// role saltea RLS y nunca puede llegar al bundle del navegador.
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  BASE_DOMAIN: z.string().min(1).default("sinipro.com")
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | null = null;

// Lazy: se valida en el primer request y no durante `next build`, que importa
// los route handlers sin tener los secretos de runtime.
export function serverEnv(): ServerEnv {
  cached ??= envSchema.parse(process.env);
  return cached;
}
