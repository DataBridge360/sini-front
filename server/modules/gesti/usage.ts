import "server-only";
import type { GestiUsageSummary } from "@/lib/gesti-contract";
import { Logger } from "@/server/core/logger";
import type { SupabaseService } from "@/server/core/supabase";
import { supabaseError } from "@/server/core/supabase-error";
import { costUsd, type CallUsage } from "./pricing";

// Consumo de Gesti: una fila de gesti_usage por llamada al modelo, el tope
// mensual (global para la cuenta de la API) y el panel del productor.

const logger = new Logger("GestiUsage");

export type UsagePurpose = "chat" | "title" | "data" | "document";

// Argentina no tiene horario de verano: UTC-3 todo el año.
const ARGENTINA_OFFSET_MS = 3 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

export type MonthBounds = {
  /** "2026-10". */
  month: string;
  /** Inicio del mes en hora de Argentina, como instante UTC (inclusive). */
  startIso: string;
  /** Inicio del mes siguiente (exclusivo). */
  endIso: string;
};

/** Mes calendario en hora de Argentina que contiene `now`. */
export function argentinaMonthBounds(now: Date): MonthBounds {
  const local = new Date(now.getTime() - ARGENTINA_OFFSET_MS);
  const year = local.getUTCFullYear();
  const monthIndex = local.getUTCMonth();
  const start = new Date(Date.UTC(year, monthIndex, 1) + ARGENTINA_OFFSET_MS);
  const end = new Date(Date.UTC(year, monthIndex + 1, 1) + ARGENTINA_OFFSET_MS);
  return {
    month: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}

/** Fecha de hoy en Argentina como YYYY-MM-DD. */
export function argentinaToday(now: Date): string {
  return new Date(now.getTime() - ARGENTINA_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Primer día del mes siguiente, para decir cuándo vuelve Gesti: "1 de noviembre". */
export function nextMonthLabel(now: Date): string {
  const end = new Date(argentinaMonthBounds(now).endIso);
  const label = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    timeZone: "America/Argentina/Buenos_Aires"
  }).format(end);
  return label;
}

type PageResult = PromiseLike<{ data: unknown[] | null; error: { message?: string; code?: string | null } | null }>;

/** Lee todas las filas de una consulta paginando de a 1000 (tope por defecto de PostgREST). */
export async function fetchAllRows<T>(page: (from: number, to: number) => PageResult, scope: string): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) {
      throw supabaseError(logger, scope, error, "No se pudo obtener el consumo.");
    }
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

type UsageRow = { organization_id: string; user_id: string; cost_usd: number | string };

/** Gastado en el mes por toda la cuenta de la API. */
export async function monthSpendUsd(supabase: SupabaseService, now: Date): Promise<number> {
  const bounds = argentinaMonthBounds(now);
  const rows = await fetchAllRows<Pick<UsageRow, "cost_usd">>(
    (from, to) =>
      supabase.admin
        .from("gesti_usage")
        .select("cost_usd")
        .gte("created_at", bounds.startIso)
        .lt("created_at", bounds.endIso)
        .order("created_at", { ascending: true })
        .range(from, to),
    "gesti.monthSpend"
  );
  return roundUsd(rows.reduce((sum, row) => sum + Number(row.cost_usd), 0));
}

export type UsageScope = {
  organizationId: string;
  userId: string;
  conversationId: string | null;
};

/** Registra el costo de cada llamada al modelo. Un fallo al registrar no corta la respuesta. */
export class UsageRecorder {
  constructor(
    private readonly supabase: SupabaseService,
    private scope: UsageScope
  ) {}

  setConversation(conversationId: string) {
    this.scope = { ...this.scope, conversationId };
  }

  async record(purpose: UsagePurpose, model: string, usage: CallUsage) {
    const { error } = await this.supabase.admin.from("gesti_usage").insert({
      organization_id: this.scope.organizationId,
      user_id: this.scope.userId,
      conversation_id: this.scope.conversationId,
      purpose,
      model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_tokens: usage.cacheReadTokens,
      cache_write_tokens: usage.cacheWriteTokens,
      web_searches: usage.webSearches,
      cost_usd: costUsd(model, usage)
    });
    if (error) {
      logger.error(`record(${purpose}): ${error.message}`, error.code ?? undefined);
    }
  }
}

type SdkUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

/** `usage` del SDK de Anthropic → CallUsage (los campos opcionales cuentan como 0). */
export function callUsageFromSdk(usage: SdkUsage | null | undefined): CallUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    webSearches: usage?.server_tool_use?.web_search_requests ?? 0
  };
}

function roundUsd(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * GET /gesti/usage: el tope es global, el detalle por usuario es de la
 * organización que consulta. "requests" son los mensajes que escribió cada
 * persona en el mes (un mensaje puede disparar varias llamadas al modelo).
 */
export async function usageSummary(
  supabase: SupabaseService,
  organizationId: string,
  budgetUsd: number,
  now: Date
): Promise<GestiUsageSummary> {
  const bounds = argentinaMonthBounds(now);

  const usageRows = await fetchAllRows<UsageRow>(
    (from, to) =>
      supabase.admin
        .from("gesti_usage")
        .select("organization_id,user_id,cost_usd")
        .gte("created_at", bounds.startIso)
        .lt("created_at", bounds.endIso)
        .order("created_at", { ascending: true })
        .range(from, to),
    "gesti.usageSummary.usage"
  );

  let spent = 0;
  let organizationSpent = 0;
  const spentByUser = new Map<string, number>();
  for (const row of usageRows) {
    const cost = Number(row.cost_usd);
    spent += cost;
    if (row.organization_id === organizationId) {
      organizationSpent += cost;
      spentByUser.set(row.user_id, (spentByUser.get(row.user_id) ?? 0) + cost);
    }
  }

  const requestsByUser = await countUserMessages(supabase, organizationId, bounds);

  const userIds = [...new Set([...spentByUser.keys(), ...requestsByUser.keys()])];
  const profiles = await loadProfiles(supabase, userIds);

  const users = userIds
    .map((userId) => ({
      userId,
      fullName: profiles.get(userId)?.fullName ?? "Usuario",
      email: profiles.get(userId)?.email ?? "",
      spentUsd: roundUsd(spentByUser.get(userId) ?? 0),
      requests: requestsByUser.get(userId) ?? 0
    }))
    .sort((a, b) => b.spentUsd - a.spentUsd || b.requests - a.requests);

  const spentUsd = roundUsd(spent);
  return {
    month: bounds.month,
    budgetUsd,
    spentUsd,
    remainingUsd: roundUsd(Math.max(0, budgetUsd - spentUsd)),
    organizationSpentUsd: roundUsd(organizationSpent),
    users
  };
}

async function countUserMessages(supabase: SupabaseService, organizationId: string, bounds: MonthBounds) {
  const messages = await fetchAllRows<{ conversation_id: string }>(
    (from, to) =>
      supabase.admin
        .from("gesti_messages")
        .select("conversation_id")
        .eq("organization_id", organizationId)
        .eq("role", "user")
        .gte("created_at", bounds.startIso)
        .lt("created_at", bounds.endIso)
        .order("created_at", { ascending: true })
        .range(from, to),
    "gesti.usageSummary.messages"
  );
  if (messages.length === 0) return new Map<string, number>();

  const conversations = await fetchAllRows<{ id: string; user_id: string }>(
    (from, to) =>
      supabase.admin
        .from("gesti_conversations")
        .select("id,user_id")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true })
        .range(from, to),
    "gesti.usageSummary.conversations"
  );
  const ownerByConversation = new Map(conversations.map((row) => [row.id, row.user_id]));

  const counts = new Map<string, number>();
  for (const message of messages) {
    const owner = ownerByConversation.get(message.conversation_id);
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return counts;
}

async function loadProfiles(supabase: SupabaseService, userIds: string[]) {
  const profiles = new Map<string, { fullName: string; email: string }>();
  if (userIds.length === 0) return profiles;

  const { data, error } = await supabase.admin
    .from("user_profiles")
    .select("id,full_name,email")
    .in("id", userIds);
  if (error) {
    throw supabaseError(logger, "gesti.usageSummary.profiles", error, "No se pudo obtener el consumo.");
  }
  for (const row of (data ?? []) as Array<{ id: string; full_name: string; email: string }>) {
    profiles.set(row.id, { fullName: row.full_name, email: row.email });
  }
  return profiles;
}
