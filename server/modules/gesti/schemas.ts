import { z } from "zod";
import { GESTI_UPLOAD_MIME_TYPES, MAX_GESTI_FILES_PER_MESSAGE, MAX_GESTI_MESSAGE_CHARS } from "@/lib/gesti-contract";

// Bodies de las rutas de Gesti y esquemas de entrada de las herramientas del
// modelo. Todo lo que escribe el modelo se valida igual que lo que escribe el
// navegador: con topes.

export const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    pinned: z.boolean().optional()
  })
  .refine((value) => value.title !== undefined || value.pinned !== undefined, {
    message: "Nothing to update"
  });

export const signUploadsSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(255),
        size: z.number().int().min(0),
        contentType: z.string().max(255).default("")
      })
    )
    .min(1)
    .max(MAX_GESTI_FILES_PER_MESSAGE)
});

export const confirmUploadsSchema = z.object({
  uploads: z
    .array(
      z.object({
        path: z.string().min(1).max(512),
        name: z.string().max(255)
      })
    )
    .min(1)
    .max(MAX_GESTI_FILES_PER_MESSAGE)
});

export const chatSchema = z
  .object({
    conversationId: z.string().uuid().nullable(),
    message: z.string().trim().max(MAX_GESTI_MESSAGE_CHARS),
    fileIds: z.array(z.string().uuid()).max(MAX_GESTI_FILES_PER_MESSAGE).default([])
  })
  .refine((value) => value.message.length > 0 || value.fileIds.length > 0, {
    message: "Write a message or attach a file"
  });

export type ChatDto = z.infer<typeof chatSchema>;
export type UpdateConversationDto = z.infer<typeof updateConversationSchema>;
export type SignUploadsDto = z.infer<typeof signUploadsSchema>;
export type ConfirmUploadsDto = z.infer<typeof confirmUploadsSchema>;

export const UPLOAD_MIME_SET: ReadonlySet<string> = new Set(GESTI_UPLOAD_MIME_TYPES);

/** JSON Schema para el `input_schema` de una herramienta, sin la clave `$schema`. */
export function toolInputSchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return { ...json, type: "object" as const };
}

// Entradas de las herramientas de Sonnet (show_chart y create_document usan los
// esquemas compartidos chartSpecSchema y documentSpecSchema directamente).

export const consultarCarteraInput = z.object({
  pregunta: z.string().trim().min(1).max(1000)
});

export const readDocumentInput = z.object({
  file_id: z.string().uuid(),
  pregunta: z.string().trim().min(1).max(1000)
});

export const editDocumentInput = z.object({
  file_id: z.string().uuid(),
  instrucciones: z.string().trim().min(1).max(4000),
  formato: z.enum(["docx", "pdf", "xlsx"]).optional()
});
