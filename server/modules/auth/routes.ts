import "server-only";
import { getSupabase } from "@/server/core/supabase";
import { route, type Route } from "@/server/core/router";
import { loginSchema, refreshSchema } from "./schemas";
import { AuthService } from "./service";

const service = () => new AuthService(getSupabase());

export const authRoutes: Route[] = [
  // Anti fuerza bruta: pocos intentos de login por IP por minuto.
  route({
    method: "POST",
    path: "/auth/login",
    access: "public",
    rateLimit: { limit: 10, ttlMs: 60_000 },
    handler: async ({ body }) => service().login(await body(loginSchema))
  }),
  route({
    method: "POST",
    path: "/auth/refresh",
    access: "public",
    rateLimit: { limit: 30, ttlMs: 60_000 },
    handler: async ({ body }) => service().refresh(await body(refreshSchema))
  })
];
