// Precios de la API de Anthropic en USD por millón de tokens.
// IMPORTANTE: son valores de referencia; hay que verificarlos contra la lista
// de precios de Anthropic (y actualizarlos acá) cuando cambien. El tope mensual
// y el panel de consumo se calculan con estos números.

export type ModelPricing = {
  /** USD por millón de tokens de entrada. */
  input: number;
  /** USD por millón de tokens de salida. */
  output: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-5-5": { input: 3, output: 15 },
  "claude-haiku-5-5": { input: 1, output: 5 }
};

/** Un modelo desconocido se cobra como el más caro: el tope nunca se subestima. */
const FALLBACK_PRICING: ModelPricing = { input: 3, output: 15 };

/** La lectura de caché cuesta 0,1x la entrada; la escritura (5 min), 1,25x. */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

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
  return MODEL_PRICING[model] ?? FALLBACK_PRICING;
}

/** Costo en USD de una llamada, redondeado a 6 decimales (como gesti_usage.cost_usd). */
export function costUsd(model: string, usage: CallUsage): number {
  const price = pricingFor(model);
  const perToken = (usdPerMillion: number) => usdPerMillion / 1_000_000;
  const total =
    usage.inputTokens * perToken(price.input) +
    usage.outputTokens * perToken(price.output) +
    usage.cacheReadTokens * perToken(price.input * CACHE_READ_MULTIPLIER) +
    usage.cacheWriteTokens * perToken(price.input * CACHE_WRITE_MULTIPLIER) +
    usage.webSearches * WEB_SEARCH_USD_PER_REQUEST;
  return Math.round(total * 1_000_000) / 1_000_000;
}
