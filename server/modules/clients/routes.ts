import "server-only";
import { getSupabase } from "@/server/core/supabase";
import { route, type Route } from "@/server/core/router";
import {
  createClientSchema,
  listClientsQuerySchema,
  searchClientsQuerySchema,
  updateClientSchema
} from "./schemas";
import { ClientsService } from "./service";

const service = () => new ClientsService(getSupabase());

export const clientsRoutes: Route[] = [
  route({
    method: "GET",
    path: "/clients",
    access: "organization",
    handler: async ({ organization, query, setHeader }) => {
      const parsed = query(listClientsQuerySchema);
      // Modo paginado (PAGINADO.md): { items, total, page, pageSize }.
      if (parsed.page || parsed.pageSize) {
        return service().findPage(organization.id, parsed);
      }

      const { data, nextCursor } = await service().findAll(organization.id, parsed);
      if (nextCursor) {
        setHeader("X-Next-Cursor", nextCursor);
      }
      // Body shape stays a plain array for backward compatibility.
      return data;
    }
  }),
  route({
    method: "GET",
    path: "/clients/search",
    access: "organization",
    handler: ({ organization, query }) => {
      const parsed = query(searchClientsQuerySchema);
      return service().search(organization.id, parsed.q ?? null, parsed.limit ?? 20);
    }
  }),
  route({
    method: "GET",
    path: "/clients/localities",
    access: "organization",
    handler: ({ organization }) => service().localities(organization.id)
  }),
  route({
    method: "POST",
    path: "/clients",
    access: "organization",
    handler: async ({ organization, body }) =>
      service().create(organization.id, await body(createClientSchema))
  }),
  route({
    method: "PATCH",
    path: "/clients/:id",
    access: "organization",
    handler: async ({ organization, params, body }) =>
      service().update(organization.id, params.id as string, await body(updateClientSchema))
  }),
  route({
    method: "DELETE",
    path: "/clients/:id",
    access: "organization",
    handler: ({ organization, params }) => service().remove(organization.id, params.id as string)
  })
];
