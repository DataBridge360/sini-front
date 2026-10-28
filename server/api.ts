import "server-only";
import { authenticate, resolveOrganization } from "./core/context";
import { MemoryRateLimiter } from "./core/rate-limit";
import { createApiHandler } from "./core/router";
import { getSupabase } from "./core/supabase";
import { apiRoutes } from "./routes";

export const API_BASE_PATH = "/api/v1";

export const handleApiRequest = createApiHandler(apiRoutes, {
  basePath: API_BASE_PATH,
  authenticate: (headers) => authenticate(headers, getSupabase()),
  resolveOrganization: (headers, user) => resolveOrganization(headers, user, getSupabase()),
  rateLimiter: new MemoryRateLimiter()
});
