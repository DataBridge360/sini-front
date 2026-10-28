import "server-only";
import { getSupabase } from "@/server/core/supabase";
import { route, type Route } from "@/server/core/router";
import {
  createPolicySchema,
  listPoliciesQuerySchema,
  searchPoliciesQuerySchema,
  updatePolicySchema
} from "./schemas";
import { PoliciesService } from "./service";

const service = () => new PoliciesService(getSupabase());

export const policiesRoutes: Route[] = [
  route({
    method: "GET",
    path: "/policies",
    access: "organization",
    handler: async ({ organization, query, setHeader }) => {
      const parsed = query(listPoliciesQuerySchema);
      // Modo paginado (PAGINADO.md): { items, total, page, pageSize }.
      if (parsed.page || parsed.pageSize) {
        return service().findPage(organization.id, parsed);
      }

      const { data, nextCursor } = await service().findAll(organization.id, parsed);
      if (nextCursor) {
        setHeader("X-Next-Cursor", nextCursor);
      }
      return data;
    }
  }),
  route({
    method: "GET",
    path: "/policies/search",
    access: "organization",
    handler: ({ organization, query }) => {
      const parsed = query(searchPoliciesQuerySchema);
      return service().search(organization.id, parsed.q ?? null, parsed.limit ?? 20);
    }
  }),
  route({
    method: "GET",
    path: "/policies/:id/notices",
    access: "organization",
    handler: ({ organization, uuidParam }) => service().findNotices(organization.id, uuidParam("id"))
  }),
  route({
    method: "POST",
    path: "/policies",
    access: "organization",
    handler: async ({ organization, user, body }) =>
      service().create(organization.id, user.id, await body(createPolicySchema))
  }),
  route({
    method: "PATCH",
    path: "/policies/:id",
    access: "organization",
    handler: async ({ organization, uuidParam, body }) =>
      service().update(organization.id, uuidParam("id"), await body(updatePolicySchema))
  }),
  route({
    method: "DELETE",
    path: "/policies/:id",
    access: "organization",
    handler: ({ organization, uuidParam }) => service().remove(organization.id, uuidParam("id"))
  })
];
