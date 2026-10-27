import { describe, expect, it, vi } from "vitest";
import type { SupabaseService } from "@/server/core/supabase";
import {
  DATA_TOOL_DEFINITIONS,
  DATA_TOOL_NAMES,
  runDataTool,
  sanitizeForModel,
  type DataToolContext
} from "@/server/modules/gesti/data-tools";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-27T15:00:00Z");

type Call = [method: string, args: unknown[]];
type Query = { table: string; calls: Call[] };
type Response = { data?: unknown; count?: number | null; error?: { message: string; code?: string } | null };

// Supabase mínimo: registra cada consulta (tabla + llamadas encadenadas) y
// responde lo que diga `respond`. Las filas incluyen a propósito ids, DNI y
// columnas que NO deben llegar al modelo.
function fakeSupabase(respond: (query: Query) => Response) {
  const queries: Query[] = [];
  const admin = {
    from(table: string) {
      const query: Query = { table, calls: [] };
      queries.push(query);
      const chain: unknown = new Proxy(
        {},
        {
          get(_target, property) {
            if (property === "then") {
              return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
                Promise.resolve({ data: null, count: null, error: null, ...respond(query) }).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              query.calls.push([String(property), args]);
              return chain;
            };
          }
        }
      );
      return chain;
    }
  };
  return { supabase: { admin } as unknown as SupabaseService, queries };
}

function contextFor(supabase: SupabaseService): DataToolContext {
  return { supabase, organizationId: ORG, now: NOW };
}

const hasOrgFilter = (query: Query) =>
  query.calls.some(([method, args]) => method === "eq" && args[0] === "organization_id" && args[1] === ORG);

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete", "rpc"]);

const tableData: Record<string, unknown> = {
  clients: [
    {
      id: CLIENT_ID,
      organization_id: ORG,
      full_name: "Ana Pérez",
      phone: "11 5555-0000",
      email: "ana@example.com",
      locality: "Rosario",
      address: "Mitre 100",
      birth_date: "1980-02-03",
      notes: "Prefiere WhatsApp",
      dni: "30111222",
      policies: [{ count: 2 }]
    }
  ],
  policies: [
    {
      id: POLICY_ID,
      client_id: CLIENT_ID,
      organization_id: ORG,
      branch: "Automotor",
      policy_number: "AU-123",
      vehicle_plate: "AB123CD",
      payment_interval_months: 1,
      payment_method: "manual",
      first_payment_date: "2026-01-10",
      clients: { id: CLIENT_ID, full_name: "Ana Pérez" },
      insurance_companies: { id: "44444444-4444-4444-8444-444444444444", name: "La Segunda" }
    }
  ],
  policy_notices: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      policy_id: POLICY_ID,
      due_date: "2026-10-30",
      status: "avisar",
      policies: {
        policy_number: "AU-123",
        branch: "Automotor",
        vehicle_plate: "AB123CD",
        clients: { full_name: "Ana Pérez" },
        insurance_companies: { name: "La Segunda" }
      }
    }
  ],
  tasks: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      title: "Llamar a Ana",
      status: "pendiente",
      priority: "alta",
      due_date: "2026-10-26",
      assigned_to: { id: "77777777-7777-4777-8777-777777777777", full_name: "Lucas" },
      clients: { id: CLIENT_ID, full_name: "Ana Pérez" }
    }
  ]
};

function standardFake() {
  return fakeSupabase((query) => {
    const isCount = query.calls.some(([method, args]) => method === "select" && (args[1] as { head?: boolean } | undefined)?.head);
    if (isCount) return { data: null, count: 7 };
    return { data: tableData[query.table] ?? [], count: Array.isArray(tableData[query.table]) ? (tableData[query.table] as unknown[]).length : null };
  });
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key);
      collectKeys(item, keys);
    }
  }
  return keys;
}

const CALLS: Array<[string, unknown]> = [
  ["buscar_asegurados", { texto: "Pérez" }],
  ["ficha_asegurado", { nombre: "Ana" }],
  ["listar_avisos", { estado: "avisar", desde: "2026-10-01", hasta: "2026-10-31", compania: "Segunda", limite: 20 }],
  ["listar_polizas", { rama: "Auto", compania: "Segunda", forma_pago: "manual", texto: "Ana" }],
  ["resumen_cartera", {}],
  ["listar_tareas", { vencidas: true }]
];

describe("Gesti data tools", () => {
  it.each(CALLS)("%s returns no id-like keys, uuids or DNI, and only reads the caller's organization", async (name, input) => {
    const { supabase, queries } = standardFake();
    const result = await runDataTool(name, input, contextFor(supabase));

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output) as unknown;
    expect(parsed).toBeTruthy();

    for (const key of collectKeys(parsed)) {
      expect(key).not.toMatch(/^(id|uuid)$|(_id|_uuid|Id|Uuid)$/);
      expect(key).not.toMatch(/organization|dni|created_at|updated_at/i);
    }
    expect(result.output).not.toMatch(UUID_PATTERN);
    expect(result.output).not.toContain("30111222");
    expect(result.output).not.toContain(ORG);

    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(hasOrgFilter(query), `${query.table} query must filter by organization`).toBe(true);
      expect(query.calls.filter(([method]) => WRITE_METHODS.has(method))).toEqual([]);
    }
  });

  it("builds the client file from clients, policies and pending notices, grouped without ids", async () => {
    const { supabase, queries } = standardFake();
    const result = await runDataTool("ficha_asegurado", { nombre: "Ana" }, contextFor(supabase));
    const parsed = JSON.parse(result.output) as { fichas: Array<Record<string, unknown>> };

    expect(queries.map((query) => query.table)).toEqual(["clients", "policies", "policy_notices"]);
    expect(parsed.fichas[0]).toMatchObject({
      nombre: "Ana Pérez",
      localidad: "Rosario",
      polizas: [
        {
          compania: "La Segunda",
          rama: "Automotor",
          numero: "AU-123",
          patente: "AB123CD",
          formaPago: "manual",
          avisosPendientes: [{ vence: "2026-10-30", estado: "avisar" }]
        }
      ]
    });
    expect(result.appSources).toEqual(["clients", "policies", "notices"]);
  });

  it("uses the Argentina day and head counts for the portfolio summary", async () => {
    const { supabase, queries } = standardFake();
    const result = await runDataTool("resumen_cartera", {}, contextFor(supabase));
    const parsed = JSON.parse(result.output) as Record<string, unknown>;

    expect(parsed.fecha).toBe("2026-10-27");
    expect(parsed.asegurados).toBe(7);
    expect(parsed.avisosPorEstado).toEqual({ avisar: 7, avisado: 7, pagado: 7 });
    expect(parsed.avisosVencidosSinPagar).toBe(7);
    expect(parsed.polizasPorRama).toEqual([{ nombre: "Automotor", polizas: 1 }]);
    expect(parsed.polizasPorCompania).toEqual([{ nombre: "La Segunda", polizas: 1 }]);

    const dates = queries.flatMap((query) =>
      query.calls.filter(([method]) => ["lt", "gte", "lte"].includes(method)).map(([method, args]) => `${method}:${String(args[1])}`)
    );
    expect(dates).toEqual(["lt:2026-10-27", "gte:2026-10-27", "lte:2026-11-03", "gte:2026-10-27", "lte:2026-11-26"]);
  });

  it("filters notices by company through the joined company name and caps the page size", async () => {
    const { supabase, queries } = standardFake();
    await runDataTool("listar_avisos", { compania: "Segunda", limite: 20 }, contextFor(supabase));
    const [query] = queries;

    const select = query!.calls.find(([method]) => method === "select")![1][0] as string;
    expect(select).toContain("policy_notices_policy_fk!inner");
    expect(query!.calls).toContainEqual(["ilike", ["policies.insurance_companies.name", "%Segunda%"]]);
    expect(query!.calls).toContainEqual(["limit", [20]]);

    const tooMany = await runDataTool("listar_avisos", { limite: 500 }, contextFor(standardFake().supabase));
    expect(tooMany.isError).toBe(true);
  });

  it("escapes LIKE wildcards and PostgREST quotes in free text searches", async () => {
    const { supabase, queries } = standardFake();
    await runDataTool("buscar_asegurados", { texto: 'Pe"rez, 100%_' }, contextFor(supabase));

    const filter = queries[0]!.calls.find(([method]) => method === "or")![1][0] as string;
    // escapeLikePattern pone "\%" y pgrstQuote duplica la barra dentro de las comillas.
    expect(filter).toContain('full_name.ilike."%Pe\\"rez, 100\\\\%\\\\_%"');
    expect(filter).toContain("dni.ilike.");
  });

  it("answers database failures with a generic message, never the Postgres error", async () => {
    const { supabase } = fakeSupabase(() => ({
      error: { message: 'relation "public.clients" does not exist (secret_column)', code: "42P01" }
    }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await runDataTool("buscar_asegurados", { texto: "Ana" }, contextFor(supabase));
    spy.mockRestore();

    expect(result.isError).toBe(true);
    expect(result.output).not.toMatch(/relation|public\.|secret_column|42P01/);
    expect(JSON.parse(result.output)).toEqual({ error: "No pude consultar ese dato en este momento." });
  });

  it("rejects unknown tools and invalid input without querying anything", async () => {
    const { supabase, queries } = standardFake();

    expect((await runDataTool("run_sql", { query: "select * from clients" }, contextFor(supabase))).isError).toBe(true);
    expect((await runDataTool("delete_policy", { id: POLICY_ID }, contextFor(supabase))).isError).toBe(true);
    expect((await runDataTool("listar_avisos", { desde: "mañana" }, contextFor(supabase))).isError).toBe(true);
    expect((await runDataTool("ficha_asegurado", {}, contextFor(supabase))).isError).toBe(true);
    expect(queries).toEqual([]);
  });

  it("exposes a closed list of read-only tools to the sub-agent", () => {
    expect(DATA_TOOL_NAMES).toEqual([
      "buscar_asegurados",
      "ficha_asegurado",
      "listar_avisos",
      "listar_polizas",
      "resumen_cartera",
      "listar_tareas"
    ]);
    expect(DATA_TOOL_NAMES.some((name) => /delete|borrar|update|insert|sql|write/i.test(name))).toBe(false);
    for (const definition of DATA_TOOL_DEFINITIONS) {
      expect(definition.input_schema.type).toBe("object");
    }
    expect(DATA_TOOL_DEFINITIONS.at(-1)).toMatchObject({ cache_control: { type: "ephemeral" } });
  });
});

describe("sanitizeForModel", () => {
  it("drops id-like keys and hides uuids inside text", () => {
    const clean = sanitizeForModel({
      id: CLIENT_ID,
      client_id: CLIENT_ID,
      policyId: POLICY_ID,
      nombre: "Ana",
      notas: `ref ${CLIENT_ID} importante`,
      polizas: [{ uuid: POLICY_ID, numero: "AU-1", paid: true }]
    });

    expect(clean).toEqual({
      nombre: "Ana",
      notas: "ref [oculto] importante",
      polizas: [{ numero: "AU-1", paid: true }]
    });
  });
});
