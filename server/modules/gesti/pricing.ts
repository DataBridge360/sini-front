// Precios de la API de Anthropic en USD por millón de tokens, tomados de
// https://platform.claude.com/docs/en/about-claude/pricing (verificados en
// octubre de 2026). Si Anthropic los cambia, actualizarlos acá: el panel de
// consumo y el tope mensual se calculan con estos números.

export type TokenRates = {
  /** Entrada sin caché. */
  input: number;
  output: number;
  /** Lectura de caché (hit). */
  cacheRead: number;
  /** Escritura de caché de 5 minutos (la que usa Gesti). */
  cacheWrite: number;
};

export type ModelPricing = TokenRates & {
  /**
   * Haiku 5.5 cobra más caro todo el request (salida incluida) cuando el prompt
   * pasa `threshold` tokens; el prompt cuenta la entrada y las lecturas y
   * escrituras de caché.
   */
  longPrompt?: { threshold: number; rates: TokenRates };
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Sonnet 5.5: la lectura de caché es 0,05x la entrada (desde el 7/10/2026).
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    longPrompt: { threshold: 100_000, rates: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } }
  }
};

/** Un modelo desconocido se cobra como el más caro que usa Gesti: el tope nunca se subestima. */
const FALLBACK_MODEL = "claude-sonnet-5-5";

/** web_search: USD 10 cada 1000 búsquedas. */
export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;

export type CallUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
};

export function pricingFor(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? (MODEL_PRICING[FALLBACK_MODEL] as ModelPricing);
}

function ratesFor(pricing: ModelPricing, usage: CallUsage): TokenRates {
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return pricing.longPrompt && promptTokens > pricing.longPrompt.threshold ? pricing.longPrompt.rates : pricing;
}

/** Costo en USD de una llamada, redondeado a 6 decimales (como gesti_usage.cost_usd). */
export function costUsd(model: string, usage: CallUsage): number {
  const rates = ratesFor(pricingFor(model), usage);
  const perToken = (usdPerMillion: number) => usdPerMillion / 1_000_000;
  const total =
    usage.inputTokens * perToken(rates.input) +
    usage.outputTokens * perToken(rates.output) +
    usage.cacheReadTokens * perToken(rates.cacheRead) +
    usage.cacheWriteTokens * perToken(rates.cacheWrite) +
    usage.webSearches * WEB_SEARCH_USD_PER_REQUEST;
  return Math.round(total * 1_000_000) / 1_000_000;
}
