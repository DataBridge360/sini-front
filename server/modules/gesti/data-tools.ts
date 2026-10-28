import "server-only";
import { z } from "zod";
import type { AppSource, ChartLink } from "@/lib/gesti-parts";
import { Logger } from "@/server/core/logger";
import { escapeLikePattern, isIsoDate, pgrstQuote } from "@/server/core/postgrest";
import type { SupabaseService } from "@/server/core/supabase";
import type { RecordRegistry } from "./references";
import { toolInputSchema } from "./schemas";
import { addDays, argentinaToday, fetchAllRows } from "./usage";

// Herramientas del sub-agente de datos (Haiku). Son un conjunto FIJO de
// consultas de SOLO LECTURA, siempre filtradas por la organización de quien
// pregunta: el modelo no escribe SQL ni elige tablas, columnas ni filtros
// arbitrarios. Lo que devuelven son objetos planos con claves en español, sin
// ids ni uuids, sin nombres de columnas ni DNI (el DNI solo sirve para
// buscar). Lo único que identifica a un registro es una referencia opaca
// (`ref: "#Rk7q2-3"`) anotada en el registro del turno (references.ts): sirve para
// que show_chart abra el registro desde una tabla y no dice nada de la base.
// Un error de la base nunca llega al modelo: se registra acá y el modelo recibe
// un mensaje genérico.

const logger = new Logger("GestiDataTools");

export type DataToolContext = {
  supabase: SupabaseService;
  organizationId: string;
  now: Date;
  /** Referencias opacas de este turno (compartido con el chat y el sub-agente). */
  records: RecordRegistry;
};

export type DataToolResult = {
  /** JSON (string) que ve el modelo. */
  output: string;
  isError: boolean;
  appSources: AppSource[];
};

const GENERIC_ERROR = "No pude consultar ese dato en este momento.";
const MAX_OUTPUT_CHARS = 16_000;
const DEFAULT_LIMIT = 50;
const MAX_POLICY_ROWS_FOR_SUMMARY = 20_000;

class DataToolError extends Error {}

const limite = z.coerce.number().int().min(1).max(100).optional();
const texto = z.string().trim().min(1).max(120);
const isoDate = z.string().refine(isIsoDate, "Fecha inválida, usar AAAA-MM-DD");

const NOTICE_STATES = ["avisar", "avisado", "pagado"] as const;
const TASK_STATES = ["pendiente", "en_proceso", "revision", "finalizado"] as const;
const PAYMENT_METHODS = ["manual", "debito_automatico"] as const;

const buscarAseguradosInput = z.object({ texto });
const fichaAseguradoInput = z.object({ nombre: texto });
const listarAvisosInput = z.object({
  estado: z.enum(NOTICE_STATES).optional(),
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  compania: texto.optional(),
  limite
});
const listarPolizasInput = z.object({
  rama: texto.optional(),
  compania: texto.optional(),
  forma_pago: z.enum(PAYMENT_METHODS).optional(),
  texto: texto.optional(),
  limite
});
const resumenCarteraInput = z.object({});
const listarTareasInput = z.object({
  estado: z.enum(TASK_STATES).optional(),
  vencidas: z.boolean().optional(),
  limite
});

type DataToolDefinition = {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (input: never, context: DataToolContext) => Promise<{ data: unknown; appSources: AppSource[] }>;
};

const like = (value: string) => `%${escapeLikePattern(value)}%`;

type Row = Record<string, unknown>;
type QueryResult = PromiseLike<{ data: unknown; error: { message?: string; code?: string | null } | null; count?: number | null }>;

async function exec(scope: string, query: QueryResult): Promise<{ rows: Row[]; count: number | null }> {
  const { data, error, count } = await query;
  if (error) {
    logger.error(`${scope}: ${error.message ?? "unknown error"}`, error.code ?? undefined);
    throw new DataToolError(GENERIC_ERROR);
  }
  return { rows: (data ?? []) as Row[], count: count ?? null };
}

async function execCount(scope: string, query: QueryResult): Promise<number> {
  const { count } = await exec(scope, query);
  return count ?? 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nested(row: Row, key: string): Row {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

/**
 * `{ ref }` para el registro, o nada si le falta algún id para poder abrirlo
 * (el modelo lista el registro igual, pero la fila no será clickeable).
 */
function referenceFor(context: DataToolContext, link: ChartLink, requires: Array<keyof ChartLink> = []): { ref?: string } {
  if (!link.id || requires.some((key) => !link[key])) return {};
  const ref = context.records.register(link);
  return ref ? { ref } : {};
}

const idOf = (value: unknown) => str(value) ?? "";

function clientRef(context: DataToolContext, id: unknown) {
  return referenceFor(context, { kind: "client", id: idOf(id) });
}

function policyRef(context: DataToolContext, id: unknown, clientId: unknown) {
  return referenceFor(context, { kind: "policy", id: idOf(id), clientId: idOf(clientId) }, ["clientId"]);
}

function noticeRef(context: DataToolContext, id: unknown, policyId: unknown, clientId: unknown) {
  return referenceFor(context, { kind: "notice", id: idOf(id), policyId: idOf(policyId), clientId: idOf(clientId) }, [
    "policyId",
    "clientId"
  ]);
}

function paymentLabel(value: unknown) {
  return value === "debito_automatico" ? "débito automático" : "manual";
}

function toPolicy(row: Row) {
  return {
    compania: str(nested(row, "insurance_companies").name),
    rama: str(row.branch),
    numero: str(row.policy_number),
    patente: str(row.vehicle_plate),
    cadaMeses: typeof row.payment_interval_months === "number" ? row.payment_interval_months : null,
    formaPago: paymentLabel(row.payment_method),
    primerPago: str(row.first_payment_date)
  };
}

// ----- buscar_asegurados -----

async function buscarAsegurados({ texto: term }: z.infer<typeof buscarAseguradosInput>, context: DataToolContext) {
  const pattern = pgrstQuote(like(term));
  const filter = ["full_name", "email", "phone", "dni"].map((column) => `${column}.ilike.${pattern}`).join(",");
  const { rows } = await exec(
    "buscar_asegurados",
    context.supabase.admin
      .from("clients")
      .select("id,full_name,phone,email,locality,policies(count)")
      .eq("organization_id", context.organizationId)
      .eq("is_active", true)
      .eq("policies.is_active", true)
      .or(filter)
      .order("full_name", { ascending: true })
      .limit(20)
  );

  const data = rows.map((row) => ({
    ...clientRef(context, row.id),
    nombre: str(row.full_name),
    telefono: str(row.phone),
    email: str(row.email),
    localidad: str(row.locality),
    polizasActivas: Number((row.policies as Array<{ count?: number }> | undefined)?.[0]?.count ?? 0)
  }));
  return { data: { encontrados: data.length, asegurados: data }, appSources: ["clients" as const] };
}

// ----- ficha_asegurado -----

async function fichaAsegurado({ nombre }: z.infer<typeof fichaAseguradoInput>, context: DataToolContext) {
  const clients = await exec(
    "ficha_asegurado.clients",
    context.supabase.admin
      .from("clients")
      .select("id,full_name,phone,email,locality,address,birth_date,notes")
      .eq("organization_id", context.organizationId)
      .eq("is_active", true)
      .ilike("full_name", like(nombre))
      .order("full_name", { ascending: true })
      .limit(3)
  );
  if (clients.rows.length === 0) {
    return { data: { encontrados: 0, fichas: [] }, appSources: ["clients" as const] };
  }

  const clientIds = clients.rows.map((row) => String(row.id));
  const policies = await exec(
    "ficha_asegurado.policies",
    context.supabase.admin
      .from("policies")
      .select(
        "id,client_id,branch,policy_number,vehicle_plate,payment_interval_months,payment_method,first_payment_date,insurance_companies!policies_insurance_company_fk(name)"
      )
      .eq("organization_id", context.organizationId)
      .eq("is_active", true)
      .in("client_id", clientIds)
      .order("created_at", { ascending: false })
      .limit(60)
  );

  const policyIds = policies.rows.map((row) => String(row.id));
  const notices =
    policyIds.length === 0
      ? { rows: [] as Row[] }
      : await exec(
          "ficha_asegurado.notices",
          context.supabase.admin
            .from("policy_notices")
            .select("id,policy_id,due_date,status")
            .eq("organization_id", context.organizationId)
            .in("policy_id", policyIds)
            .is("deleted_at", null)
            .neq("status", "pagado")
            .order("due_date", { ascending: true })
            .limit(100)
        );

  const clientByPolicy = new Map(policies.rows.map((policy) => [String(policy.id), String(policy.client_id)] as const));
  const noticesByPolicy = new Map<string, Array<{ ref?: string; vence: string | null; estado: string | null }>>();
  for (const notice of notices.rows) {
    const key = String(notice.policy_id);
    const list = noticesByPolicy.get(key) ?? [];
    list.push({
      ...noticeRef(context, notice.id, notice.policy_id, clientByPolicy.get(key)),
      vence: str(notice.due_date),
      estado: str(notice.status)
    });
    noticesByPolicy.set(key, list);
  }

  const fichas = clients.rows.map((client) => ({
    ...clientRef(context, client.id),
    nombre: str(client.full_name),
    telefono: str(client.phone),
    email: str(client.email),
    localidad: str(client.locality),
    direccion: str(client.address),
    fechaNacimiento: str(client.birth_date),
    notas: str(client.notes)?.slice(0, 300) ?? null,
    polizas: policies.rows
      .filter((policy) => policy.client_id === client.id)
      .map((policy) => ({
        ...policyRef(context, policy.id, policy.client_id),
        ...toPolicy(policy),
        avisosPendientes: noticesByPolicy.get(String(policy.id)) ?? []
      }))
  }));

  return {
    data: { encontrados: fichas.length, fichas },
    appSources: ["clients" as const, "policies" as const, "notices" as const]
  };
}

// ----- listar_avisos -----

async function listarAvisos(input: z.infer<typeof listarAvisosInput>, context: DataToolContext) {
  const byCompany = Boolean(input.compania);
  const join = byCompany ? "!inner" : "";
  let query = context.supabase.admin
    .from("policy_notices")
    .select(
      `id,due_date,status,policies!policy_notices_policy_fk${join}(id,client_id,policy_number,branch,vehicle_plate,clients!policies_client_fk(full_name),insurance_companies!policies_insurance_company_fk${join}(name))`,
      { count: "exact" }
    )
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null);

  if (input.estado) query = query.eq("status", input.estado);
  if (input.desde) query = query.gte("due_date", input.desde);
  if (input.hasta) query = query.lte("due_date", input.hasta);
  if (input.compania) query = query.ilike("policies.insurance_companies.name", like(input.compania));

  const max = input.limite ?? DEFAULT_LIMIT;
  const { rows, count } = await exec(
    "listar_avisos",
    query.order("due_date", { ascending: true }).limit(max)
  );

  const avisos = rows.map((row) => {
    const policy = nested(row, "policies");
    return {
      ...noticeRef(context, row.id, policy.id, policy.client_id),
      vence: str(row.due_date),
      estado: str(row.status),
      compania: str(nested(policy, "insurance_companies").name),
      asegurado: str(nested(policy, "clients").full_name),
      poliza: str(policy.policy_number),
      rama: str(policy.branch),
      patente: str(policy.vehicle_plate)
    };
  });

  return {
    data: { total: count ?? avisos.length, mostrando: avisos.length, avisos },
    appSources: ["notices" as const, "policies" as const, ...(byCompany ? (["companies"] as const) : [])]
  };
}

// ----- listar_polizas -----

async function listarPolizas(input: z.infer<typeof listarPolizasInput>, context: DataToolContext) {
  const byCompany = Boolean(input.compania);
  const join = byCompany ? "!inner" : "";
  let query = context.supabase.admin
    .from("policies")
    .select(
      `id,client_id,branch,policy_number,vehicle_plate,payment_interval_months,payment_method,first_payment_date,clients!policies_client_fk(full_name),insurance_companies!policies_insurance_company_fk${join}(name)`,
      { count: "exact" }
    )
    .eq("organization_id", context.organizationId)
    .eq("is_active", true);

  if (input.rama) query = query.ilike("branch", like(input.rama));
  if (input.forma_pago) query = query.eq("payment_method", input.forma_pago);
  if (input.compania) query = query.ilike("insurance_companies.name", like(input.compania));

  if (input.texto) {
    const pattern = pgrstQuote(like(input.texto));
    const conditions = [`policy_number.ilike.${pattern}`, `vehicle_plate.ilike.${pattern}`];
    const matches = await exec(
      "listar_polizas.clients",
      context.supabase.admin
        .from("clients")
        .select("id")
        .eq("organization_id", context.organizationId)
        .eq("is_active", true)
        .ilike("full_name", like(input.texto))
        .limit(100)
    );
    if (matches.rows.length > 0) {
      conditions.push(`client_id.in.(${matches.rows.map((row) => String(row.id)).join(",")})`);
    }
    query = query.or(conditions.join(","));
  }

  const max = input.limite ?? DEFAULT_LIMIT;
  const { rows, count } = await exec(
    "listar_polizas",
    query.order("created_at", { ascending: false }).limit(max)
  );

  const polizas = rows.map((row) => ({
    ...policyRef(context, row.id, row.client_id),
    asegurado: str(nested(row, "clients").full_name),
    ...toPolicy(row)
  }));

  return {
    data: { total: count ?? polizas.length, mostrando: polizas.length, polizas },
    appSources: ["policies" as const, "clients" as const, ...(byCompany ? (["companies"] as const) : [])]
  };
}

// ----- resumen_cartera -----

async function resumenCartera(_input: z.infer<typeof resumenCarteraInput>, context: DataToolContext) {
  const { supabase, organizationId } = context;
  const today = argentinaToday(context.now);
  const noticeBase = () =>
    supabase.admin
      .from("policy_notices")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("deleted_at", null);
  const unpaid = () => noticeBase().neq("status", "pagado");

  const [clientCount, policyRows, avisar, avisado, pagado, vencidos, proximos7, proximos30] = await Promise.all([
    execCount(
      "resumen_cartera.clients",
      supabase.admin
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("is_active", true)
    ),
    fetchAllRows<Row>(
      (from, to) =>
        supabase.admin
          .from("policies")
          .select("branch,insurance_companies!policies_insurance_company_fk(id,name)")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("created_at", { ascending: true })
          .range(from, to),
      "resumen_cartera.policies"
    ).catch((error: unknown) => {
      logger.error("resumen_cartera.policies", error);
      throw new DataToolError(GENERIC_ERROR);
    }),
    execCount("resumen_cartera.avisar", noticeBase().eq("status", "avisar")),
    execCount("resumen_cartera.avisado", noticeBase().eq("status", "avisado")),
    execCount("resumen_cartera.pagado", noticeBase().eq("status", "pagado")),
    execCount("resumen_cartera.vencidos", unpaid().lt("due_date", today)),
    execCount(
      "resumen_cartera.proximos7",
      unpaid().gte("due_date", today).lte("due_date", addDays(today, 7))
    ),
    execCount(
      "resumen_cartera.proximos30",
      unpaid().gte("due_date", today).lte("due_date", addDays(today, 30))
    )
  ]);

  const capped = policyRows.slice(0, MAX_POLICY_ROWS_FOR_SUMMARY);
  const byBranch = new Map<string, number>();
  const byCompany = new Map<string, number>();
  const companyIds = new Map<string, string>();
  for (const policy of capped) {
    const branch = str(policy.branch) ?? "Sin rama";
    const companyRow = nested(policy, "insurance_companies");
    const company = str(companyRow.name) ?? "Sin compañía";
    const companyId = str(companyRow.id);
    if (companyId) companyIds.set(company, companyId);
    byBranch.set(branch, (byBranch.get(branch) ?? 0) + 1);
    byCompany.set(company, (byCompany.get(company) ?? 0) + 1);
  }
  const ranked = (map: Map<string, number>, refs?: Map<string, string>) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([nombre, polizas]) => ({
        ...(refs ? referenceFor(context, { kind: "company", id: refs.get(nombre) ?? "" }) : {}),
        nombre,
        polizas
      }));

  return {
    data: {
      fecha: today,
      asegurados: clientCount,
      polizasActivas: capped.length,
      polizasPorRama: ranked(byBranch),
      polizasPorCompania: ranked(byCompany, companyIds),
      avisosPorEstado: { avisar, avisado, pagado },
      avisosVencidosSinPagar: vencidos,
      avisosSinPagarProximos7Dias: proximos7,
      avisosSinPagarProximos30Dias: proximos30
    },
    appSources: ["clients" as const, "policies" as const, "notices" as const, "companies" as const]
  };
}

// ----- listar_tareas -----

async function listarTareas(input: z.infer<typeof listarTareasInput>, context: DataToolContext) {
  let query = context.supabase.admin
    .from("tasks")
    .select(
      "id,title,status,priority,due_date,assigned_to:user_profiles!tasks_assigned_to_user_id_fkey(full_name),clients!tasks_client_fk(full_name)",
      { count: "exact" }
    )
    .eq("organization_id", context.organizationId);

  if (input.estado) {
    query = query.eq("status", input.estado);
  } else {
    // Sin estado: lo que sigue abierto.
    query = query.neq("status", "finalizado");
  }
  if (input.vencidas) {
    query = query.neq("status", "finalizado").lt("due_date", argentinaToday(context.now));
  }

  const max = input.limite ?? DEFAULT_LIMIT;
  const { rows, count } = await exec(
    "listar_tareas",
    query.order("due_date", { ascending: true, nullsFirst: false }).limit(max)
  );

  const tareas = rows.map((row) => ({
    ...referenceFor(context, { kind: "task", id: idOf(row.id) }),
    titulo: str(row.title),
    estado: str(row.status),
    prioridad: str(row.priority),
    vence: str(row.due_date),
    responsable: str(nested(row, "assigned_to").full_name),
    asegurado: str(nested(row, "clients").full_name)
  }));

  return {
    data: { total: count ?? tareas.length, mostrando: tareas.length, tareas },
    appSources: ["tasks" as const]
  };
}

const DEFINITIONS: DataToolDefinition[] = [
  {
    name: "buscar_asegurados",
    description:
      "Busca asegurados activos por nombre, DNI, email o teléfono. Devuelve datos de contacto y cuántas pólizas activas tiene cada uno (máximo 20).",
    schema: buscarAseguradosInput,
    run: buscarAsegurados as DataToolDefinition["run"]
  },
  {
    name: "ficha_asegurado",
    description:
      "Ficha de un asegurado por nombre: contacto, pólizas activas (compañía, rama, número, patente, forma de pago) y avisos de pago pendientes de cada póliza.",
    schema: fichaAseguradoInput,
    run: fichaAsegurado as DataToolDefinition["run"]
  },
  {
    name: "listar_avisos",
    description:
      "Lista avisos de pago de pólizas ordenados por vencimiento. estado: avisar (falta avisar al asegurado), avisado (ya se le avisó), pagado. desde/hasta: fechas AAAA-MM-DD sobre el vencimiento. compania: nombre o parte del nombre. limite hasta 100 (50 por defecto).",
    schema: listarAvisosInput,
    run: listarAvisos as DataToolDefinition["run"]
  },
  {
    name: "listar_polizas",
    description:
      "Lista pólizas activas. Filtros opcionales: rama, compania (nombre o parte), forma_pago (manual o debito_automatico), texto (número de póliza, patente o nombre del asegurado). limite hasta 100 (50 por defecto).",
    schema: listarPolizasInput,
    run: listarPolizas as DataToolDefinition["run"]
  },
  {
    name: "resumen_cartera",
    description:
      "Resumen general de la cartera: cantidad de asegurados y pólizas activas, pólizas por rama y por compañía, avisos por estado, avisos vencidos sin pagar y avisos sin pagar que vencen en 7 y 30 días.",
    schema: resumenCarteraInput,
    run: resumenCartera as DataToolDefinition["run"]
  },
  {
    name: "listar_tareas",
    description:
      "Lista tareas del equipo ordenadas por vencimiento. estado: pendiente, en_proceso, revision o finalizado (sin estado: las abiertas). vencidas: solo las abiertas con fecha vencida. limite hasta 100 (50 por defecto).",
    schema: listarTareasInput,
    run: listarTareas as DataToolDefinition["run"]
  }
];

/** Nombres de las herramientas del sub-agente (lista cerrada). */
export const DATA_TOOL_NAMES = DEFINITIONS.map((definition) => definition.name);

/** Definiciones para la API de Anthropic. La última lleva cache_control. */
export const DATA_TOOL_DEFINITIONS = DEFINITIONS.map((definition, index) => ({
  name: definition.name,
  description: definition.description,
  input_schema: toolInputSchema(definition.schema),
  ...(index === DEFINITIONS.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {})
}));

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ID_KEY_PATTERN = /^(id|uuid)$|(_id|_uuid|Id|Uuid)$/;

/**
 * Última barrera antes de que algo llegue al modelo: quita claves que parecen
 * ids y oculta cualquier uuid que se haya colado dentro de un texto.
 */
export function sanitizeForModel(value: unknown): unknown {
  if (typeof value === "string") return value.replace(UUID_PATTERN, "[oculto]");
  if (Array.isArray(value)) return value.map(sanitizeForModel);
  if (value && typeof value === "object") {
    const clean: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (ID_KEY_PATTERN.test(key)) continue;
      clean[key] = sanitizeForModel(item);
    }
    return clean;
  }
  return value;
}

function serialize(data: unknown): string {
  const json = JSON.stringify(sanitizeForModel(data));
  return json.length > MAX_OUTPUT_CHARS ? `${json.slice(0, MAX_OUTPUT_CHARS)}… [resultado recortado]` : json;
}

function failure(message: string): DataToolResult {
  return { output: JSON.stringify({ error: message }), isError: true, appSources: [] };
}

/** Ejecuta una herramienta del sub-agente. Nunca lanza: los errores vuelven genéricos. */
export async function runDataTool(name: string, input: unknown, context: DataToolContext): Promise<DataToolResult> {
  const definition = DEFINITIONS.find((candidate) => candidate.name === name);
  if (!definition) return failure("Herramienta no disponible.");

  const parsed = definition.schema.safeParse(input ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "entrada"}: ${issue.message}`).join("; ");
    return failure(`Parámetros inválidos (${detail.slice(0, 300)}).`);
  }

  try {
    const result = await definition.run(parsed.data as never, context);
    return { output: serialize(result.data), isError: false, appSources: result.appSources };
  } catch (error) {
    if (!(error instanceof DataToolError)) {
      logger.error(`${name}: unexpected error`, error);
    }
    return failure(GENERIC_ERROR);
  }
}
