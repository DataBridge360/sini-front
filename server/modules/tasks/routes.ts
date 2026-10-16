import "server-only";
import { getSupabase } from "@/server/core/supabase";
import { route, type Route } from "@/server/core/router";
import {
  createTaskSchema,
  listTasksQuerySchema,
  taskStatsQuerySchema,
  updateTaskSchema,
  updateTaskStatusSchema
} from "./schemas";
import { TasksService } from "./service";

// POST /tasks/:id/messages (actividad multipart) no está acá a propósito: en
// Vercel el body de una request está limitado a 4.5 MB, así que los adjuntos
// suben directo a Storage con URLs firmadas (spec S5).

const service = () => new TasksService(getSupabase());

export const tasksRoutes: Route[] = [
  // Sin `archived`: tablero (activas, sin paginar — el WIP de un equipo está
  // acotado). Con `archived=1`: finalizadas, paginadas, que crecen sin techo.
  route({
    method: "GET",
    path: "/tasks",
    access: "organization",
    handler: ({ organization, query }) => {
      const parsed = query(listTasksQuerySchema);
      return parsed.archived
        ? service().findArchivedPage(organization.id, parsed)
        : service().findBoard(organization.id);
    }
  }),

  // Antes de `:id` a propósito: se resuelve por orden de declaración y "stats"
  // no es un UUID.
  route({
    method: "GET",
    path: "/tasks/stats",
    access: "organization",
    handler: ({ organization, query }) => service().findStats(organization.id, query(taskStatsQuerySchema))
  }),

  route({
    method: "GET",
    path: "/tasks/:id",
    access: "organization",
    handler: ({ organization, uuidParam }) => service().findOne(organization.id, uuidParam("id"))
  }),

  route({
    method: "POST",
    path: "/tasks",
    access: "organization",
    handler: async ({ organization, user, body }) =>
      service().create(organization.id, user.id, await body(createTaskSchema))
  }),

  route({
    method: "PATCH",
    path: "/tasks/:id",
    access: "organization",
    handler: async ({ organization, uuidParam, body }) => {
      const id = uuidParam("id");
      return service().update(organization.id, id, await body(updateTaskSchema));
    }
  }),

  route({
    method: "PATCH",
    path: "/tasks/:id/status",
    access: "organization",
    handler: async ({ organization, user, uuidParam, body }) => {
      const id = uuidParam("id");
      return service().updateStatus(organization, id, user.id, await body(updateTaskStatusSchema));
    }
  }),

  route({
    method: "DELETE",
    path: "/tasks/:id",
    access: "organization",
    handler: ({ organization, user, uuidParam }) =>
      service().delete(organization, uuidParam("id"), user.id)
  }),

  route({
    method: "DELETE",
    path: "/tasks/:id/messages/:messageId",
    access: "organization",
    handler: ({ organization, user, uuidParam }) => {
      const id = uuidParam("id");
      const messageId = uuidParam("messageId");
      return service().deleteMessage(organization, id, messageId, user.id);
    }
  }),

  route({
    method: "DELETE",
    path: "/tasks/:id/attachments/:attachmentId",
    access: "organization",
    handler: ({ organization, user, uuidParam }) => {
      const id = uuidParam("id");
      const attachmentId = uuidParam("attachmentId");
      return service().deleteAttachment(organization, id, attachmentId, user.id);
    }
  })
];
