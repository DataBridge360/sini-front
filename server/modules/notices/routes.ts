import "server-only";
import { getSupabase } from "@/server/core/supabase";
import { route, type Route } from "@/server/core/router";
import { createNoticeNoteSchema, listNoticesQuerySchema, payNoticeSchema } from "./schemas";
import { NoticesService } from "./service";

const service = () => new NoticesService(getSupabase());

export const noticesRoutes: Route[] = [
  route({
    method: "GET",
    path: "/notices",
    access: "organization",
    handler: async ({ organization, query, setHeader }) => {
      const { data, nextCursor } = await service().findAll(
        organization.id,
        query(listNoticesQuerySchema)
      );
      if (nextCursor) {
        setHeader("X-Next-Cursor", nextCursor);
      }
      return data;
    }
  }),
  route({
    method: "PATCH",
    path: "/notices/:id/notified",
    access: "organization",
    handler: ({ organization, user, params }) =>
      service().markNotified(organization.id, params.id as string, user.id)
  }),
  route({
    method: "PATCH",
    path: "/notices/:id/pay",
    access: "organization",
    handler: async ({ organization, user, params, body }) =>
      service().pay(organization.id, params.id as string, user.id, await body(payNoticeSchema))
  }),
  route({
    method: "PATCH",
    path: "/notices/:id/revert",
    access: "organization",
    handler: ({ organization, user, params }) =>
      service().revert(organization.id, params.id as string, user.id)
  }),
  route({
    method: "POST",
    path: "/notices/:id/notes",
    access: "organization",
    handler: async ({ organization, user, params, body }) =>
      service().addNote(organization.id, params.id as string, user.id, await body(createNoticeNoteSchema))
  }),
  route({
    method: "DELETE",
    path: "/notices/:id/notes/:noteId",
    access: "organization",
    handler: ({ organization, user, params }) =>
      service().deleteNote(organization.id, params.id as string, params.noteId as string, user.id)
  })
];
