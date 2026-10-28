import "server-only";
import { timingSafeEqual } from "node:crypto";
import { Logger } from "@/server/core/logger";
import { getSupabase, type SupabaseService } from "@/server/core/supabase";
import { ATTACHMENT_BUCKET } from "./service";

// Barrido de adjuntos huérfanos: objetos del bucket que ninguna fila de
// task_attachments referencia. Quedan si alguien cierra la pestaña entre la
// subida directa a Storage y la confirmación de la actividad (si falla una
// subida o la confirmación, el navegador ya los descarta en el momento).
//
// Solo se borra lo que tiene más de 3 horas: la URL firmada de subida dura 2,
// así que una subida en curso nunca entra en el barrido.
export const ORPHAN_MIN_AGE_MS = 3 * 60 * 60 * 1000;

const LIST_PAGE_SIZE = 100;
const logger = new Logger("TaskAttachmentsCleanup");

type StorageEntry = { name: string; id: string | null; created_at: string | null };

async function listAll(supabase: SupabaseService, prefix: string): Promise<StorageEntry[]> {
  const entries: StorageEntry[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await supabase.admin.storage
      .from(ATTACHMENT_BUCKET)
      .list(prefix, { limit: LIST_PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) {
      throw new Error(`No se pudo listar ${prefix || "/"}: ${error.message}`);
    }
    entries.push(...((data ?? []) as StorageEntry[]));
    if (!data || data.length < LIST_PAGE_SIZE) {
      return entries;
    }
  }
}

// Estructura del bucket: <organization_id>/<task_id>/<archivo>. Las carpetas
// llegan con id null; los archivos, con id y created_at.
export async function sweepOrphanedTaskAttachments(supabase: SupabaseService, now = Date.now()) {
  const cutoff = now - ORPHAN_MIN_AGE_MS;
  let scanned = 0;
  let removed = 0;

  for (const organization of await listAll(supabase, "")) {
    if (organization.id !== null) continue;
    for (const task of await listAll(supabase, organization.name)) {
      if (task.id !== null) continue;
      const folder = `${organization.name}/${task.name}`;
      const files = (await listAll(supabase, folder)).filter((entry) => entry.id !== null);
      scanned += files.length;

      const candidates = files
        .filter((file) => file.created_at && Date.parse(file.created_at) < cutoff)
        .map((file) => `${folder}/${file.name}`);
      if (candidates.length === 0) continue;

      // Si no se puede saber qué está vinculado, no se borra nada.
      const { data: linkedRows, error } = await supabase.admin
        .from("task_attachments")
        .select("storage_path")
        .in("storage_path", candidates);
      if (error) {
        logger.error(`No se pudo consultar task_attachments para ${folder}`, error.message);
        throw new Error("No se pudo verificar qué adjuntos están vinculados.");
      }

      const linked = new Set((linkedRows ?? []).map((row: { storage_path: string }) => row.storage_path));
      const orphans = candidates.filter((path) => !linked.has(path));
      if (orphans.length === 0) continue;

      const { error: removeError } = await supabase.admin.storage.from(ATTACHMENT_BUCKET).remove(orphans);
      if (removeError) {
        logger.warn(`No se pudieron borrar huérfanos de ${folder} (${removeError.message})`);
        continue;
      }
      removed += orphans.length;
    }
  }

  return { scanned, removed };
}

function sameSecret(received: string, expected: string) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Endpoint del Cron de Vercel: Vercel manda `Authorization: Bearer <CRON_SECRET>`
// cuando la variable está configurada. Sin secreto configurado no corre.
export async function handleTaskAttachmentsCleanup(
  request: Request,
  deps: { secret: string | undefined; supabase?: SupabaseService; now?: number } = {
    secret: process.env.CRON_SECRET
  }
): Promise<Response> {
  if (!deps.secret) {
    return Response.json({ message: "CRON_SECRET no está configurado" }, { status: 503 });
  }
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${deps.secret}`)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sweepOrphanedTaskAttachments(deps.supabase ?? getSupabase(), deps.now);
    logger.log(`Barrido de huérfanos: ${result.removed} de ${result.scanned} objetos`);
    return Response.json(result);
  } catch (error) {
    logger.error("Falló el barrido de huérfanos", error);
    return Response.json({ message: "No se pudo completar el barrido" }, { status: 500 });
  }
}
