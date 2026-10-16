import "server-only";
import { getSupabase } from "@/server/core/supabase";
import { route, type Route } from "@/server/core/router";
import { changePasswordSchema, updateProfileSchema } from "./schemas";
import { ProfileService } from "./service";

const service = () => new ProfileService(getSupabase());

export const profileRoutes: Route[] = [
  route({
    method: "GET",
    path: "/profile",
    access: "user",
    handler: ({ user }) => service().getProfile(user)
  }),
  // El avatar viaja como data URL en el JSON: este endpoint admite hasta 1 MB.
  route({
    method: "PATCH",
    path: "/profile",
    access: "user",
    bodyLimitBytes: 1024 * 1024,
    handler: async ({ user, body }) => service().updateProfile(user, await body(updateProfileSchema))
  }),
  route({
    method: "PATCH",
    path: "/profile/password",
    access: "user",
    // En Nest el json({ limit: "1mb" }) se montaba sobre todo /profile/*.
    bodyLimitBytes: 1024 * 1024,
    handler: async ({ user, body }) => service().changePassword(user, await body(changePasswordSchema))
  })
];
