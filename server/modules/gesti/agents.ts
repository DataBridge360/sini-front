import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { AppSource, DocumentFormat } from "@/lib/gesti-parts";
import type { SupabaseService } from "@/server/core/supabase";
import { MODEL_FAST, type GestiAnthropic } from "./config";
import { DATA_TOOL_DEFINITIONS, runDataTool } from "./data-tools";
import { documentSpecSchema, type DocumentSpec } from "./documents/spec";
import {
  DATA_AGENT_PROMPT,
  DOCUMENT_EDITOR_PROMPT,
  DOCUMENT_READER_PROMPT,
  TITLE_PROMPT
} from "./prompts";
import { toolInputSchema } from "./schemas";
import { callUsageFromSdk, type UsageRecorder } from "./usage";

// Sub-agentes de Haiku 5.5: leen la cartera, leen o editan documentos largos y
// titulan los chats. Cada llamada registra su costo en gesti_usage.

export type AgentContext = {
  client: GestiAnthropic;
  supabase: SupabaseService;
  organizationId: string;
  usage: UsageRecorder;
  now: () => Date;
  signal?: AbortSignal;
};

/** Error con un mensaje seguro para mostrarle al modelo (y, vía el modelo, a la persona). */
export class ToolFailure extends Error {}

export const MAX_DATA_ROUNDS = 6;
export const MAX_SUBAGENT_ANSWER_CHARS = 3000;
/** Un PDF con menos texto que esto se considera escaneado y se lee como PDF/imagen. */
export const SCANNED_PDF_TEXT_CHARS = 200;
/**
 * Tope del texto de un documento que lee o edita Haiku. Haiku 5.5 cobra 5 veces
 * más todo el pedido (salida incluida) si el prompt pasa los 100.000 tokens;
 * 240.000 caracteres son unos 70.000 tokens en español, con margen para el
 * resto del prompt. Un PDF de 36 páginas ronda los 100.000 caracteres.
 */
export const MAX_DOCUMENT_PROMPT_CHARS = 240_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const EPHEMERAL = { type: "ephemeral" as const };

function cappedText(content: Anthropic.ContentBlock[], max = MAX_SUBAGENT_ANSWER_CHARS) {
  const text = content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Haiku 5.5 razona por defecto (esfuerzo medio) y ese razonamiento se cobra y
 * cuenta en max_tokens. Para estas tareas cortas no hace falta: se apaga.
 */
const HAIKU_NO_THINKING = { thinking: { type: "disabled" as const }, output_config: { effort: "low" as const } };

function cachedSystem(prompt: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text: prompt, cache_control: EPHEMERAL }];
}

// ----- Datos de la cartera (solo lectura) -----

export async function runDataAgent(
  context: AgentContext,
  question: string
): Promise<{ text: string; appSources: AppSource[] }> {
  const appSources = new Set<AppSource>();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  for (let round = 0; round < MAX_DATA_ROUNDS; round += 1) {
    const response = await context.client.messages.create(
      {
        model: MODEL_FAST,
        max_tokens: 1500,
        ...HAIKU_NO_THINKING,
        // Caché automático: cada ronda reenvía las anteriores con sus resultados.
        cache_control: EPHEMERAL,
        system: cachedSystem(DATA_AGENT_PROMPT),
        tools: DATA_TOOL_DEFINITIONS,
        messages
      },
      { signal: context.signal }
    );
    await context.usage.record("data", MODEL_FAST, callUsageFromSdk(response.usage));

    const toolUses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      return { text: cappedText(response.content) || "No encontré datos para esa consulta.", appSources: [...appSources] };
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const result = await runDataTool(toolUse.name, toolUse.input, {
        supabase: context.supabase,
        organizationId: context.organizationId,
        now: context.now()
      });
      for (const source of result.appSources) appSources.add(source);
      results.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.output,
        ...(result.isError ? { is_error: true } : {})
      });
    }
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: results });
  }

  return { text: "No pude completar la consulta con los datos disponibles.", appSources: [...appSources] };
}

// ----- Documentos -----

export type AgentFile = {
  name: string;
  mime: string;
  sizeBytes: number;
  text: string | null;
  textTruncated: boolean;
};

function escapeAttribute(value: string) {
  return value.replace(/["<>\r\n]/g, " ");
}

function documentText(file: AgentFile) {
  const text = (file.text ?? "").slice(0, MAX_DOCUMENT_PROMPT_CHARS);
  const note = file.textTruncated || (file.text ?? "").length > text.length ? "\n[El texto se cortó por su extensión.]" : "";
  return `<documento nombre="${escapeAttribute(file.name)}">\n${text}${note}\n</documento>`;
}

/** Haiku lee el archivo (texto extraído, o el PDF/imagen mismos si no hay texto) y responde. */
export async function readDocument(
  context: AgentContext,
  file: AgentFile,
  question: string,
  loadBytes: () => Promise<Uint8Array>
): Promise<string> {
  const isPdf = file.mime === "application/pdf";
  const isImage = file.mime.startsWith("image/");
  const text = file.text ?? "";
  const content: Anthropic.ContentBlockParam[] = [];

  if (isImage) {
    if (file.sizeBytes > MAX_IMAGE_BYTES) throw new ToolFailure("La imagen es demasiado grande para leerla.");
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: file.mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        data: Buffer.from(await loadBytes()).toString("base64")
      }
    });
  } else if (isPdf && text.trim().length < SCANNED_PDF_TEXT_CHARS) {
    if (file.sizeBytes > MAX_PDF_BYTES) throw new ToolFailure("El PDF es escaneado y demasiado grande para leerlo.");
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: Buffer.from(await loadBytes()).toString("base64") }
    });
  } else if (text.trim().length > 0) {
    content.push({ type: "text", text: documentText(file) });
  } else {
    throw new ToolFailure("El archivo no tiene texto legible.");
  }
  content.push({ type: "text", text: `Pregunta: ${question}` });

  const response = await context.client.messages.create(
    {
      model: MODEL_FAST,
      max_tokens: 1500,
      ...HAIKU_NO_THINKING,
      // El documento queda en caché: otra pregunta sobre el mismo archivo en los
      // próximos 5 minutos lo lee a 0,1x.
      cache_control: EPHEMERAL,
      system: cachedSystem(DOCUMENT_READER_PROMPT),
      messages: [{ role: "user", content }]
    },
    { signal: context.signal }
  );
  await context.usage.record("document", MODEL_FAST, callUsageFromSdk(response.usage));
  return cappedText(response.content) || "No encontré esa información en el documento.";
}

export const GENERATE_DOCUMENT_TOOL = "generar_documento";

export function formatFromMime(mime: string): DocumentFormat | null {
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("wordprocessingml")) return "docx";
  if (mime.includes("spreadsheetml")) return "xlsx";
  return null;
}

/** Haiku devuelve el documento completo ya editado como DocumentSpec (herramienta forzada). */
export async function editDocument(
  context: AgentContext,
  file: AgentFile,
  instructions: string,
  format: DocumentFormat | undefined
): Promise<DocumentSpec> {
  if (!file.text || file.text.trim().length === 0) {
    throw new ToolFailure("No pude leer el texto de ese archivo, así que no puedo editarlo.");
  }
  const target = format ?? formatFromMime(file.mime) ?? "docx";
  const original = file.name.replace(/\.[^.]+$/, "");

  const response = await context.client.messages.create(
    {
      model: MODEL_FAST,
      max_tokens: 16_000,
      ...HAIKU_NO_THINKING,
      cache_control: EPHEMERAL,
      system: cachedSystem(DOCUMENT_EDITOR_PROMPT),
      tools: [
        {
          name: GENERATE_DOCUMENT_TOOL,
          description: "Devuelve el documento completo ya modificado.",
          input_schema: toolInputSchema(documentSpecSchema)
        }
      ],
      tool_choice: { type: "tool", name: GENERATE_DOCUMENT_TOOL },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: documentText(file) },
            {
              type: "text",
              text: `Instrucciones de cambio: ${instructions}\n\nFormato de salida: ${target}. Nombre de archivo sugerido (sin extensión): ${original}-editado.`
            }
          ]
        }
      ]
    },
    { signal: context.signal }
  );
  await context.usage.record("document", MODEL_FAST, callUsageFromSdk(response.usage));

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === GENERATE_DOCUMENT_TOOL
  );
  const parsed = documentSpecSchema.safeParse(toolUse?.input);
  if (!parsed.success) {
    throw new ToolFailure(
      response.stop_reason === "max_tokens"
        ? "El documento es demasiado largo para editarlo de una vez."
        : "No pude armar el archivo editado."
    );
  }
  return parsed.data;
}

// ----- Título -----

/** Título provisorio (sin llamar al modelo): las primeras palabras del mensaje. */
export function fallbackTitle(message: string): string {
  const words = message.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).slice(0, 6).join(" ");
  const title = words.length > 60 ? `${words.slice(0, 59).trimEnd()}…` : words;
  return title || "Nueva conversación";
}

export function cleanTitle(raw: string): string | null {
  const firstLine = raw.split("\n")[0] ?? "";
  const title = firstLine
    .replace(/^["'“”«»\s]+|["'“”«»\s]+$/g, "")
    .replace(/[.。]+$/, "")
    .trim()
    .slice(0, 80);
  return title.length > 0 ? title : null;
}

/** Haiku titula el chat a partir del primer mensaje; null si no pudo. */
export async function generateTitle(context: AgentContext, firstMessage: string): Promise<string | null> {
  const response = await context.client.messages.create(
    {
      model: MODEL_FAST,
      max_tokens: 30,
      ...HAIKU_NO_THINKING,
      system: TITLE_PROMPT,
      messages: [{ role: "user", content: firstMessage.slice(0, 1000) }]
    },
    { signal: context.signal }
  );
  await context.usage.record("title", MODEL_FAST, callUsageFromSdk(response.usage));
  return cleanTitle(cappedText(response.content, 200));
}

