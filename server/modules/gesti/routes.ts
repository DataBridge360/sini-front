import "server-only";
import { ForbiddenException } from "@/server/core/http-errors";
import { getSupabase } from "@/server/core/supabase";
import { route, type Route } from "@/server/core/router";
import { GestiChatService } from "./chat";
import { getAnthropic, monthlyBudgetUsd } from "./config";
import { ConversationsService } from "./conversations";
import { GestiFilesService } from "./files";
import {
  chatSchema,
  confirmUploadsSchema,
  signUploadsSchema,
  updateConversationSchema
} from "./schemas";
import { usageSummary } from "./usage";

// Gesti (asistente con IA). Todas las rutas son `organization`: hace falta una
// membresía activa. Los chats y archivos son privados de quien los creó.
// A propósito NO hay ninguna ruta DELETE: los chats no se borran.

const CHAT_BODY_LIMIT_BYTES = 64 * 1024;

const conversations = () => new ConversationsService(getSupabase());
const files = () => new GestiFilesService(getSupabase());
const chat = () => new GestiChatService({ supabase: getSupabase(), getClient: getAnthropic });

export const gestiRoutes: Route[] = [
  route({
    method: "GET",
    path: "/gesti/conversations",
    access: "organization",
    handler: ({ organization, user }) => conversations().list(organization.id, user.id)
  }),

  route({
    method: "GET",
    path: "/gesti/conversations/:id",
    access: "organization",
    handler: ({ organization, user, uuidParam }) =>
      conversations().findOne(organization.id, user.id, uuidParam("id"))
  }),

  route({
    method: "PATCH",
    path: "/gesti/conversations/:id",
    access: "organization",
    handler: async ({ organization, user, uuidParam, body }) => {
      const id = uuidParam("id");
      return conversations().update(organization.id, user.id, id, await body(updateConversationSchema));
    }
  }),

  route({
    method: "POST",
    path: "/gesti/files/uploads",
    access: "organization",
    rateLimit: { limit: 30, ttlMs: 60_000 },
    handler: async ({ organization, user, body }) =>
      files().createUploads(organization.id, user.id, await body(signUploadsSchema))
  }),

  route({
    method: "POST",
    path: "/gesti/files",
    access: "organization",
    rateLimit: { limit: 30, ttlMs: 60_000 },
    handler: async ({ organization, user, body }) =>
      files().confirmUploads(organization.id, user.id, await body(confirmUploadsSchema))
  }),

  route({
    method: "GET",
    path: "/gesti/files/:id/url",
    access: "organization",
    handler: ({ organization, user, uuidParam }) => files().getUrl(organization.id, user.id, uuidParam("id"))
  }),

  // Respuesta: NDJSON (un GestiStreamEvent por línea). El handler devuelve una
  // Response, que el router pasa sin tocar.
  route({
    method: "POST",
    path: "/gesti/chat",
    access: "organization",
    bodyLimitBytes: CHAT_BODY_LIMIT_BYTES,
    rateLimit: { limit: 20, ttlMs: 60_000 },
    handler: async ({ organization, user, request, body }) =>
      chat().start({ organization, user, payload: await body(chatSchema), signal: request.signal })
  }),

  // Consumo del mes: solo el productor (o un admin de plataforma).
  route({
    method: "GET",
    path: "/gesti/usage",
    access: "organization",
    handler: ({ organization }) => {
      if (organization.role !== "productor" && organization.role !== "platform_admin") {
        throw new ForbiddenException("Only the productor can see Gesti usage");
      }
      return usageSummary(getSupabase(), organization.id, monthlyBudgetUsd(), new Date());
    }
  })
];
