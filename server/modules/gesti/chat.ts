import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { GestiStreamEvent, StoredGestiMessage } from "@/lib/gesti-contract";
import {
  chartSpecSchema,
  MAX_REPLY_CHARS,
  messagePartsSchema,
  questionSchema,
  type AppSource,
  type ChartSpec,
  type GestiFileRef,
  type GestiQuestion,
  type MessageParts,
  type WebSource
} from "@/lib/gesti-parts";
import type { AuthUser, OrganizationContext } from "@/server/core/context";
import { BadRequestException, NotFoundException } from "@/server/core/http-errors";
import { Logger } from "@/server/core/logger";
import type { SupabaseService } from "@/server/core/supabase";
import {
  editDocument,
  fallbackTitle,
  generateTitle,
  readDocument,
  runDataAgent,
  SCANNED_PDF_TEXT_CHARS,
  ToolFailure,
  type AgentContext,
  type AgentFile
} from "./agents";
import { monthlyBudgetUsd, MODEL_MAIN, type GestiAnthropic } from "./config";
import { ConversationsService } from "./conversations";
import { renderDocument } from "./documents/render";
import { documentSpecSchema, type DocumentSpec } from "./documents/spec";
import { fileRefFromRow, GestiFilesService, type GestiFileRow } from "./files";
import {
  budgetExhaustedReply,
  ERROR_REPLY,
  MAIN_SYSTEM_PROMPT,
  NOT_CONFIGURED_REPLY,
  STATUS_LABEL,
  todayBlock
} from "./prompts";
import {
  consultarCarteraInput,
  editDocumentInput,
  readDocumentInput,
  toolInputSchema,
  type ChatDto
} from "./schemas";
import { callUsageFromSdk, monthSpendUsd, nextMonthLabel, UsageRecorder } from "./usage";

const logger = new Logger("GestiChat");

export const HISTORY_MESSAGES = 12;
export const MAX_TOOL_ROUNDS = 6;
export const MAX_CHARTS_PER_REPLY = 4;
export const MAX_DOCUMENTS_PER_REPLY = 4;
export const MAX_WEB_SOURCES = 20;
const MAX_TOKENS = 4096;
const INLINE_DOCUMENT_CHARS = 15_000;
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_STORED_CONTENT_CHARS = 20_000;
const EMPTY_REPLY = "No tengo una respuesta para eso. ¿Me lo podés contar de otra forma?";
const TOOL_ERROR = "No pude completar esa acción.";

const EPHEMERAL = { type: "ephemeral" as const };

// ----- Herramientas de Sonnet -----

const CLIENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "consultar_cartera",
    description:
      "Consulta los datos reales de la cartera del productor (asegurados, pólizas, avisos de pago, compañías, tareas). Pasá una pregunta clara y completa en español; devuelve un resumen con los hechos encontrados.",
    input_schema: toolInputSchema(consultarCarteraInput)
  },
  {
    name: "read_document",
    description:
      "Lee un archivo adjunto (PDF, Word, Excel, CSV, TXT o imagen) identificado por su file_id y responde una pregunta puntual sobre su contenido. Usalo cuando el archivo no llegó completo dentro de <documento>.",
    input_schema: toolInputSchema(readDocumentInput)
  },
  {
    name: "edit_document",
    description:
      "Edita un archivo existente (file_id) según las instrucciones y genera una versión nueva en docx, pdf o xlsx (por defecto, el mismo formato). Se conserva el contenido, no el diseño original.",
    input_schema: toolInputSchema(editDocumentInput)
  },
  {
    name: "create_document",
    description:
      "Crea un archivo nuevo para descargar: Word (docx) o PDF con bloques (títulos, párrafos, listas, tablas) o Excel (xlsx) con hojas. Solo estos formatos.",
    input_schema: toolInputSchema(documentSpecSchema)
  },
  {
    name: "show_chart",
    description:
      "Muestra un gráfico interactivo (bar, line, area, pie) o una tabla al usuario. Máximo 4 por respuesta. Úsalo solo cuando ayude a entender datos reales.",
    input_schema: toolInputSchema(chartSpecSchema)
  },
  {
    name: "ask_user",
    description:
      "Le hace una pregunta al usuario con 2 a 4 opciones cuando el pedido es realmente ambiguo o falta un dato que cambia la respuesta. Después de llamarla, no escribas nada más: la respuesta llega en el próximo mensaje.",
    input_schema: toolInputSchema(questionSchema),
    cache_control: EPHEMERAL
  }
];

const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: "web_search_20250305",
  name: "web_search",
  // Cada búsqueda cuesta USD 0,01 y sus resultados suman miles de tokens de entrada.
  max_uses: 2,
  user_location: { type: "approximate", country: "AR", timezone: "America/Argentina/Buenos_Aires" }
};

const SONNET_TOOLS: Anthropic.ToolUnion[] = [WEB_SEARCH_TOOL, ...CLIENT_TOOLS];

// ----- Historial -----

const CITATION_MARKER = /\s?\[\[\d+\]\]/g;

/** El texto de una respuesta sin las marcas [[n]] de las citas. */
export function stripCitationMarkers(content: string) {
  return content.replace(CITATION_MARKER, "");
}

function attachmentLine(file: GestiFileRef, pages: number | null | undefined) {
  const pageText = pages ? ` · ${pages} ${pages === 1 ? "página" : "páginas"}` : "";
  return `[Adjunto: ${file.name} · file_id: ${file.fileId}${pageText}]`;
}

/**
 * Reconstruye el historial para el modelo desde lo guardado: solo texto, sin
 * bloques de herramientas. Los gráficos, preguntas y archivos pasan a notas de
 * una línea; las marcas [[n]] se quitan; las respuestas de aviso (presupuesto,
 * error) no se envían. Siempre arranca con un mensaje del usuario y alterna roles.
 */
export function buildHistory(
  stored: StoredGestiMessage[],
  pagesByFileId: ReadonlyMap<string, number | null> = new Map()
): Anthropic.MessageParam[] {
  const rendered: Array<{ role: "user" | "assistant"; text: string }> = [];

  for (const message of stored) {
    const lines: string[] = [];
    if (message.role === "user") {
      if (message.content.trim()) lines.push(message.content.trim());
      for (const file of message.parts.attachments ?? []) {
        lines.push(attachmentLine(file, pagesByFileId.get(file.fileId)));
      }
    } else {
      if (message.parts.notice) continue;
      const text = stripCitationMarkers(message.content).trim();
      if (text) lines.push(text);
      for (const chart of message.parts.charts ?? []) lines.push(`[Gráfico mostrado: ${chart.title}]`);
      if (message.parts.question) lines.push(`[Pregunta hecha al usuario: ${message.parts.question.question}]`);
      for (const file of message.parts.documents ?? []) {
        lines.push(`[Archivo generado: ${file.name} · file_id: ${file.fileId}]`);
      }
    }
    if (lines.length === 0) continue;

    const text = lines.join("\n");
    const last = rendered[rendered.length - 1];
    if (last && last.role === message.role) {
      last.text = `${last.text}\n\n${text}`;
    } else {
      rendered.push({ role: message.role, text });
    }
  }

  while (rendered[0]?.role === "assistant") rendered.shift();
  return rendered.map((item) => ({ role: item.role, content: item.text }));
}

function escapeAttribute(value: string) {
  return value.replace(/["<>\r\n]/g, " ");
}

// ----- Servicio -----

export type ChatDependencies = {
  supabase: SupabaseService;
  /** null si no hay API key configurada. */
  getClient: () => GestiAnthropic | null;
  now?: () => Date;
  budgetUsd?: () => number;
  /** Tope del turno completo; los tests lo achican. */
  turnDeadlineMs?: number;
};

/**
 * Tope de un turno entero (todas las rondas del modelo y las herramientas). La
 * ruta tiene maxDuration 300 s: si Vercel corta la función antes, la respuesta
 * no llega a guardarse. Así se corta antes y se guarda lo escrito.
 */
export const TURN_DEADLINE_MS = 240_000;
export const TURN_TIMEOUT_NOTE = "La respuesta se cortó porque tardó demasiado. Probá con una consulta más acotada.";
const TURN_TIMEOUT = Symbol("turn-timeout");

/**
 * Anthropic rechaza el pedido porque se alcanzó el límite de gasto de la cuenta
 * (platform.claude.com/docs/en/api/rate-limits#spend-limits): 400 "You have
 * reached your specified … API usage limits", 429 con error_code
 * enforced_spend_limit_reached, o sin crédito ("credit balance is too low").
 * Un rate limit común (429 sin ese código) no cuenta.
 */
export function isSpendLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  const body = (error as { error?: { error?: { message?: unknown; details?: { error_code?: unknown } } } }).error?.error;
  const message = typeof body?.message === "string" ? body.message : error instanceof Error ? error.message : "";
  if (status === 429) return body?.details?.error_code === "enforced_spend_limit_reached";
  if (status === 400) return /reached your specified (workspace )?API usage limits|credit balance is too low/i.test(message);
  return false;
}

type TurnInput = {
  organization: OrganizationContext;
  user: AuthUser;
  payload: ChatDto;
  /** request.signal: se aborta cuando el navegador corta la conexión. */
  signal?: AbortSignal;
};

type TurnContext = {
  organization: OrganizationContext;
  user: AuthUser;
  conversationId: string;
  isNew: boolean;
  message: string;
  uploaded: GestiFileRow[];
  history: StoredGestiMessage[];
  userMessage: StoredGestiMessage;
  signal: AbortSignal;
};

type TurnState = {
  content: string;
  /** Caracteres visibles (sin las marcas [[n]]). */
  visible: number;
  capped: boolean;
  status: string | null;
  sources: WebSource[];
  appSources: AppSource[];
  charts: ChartSpec[];
  documents: GestiFileRef[];
  question: GestiQuestion | null;
};

type Emit = (event: GestiStreamEvent) => void;

type ToolOutcome = { content: string; isError?: boolean };

export class GestiChatService {
  private readonly conversations: ConversationsService;
  private readonly files: GestiFilesService;
  private readonly now: () => Date;

  constructor(private readonly deps: ChatDependencies) {
    this.conversations = new ConversationsService(deps.supabase);
    this.files = new GestiFilesService(deps.supabase);
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Valida, guarda el mensaje del usuario y devuelve el stream NDJSON. Lo que
   * falla antes de empezar (chat ajeno, archivo ajeno) sale como error HTTP.
   */
  async start(input: TurnInput): Promise<Response> {
    const { organization, user, payload } = input;

    const existing = payload.conversationId
      ? await this.conversations.requireOwned(organization.id, user.id, payload.conversationId)
      : null;

    // Los archivos tienen que ser del usuario y no venir de otra conversación.
    const fileIds = [...new Set(payload.fileIds)];
    const uploaded = await this.files.findOwned(organization.id, user.id, fileIds, { withText: true });
    if (uploaded.length !== fileIds.length) {
      throw new NotFoundException("File not found");
    }
    if (uploaded.some((file) => file.conversation_id !== null && file.conversation_id !== existing?.id)) {
      throw new BadRequestException("Ese archivo ya se usó en otra conversación.");
    }

    const conversation =
      existing ??
      (await this.conversations.create(
        organization.id,
        user.id,
        fallbackTitle(payload.message || uploaded[0]?.name || "")
      ));
    const isNew = existing === null;

    const history = isNew
      ? []
      : await this.conversations.recentMessages(organization.id, conversation.id, HISTORY_MESSAGES);

    await this.files.attachToConversation(organization.id, user.id, fileIds, conversation.id);
    const userMessage = await this.conversations.addMessage(organization.id, conversation.id, "user", payload.message, {
      attachments: uploaded.map(fileRefFromRow)
    });

    const abort = new AbortController();
    input.signal?.addEventListener("abort", () => abort.abort(), { once: true });
    const deadline = setTimeout(() => abort.abort(TURN_TIMEOUT), this.deps.turnDeadlineMs ?? TURN_DEADLINE_MS);
    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const emit: Emit = (event) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            closed = true;
          }
        };
        const turn: TurnContext = {
          organization,
          user,
          conversationId: conversation.id,
          isNew,
          message: payload.message,
          uploaded,
          history,
          userMessage,
          signal: abort.signal
        };
        void this.runTurn(turn, emit)
          .catch((error: unknown) => {
            logger.error("turn failed", error);
            emit({ type: "error", message: ERROR_REPLY });
          })
          .finally(() => {
            clearTimeout(deadline);
            if (closed) return;
            closed = true;
            try {
              controller.close();
            } catch {
              // ya cerrado por el cliente
            }
          });
      },
      cancel: () => {
        closed = true;
        abort.abort();
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no"
      }
    });
  }

  private async runTurn(turn: TurnContext, emit: Emit) {
    const { organization, user, conversationId, signal } = turn;
    emit({ type: "meta", conversationId, userMessage: turn.userMessage });

    const usage = new UsageRecorder(this.deps.supabase, {
      organizationId: organization.id,
      userId: user.id,
      conversationId
    });
    const state: TurnState = {
      content: "",
      visible: 0,
      capped: false,
      status: null,
      sources: [],
      appSources: [],
      charts: [],
      documents: [],
      question: null
    };

    let notice: NonNullable<MessageParts["notice"]> | null = null;
    let aborted = false;
    let titleTask: Promise<void> = Promise.resolve();

    try {
      const client = this.deps.getClient();
      if (!client) {
        notice = "not_configured";
        this.writeText(state, emit, NOT_CONFIGURED_REPLY);
      } else {
        const now = this.now();
        const spent = await monthSpendUsd(this.deps.supabase, now);
        const budget = (this.deps.budgetUsd ?? monthlyBudgetUsd)();
        if (spent >= budget) {
          notice = "budget_exhausted";
          this.writeText(state, emit, budgetExhaustedReply(nextMonthLabel(now)));
        } else {
          const agent: AgentContext = {
            client,
            supabase: this.deps.supabase,
            organizationId: organization.id,
            usage,
            now: this.now,
            signal
          };
          if (turn.isNew && turn.message) {
            titleTask = this.titleConversation(agent, turn, emit);
          }
          await this.runModel({ client, agent, turn, state, emit });
        }
      }
    } catch (error) {
      if (signal.aborted && signal.reason === TURN_TIMEOUT) {
        this.writeText(state, emit, `${state.content.trim() ? "\n\n" : ""}${TURN_TIMEOUT_NOTE}`, false);
      } else if (signal.aborted) {
        aborted = true;
      } else if (isSpendLimitError(error)) {
        // El límite de gasto de la API key (o la falta de crédito) llegó antes que
        // nuestro cálculo: para el usuario es lo mismo, presupuesto agotado.
        logger.warn("gesti.runTurn: Anthropic spend limit reached");
        notice = "budget_exhausted";
        state.content = "";
        state.visible = 0;
        state.capped = false;
        this.writeText(state, emit, budgetExhaustedReply(nextMonthLabel(this.now())));
      } else {
        logger.error("gesti.runTurn", error);
        notice = "error";
        state.content = "";
        state.visible = 0;
        state.capped = false;
        this.writeText(state, emit, ERROR_REPLY);
      }
    }

    await titleTask.catch(() => undefined);

    const parts = this.buildParts(state, notice);
    const content = state.content.trim().slice(0, MAX_STORED_CONTENT_CHARS);
    if (aborted && !content && Object.keys(parts).length === 0) return;

    // Una respuesta sin texto ni partes (el modelo no dijo nada) igual necesita algo que mostrar.
    const finalContent = content || Object.keys(parts).length > 0 ? content : EMPTY_REPLY;

    try {
      const stored = await this.conversations.addMessage(organization.id, conversationId, "assistant", finalContent, parts);
      if (!aborted) emit({ type: "done", message: stored });
    } catch (error) {
      logger.error("gesti.runTurn.store", error);
      emit({ type: "error", message: ERROR_REPLY });
    }
  }

  private async titleConversation(agent: AgentContext, turn: TurnContext, emit: Emit) {
    try {
      const title = await generateTitle(agent, turn.message);
      if (!title) return;
      await this.conversations.setTitle(turn.organization.id, turn.user.id, turn.conversationId, title);
      emit({ type: "title", title });
    } catch (error) {
      // El título provisorio (primeras palabras) queda.
      if (!agent.signal?.aborted) logger.warn(`title: ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  // ----- Turno con Sonnet -----

  private async runModel(run: {
    client: GestiAnthropic;
    agent: AgentContext;
    turn: TurnContext;
    state: TurnState;
    emit: Emit;
  }) {
    const { client, agent, turn, state, emit } = run;
    const { organization, user, conversationId, signal } = turn;

    const pages = await this.pagesByFileId(organization.id, user.id, turn.history);
    const messages = buildHistory(turn.history, pages);
    this.pushUser(messages, await this.currentUserBlocks(turn.message, turn.uploaded));

    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: MAIN_SYSTEM_PROMPT, cache_control: EPHEMERAL },
      { type: "text", text: todayBlock(this.now()) }
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      if (signal.aborted) return;

      const message = await this.streamRound(client, { system, messages }, agent, state, emit);
      if (state.capped) return;

      const assistantContent = message.content
        .filter((block) => block.type !== "text" || block.text.length > 0) as unknown as Anthropic.ContentBlockParam[];

      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: assistantContent });
        continue;
      }
      if (message.stop_reason !== "tool_use") return;

      const toolUses = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
      if (toolUses.length === 0) return;

      // ask_user corta el turno: no hay tool_result, la respuesta llega en el próximo mensaje.
      const ask = toolUses.find((toolUse) => toolUse.name === "ask_user");
      const parsedQuestion = ask ? questionSchema.safeParse(ask.input) : null;
      if (parsedQuestion?.success) {
        state.question = parsedQuestion.data;
        this.setStatus(state, emit, null);
        emit({ type: "question", question: parsedQuestion.data });
        return;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const outcome =
          toolUse.name === "ask_user"
            ? { content: "La pregunta no es válida: necesita una pregunta y entre 2 y 4 opciones.", isError: true }
            : await this.executeTool(toolUse, { agent, turn, state, emit, conversationId });
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {})
        });
      }
      messages.push({ role: "assistant", content: assistantContent }, { role: "user", content: results });
    }
  }

  /** Una llamada a Sonnet en streaming: reenvía texto, fuentes y marcas de cita. */
  private async streamRound(
    client: GestiAnthropic,
    request: { system: Anthropic.TextBlockParam[]; messages: Anthropic.MessageParam[] },
    agent: AgentContext,
    state: TurnState,
    emit: Emit
  ): Promise<Anthropic.Message> {
    const stream = client.messages.stream(
      {
        model: MODEL_MAIN,
        max_tokens: MAX_TOKENS,
        // Sonnet 5.5 razona por defecto con esfuerzo alto, y el razonamiento se cobra
        // como salida. between_tools es lo mínimo: sin razonar antes de responder,
        // solo notas breves entre herramientas. El esfuerzo no puede cambiar a
        // mitad de conversación con between_tools: queda fijo.
        thinking: { type: "between_tools" },
        output_config: { effort: "medium" },
        // Caché automático: el historial y los resultados de herramientas se
        // reenvían en cada ronda; así se cobran a 0,05x en vez de entero.
        cache_control: EPHEMERAL,
        system: request.system,
        tools: SONNET_TOOLS,
        messages: request.messages
      },
      { signal: agent.signal }
    );

    const blocks = new Map<number, Set<number>>();
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        blocks.set(event.index, new Set());
        if (event.content_block.type === "server_tool_use" && event.content_block.name === "web_search") {
          this.setStatus(state, emit, STATUS_LABEL.search);
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          this.writeText(state, emit, delta.text);
        } else if (delta.type === "citations_delta" && delta.citation.type === "web_search_result_location") {
          const position = this.addSource(state, emit, delta.citation.url, delta.citation.title);
          if (position !== null) blocks.get(event.index)?.add(position);
        }
      } else if (event.type === "content_block_stop") {
        const markers = blocks.get(event.index);
        if (markers && markers.size > 0) {
          const text = [...markers]
            .sort((a, b) => a - b)
            .map((position) => ` [[${position}]]`)
            .join("");
          this.writeText(state, emit, text, false);
        }
      }
    }

    const message = await stream.finalMessage();
    await agent.usage.record("chat", MODEL_MAIN, callUsageFromSdk(message.usage));
    return message;
  }

  // ----- Herramientas -----

  private async executeTool(
    toolUse: Anthropic.ToolUseBlock,
    run: {
      agent: AgentContext;
      turn: TurnContext;
      state: TurnState;
      emit: Emit;
      conversationId: string;
    }
  ): Promise<ToolOutcome> {
    const { agent, turn, state, emit } = run;
    try {
      switch (toolUse.name) {
        case "consultar_cartera": {
          const input = consultarCarteraInput.safeParse(toolUse.input);
          if (!input.success) return invalidInput();
          this.setStatus(state, emit, STATUS_LABEL.portfolio);
          const answer = await runDataAgent(agent, input.data.pregunta);
          const merged = new Set([...state.appSources, ...answer.appSources]);
          if (merged.size !== state.appSources.length) {
            state.appSources = [...merged];
            emit({ type: "app_sources", appSources: state.appSources });
          }
          return { content: answer.text };
        }
        case "read_document": {
          const input = readDocumentInput.safeParse(toolUse.input);
          if (!input.success) return invalidInput();
          this.setStatus(state, emit, STATUS_LABEL.reading);
          const file = await this.resolveFile(turn, input.data.file_id);
          const answer = await readDocument(agent, toAgentFile(file), input.data.pregunta, () => this.files.download(file.path));
          return { content: answer };
        }
        case "edit_document": {
          const input = editDocumentInput.safeParse(toolUse.input);
          if (!input.success) return invalidInput();
          if (state.documents.length >= MAX_DOCUMENTS_PER_REPLY) return tooManyDocuments();
          this.setStatus(state, emit, STATUS_LABEL.editing);
          const file = await this.resolveFile(turn, input.data.file_id);
          const spec = await editDocument(agent, toAgentFile(file), input.data.instrucciones, input.data.formato);
          return await this.storeDocument(spec, turn, state, emit);
        }
        case "create_document": {
          const input = documentSpecSchema.safeParse(toolUse.input);
          if (!input.success) {
            return { content: `El documento no es válido: ${issueSummary(input.error.issues)}. Corregilo y volvé a intentar.`, isError: true };
          }
          if (state.documents.length >= MAX_DOCUMENTS_PER_REPLY) return tooManyDocuments();
          this.setStatus(state, emit, STATUS_LABEL.creating);
          return await this.storeDocument(input.data, turn, state, emit);
        }
        case "show_chart": {
          const input = chartSpecSchema.safeParse(toolUse.input);
          if (!input.success) {
            return { content: `El gráfico no es válido: ${issueSummary(input.error.issues)}. Corregilo y volvé a llamar a show_chart.`, isError: true };
          }
          if (state.charts.length >= MAX_CHARTS_PER_REPLY) {
            return { content: `Ya mostraste ${MAX_CHARTS_PER_REPLY} gráficos en esta respuesta.`, isError: true };
          }
          state.charts.push(input.data);
          emit({ type: "chart", chart: input.data });
          return { content: "Gráfico mostrado al usuario." };
        }
        default:
          return { content: "Herramienta no disponible.", isError: true };
      }
    } catch (error) {
      if (turn.signal.aborted) throw error;
      if (error instanceof ToolFailure) return { content: error.message, isError: true };
      logger.error(`tool ${toolUse.name} failed`, error);
      return { content: TOOL_ERROR, isError: true };
    }
  }

  /** Un archivo solo es usable si es del usuario Y de esta conversación. */
  private async resolveFile(turn: TurnContext, fileId: string): Promise<GestiFileRow> {
    const [file] = await this.files.findOwned(turn.organization.id, turn.user.id, [fileId], { withText: true });
    if (!file || file.conversation_id !== turn.conversationId) {
      throw new ToolFailure("No encontré ese archivo en esta conversación.");
    }
    return file;
  }

  private async storeDocument(
    spec: DocumentSpec,
    turn: TurnContext,
    state: TurnState,
    emit: Emit
  ): Promise<ToolOutcome> {
    const rendered = await renderDocument(spec);
    const file = await this.files.storeGenerated(turn.organization.id, turn.user.id, turn.conversationId, rendered);
    state.documents.push(file);
    emit({ type: "document", file });
    return {
      content: `Archivo generado: ${file.name} · file_id: ${file.fileId}. El usuario ya lo ve para descargar; no incluyas enlaces.`
    };
  }

  // ----- Armado de mensajes -----

  private async pagesByFileId(organizationId: string, userId: string, history: StoredGestiMessage[]) {
    const ids = [
      ...new Set(history.flatMap((message) => (message.parts.attachments ?? []).map((file) => file.fileId)))
    ];
    const rows = await this.files.findOwned(organizationId, userId, ids, { withText: false });
    return new Map(rows.map((row) => [row.id, row.page_count] as const));
  }

  /** El mensaje de esta vuelta: documentos chicos en línea, el resto por referencia, imágenes como bloques. */
  private async currentUserBlocks(message: string, uploaded: GestiFileRow[]): Promise<Anthropic.ContentBlockParam[]> {
    const blocks: Anthropic.ContentBlockParam[] = [];

    for (const file of uploaded) {
      const ref = fileRefFromRow(file);
      const text = file.extracted_text ?? "";
      const isImage = file.mime_type.startsWith("image/");
      const scannedPdf = file.mime_type === "application/pdf" && text.trim().length < SCANNED_PDF_TEXT_CHARS;

      if (isImage && Number(file.size_bytes) <= MAX_INLINE_IMAGE_BYTES) {
        const bytes = await this.files.download(file.path);
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: file.mime_type as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
            data: Buffer.from(bytes).toString("base64")
          }
        });
        blocks.push({ type: "text", text: `[Imagen adjunta: ${file.name} · file_id: ${file.id}]` });
      } else if (!isImage && !scannedPdf && text.trim().length > 0 && text.length <= INLINE_DOCUMENT_CHARS) {
        blocks.push({
          type: "text",
          text: `<documento nombre="${escapeAttribute(file.name)}" file_id="${file.id}">\n${text}\n</documento>`
        });
      } else {
        blocks.push({ type: "text", text: `${attachmentLine(ref, file.page_count)} — para leerlo usá read_document.` });
      }
    }

    blocks.push({ type: "text", text: message || "(Sin mensaje: solo archivos adjuntos.)" });
    return blocks;
  }

  private pushUser(messages: Anthropic.MessageParam[], blocks: Anthropic.ContentBlockParam[]) {
    const last = messages[messages.length - 1];
    if (last && last.role === "user") {
      const previous: Anthropic.ContentBlockParam[] =
        typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
      last.content = [...previous, ...blocks];
    } else {
      messages.push({ role: "user", content: blocks });
    }
  }

  // ----- Estado del turno -----

  private setStatus(state: TurnState, emit: Emit, label: string | null) {
    if (state.status === label) return;
    state.status = label;
    emit({ type: "status", label });
  }

  /**
   * Suma texto a la respuesta y lo reenvía. `counts` es false para las marcas
   * [[n]], que no cuentan para el tope. Pasado el tope no se reenvía nada más y
   * la respuesta termina en "…".
   */
  private writeText(state: TurnState, emit: Emit, text: string, counts = true) {
    if (state.capped || text.length === 0) return;
    if (state.status !== null) this.setStatus(state, emit, null);

    let delta = text;
    if (counts) {
      if (state.visible + text.length > MAX_REPLY_CHARS) {
        delta = `${text.slice(0, Math.max(0, MAX_REPLY_CHARS - 1 - state.visible))}…`;
        state.visible = MAX_REPLY_CHARS;
        state.capped = true;
      } else {
        state.visible += text.length;
      }
    }
    state.content += delta;
    emit({ type: "text", delta });
  }

  /** Número (1-based) de la fuente en `parts.sources`, o null si no se pudo registrar. */
  private addSource(state: TurnState, emit: Emit, url: string, title: string | null): number | null {
    const existing = state.sources.findIndex((source) => source.url === url);
    if (existing >= 0) return existing + 1;
    if (state.sources.length >= MAX_WEB_SOURCES || url.length > 2000) return null;
    try {
      new URL(url);
    } catch {
      return null;
    }
    state.sources.push({ url, title: (title ?? hostnameOf(url)).slice(0, 300) });
    emit({ type: "sources", sources: [...state.sources] });
    return state.sources.length;
  }

  private buildParts(state: TurnState, notice: MessageParts["notice"] | null): MessageParts {
    const parts: MessageParts = {};
    if (state.sources.length > 0) parts.sources = state.sources;
    if (state.appSources.length > 0) parts.appSources = state.appSources;
    if (state.charts.length > 0) parts.charts = state.charts;
    if (state.question) parts.question = state.question;
    if (state.documents.length > 0) parts.documents = state.documents;
    if (notice) parts.notice = notice;
    const checked = messagePartsSchema.safeParse(parts);
    return checked.success ? checked.data : notice ? { notice } : {};
  }
}

function toAgentFile(file: GestiFileRow): AgentFile {
  return {
    name: file.name,
    mime: file.mime_type,
    sizeBytes: Number(file.size_bytes),
    text: file.extracted_text ?? null,
    textTruncated: Boolean(file.text_truncated)
  };
}

function invalidInput(): ToolOutcome {
  return { content: "Los parámetros de la herramienta no son válidos.", isError: true };
}

function tooManyDocuments(): ToolOutcome {
  return { content: `Ya generaste ${MAX_DOCUMENTS_PER_REPLY} archivos en esta respuesta.`, isError: true };
}

function issueSummary(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return issues
    .slice(0, 4)
    .map((issue) => `${issue.path.map(String).join(".") || "entrada"}: ${issue.message}`)
    .join("; ")
    .slice(0, 400);
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
