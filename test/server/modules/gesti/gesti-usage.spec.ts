import { describe, expect, it } from "vitest";
import type { SupabaseService } from "@/server/core/supabase";
import { costUsd, type CallUsage } from "@/server/modules/gesti/pricing";
import { cachedMonthSpendUsd, UsageRecorder } from "@/server/modules/gesti/usage";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const MODEL = "claude-sonnet-5-5";
const CALL: CallUsage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 };

type Row = { cost_usd: number; created_at: string };

// Solo lo que usan el gasto del mes y el registro de consumo: cuenta las lecturas.
function createUsageDb() {
  const rows: Row[] = [];
  let reads = 0;

  const query = () => {
    let gte = "";
    let lt = "";
    let window: [number, number] = [0, Number.MAX_SAFE_INTEGER];
    const chain = {
      select: () => chain,
      gte: (_column: string, value: string) => ((gte = value), chain),
      lt: (_column: string, value: string) => ((lt = value), chain),
      order: () => chain,
      range: (from: number, to: number) => ((window = [from, to]), chain),
      insert: (row: { cost_usd: number }) => {
        rows.push({ cost_usd: row.cost_usd, created_at: NOW.toISOString() });
        return Promise.resolve({ error: null });
      },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
        reads += 1;
        const data = rows.filter((row) => row.created_at >= gte && row.created_at < lt).slice(window[0], window[1] + 1);
        return Promise.resolve({ data, error: null }).then(resolve);
      }
    };
    return chain;
  };

  const supabase = { admin: { from: () => query() } } as unknown as SupabaseService;
  return {
    supabase,
    seed: (cost: number, createdAt = NOW.toISOString()) => rows.push({ cost_usd: cost, created_at: createdAt }),
    reads: () => reads
  };
}

const later = (ms: number) => new Date(NOW.getTime() + ms);

describe("cachedMonthSpendUsd", () => {
  it("reads gesti_usage once and serves the same total for the next minute", async () => {
    const db = createUsageDb();
    db.seed(10);

    expect(await cachedMonthSpendUsd(db.supabase, NOW)).toBe(10);
    db.seed(5); // otro proceso gast\u00f3: no se ve hasta que vence el cach\u00e9
    expect(await cachedMonthSpendUsd(db.supabase, later(59_000))).toBe(10);
    expect(db.reads()).toBe(1);
  });

  it("reads again once the minute passes", async () => {
    const db = createUsageDb();
    db.seed(10);
    await cachedMonthSpendUsd(db.supabase, NOW);
    db.seed(5);

    expect(await cachedMonthSpendUsd(db.supabase, later(60_000))).toBe(15);
    expect(db.reads()).toBe(2);
  });

  it("reads again when the month changes, without carrying last month's spend", async () => {
    const db = createUsageDb();
    db.seed(10);
    await cachedMonthSpendUsd(db.supabase, NOW);

    // 1 de noviembre a las 00:00:30 en Argentina, 30 segundos despu\u00e9s de la lectura anterior.
    const november = new Date("2026-11-01T03:00:30.000Z");
    const cached = await cachedMonthSpendUsd(db.supabase, new Date("2026-11-01T03:00:00.000Z"));
    expect(cached).toBe(0);
    expect(await cachedMonthSpendUsd(db.supabase, november)).toBe(0);
    expect(db.reads()).toBe(2);
  });

  it("adds what this process records without reading the table again", async () => {
    const db = createUsageDb();
    db.seed(10);
    await cachedMonthSpendUsd(db.supabase, NOW);

    await new UsageRecorder(db.supabase, { organizationId: "org", userId: "user", conversationId: null }).record(
      "chat",
      MODEL,
      CALL
    );

    expect(await cachedMonthSpendUsd(db.supabase, later(1_000))).toBeCloseTo(10 + costUsd(MODEL, CALL), 4);
    expect(db.reads()).toBe(1);
  });

  it("keeps each Supabase client's total apart", async () => {
    const first = createUsageDb();
    const second = createUsageDb();
    first.seed(10);
    second.seed(3);

    expect(await cachedMonthSpendUsd(first.supabase, NOW)).toBe(10);
    expect(await cachedMonthSpendUsd(second.supabase, NOW)).toBe(3);
  });
});
