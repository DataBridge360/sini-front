import type { PreviousPolicyNumber } from "@/lib/api";

// Una póliza guarda su número vigente y los anteriores (renovaciones). Todo lo
// que se creó bajo un número viejo (tareas hoy, siniestros mañana) tiene que
// seguir mostrando el número que estaba vigente cuando se creó.

export type PolicyNumberSource = {
  policy_number?: string | null;
  previous_policy_numbers?: unknown;
};

export type PolicyNumberMatch = "current" | "previous" | null;

type Entry = { number: string; replacedAtMs: number };

// Tolera cualquier forma: sin arreglo, vacío, elementos sin número o con fecha
// inválida. Ordenadas de la renovación más vieja a la más nueva.
function readEntries(value: unknown): Entry[] {
  if (!Array.isArray(value)) return [];
  const entries: Entry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { number, replaced_at: replacedAt } = item as Partial<PreviousPolicyNumber>;
    if (typeof number !== "string" || !number.trim()) continue;
    const replacedAtMs = typeof replacedAt === "string" ? Date.parse(replacedAt) : Number.NaN;
    if (Number.isNaN(replacedAtMs)) continue;
    entries.push({ number, replacedAtMs });
  }
  return entries.sort((a, b) => a.replacedAtMs - b.replacedAtMs);
}

function toMs(at: string | number | Date | null | undefined): number {
  if (at === null || at === undefined || at === "") return Number.NaN;
  return at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
}

/** Los números anteriores, del más reciente al más viejo. */
export function previousPolicyNumbers(policy: PolicyNumberSource | null | undefined): string[] {
  return readEntries(policy?.previous_policy_numbers)
    .map((entry) => entry.number)
    .reverse();
}

/**
 * El número que estaba vigente en una fecha. Antes de una renovación vale el
 * número que ella reemplazó; sin fecha válida o después de la última, el actual.
 */
export function policyNumberAt(
  policy: PolicyNumberSource | null | undefined,
  at: string | number | Date | null | undefined
): string | null {
  if (!policy) return null;
  const current = policy.policy_number ?? null;
  const atMs = toMs(at);
  if (Number.isNaN(atMs)) return current;
  const replacement = readEntries(policy.previous_policy_numbers).find((entry) => entry.replacedAtMs > atMs);
  return replacement ? replacement.number : current;
}

/** Si el texto buscado está en el número actual o en alguno anterior (sin distinguir mayúsculas). */
export function policyNumberMatch(
  policy: PolicyNumberSource | null | undefined,
  search: string
): PolicyNumberMatch {
  const term = search.trim().toLowerCase();
  if (!term || !policy) return null;
  if (policy.policy_number?.toLowerCase().includes(term)) return "current";
  return readEntries(policy.previous_policy_numbers).some((entry) => entry.number.toLowerCase().includes(term))
    ? "previous"
    : null;
}

export function matchesPolicyNumber(policy: PolicyNumberSource | null | undefined, search: string): boolean {
  return policyNumberMatch(policy, search) !== null;
}

/** "Antes: #B, #A" (el más reciente primero), o null si no hubo renovaciones. */
export function previousNumbersLabel(policy: PolicyNumberSource | null | undefined): string | null {
  const numbers = previousPolicyNumbers(policy);
  return numbers.length > 0 ? `Antes: ${numbers.map((number) => `#${number}`).join(", ")}` : null;
}

export type TaskPolicyNumber = {
  /** El número vigente cuando se creó la tarea. */
  shown: string | null;
  /** El número de hoy. */
  current: string | null;
  /** true cuando la póliza se renovó después de crear la tarea. */
  isHistoric: boolean;
};

/** El número de póliza que muestra una tarea: el que estaba vigente al crearla. */
export function taskPolicyNumber(task: {
  created_at?: string | null;
  policies?: PolicyNumberSource | null;
}): TaskPolicyNumber {
  const current = task.policies?.policy_number ?? null;
  const shown = policyNumberAt(task.policies, task.created_at);
  return { shown, current, isHistoric: shown !== current };
}

/** Texto de ayuda cuando el número mostrado ya no es el de hoy ("Número actual: #X"). */
export function historicNumberTitle(number: TaskPolicyNumber): string | undefined {
  return number.isHistoric && number.current ? `Hoy la póliza es #${number.current}` : undefined;
}
