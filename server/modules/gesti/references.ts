import { randomInt } from "node:crypto";
import { MAX_TABLE_ROWS, type ChartLink } from "@/lib/gesti-parts";

// Referencias opacas a registros de la cartera (S3 de gesti-inline-tables). Las
// herramientas de datos le dan a cada registro que devuelven una referencia
// (`#Rk7q2-3`) y la anotan acá, en un registro que vive lo que dura UN turno de chat.
// El modelo solo ve la referencia; el id real y los enlaces nunca salen del
// server. Cuando Gesti pasa referencias a show_chart, se resuelven contra este
// mismo registro: una referencia desconocida, mal formada o de otro turno
// simplemente no resuelve. Cada turno lleva su propia marca al azar (`k7q2`):
// sin ella, un `#R3` viejo que quedó en el historial abriría el `#R3` de este turno.

const REFERENCE = /^#R([a-z0-9]{4})-([1-9]\d{0,3})$/;
const TAG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function newTurnTag() {
  return Array.from({ length: 4 }, () => TAG_ALPHABET[randomInt(TAG_ALPHABET.length)]).join("");
}
/** Más registros que cualquier turno razonable (6 rondas x 100 filas), con margen. */
export const MAX_REFERENCES_PER_TURN = 1000;

function keyOf(link: ChartLink) {
  return `${link.kind}:${link.id}`;
}

export class RecordRegistry {
  private readonly links = new Map<number, ChartLink>();
  private readonly numbers = new Map<string, number>();

  constructor(
    private readonly cap = MAX_REFERENCES_PER_TURN,
    /** Marca del turno; los tests la fijan. */
    private readonly tag = newTurnTag()
  ) {}

  private reference(number: number) {
    return `#R${this.tag}-${number}`;
  }

  get size() {
    return this.links.size;
  }

  /** Registra el registro y devuelve su referencia; la misma si ya estaba. null si se llegó al tope. */
  register(link: ChartLink): string | null {
    const key = keyOf(link);
    const existing = this.numbers.get(key);
    if (existing !== undefined) return this.reference(existing);
    if (this.links.size >= this.cap) return null;
    const number = this.links.size + 1;
    this.links.set(number, { ...link });
    this.numbers.set(key, number);
    return this.reference(number);
  }

  /** El enlace de una referencia de ESTE turno; null para cualquier otra cosa. */
  resolve(reference: unknown): ChartLink | null {
    if (typeof reference !== "string") return null;
    const match = REFERENCE.exec(reference.trim());
    if (!match || match[1] !== this.tag) return null;
    const link = this.links.get(Number(match[2]));
    return link ? { ...link } : null;
  }
}

/**
 * Un enlace (o null) por fila a partir de las referencias que pasó el modelo.
 * Undefined si ninguna fila resolvió, para no guardar un arreglo de nulls.
 */
export function resolveRowLinks(
  registry: RecordRegistry,
  refs: ReadonlyArray<string | null> | undefined,
  rowCount: number
): Array<ChartLink | null> | undefined {
  if (!refs || refs.length === 0) return undefined;
  const count = Math.min(rowCount, refs.length, MAX_TABLE_ROWS);
  const links: Array<ChartLink | null> = [];
  for (let index = 0; index < count; index += 1) links.push(registry.resolve(refs[index]));
  return links.some((link) => link !== null) ? links : undefined;
}
