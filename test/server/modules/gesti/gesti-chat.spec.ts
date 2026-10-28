import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStreamLine, type GestiStreamEvent, type StoredGestiMessage } from "@/lib/gesti-contract";
import { MAX_REPLY_CHARS } from "@/lib/gesti-parts";
import type { AuthUser, OrganizationContext } from "@/server/core/context";
import { MemoryRateLimiter } from "@/server/core/rate-limit";
import { createApiHandler } from "@/server/core/router";
import type { SupabaseService } from "@/server/core/supabase";
import { MAX_DOCUMENT_PROMPT_CHARS } from "@/server/modules/gesti/agents";
import { buildHistory, GestiChatService, HISTORY_MESSAGES, TURN_DEADLINE_MS, TURN_TIMEOUT_NOTE } from "@/server/modules/gesti/chat";
import { DATA_AGENT_PROMPT, MAIN_SYSTEM_PROMPT } from "@/server/modules/gesti/prompts";
import { gestiRoutes } from "@/server/modules/gesti/routes";
import { costUsd } from "@/server/modules/gesti/pricing";
import { monthSpendUsd, UsageRecorder } from "@/server/modules/gesti/usage";

// Las dependencias externas son falsas: Supabase vive en memoria (con el
// mismo filtrado por columnas que usa el código) y Anthropic es un guion de
// eventos. Nada sale a la red.

const hoisted = vi.hoisted(() => ({ db: null as unknown, client: null as unknown }));

vi.mock("@/server/core/supabase", () => ({ getSupabase: () => hoisted.db }));
vi.mock("@/server/modules/gesti/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/modules/gesti/config")>();
  return { ...actual, getAnthropic: () => hoisted.client };
});
vi.mock("@/server/modules/gesti/documents/render", () => ({
  renderDocument: vi.fn(async (spec: { filename: string }) => ({
    bytes: new Uint8Array([1, 2, 3, 4]),
    mime: "application/pdf",
    filename: `${spec.filename}.pdf`
  }))
}));
vi.mock("@/server/modules/gesti/documents/extract", () => ({
  UnsupportedDocumentError: class extends Error {},
  detectDocumentKind: () => null,
  extractDocument: vi.fn()
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-10-27T15:00:00Z");

const authUser: AuthUser = { id: USER, email: "ana@example.com", fullName: "Ana", avatarUrl: null, platformRole: "user" };
const organization = (role: OrganizationContext["role"] = "productor"): OrganizationContext => ({
  id: ORG,
  slug: "norte",
  displayName: "Norte",
  primaryColor: null,
  secondaryColor: null,
  role
});

// ----- Supabase en memoria -----

type Row = Record<string, unknown>;

function createDb() {
  const tables: Record<string, Row[]> = {};
  const objects = new Map<string, Uint8Array>();
  const uploads: string[] = [];
  let clock = NOW.getTime();

  const rowsOf = (table: string) => (tables[table] ??= []);

  class Query {
    private op: "select" | "insert" | "update" = "select";
    private payload: Row | Row[] | null = null;
    private filters: Array<(row: Row) => boolean> = [];
    private orders: Array<{ column: string; ascending: boolean }> = [];
    private limitTo: number | null = null;
    private window: [number, number] | null = null;
    private shape: "many" | "single" | "maybe" = "many";
    private head = false;
    private wantsCount = false;

    constructor(private readonly table: string) {}

    select(_columns?: string, options?: { count?: string; head?: boolean }) {
      this.head = Boolean(options?.head);
      this.wantsCount = Boolean(options?.count);
      return this;
    }
    insert(payload: Row | Row[]) {
      this.op = "insert";
      this.payload = payload;
      return this;
    }
    update(patch: Row) {
      this.op = "update";
      this.payload = patch;
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push((row) => row[column] === value);
      return this;
    }
    neq(column: string, value: unknown) {
      this.filters.push((row) => row[column] !== value);
      return this;
    }
    in(column: string, values: unknown[]) {
      this.filters.push((row) => values.includes(row[column]));
      return this;
    }
    is(column: string, value: null) {
      this.filters.push((row) => (row[column] ?? null) === value);
      return this;
    }
    gte(column: string, value: string) {
      this.filters.push((row) => String(row[column]) >= value);
      return this;
    }
    lt(column: string, value: string) {
      this.filters.push((row) => String(row[column]) < value);
      return this;
    }
    lte(column: string, value: string) {
      this.filters.push((row) => String(row[column]) <= value);
      return this;
    }
    // Filtros de texto: la prueba no los necesita, pasan todo.
    or() {
      return this;
    }
    ilike() {
      return this;
    }
    order(column: string, options?: { ascending?: boolean }) {
      this.orders.push({ column, ascending: options?.ascending !== false });
      return this;
    }
    limit(count: number) {
      this.limitTo = count;
      return this;
    }
    range(from: number, to: number) {
      this.window = [from, to];
      return this;
    }
    single() {
      this.shape = "single";
      return this;
    }
    maybeSingle() {
      this.shape = "maybe";
      return this;
    }

    // Awaitable como el builder de PostgREST.
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(this.run()).then(resolve, reject);
    }

    private run() {
      const table = rowsOf(this.table);
      let matched: Row[];

      if (this.op === "insert") {
        const inputs = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
        matched = inputs.map((input) => {
          clock += 1000;
          const stamp = new Date(clock).toISOString();
          const row: Row = { id: randomUUID(), created_at: stamp, updated_at: stamp, ...input };
          if (this.table === "gesti_conversations") row.pinned ??= false;
          if (this.table === "gesti_files") {
            row.conversation_id ??= null;
            row.page_count ??= null;
            row.extracted_text ??= null;
          }
          table.push(row);
          return { ...row };
        });
      } else {
        matched = table.filter((row) => this.filters.every((test) => test(row)));
        if (this.op === "update") {
          for (const row of matched) Object.assign(row, this.payload);
        }
        for (const { column, ascending } of [...this.orders].reverse()) {
          matched = [...matched].sort((a, b) => {
            const left = String(a[column] ?? "");
            const right = String(b[column] ?? "");
            return (left < right ? -1 : left > right ? 1 : 0) * (ascending ? 1 : -1);
          });
        }
      }

      const total = matched.length;
      if (this.window) matched = matched.slice(this.window[0], this.window[1] + 1);
      if (this.limitTo !== null) matched = matched.slice(0, this.limitTo);
      matched = matched.map((row) => ({ ...row }));

      const count = this.wantsCount ? total : null;
      if (this.head) return { data: null, count, error: null };
      if (this.shape === "single") {
        return matched[0] ? { data: matched[0], count, error: null } : { data: null, count, error: { message: "no rows", code: "PGRST116" } };
      }
      if (this.shape === "maybe") return { data: matched[0] ?? null, count, error: null };
      return { data: matched, count, error: null };
    }
  }

  const storage = {
    from: () => ({
      download: async (path: string) => {
        const bytes = objects.get(path);
        return bytes ? { data: new Blob([bytes as BlobPart]), error: null } : { data: null, error: { message: "not found" } };
      },
      upload: async (path: string, bytes: Uint8Array) => {
        objects.set(path, bytes);
        uploads.push(path);
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        paths.forEach((path) => objects.delete(path));
        return { data: null, error: null };
      },
      info: async (path: string) =>
        objects.has(path) ? { data: { size: objects.get(path)!.byteLength, contentType: "application/pdf" }, error: null } : { data: null, error: { message: "not found" } },
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}?token=t` }, error: null }),
      createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/up/${path}`, token: "t" }, error: null })
    })
  };

  const supabase = { admin: { from: (table: string) => new Query(table), storage } } as unknown as SupabaseService;
  return { supabase, tables, rowsOf, objects, uploads };
}

type Db = ReturnType<typeof createDb>;

// ----- Anthropic falso -----

type Usage = Partial<{ in: number; out: number; read: number; write: number; searches: number }>;
type ScriptBlock =
  | { type: "text"; text: string; citations?: Array<{ url: string; title: string | null }> }
  | { type: "server_tool_use"; name: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "thinking"; signature: string };
type Script = {
  blocks: ScriptBlock[];
  stop?: string;
  usage?: Usage;
  fail?: Error;
  /** Después de sus bloques, el stream queda colgado hasta que lo abortan. */
  hang?: boolean;
};

function sdkUsage(usage: Usage = {}) {
  return {
    input_tokens: usage.in ?? 100,
    output_tokens: usage.out ?? 20,
    cache_read_input_tokens: usage.read ?? 0,
    cache_creation_input_tokens: usage.write ?? 0,
    server_tool_use: { web_search_requests: usage.searches ?? 0, web_fetch_requests: 0 }
  };
}

function chunksOf(text: string, size = 400) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size));
  return chunks;
}

function streamEvents(blocks: ScriptBlock[]) {
  const events: unknown[] = [];
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } });
      for (const chunk of chunksOf(block.text)) {
        events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: chunk } });
      }
      for (const citation of block.citations ?? []) {
        events.push({
          type: "content_block_delta",
          index,
          delta: {
            type: "citations_delta",
            citation: { type: "web_search_result_location", url: citation.url, title: citation.title, cited_text: "…", encrypted_index: "x" }
          }
        });
      }
    } else if (block.type === "thinking") {
      events.push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: block.signature } });
    } else if (block.type === "server_tool_use") {
      events.push({ type: "content_block_start", index, content_block: { type: "server_tool_use", id: `srv_${index}`, name: block.name, input: {} } });
    } else {
      events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: `tu_${index}`, name: block.name, input: {} } });
    }
    events.push({ type: "content_block_stop", index });
  });
  return events;
}

function messageOf(model: string, script: Script) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model,
    stop_sequence: null,
    stop_reason: script.stop ?? (script.blocks.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn"),
    usage: sdkUsage(script.usage),
    content: script.blocks.map((block, index) => {
      if (block.type === "text") return { type: "text", text: block.text, citations: null };
      if (block.type === "thinking") return { type: "thinking", thinking: "", signature: block.signature };
      if (block.type === "server_tool_use") return { type: "server_tool_use", id: `srv_${index}`, name: block.name, input: {} };
      return { type: "tool_use", id: `tu_${index}`, name: block.name, input: block.input };
    })
  };
}

type CreateReply = Script | ((params: Record<string, unknown>) => Script);

function createAnthropic(options: { streams?: Script[]; creates?: CreateReply[]; title?: string } = {}) {
  const streamQueue = [...(options.streams ?? [])];
  const createQueue = [...(options.creates ?? [])];
  const streamCalls: Array<{ params: Record<string, any>; messagesAtCall: unknown }> = [];
  const createCalls: Array<Record<string, any>> = [];

  const client = {
    messages: {
      stream: (params: Record<string, any>, requestOptions?: { signal?: AbortSignal }) => {
        // El SDK reutiliza el array de mensajes: se guarda una copia de lo que vio esta llamada.
        streamCalls.push({ params, messagesAtCall: JSON.parse(JSON.stringify(params.messages)) });
        const script = streamQueue.shift();
        if (!script) throw new Error("No stream scripted");
        return {
          async *[Symbol.asyncIterator]() {
            if (script.fail) throw script.fail;
            for (const event of streamEvents(script.blocks)) {
              if (requestOptions?.signal?.aborted) throw new Error("aborted");
              yield event;
            }
            if (script.hang) {
              await new Promise<void>((resolve) => {
                if (requestOptions?.signal?.aborted) resolve();
                requestOptions?.signal?.addEventListener("abort", () => resolve(), { once: true });
              });
              throw new Error("aborted");
            }
          },
          finalMessage: async () => messageOf(params.model, script)
        };
      },
      create: async (params: Record<string, any>) => {
        createCalls.push(params);
        const next = createQueue.shift();
        const script: Script = next
          ? typeof next === "function"
            ? next(params)
            : next
          : { blocks: [{ type: "text", text: options.title ?? "Consulta de seguro" }], usage: { in: 50, out: 5 } };
        return messageOf(params.model, script);
      }
    }
  };
  return { client, streamCalls, createCalls };
}

// ----- Helpers de prueba -----

async function readEvents(response: Response): Promise<GestiStreamEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .map(parseStreamLine)
    .filter((event): event is GestiStreamEvent => event !== null);
}

function seedConversation(db: Db, owner = USER, title = "Chat previo") {
  const id = randomUUID();
  db.rowsOf("gesti_conversations").push({
    id,
    organization_id: ORG,
    user_id: owner,
    title,
    pinned: false,
    created_at: "2026-10-20T10:00:00.000Z",
    updated_at: "2026-10-20T10:00:00.000Z"
  });
  return id;
}

function seedMessage(db: Db, conversationId: string, role: "user" | "assistant", content: string, index: number, parts: Row = {}) {
  db.rowsOf("gesti_messages").push({
    id: randomUUID(),
    organization_id: ORG,
    conversation_id: conversationId,
    role,
    content,
    parts,
    created_at: new Date(Date.UTC(2026, 9, 20, 10, 0, index)).toISOString()
  });
}

function seedUsage(db: Db, costUsdValue: number, createdAt: string, userId = USER, organizationId = ORG) {
  db.rowsOf("gesti_usage").push({
    id: randomUUID(),
    organization_id: organizationId,
    user_id: userId,
    conversation_id: null,
    purpose: "chat",
    model: "claude-sonnet-5-5",
    cost_usd: costUsdValue,
    created_at: createdAt
  });
}

function seedFile(db: Db, overrides: Row = {}) {
  const id = randomUUID();
  const row: Row = {
    id,
    organization_id: ORG,
    user_id: USER,
    conversation_id: null,
    origin: "upload",
    path: `${ORG}/${USER}/${randomUUID()}/informe.pdf`,
    name: "informe.pdf",
    mime_type: "application/pdf",
    size_bytes: 1000,
    page_count: 3,
    extracted_text: "Texto del informe con datos de la póliza. ".repeat(10),
    text_truncated: false,
    ...overrides
  };
  db.rowsOf("gesti_files").push(row);
  return row;
}

let db: Db;

function chatService(client: unknown, overrides: { budget?: number; turnDeadlineMs?: number } = {}) {
  return new GestiChatService({
    supabase: db.supabase,
    getClient: () => client as never,
    now: () => NOW,
    budgetUsd: () => overrides.budget ?? 100,
    referenceTag: () => "tn01",
    ...(overrides.turnDeadlineMs === undefined ? {} : { turnDeadlineMs: overrides.turnDeadlineMs })
  });
}

async function chat(
  client: unknown,
  payload: { message?: string; conversationId?: string | null; fileIds?: string[] } = {},
  overrides: { budget?: number; turnDeadlineMs?: number } = {}
) {
  const response = await chatService(client, overrides).start({
    organization: organization(),
    user: authUser,
    payload: { conversationId: payload.conversationId ?? null, message: payload.message ?? "Hola Gesti", fileIds: payload.fileIds ?? [] }
  });
  return readEvents(response);
}

const lastDone = (events: GestiStreamEvent[]) => {
  const done = events.at(-1);
  if (done?.type !== "done") throw new Error(`last event is ${done?.type}`);
  return done.message;
};

beforeEach(() => {
  db = createDb();
  hoisted.db = db.supabase;
  hoisted.client = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

// ----- Chat -----

describe("Gesti chat", () => {
  it("streams meta, text, title and done, stores both messages and records a usage row per model call", async () => {
    const anthropic = createAnthropic({
      streams: [{ blocks: [{ type: "text", text: "Hola, ¿en qué te ayudo?" }], usage: { in: 1000, out: 500, read: 2000, write: 1000 } }],
      title: "Consulta de seguro"
    });
    const events = await chat(anthropic.client);

    expect(events[0]).toMatchObject({ type: "meta", userMessage: { role: "user", content: "Hola Gesti" } });
    const types = events.map((event) => event.type);
    expect(types.at(-1)).toBe("done");
    expect(types).toContain("title");
    expect(types.indexOf("title")).toBeLessThan(types.indexOf("done"));
    expect(events.filter((event) => event.type === "text").map((event) => (event as { delta: string }).delta).join("")).toBe(
      "Hola, ¿en qué te ayudo?"
    );

    const conversation = db.rowsOf("gesti_conversations")[0]!;
    expect(conversation).toMatchObject({ organization_id: ORG, user_id: USER, title: "Consulta de seguro" });
    const messages = db.rowsOf("gesti_messages");
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(lastDone(events)).toMatchObject({ role: "assistant", content: "Hola, ¿en qué te ayudo?" });

    const usage = db.rowsOf("gesti_usage");
    expect(usage.map((row) => row.purpose).sort()).toEqual(["chat", "title"]);
    const chatRow = usage.find((row) => row.purpose === "chat")!;
    expect(chatRow).toMatchObject({
      organization_id: ORG,
      user_id: USER,
      conversation_id: conversation.id,
      model: "claude-sonnet-5-5",
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 2000,
      cache_write_tokens: 1000,
      web_searches: 0
    });
    expect(chatRow.cost_usd).toBe(costUsd("claude-sonnet-5-5", { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 1000, webSearches: 0 }));
    expect(usage.find((row) => row.purpose === "title")).toMatchObject({ model: "claude-haiku-5-5", input_tokens: 50 });
  });

  it("calls Sonnet with cached system and tools, the web search tool for Argentina and today's date outside the cache", async () => {
    const anthropic = createAnthropic({ streams: [{ blocks: [{ type: "text", text: "ok" }] }] });
    await chat(anthropic.client);

    const { params } = anthropic.streamCalls[0]!;
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.system[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(params.system[0].text).not.toMatch(/Hoy es/);
    expect(params.system[1].text).toMatch(/^Hoy es .*2026/);
    expect(params.system[1].cache_control).toBeUndefined();

    expect(params.tools[0]).toEqual({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 3,
      user_location: { type: "approximate", country: "AR", timezone: "America/Argentina/Buenos_Aires" }
    });
    expect(params.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "web_search",
      "consultar_cartera",
      "read_document",
      "edit_document",
      "create_document",
      "show_chart",
      "ask_user"
    ]);
    expect(params.tools.at(-1).cache_control).toEqual({ type: "ephemeral" });

    // Costo sin perder calidad: Sonnet razona solo cuando la consulta lo pide
    // (adaptativo) con esfuerzo medio, deja lugar en max_tokens para ese
    // razonamiento, y el historial va en caché.
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({ effort: "medium" });
    expect(params.max_tokens).toBe(8192);
    expect(params.cache_control).toEqual({ type: "ephemeral" });

    // Haiku titula con un tope de tokens bajo y sin razonar (el razonamiento cuenta en max_tokens).
    expect(anthropic.createCalls[0]).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 30,
      thinking: { type: "disabled" },
      output_config: { effort: "low" }
    });
  });

  it("passes Sonnet's thinking blocks back unchanged in the next tool round and never shows them", async () => {
    const anthropic = createAnthropic({
      streams: [
        {
          blocks: [
            { type: "thinking", signature: "sig-1" },
            { type: "tool_use", name: "show_chart", input: { kind: "pie", title: "Pólizas", labels: ["Auto"], series: [{ name: "Pólizas", values: [3] }] } }
          ]
        },
        { blocks: [{ type: "text", text: "Ahí está el gráfico." }] }
      ]
    });
    const events = await chat(anthropic.client);

    const secondRound = anthropic.streamCalls[1]?.messagesAtCall as Array<{ role: string; content: unknown }>;
    const assistantTurn = secondRound.at(-2);
    expect(assistantTurn?.role).toBe("assistant");
    expect(assistantTurn?.content).toEqual(
      expect.arrayContaining([{ type: "thinking", thinking: "", signature: "sig-1" }])
    );
    expect(lastDone(events).content).toBe("Ahí está el gráfico.");
  });

  it("never lets Haiku think and caches its prompts, so long documents and data rounds stay cheap", async () => {
    const conversationId = seedConversation(db);
    const file = seedFile(db, { conversation_id: conversationId, extracted_text: "Cláusula de la póliza. ".repeat(25_000) });
    const anthropic = createAnthropic({
      streams: [
        { blocks: [{ type: "tool_use", name: "read_document", input: { file_id: file.id, pregunta: "¿Qué cubre?" } }] },
        { blocks: [{ type: "tool_use", name: "consultar_cartera", input: { pregunta: "¿Cuántas pólizas activas hay?" } }] },
        { blocks: [{ type: "text", text: "Listo." }] }
      ],
      creates: [
        { blocks: [{ type: "text", text: "Cubre robo." }] },
        { blocks: [{ type: "text", text: "Hay 3." }] }
      ]
    });
    await chat(anthropic.client, { conversationId });

    expect(anthropic.createCalls).toHaveLength(2);
    // Leer documentos y consultar la cartera son tareas de varios pasos: esfuerzo
    // medio para no saltear consultas, pero sin razonamiento cobrado.
    for (const call of anthropic.createCalls) {
      expect(call).toMatchObject({
        model: "claude-haiku-5-5",
        thinking: { type: "disabled" },
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" }
      });
    }
    // El documento entra recortado para que el prompt quede debajo de los 100.000 tokens
    // (arriba de eso Haiku 5.5 cobra 5 veces más todo el pedido).
    const readPrompt = JSON.stringify(anthropic.createCalls[0]?.messages);
    expect(readPrompt.length).toBeLessThan(MAX_DOCUMENT_PROMPT_CHARS + 2_000);
    expect(readPrompt).toContain("El texto se cortó");
  });

  it("answers with a friendly notice and no model call when the monthly budget is spent", async () => {
    seedUsage(db, 60, "2026-10-03T12:00:00.000Z", USER);
    seedUsage(db, 40, "2026-10-26T12:00:00.000Z", OTHER_USER, OTHER_ORG); // el tope es global: cuenta otra organización
    const anthropic = createAnthropic();
    const events = await chat(anthropic.client);

    expect(anthropic.streamCalls).toHaveLength(0);
    expect(anthropic.createCalls).toHaveLength(0);
    expect(events.map((event) => event.type)).toEqual(["meta", "text", "done"]);

    const reply = lastDone(events);
    expect(reply.parts.notice).toBe("budget_exhausted");
    expect(reply.content).toMatch(/presupuesto/);
    expect(reply.content).toContain("1 de noviembre");
    expect(reply.content).toMatch(/productor/);
    expect(db.rowsOf("gesti_messages").map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(db.rowsOf("gesti_usage")).toHaveLength(2); // nada nuevo
  });

  it("does not count last month's spend, nor a spend just under the budget", async () => {
    seedUsage(db, 500, "2026-09-30T23:59:00.000Z"); // septiembre en Argentina
    seedUsage(db, 99.99, "2026-10-10T12:00:00.000Z");
    expect(await monthSpendUsd(db.supabase, NOW)).toBe(99.99);

    const anthropic = createAnthropic({ streams: [{ blocks: [{ type: "text", text: "Sigo acá" }] }] });
    const events = await chat(anthropic.client);

    expect(lastDone(events).parts.notice).toBeUndefined();
    expect(lastDone(events).content).toBe("Sigo acá");
  });

  it("answers with a not_configured notice when there is no API key", async () => {
    const events = await chat(null);

    expect(events.map((event) => event.type)).toEqual(["meta", "text", "done"]);
    expect(lastDone(events).parts.notice).toBe("not_configured");
    expect(lastDone(events).content).not.toBe("");
    expect(db.rowsOf("gesti_usage")).toEqual([]);
  });

  it("caps the visible reply at MAX_REPLY_CHARS and ends it with an ellipsis, without another model round", async () => {
    const anthropic = createAnthropic({
      streams: [{ blocks: [{ type: "text", text: "a".repeat(7000) }, { type: "tool_use", name: "show_chart", input: {} }], usage: { in: 10, out: 2000 } }]
    });
    const events = await chat(anthropic.client);

    const streamed = events.filter((event) => event.type === "text").map((event) => (event as { delta: string }).delta).join("");
    expect(streamed).toHaveLength(MAX_REPLY_CHARS);
    expect(streamed.endsWith("…")).toBe(true);
    expect(lastDone(events).content).toBe(streamed);
    expect(anthropic.streamCalls).toHaveLength(1);
    expect(db.rowsOf("gesti_usage").filter((row) => row.purpose === "chat")).toHaveLength(1);
  });

  it("turns web search citations into sources events and [[n]] markers at the end of each text block", async () => {
    const siteA = { url: "https://www.argentina.gob.ar/ley-24449", title: "Ley 24.449" };
    const siteB = { url: "https://www.example.com/seguros", title: null };
    const anthropic = createAnthropic({
      streams: [
        {
          blocks: [
            { type: "server_tool_use", name: "web_search" },
            { type: "text", text: "El valor es 10.", citations: [siteA, siteB, siteA] },
            { type: "text", text: " Y hay otro dato.", citations: [siteB] }
          ],
          usage: { searches: 1 }
        }
      ]
    });
    const events = await chat(anthropic.client);

    const sourceEvents = events.filter((event) => event.type === "sources") as Array<{ sources: Array<{ url: string; title: string }> }>;
    expect(sourceEvents).toHaveLength(2);
    expect(sourceEvents[0]!.sources).toEqual([{ url: siteA.url, title: "Ley 24.449" }]);
    expect(sourceEvents[1]!.sources).toEqual([
      { url: siteA.url, title: "Ley 24.449" },
      { url: siteB.url, title: "www.example.com" }
    ]);

    const statuses = events.filter((event) => event.type === "status").map((event) => (event as { label: string | null }).label);
    expect(statuses).toEqual(["Buscando en internet…", null]);

    const reply = lastDone(events);
    expect(reply.content).toBe("El valor es 10. [[1]] [[2]] Y hay otro dato. [[2]]");
    expect(reply.parts.sources).toHaveLength(2);
    expect(db.rowsOf("gesti_usage").find((row) => row.purpose === "chat")).toMatchObject({ web_searches: 1 });
  });

  it("ends the turn at ask_user: it emits the question and makes no further model round", async () => {
    const question = { question: "¿Para qué vehículo?", options: ["Auto", "Moto"] };
    const anthropic = createAnthropic({
      streams: [
        { blocks: [{ type: "text", text: "Necesito un dato." }, { type: "tool_use", name: "ask_user", input: question }] },
        { blocks: [{ type: "text", text: "no debería llamarse" }] }
      ]
    });
    const events = await chat(anthropic.client);

    expect(anthropic.streamCalls).toHaveLength(1);
    const asked = events.find((event) => event.type === "question");
    expect(asked).toMatchObject({ question: { question: "¿Para qué vehículo?", options: ["Auto", "Moto"], allowFreeText: true } });
    expect(lastDone(events).parts.question).toMatchObject({ options: ["Auto", "Moto"] });
  });

  it("returns an invalid show_chart as an is_error tool_result so the model can fix it, and emits a valid one", async () => {
    const valid = { kind: "bar", title: "Pólizas por rama", labels: ["Auto", "Hogar"], series: [{ name: "Pólizas", values: [5, 3] }] };
    const anthropic = createAnthropic({
      streams: [
        { blocks: [{ type: "tool_use", name: "show_chart", input: { kind: "bar", title: "Sin datos" } }] },
        { blocks: [{ type: "tool_use", name: "show_chart", input: valid }] },
        { blocks: [{ type: "text", text: "Listo." }] }
      ]
    });
    const events = await chat(anthropic.client);

    expect(anthropic.streamCalls).toHaveLength(3);
    const afterInvalid = (anthropic.streamCalls[1]!.messagesAtCall as any[]).at(-1);
    expect(afterInvalid.role).toBe("user");
    expect(afterInvalid.content[0]).toMatchObject({ type: "tool_result", is_error: true });
    expect(afterInvalid.content[0].content).toMatch(/labels|series|gráfico/i);

    const afterValid = (anthropic.streamCalls[2]!.messagesAtCall as any[]).at(-1);
    expect(afterValid.content[0]).toMatchObject({ type: "tool_result", content: "Gráfico mostrado al usuario." });
    expect(afterValid.content[0].is_error).toBeUndefined();

    expect(events.filter((event) => event.type === "chart")).toHaveLength(1);
    expect(lastDone(events).parts.charts).toEqual([{ ...valid, position: 0 }]);
    expect(lastDone(events).content).toBe("Listo.");
    expect(db.rowsOf("gesti_usage").filter((row) => row.purpose === "chat")).toHaveLength(3);
  });

  it("runs consultar_cartera through the Haiku data agent, scoped to the organization, and records its usage", async () => {
    db.rowsOf("tasks").push(
      { id: randomUUID(), organization_id: ORG, title: "Llamar a Ana", status: "pendiente", priority: "alta", due_date: "2026-10-20" },
      { id: randomUUID(), organization_id: OTHER_ORG, title: "Tarea de otra organización", status: "pendiente", priority: "baja", due_date: null }
    );
    const anthropic = createAnthropic({
      streams: [
        { blocks: [{ type: "tool_use", name: "consultar_cartera", input: { pregunta: "¿Qué tareas hay abiertas?" } }] },
        { blocks: [{ type: "text", text: "Tenés una tarea abierta." }] }
      ],
      creates: [
        { blocks: [{ type: "text", text: "Consulta de tareas" }] }, // título
        { blocks: [{ type: "tool_use", name: "listar_tareas", input: {} }], usage: { in: 300, out: 40 } },
        { blocks: [{ type: "text", text: "Hay 1 tarea abierta: Llamar a Ana (vencida)." }], usage: { in: 500, out: 60 } }
      ]
    });
    const events = await chat(anthropic.client, { message: "¿Qué tengo pendiente?" });

    const dataCalls = anthropic.createCalls.filter((call) => call.tools);
    expect(dataCalls).toHaveLength(2);
    expect(dataCalls[0]!.model).toBe("claude-haiku-5-5");
    expect(dataCalls[0]!.max_tokens).toBe(1500);
    expect(dataCalls[0]!.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "buscar_asegurados",
      "ficha_asegurado",
      "listar_avisos",
      "listar_polizas",
      "resumen_cartera",
      "listar_tareas"
    ]);

    // Lo que Haiku ve de la base: solo la organización, sin ids.
    const toolResult = (dataCalls[1]!.messages as any[]).at(-1).content[0];
    expect(toolResult.content).toContain("Llamar a Ana");
    expect(toolResult.content).not.toContain("otra organización");
    expect(toolResult.content).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);

    // Sonnet recibe solo la respuesta de texto del sub-agente.
    const forSonnet = (anthropic.streamCalls[1]!.messagesAtCall as any[]).at(-1).content[0];
    expect(forSonnet).toMatchObject({ type: "tool_result", content: "Hay 1 tarea abierta: Llamar a Ana (vencida)." });

    expect(events.filter((event) => event.type === "status").map((event) => (event as { label: string | null }).label)).toEqual([
      "Consultando tu cartera…",
      null
    ]);
    expect(events.find((event) => event.type === "app_sources")).toEqual({ type: "app_sources", appSources: ["tasks"] });
    expect(lastDone(events).parts.appSources).toEqual(["tasks"]);
    expect(db.rowsOf("gesti_usage").map((row) => row.purpose).sort()).toEqual(["chat", "chat", "data", "data", "title"]);
    expect(db.rowsOf("gesti_usage").filter((row) => row.purpose === "data").every((row) => row.model === "claude-haiku-5-5")).toBe(true);
  });

  describe("table links and inline position", () => {
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const TASKS_TABLE = {
      kind: "table",
      title: "Tareas abiertas",
      columns: ["Tarea"],
      rows: [["Llamar a Ana"], ["Fantasma"], ["Inventada"], ["Sin referencia"]]
    };

    function seedTask() {
      const taskId = randomUUID();
      db.rowsOf("tasks").push(
        { id: taskId, organization_id: ORG, title: "Llamar a Ana", status: "pendiente", priority: "alta", due_date: "2026-10-20" },
        { id: randomUUID(), organization_id: OTHER_ORG, title: "Tarea de otra organización", status: "pendiente", priority: "baja", due_date: null }
      );
      return taskId;
    }

    const chartEvents = (events: GestiStreamEvent[]) =>
      events.filter((event): event is Extract<GestiStreamEvent, { type: "chart" }> => event.type === "chart").map((event) => event.chart);

    it("resolves the references Gesti passes against this turn's data tools and emits links with the position", async () => {
      const taskId = seedTask();
      const first = "Revisé tu cartera.\n\n";
      const second = "Acá está la tabla:\n\n";
      const anthropic = createAnthropic({
        streams: [
          { blocks: [{ type: "text", text: first }, { type: "tool_use", name: "consultar_cartera", input: { pregunta: "¿Qué tareas hay abiertas?" } }] },
          { blocks: [{ type: "text", text: second }, { type: "tool_use", name: "show_chart", input: { ...TASKS_TABLE, refs: ["#Rtn01-1", "#Rtn01-9", "no-es-una-ref", null] } }] },
          { blocks: [{ type: "text", text: "Esa es la urgente." }] }
        ],
        creates: [
          { blocks: [{ type: "text", text: "Tareas abiertas" }] },
          { blocks: [{ type: "tool_use", name: "listar_tareas", input: {} }] },
          { blocks: [{ type: "text", text: "Ref | Tarea\n#Rtn01-1 | Llamar a Ana" }] }
        ]
      });
      const events = await chat(anthropic.client, { message: "¿Qué tareas tengo?" });

      const expected = { links: [{ kind: "task", id: taskId }, null, null, null], position: first.length + second.length };
      expect(chartEvents(events)).toEqual([{ ...TASKS_TABLE, ...expected }]);
      expect(chartEvents(events)[0]).not.toHaveProperty("refs");

      const reply = lastDone(events);
      expect(reply.parts.charts).toEqual([{ ...TASKS_TABLE, ...expected }]);
      expect(db.rowsOf("gesti_messages").at(-1)?.parts).toMatchObject({ charts: [expected] });

      // Haiku ve la referencia, nunca el id; Sonnet tampoco.
      const dataCalls = anthropic.createCalls.filter((call) => call.tools);
      const haikuSaw = JSON.stringify((dataCalls[1]!.messages as any[]).at(-1));
      expect(haikuSaw).toContain("#Rtn01-1");
      expect(haikuSaw).not.toContain(taskId);
      const sonnetSaw = JSON.stringify(anthropic.streamCalls.map((call) => call.messagesAtCall));
      expect(sonnetSaw).toContain("#Rtn01-1");
      expect(sonnetSaw).not.toMatch(UUID);
    });

    it("drops references from another turn, even when this turn issued the same number", async () => {
      const taskId = seedTask();
      const conversationId = seedConversation(db);
      seedMessage(db, conversationId, "user", "¿Qué tareas tengo?", 1);
      seedMessage(db, conversationId, "assistant", "Tenés una tarea (#Rold1-1).", 2);
      const anthropic = createAnthropic({
        streams: [
          { blocks: [{ type: "tool_use", name: "consultar_cartera", input: { pregunta: "¿Qué tareas hay abiertas?" } }] },
          { blocks: [{ type: "tool_use", name: "show_chart", input: { ...TASKS_TABLE, refs: ["#Rold1-1", "#R1", null, null] } }] },
          { blocks: [{ type: "text", text: "Listo." }] }
        ],
        creates: [
          { blocks: [{ type: "tool_use", name: "listar_tareas", input: {} }] },
          { blocks: [{ type: "text", text: "Ref | Tarea\n#Rtn01-1 | Llamar a Ana" }] }
        ]
      });
      const events = await chat(anthropic.client, { conversationId, message: "Mostrame la tabla" });

      const [chart] = chartEvents(events);
      expect(chart).toBeDefined();
      expect(chart).not.toHaveProperty("links");
      expect(JSON.stringify(events)).not.toContain(taskId);
      expect(lastDone(events).parts.charts?.[0]).not.toHaveProperty("links");
    });

    it("ignores raw links and positions injected in the show_chart input", async () => {
      const injected = { ...TASKS_TABLE, links: [{ kind: "task", id: randomUUID() }], position: 3 };
      const anthropic = createAnthropic({
        streams: [
          { blocks: [{ type: "text", text: "Mirá esto:\n\n" }, { type: "tool_use", name: "show_chart", input: injected }] },
          { blocks: [{ type: "text", text: "Listo." }] }
        ]
      });
      const events = await chat(anthropic.client);

      const [chart] = chartEvents(events);
      expect(chart).not.toHaveProperty("links");
      expect(chart?.position).toBe("Mirá esto:\n\n".length);
      expect(JSON.stringify(events)).not.toContain(injected.links[0]!.id);
    });

    it("stores the position relative to the trimmed reply and keeps it within the stored text", async () => {
      const anthropic = createAnthropic({
        streams: [
          { blocks: [{ type: "text", text: "\n\nHola mundo" }, { type: "tool_use", name: "show_chart", input: TASKS_TABLE }] },
          { blocks: [{ type: "text", text: "" }] }
        ]
      });
      const events = await chat(anthropic.client);

      // Streaming: el navegador tiene el texto crudo.
      expect(chartEvents(events)[0]?.position).toBe("\n\nHola mundo".length);
      // Guardado: el texto se recorta, la posición lo acompaña.
      const reply = lastDone(events);
      expect(reply.content).toBe("Hola mundo");
      expect(reply.parts.charts?.[0]?.position).toBe("Hola mundo".length);
    });

    it("never gives the model ids or links when it rebuilds the history", async () => {
      const taskId = randomUUID();
      const conversationId = seedConversation(db);
      seedMessage(db, conversationId, "user", "¿Qué tareas tengo?", 1);
      seedMessage(db, conversationId, "assistant", "Tenés una tarea.", 2, {
        charts: [{ ...TASKS_TABLE, links: [{ kind: "task", id: taskId }, null, null, null], position: 4 }]
      });
      const anthropic = createAnthropic({ streams: [{ blocks: [{ type: "text", text: "Dale." }] }] });
      await chat(anthropic.client, { conversationId, message: "Gracias" });

      const sent = JSON.stringify(anthropic.streamCalls[0]!.messagesAtCall);
      expect(sent).toContain("[Gráfico mostrado: Tareas abiertas]");
      expect(sent).not.toContain(taskId);
      expect(sent).not.toMatch(/"links"|"position"|clientId|policyId/);
    });
  });

  it.each([
    ["a spend limit set on the key or workspace (400)", 400, { type: "invalid_request_error", message: "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC." }],
    ["the tier spend cap (429)", 429, { type: "rate_limit_error", message: "You have reached your API usage limits", details: { error_code: "enforced_spend_limit_reached" } }],
    ["no credits left (400)", 400, { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." }]
  ])("answers with the friendly budget notice, not an error, when Anthropic rejects the call for %s", async (_label, status, error) => {
    const failure = Object.assign(new Error(`${status} ${error.message}`), { status, error: { type: "error", error } });
    const anthropic = createAnthropic({ streams: [{ blocks: [], fail: failure }] });
    const events = await chat(anthropic.client);

    const reply = lastDone(events);
    expect(reply.parts.notice).toBe("budget_exhausted");
    expect(reply.content).toContain("presupuesto");
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("keeps the generic error notice for an ordinary rate limit", async () => {
    const failure = Object.assign(new Error("429 rate limited"), { status: 429, error: { type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" } } });
    const anthropic = createAnthropic({ streams: [{ blocks: [], fail: failure }] });

    expect(lastDone(await chat(anthropic.client)).parts.notice).toBe("error");
  });

  it("stores a generic error notice when the model call fails, without leaking the failure", async () => {
    const anthropic = createAnthropic({ streams: [{ blocks: [], fail: new Error("401 invalid x-api-key sk-ant-secret") }] });
    const events = await chat(anthropic.client);

    const reply = lastDone(events);
    expect(reply.parts.notice).toBe("error");
    expect(reply.content).toBe("No pude responder ahora. Probá de nuevo en un momento.");
    expect(JSON.stringify(events)).not.toMatch(/sk-ant|x-api-key/);
    expect(db.rowsOf("gesti_messages").map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("stores what was written plus a timeout note when the turn passes its deadline, before the platform kills it", async () => {
    const anthropic = createAnthropic({ streams: [{ blocks: [{ type: "text", text: "Empiezo a revisar la póliza." }], hang: true }] });
    const events = await chat(anthropic.client, {}, { turnDeadlineMs: 30 });

    const reply = lastDone(events);
    expect(reply.content).toMatch(/^Empiezo a revisar la póliza\./);
    expect(reply.content).toContain(TURN_TIMEOUT_NOTE);
    expect(db.rowsOf("gesti_messages").map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("keeps the turn deadline under the route's maxDuration", () => {
    expect(TURN_DEADLINE_MS).toBeLessThan(300_000 - 30_000);
  });

  it("creates a document through create_document, stores it as generated and emits a document event", async () => {
    const anthropic = createAnthropic({
      streams: [
        {
          blocks: [
            {
              type: "tool_use",
              name: "create_document",
              input: { format: "pdf", filename: "Carta al asegurado", blocks: [{ type: "paragraph", text: "Estimado Ana" }] }
            }
          ]
        },
        { blocks: [{ type: "text", text: "Ya está el archivo." }] }
      ]
    });
    const events = await chat(anthropic.client);

    const documentEvent = events.find((event) => event.type === "document") as { file: { fileId: string; name: string } };
    expect(documentEvent.file.name).toBe("Carta al asegurado.pdf");
    const stored = db.rowsOf("gesti_files").find((row) => row.id === documentEvent.file.fileId)!;
    expect(stored).toMatchObject({ organization_id: ORG, user_id: USER, origin: "generated", conversation_id: db.rowsOf("gesti_conversations")[0]!.id });
    expect(String(stored.path).startsWith(`${ORG}/${USER}/`)).toBe(true);
    expect(db.uploads).toEqual([stored.path]);
    expect(lastDone(events).parts.documents).toHaveLength(1);
  });

  it("gives the document tools only files of the caller that belong to this conversation", async () => {
    const foreign = seedFile(db, { user_id: OTHER_USER });
    const otherChat = seedFile(db, { conversation_id: seedConversation(db) });
    const anthropic = createAnthropic({
      streams: [
        {
          blocks: [
            { type: "tool_use", name: "read_document", input: { file_id: foreign.id, pregunta: "¿Qué dice?" } },
            { type: "tool_use", name: "read_document", input: { file_id: otherChat.id, pregunta: "¿Qué dice?" } }
          ]
        },
        { blocks: [{ type: "text", text: "No pude leerlos." }] }
      ]
    });
    await chat(anthropic.client);

    const results = (anthropic.streamCalls[1]!.messagesAtCall as any[]).at(-1).content;
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result).toMatchObject({ type: "tool_result", is_error: true, content: "No encontré ese archivo en esta conversación." });
    }
    // Ninguna llamada a Haiku para leer un archivo ajeno.
    expect(anthropic.createCalls.filter((call) => call.system?.[0]?.text?.includes("lector de documentos"))).toHaveLength(0);
  });

  it("reads an owned attachment with Haiku over its extracted text", async () => {
    const file = seedFile(db);
    const conversationId = seedConversation(db);
    const anthropic = createAnthropic({
      streams: [
        { blocks: [{ type: "tool_use", name: "read_document", input: { file_id: file.id, pregunta: "¿Cuál es el premio?" } }] },
        { blocks: [{ type: "text", text: "El premio es $100." }] }
      ],
      creates: [{ blocks: [{ type: "text", text: "El premio mensual es $100." }] }]
    });
    const events = await chat(anthropic.client, { conversationId, message: "Mirá el informe", fileIds: [file.id as string] });

    // El archivo quedó vinculado a la conversación y el mensaje lo referencia.
    expect(db.rowsOf("gesti_files").find((row) => row.id === file.id)).toMatchObject({ conversation_id: conversationId });
    expect(events[0]).toMatchObject({ type: "meta", userMessage: { parts: { attachments: [{ fileId: file.id, name: "informe.pdf" }] } } });

    const haiku = anthropic.createCalls.find((call) => call.system?.[0]?.text?.includes("lector de documentos"))!;
    expect(haiku.model).toBe("claude-haiku-5-5");
    expect(haiku.messages[0].content[0].text).toContain("<documento");
    expect(haiku.messages[0].content.at(-1).text).toBe("Pregunta: ¿Cuál es el premio?");
    expect(db.rowsOf("gesti_usage").some((row) => row.purpose === "document")).toBe(true);
    expect(lastDone(events).content).toBe("El premio es $100.");
  });

  it("rejects fileIds of another user with a 404 before storing anything", async () => {
    const foreign = seedFile(db, { user_id: OTHER_USER });
    const anthropic = createAnthropic();

    await expect(chat(anthropic.client, { fileIds: [foreign.id as string] })).rejects.toMatchObject({ status: 404 });
    expect(db.rowsOf("gesti_messages")).toEqual([]);
    expect(db.rowsOf("gesti_conversations")).toEqual([]);
    expect(anthropic.streamCalls).toHaveLength(0);
  });

  it("sends only the last 12 stored messages as rebuilt text history", async () => {
    const conversationId = seedConversation(db);
    for (let index = 0; index < 14; index += 1) {
      const role = index % 2 === 0 ? "user" : "assistant";
      seedMessage(db, conversationId, role, role === "user" ? `mensaje ${index}` : `mensaje ${index} [[1]]`, index);
    }
    const anthropic = createAnthropic({ streams: [{ blocks: [{ type: "text", text: "ok" }] }] });
    await chat(anthropic.client, { conversationId, message: "Y ahora" });

    const sent = anthropic.streamCalls[0]!.messagesAtCall as Array<{ role: string; content: unknown }>;
    expect(HISTORY_MESSAGES).toBe(12);
    // 12 mensajes de historia (los dos primeros quedan afuera), más el actual.
    expect(sent).toHaveLength(13);
    expect(sent[0]).toEqual({ role: "user", content: "mensaje 2" });
    expect(JSON.stringify(sent)).not.toContain("[[1]]");
    expect(sent.at(-1)!.role).toBe("user");
    expect(anthropic.createCalls).toHaveLength(0); // no es un chat nuevo: sin título
  });
});

// ----- Historial -----

describe("MAIN_SYSTEM_PROMPT", () => {
  it("prefers short replies but allows a long one when the question needs it", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/Si la consulta lo amerita/);
    expect(MAIN_SYSTEM_PROMPT).not.toMatch(/más corta posible/);
    expect(MAIN_SYSTEM_PROMPT).not.toMatch(/en pocas líneas/);
    expect(MAIN_SYSTEM_PROMPT).toContain(String(MAX_REPLY_CHARS));
  });

  it("asks for a table, not a bullet list, when a reply lists several portfolio records", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/4 o más registros/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(/show_chart con kind "table"/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(/no repitas la lista en el texto/);
  });

  it("has the data agent return one record per line so it can become a table", () => {
    expect(DATA_AGENT_PROMPT).toMatch(/un registro por línea/);
    expect(DATA_AGENT_PROMPT).toContain(" | ");
  });

  it("has Gesti pass the record references to show_chart and never write them in the text", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/refs de show_chart/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(/nunca las escribas en el texto/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(/en el punto de tu respuesta donde querés que aparezca/);
  });

  it("has the data agent keep each record's reference on its line", () => {
    expect(DATA_AGENT_PROMPT).toMatch(/Mantenela en la línea de ese registro/);
    expect(DATA_AGENT_PROMPT).toContain("Ref | Vence");
  });
});

describe("buildHistory", () => {
  const message = (role: "user" | "assistant", content: string, parts: StoredGestiMessage["parts"] = {}): StoredGestiMessage => ({
    id: randomUUID(),
    role,
    content,
    parts,
    createdAt: NOW.toISOString()
  });
  const file = { fileId: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1", name: "informe.pdf", size: 10, mime: "application/pdf" };

  it("strips [[n]] markers and summarizes charts, questions and generated files in one line", () => {
    const history = buildHistory([
      message("user", "Hacé un resumen", { attachments: [file] }),
      message("assistant", "El tope es $10 [[1]] y sube [[2]] [[3]].", {
        sources: [{ url: "https://a.test", title: "A" }],
        charts: [{ kind: "table", title: "Cartera", columns: ["a"], rows: [["x"]] }],
        question: { question: "¿Cuál?", options: ["A", "B"], allowFreeText: true },
        documents: [{ fileId: "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2", name: "carta.docx", size: 5, mime: "x" }]
      })
    ], new Map([[file.fileId, 36]]));

    expect(history).toEqual([
      { role: "user", content: `Hacé un resumen\n[Adjunto: informe.pdf · file_id: ${file.fileId} · 36 páginas]` },
      {
        role: "assistant",
        content:
          "El tope es $10 y sube.\n[Gráfico mostrado: Cartera]\n[Pregunta hecha al usuario: ¿Cuál?]\n[Archivo generado: carta.docx · file_id: d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2]"
      }
    ]);
  });

  it("never includes chart links or ids, only the chart title", () => {
    const history = buildHistory([
      message("user", "Mostrame las tareas"),
      message("assistant", "Acá están.", {
        charts: [
          {
            kind: "table",
            title: "Tareas",
            columns: ["a"],
            rows: [["x"]],
            links: [{ kind: "policy", id: "p-secret-id", clientId: "c-secret-id" }],
            position: 5
          }
        ]
      })
    ]);

    expect(JSON.stringify(history)).not.toMatch(/secret|links|clientId|position/);
    expect(history[1]).toEqual({ role: "assistant", content: "Acá están.\n[Gráfico mostrado: Tareas]" });
  });

  it("drops notice replies, leading assistant messages and merges same-role neighbours", () => {
    const history = buildHistory([
      message("assistant", "Respuesta huérfana"),
      message("user", "Primera"),
      message("assistant", "No pude responder ahora.", { notice: "error" }),
      message("user", "Segunda"),
      message("assistant", "Listo")
    ]);

    expect(history).toEqual([
      { role: "user", content: "Primera\n\nSegunda" },
      { role: "assistant", content: "Listo" }
    ]);
  });
});

// ----- Acceso a conversaciones y rutas -----

describe("Gesti routes", () => {
  const api = () =>
    createApiHandler(gestiRoutes, {
      basePath: "/api/v1",
      authenticate: async () => authUser,
      resolveOrganization: async () => organization(),
      rateLimiter: new MemoryRateLimiter()
    });
  const call = (path: string, init: RequestInit = {}) =>
    api()(new Request(`https://norte.sinipro.com/api/v1${path}`, { ...init, headers: { authorization: "Bearer t", "content-type": "application/json", ...init.headers } }));

  it("answers 404 for another user's conversation on read, rename and chat, and never stores anything", async () => {
    const theirs = seedConversation(db, OTHER_USER, "Privado");
    seedMessage(db, theirs, "user", "secreto", 1);
    const anthropic = createAnthropic();
    hoisted.client = anthropic.client;

    const read = await call(`/gesti/conversations/${theirs}`);
    expect(read.status).toBe(404);
    expect(JSON.stringify(await read.json())).not.toContain("secreto");

    const rename = await call(`/gesti/conversations/${theirs}`, { method: "PATCH", body: JSON.stringify({ title: "Mío" }) });
    expect(rename.status).toBe(404);
    expect(db.rowsOf("gesti_conversations").find((row) => row.id === theirs)!.title).toBe("Privado");

    const talk = await call("/gesti/chat", { method: "POST", body: JSON.stringify({ conversationId: theirs, message: "hola", fileIds: [] }) });
    expect(talk.status).toBe(404);
    expect(db.rowsOf("gesti_messages")).toHaveLength(1);
    expect(anthropic.streamCalls).toHaveLength(0);

    const list = await call("/gesti/conversations");
    expect(await list.json()).toEqual([]);
  });

  it("lists, reads, renames and pins the owner's conversations", async () => {
    const mine = seedConversation(db, USER, "Mi chat");
    seedConversation(db, OTHER_USER, "Ajeno");
    seedMessage(db, mine, "assistant", "Hola [[1]]", 2, { sources: [{ url: "https://a.test", title: "A" }] });
    seedMessage(db, mine, "user", "Pregunta", 1);

    const list = (await (await call("/gesti/conversations")).json()) as Array<{ id: string; title: string; pinned: boolean }>;
    expect(list.map((item) => item.title)).toEqual(["Mi chat"]);

    const detail = (await (await call(`/gesti/conversations/${mine}`)).json()) as { messages: Array<{ role: string; parts: unknown }> };
    expect(detail.messages.map((item) => item.role)).toEqual(["user", "assistant"]);

    const patched = await call(`/gesti/conversations/${mine}`, { method: "PATCH", body: JSON.stringify({ title: "Renombrado", pinned: true }) });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ id: mine, title: "Renombrado", pinned: true });

    const empty = await call(`/gesti/conversations/${mine}`, { method: "PATCH", body: JSON.stringify({}) });
    expect(empty.status).toBe(400);
  });

  it("streams NDJSON from POST /gesti/chat through the router untouched", async () => {
    hoisted.client = createAnthropic({ streams: [{ blocks: [{ type: "text", text: "Hola" }] }] }).client;
    const response = await call("/gesti/chat", { method: "POST", body: JSON.stringify({ conversationId: null, message: "Hola", fileIds: [] }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    const events = await readEvents(response);
    expect(events[0]!.type).toBe("meta");
    expect(events.at(-1)!.type).toBe("done");
  });

  it("rejects a chat body without a message or files, and one over 64 KB", async () => {
    hoisted.client = createAnthropic().client;
    const empty = await call("/gesti/chat", { method: "POST", body: JSON.stringify({ conversationId: null, message: "  ", fileIds: [] }) });
    expect(empty.status).toBe(400);

    const huge = await call("/gesti/chat", {
      method: "POST",
      body: JSON.stringify({ conversationId: null, message: "x".repeat(70 * 1024), fileIds: [] })
    });
    expect(huge.status).toBe(413);
  });

  it("limits the chat route to 20 per minute and the uploads to 30", () => {
    const find = (method: string, path: string) => gestiRoutes.find((entry) => entry.method === method && entry.path === path)!;
    expect(find("POST", "/gesti/chat").rateLimit).toEqual({ limit: 20, ttlMs: 60_000 });
    expect(find("POST", "/gesti/chat").bodyLimitBytes).toBe(64 * 1024);
    expect(find("POST", "/gesti/files/uploads").rateLimit.limit).toBe(30);
  });

  it("signs uploads inside <org>/<user>/ and refuses types outside the allowlist or files over 30 MB", async () => {
    const ok = await call("/gesti/files/uploads", {
      method: "POST",
      body: JSON.stringify({ files: [{ name: "Informe Final.PDF", size: 1000, contentType: "application/pdf" }] })
    });
    expect(ok.status).toBe(201);
    const [upload] = (await ok.json()) as Array<{ path: string; contentType: string; signedUrl: string }>;
    expect(upload!.path).toMatch(new RegExp(`^${ORG}/${USER}/[0-9a-f-]{36}/informe-final\\.pdf$`));
    expect(upload!.contentType).toBe("application/pdf");

    const exe = await call("/gesti/files/uploads", {
      method: "POST",
      body: JSON.stringify({ files: [{ name: "virus.exe", size: 10, contentType: "application/x-msdownload" }] })
    });
    expect(exe.status).toBe(400);

    const big = await call("/gesti/files/uploads", {
      method: "POST",
      body: JSON.stringify({ files: [{ name: "grande.pdf", size: 31 * 1024 * 1024, contentType: "application/pdf" }] })
    });
    expect(big.status).toBe(400);
  });

  it("refuses to confirm paths outside the caller's own folder without touching storage", async () => {
    const foreignPath = `${ORG}/${OTHER_USER}/${randomUUID()}/informe.pdf`;
    db.objects.set(foreignPath, new Uint8Array([1]));
    const response = await call("/gesti/files", { method: "POST", body: JSON.stringify({ uploads: [{ path: foreignPath, name: "informe.pdf" }] }) });

    expect(response.status).toBe(400);
    expect(db.objects.has(foreignPath)).toBe(true); // ni se verifica ni se borra
    expect(db.rowsOf("gesti_files")).toEqual([]);

    const traversal = await call("/gesti/files", {
      method: "POST",
      body: JSON.stringify({ uploads: [{ path: `${ORG}/${USER}/../${OTHER_USER}/x/informe.pdf`, name: "x.pdf" }] })
    });
    expect(traversal.status).toBe(400);
  });

  it("serves a signed download URL only to the file's owner", async () => {
    const mine = seedFile(db);
    const theirs = seedFile(db, { user_id: OTHER_USER });

    const ok = await call(`/gesti/files/${mine.id}/url`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { url: string }).url).toContain(String(mine.path));

    expect((await call(`/gesti/files/${theirs.id}/url`)).status).toBe(404);
    expect((await call(`/gesti/files/${randomUUID()}/url`)).status).toBe(404);
  });

  it("has no way to delete a conversation or message", async () => {
    const mine = seedConversation(db);
    seedMessage(db, mine, "user", "hola", 1);

    expect((await call(`/gesti/conversations/${mine}`, { method: "DELETE" })).status).toBe(404);
    expect((await call(`/gesti/conversations/${mine}/messages/${randomUUID()}`, { method: "DELETE" })).status).toBe(404);
    expect(db.rowsOf("gesti_conversations")).toHaveLength(1);
    expect(db.rowsOf("gesti_messages")).toHaveLength(1);
  });
});

// ----- Consumo -----

describe("Gesti usage", () => {
  // La ruta usa la fecha real: se fija para que el mes sea el de los datos.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.GESTI_MONTHLY_BUDGET_USD;
  });

  const usageCall = (role: OrganizationContext["role"]) =>
    createApiHandler(gestiRoutes, {
      basePath: "/api/v1",
      authenticate: async () => authUser,
      resolveOrganization: async () => organization(role),
      rateLimiter: new MemoryRateLimiter()
    })(new Request("https://norte.sinipro.com/api/v1/gesti/usage", { headers: { authorization: "Bearer t" } }));

  it("shows the productor the global spend and this organization's per-user spend", async () => {
    db.rowsOf("user_profiles").push(
      { id: USER, full_name: "Ana", email: "ana@example.com" },
      { id: OTHER_USER, full_name: "Beto", email: "beto@example.com" }
    );
    seedUsage(db, 2.5, "2026-10-05T12:00:00.000Z", USER);
    seedUsage(db, 1.25, "2026-10-06T12:00:00.000Z", OTHER_USER);
    seedUsage(db, 10, "2026-10-07T12:00:00.000Z", OTHER_USER, OTHER_ORG); // otra organización
    seedUsage(db, 30, "2026-09-07T12:00:00.000Z", USER); // otro mes
    const conversation = seedConversation(db, USER);
    seedMessage(db, conversation, "user", "uno", 1);
    seedMessage(db, conversation, "assistant", "dos", 2);
    seedMessage(db, conversation, "user", "tres", 3);
    db.rowsOf("gesti_messages").forEach((row) => (row.created_at = String(row.created_at).replace("2026-10-20", "2026-10-21")));
    process.env.GESTI_MONTHLY_BUDGET_USD = "100";

    const response = await usageCall("productor");
    expect(response.status).toBe(200);
    const summary = (await response.json()) as Record<string, any>;
    expect(summary).toMatchObject({
      budgetUsd: 100,
      spentUsd: 13.75, // toda la cuenta de la API
      remainingUsd: 86.25,
      organizationSpentUsd: 3.75
    });
    expect(summary.month).toMatch(/^\d{4}-\d{2}$/);
    expect(summary.users).toEqual([
      { userId: USER, fullName: "Ana", email: "ana@example.com", spentUsd: 2.5, requests: 2 },
      { userId: OTHER_USER, fullName: "Beto", email: "beto@example.com", spentUsd: 1.25, requests: 0 }
    ]);
  });

  it("answers 403 to asesores and allows the platform admin", async () => {
    expect((await usageCall("asesor")).status).toBe(403);
    expect((await usageCall("platform_admin")).status).toBe(200);
  });
});

describe("UsageRecorder", () => {
  it("does not break the reply when a usage row cannot be stored", async () => {
    const failing = {
      admin: { from: () => ({ insert: async () => ({ error: { message: "db down", code: "XX000" } }) }) }
    } as unknown as SupabaseService;
    const recorder = new UsageRecorder(failing, { organizationId: ORG, userId: USER, conversationId: null });

    await expect(
      recorder.record("chat", "claude-sonnet-5-5", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 })
    ).resolves.toBeUndefined();
  });
});
