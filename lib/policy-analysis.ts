import type { Client, InsuranceCompany } from "@/lib/api";
import type { PolicyFormValues } from "@/lib/shell-types";

// Espejo de la respuesta de POST /policies/analyze. El backend es la fuente de
// verdad del schema (backend/src/policy-analysis/policy-analysis.schema.ts).
export type PolicyAnalysisCoverage = {
  nombre: string;
  sumaAsegurada: string | null;
  franquicia: string | null;
};

/** Datos del tomador: alcanzan para dar de alta el asegurado sin tipear nada. */
export type PolicyTomador = {
  nombre: string | null;
  documentoTipo: string | null;
  documentoNumero: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
  fechaNacimiento: string | null;
};

export type PolicyAnalysisExtraction = {
  compania: string | null;
  numeroPoliza: string | null;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  tipo: string;
  tipoDetalle: string | null;
  tomador: PolicyTomador;
  /** Solo viene cuando el asegurado difiere del tomador. */
  asegurado: string | null;
  beneficiario: string | null;
  bienAsegurado: {
    categoria: "vehiculo" | "persona" | "inmueble" | "comercio" | "otro";
    descripcion: string | null;
    vehiculo: {
      marca: string | null;
      modelo: string | null;
      anio: number | null;
      patente: string | null;
      uso: string | null;
    } | null;
    ubicacion: {
      direccion: string | null;
      localidad: string | null;
      actividad: string | null;
      destino: string | null;
    } | null;
  };
  coberturas: PolicyAnalysisCoverage[];
  cantidadCuotas: number | null;
  alertas: string[];
};

export type PolicyAnalysis = {
  extraccion: PolicyAnalysisExtraction;
  mensaje: string;
  meta: {
    modelo: string;
    version: number;
    paginas: number;
    sinCapaDeTexto: boolean;
    latenciaMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    costoUsdEstimado: number | null;
  };
};

export const ANALYSIS_ACCEPT = "application/pdf,.pdf";

// ---------------------------------------------------------------------------
// Matching contra el padrón de la organización.
//
// El PDF trae texto libre ("PEREZ, JUAN CARLOS", "SANCOR COOPERATIVA DE SEGUROS
// LIMITADA") y hay que llevarlo a un id. Se resuelve acá y no en el backend
// porque el shell ya tiene las listas completas de clientes y compañías en
// memoria: cero round-trips.
// ---------------------------------------------------------------------------

export type Match<T> = { item: T; confidence: "alta" | "media" } | null;

function norm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_STOPWORDS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "EL", "Y"]);

function tokens(value: string, stopwords: Set<string>): Set<string> {
  return new Set(
    norm(value)
      .split(" ")
      .filter((word) => word.length >= 3 && !stopwords.has(word))
  );
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/** Coeficiente de Dice sobre bigramas: tolera typos y abreviaturas. */
function diceSimilarity(a: string, b: string): number {
  const bigrams = (value: string) => {
    const result = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const pair = value.slice(index, index + 2);
      result.set(pair, (result.get(pair) ?? 0) + 1);
    }
    return result;
  };

  const first = bigrams(a);
  const second = bigrams(b);
  if (first.size === 0 || second.size === 0) return 0;

  let shared = 0;
  for (const [pair, count] of first) {
    shared += Math.min(count, second.get(pair) ?? 0);
  }
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

/**
 * Devuelve el único candidato o null. Que haya empate se trata como "no hay
 * match" a propósito: colgarle la póliza al asegurado equivocado es peor que
 * dejar el campo vacío y que la persona lo elija.
 */
function onlyOne<T>(candidates: T[], confidence: "alta" | "media"): Match<T> {
  return candidates.length === 1 ? { item: candidates[0]!, confidence } : null;
}

export function matchClient(clients: Client[], extraction: PolicyAnalysisExtraction): Match<Client> {
  const name = extraction.asegurado ?? extraction.tomador.nombre;
  const documento = extraction.tomador.documentoNumero?.replace(/\D/g, "");

  // 1. Por documento: el único match que se puede dar por seguro, hay un índice
  //    único de DNI por organización.
  if (documento && documento.length >= 7) {
    const byDni = clients.filter((client) => client.dni?.replace(/\D/g, "") === documento);
    const match = onlyOne(byDni, "alta");
    if (match) return match;
  }

  if (!name) return null;
  const target = norm(name);

  // 2. Nombre exacto normalizado.
  const exact = clients.filter((client) => norm(client.full_name) === target);
  const exactMatch = onlyOne(exact, "alta");
  if (exactMatch) return exactMatch;

  // 3. Conjunto de tokens. Resuelve el caso más común: el PDF dice
  //    "PEREZ, JUAN CARLOS" y el padrón dice "Juan Carlos Pérez".
  const targetTokens = tokens(name, NAME_STOPWORDS);
  const byTokens = clients.filter((client) => {
    const clientTokens = tokens(client.full_name, NAME_STOPWORDS);
    return isSubset(targetTokens, clientTokens) || isSubset(clientTokens, targetTokens);
  });
  const tokenMatch = onlyOne(byTokens, "media");
  if (tokenMatch) return tokenMatch;

  // 4. Similitud de bigramas, para typos.
  const similar = clients.filter((client) => diceSimilarity(target, norm(client.full_name)) >= 0.82);
  return onlyOne(similar, "media");
}

// El PDF dice "SANCOR COOPERATIVA DE SEGUROS LIMITADA" y el padrón "Sancor":
// sin sacar el ruido societario ningún match funciona.
const COMPANY_NOISE = new Set([
  "SEGUROS", "SEGURO", "CIA", "COMPANIA", "COMPANIAS", "SA", "SAU", "SRL", "LTDA",
  "LIMITADA", "COOP", "COOPERATIVA", "DE", "LA", "EL", "ARGENTINA", "ARGENTINOS",
  "GRUPO", "ASEGURADORA", "ASEGURADORES", "SOCIEDAD", "ANONIMA", "MUTUAL",
  "GENERALES", "PATRIMONIALES", "RETIRO", "ART", "SEGURADORA"
]);

export function matchCompany(
  companies: InsuranceCompany[],
  extraction: PolicyAnalysisExtraction
): Match<InsuranceCompany> {
  const name = extraction.compania;
  if (!name) return null;

  const active = companies.filter((company) => company.is_active !== false);
  const target = norm(name);

  const exact = active.filter((company) => norm(company.name) === target);
  const exactMatch = onlyOne(exact, "alta");
  if (exactMatch) return exactMatch;

  const targetTokens = tokens(name, COMPANY_NOISE);
  const byTokens = active.filter((company) => {
    const companyTokens = tokens(company.name, COMPANY_NOISE);
    return isSubset(targetTokens, companyTokens) || isSubset(companyTokens, targetTokens);
  });
  const tokenMatch = onlyOne(byTokens, "media");
  if (tokenMatch) return tokenMatch;

  const similar = active.filter((company) => diceSimilarity(target, norm(company.name)) >= 0.82);
  return onlyOne(similar, "media");
}

/**
 * Periodicidad de cobranza en meses = duración de la vigencia / cantidad de
 * cuotas.
 *
 * No alcanza con mirar solo las cuotas: en la Patagonia es común la póliza
 * trimestral con 3 cuotas, que es mensual y no cuatrimestral. Sin la vigencia
 * se asume un año, que es el caso más frecuente.
 */
export function intervalFromInstallments(
  installments: number | null | undefined,
  validFrom?: string | null,
  validTo?: string | null
): number {
  if (!installments || installments < 1) return 1;

  const months = monthsBetween(validFrom, validTo) ?? 12;
  return Math.min(12, Math.max(1, Math.round(months / installments)));
}

/**
 * Fecha del próximo cobro, sugerida a partir de la vigencia.
 *
 * Se arranca en el inicio de vigencia y se avanza de a `intervalMonths` hasta
 * pasar la fecha de hoy: si la póliza arrancó el 28/07, es mensual y hoy es 9
 * de agosto, el próximo cobro cae el 28/08. Es una sugerencia para que la
 * persona no tenga que calcularla, no un dato de la póliza — el PDF trae la
 * vigencia, no el calendario de cobranza.
 */
export function suggestNextPaymentDate(
  validFrom: string | null,
  intervalMonths: number,
  today = new Date()
): string | null {
  const start = parseIsoDate(validFrom ?? "");
  if (!start || intervalMonths < 1) return null;

  const [year, month, day] = start;
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  // Tope de 120 saltos: corta cualquier vigencia vieja sin colgar el render.
  for (let step = 0; step < 120; step += 1) {
    const total = month - 1 + step * intervalMonths;
    const candidateYear = year + Math.floor(total / 12);
    const candidateMonth = (total % 12) + 1;
    // El día se recorta al último del mes (un cobro el 31 en un mes de 30).
    const lastDay = new Date(Date.UTC(candidateYear, candidateMonth, 0)).getUTCDate();
    const candidate = `${candidateYear}-${pad(candidateMonth)}-${pad(Math.min(day, lastDay))}`;
    if (candidate >= todayKey) return candidate;
  }
  return null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// Se parsean los componentes a mano: new Date("2026-01-01") es medianoche UTC,
// que en Argentina (UTC-3) cae el 31/12 y corre todo un mes.
function parseIsoDate(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function monthsBetween(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return null;

  const months =
    (end[0] - start[0]) * 12 + (end[1] - start[1]) + (end[2] >= start[2] ? 0 : -1);
  return months > 0 ? months : null;
}

export function toPolicyFormValues(
  extraction: PolicyAnalysisExtraction,
  clientId: string,
  insuranceCompanyId: string
): PolicyFormValues {
  return {
    clientId,
    insuranceCompanyId,
    branch: extraction.tipo,
    policyNumber: extraction.numeroPoliza ?? "",
    vehiclePlate: extraction.bienAsegurado.vehiculo?.patente ?? "",
    paymentIntervalMonths: intervalFromInstallments(
      extraction.cantidadCuotas,
      extraction.vigenciaDesde,
      extraction.vigenciaHasta
    ),
    // La póliza no dice cómo se cobra: lo elige la persona en el formulario.
    paymentMethod: "manual",
    // Siempre vacío: la póliza trae vigencia, no el calendario de cobranza, y
    // esta fecha dispara el trigger que mueve el aviso pendiente. La pone la
    // persona.
    firstPaymentDate: ""
  };
}

/**
 * Datos del tomador -> cuerpo de POST /clients. Permite dar de alta el
 * asegurado con el teléfono y la localidad que ya trae la póliza, sin tipear.
 */
export function toClientPayload(tomador: PolicyTomador): Record<string, string> {
  const payload: Record<string, string> = { fullName: tomador.nombre?.trim() ?? "" };
  const optional: Array<[string, string | null]> = [
    ["phone", tomador.telefono],
    ["email", tomador.email],
    ["locality", tomador.localidad],
    ["dni", tomador.documentoNumero],
    ["address", tomador.direccion],
    ["birthDate", tomador.fechaNacimiento]
  ];
  for (const [key, value] of optional) {
    if (value?.trim()) payload[key] = value.trim();
  }
  return payload;
}
