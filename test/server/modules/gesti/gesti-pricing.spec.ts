import { describe, expect, it } from "vitest";
import { costUsd, MODEL_PRICING, pricingFor } from "@/server/modules/gesti/pricing";
import {
  addDays,
  argentinaMonthBounds,
  argentinaToday,
  callUsageFromSdk,
  nextMonthLabel
} from "@/server/modules/gesti/usage";

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 };

describe("costUsd", () => {
  // Precios oficiales (platform.claude.com/docs/en/about-claude/pricing, octubre 2026).
  it("prices every kind of token and web search for Sonnet 5.5", () => {
    // 1000 in (USD 2/MTok) + 500 out (10) + 2000 cache read (0.10) + 1000 cache write 5 min (2.50)
    // + 2 searches (USD 10 per 1000)
    const cost = costUsd("claude-sonnet-5-5", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 2000,
      cacheWriteTokens: 1000,
      webSearches: 2
    });

    expect(cost).toBe(0.0297);
  });

  it("prices Haiku 5.5 at its short-prompt rates up to 100,000 prompt tokens", () => {
    expect(costUsd("claude-haiku-5-5", { ...NO_USAGE, inputTokens: 10_000, outputTokens: 1000 })).toBe(0.0015);
    expect(costUsd("claude-haiku-5-5", { ...NO_USAGE, inputTokens: 90_000, cacheReadTokens: 10_000 })).toBe(0.0091);
    expect(costUsd("claude-haiku-5-5", { ...NO_USAGE, cacheWriteTokens: 100_000 })).toBe(0.0125);
  });

  it("prices a Haiku 5.5 request over 100,000 prompt tokens (cache reads and writes count) at the long rates, output included", () => {
    expect(costUsd("claude-haiku-5-5", { ...NO_USAGE, inputTokens: 200_000 })).toBe(0.1);
    expect(
      costUsd("claude-haiku-5-5", { ...NO_USAGE, inputTokens: 20_000, cacheReadTokens: 90_000, outputTokens: 2000 })
    ).toBe(0.0195);
  });

  it("charges only the web searches when there are no tokens", () => {
    expect(costUsd("claude-haiku-5-5", { ...NO_USAGE, webSearches: 3 })).toBe(0.03);
    expect(costUsd("claude-sonnet-5-5", NO_USAGE)).toBe(0);
  });

  it("never underestimates an unknown model: it is priced like the most expensive one", () => {
    expect(pricingFor("claude-unknown")).toEqual(MODEL_PRICING["claude-sonnet-5-5"]);
    expect(costUsd("claude-unknown", { ...NO_USAGE, inputTokens: 1_000_000 })).toBe(2);
  });
});

describe("callUsageFromSdk", () => {
  it("maps SDK usage, treating missing and null fields as zero", () => {
    expect(
      callUsageFromSdk({
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 40,
        server_tool_use: { web_search_requests: 2 }
      })
    ).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40, webSearches: 2 });

    expect(callUsageFromSdk({ input_tokens: null, cache_read_input_tokens: null, server_tool_use: null })).toEqual(NO_USAGE);
    expect(callUsageFromSdk(undefined)).toEqual(NO_USAGE);
  });
});

describe("argentinaMonthBounds", () => {
  it("keeps 2026-10-31T23:30:00-03:00 in October", () => {
    const bounds = argentinaMonthBounds(new Date("2026-10-31T23:30:00-03:00"));

    expect(bounds.month).toBe("2026-10");
    expect(bounds.startIso).toBe("2026-10-01T03:00:00.000Z");
    expect(bounds.endIso).toBe("2026-11-01T03:00:00.000Z");
  });

  it("treats 2026-11-01T02:00:00Z as still October (it is 23:00 on the 31st in Argentina)", () => {
    expect(argentinaMonthBounds(new Date("2026-11-01T02:00:00Z")).month).toBe("2026-10");
  });

  it("starts November at 03:00 UTC on the 1st", () => {
    expect(argentinaMonthBounds(new Date("2026-11-01T03:00:00Z")).month).toBe("2026-11");
    expect(argentinaMonthBounds(new Date("2026-11-01T02:59:59.999Z")).month).toBe("2026-10");
  });

  it("rolls the year over in December", () => {
    const bounds = argentinaMonthBounds(new Date("2026-12-31T23:00:00-03:00"));

    expect(bounds.month).toBe("2026-12");
    expect(bounds.endIso).toBe("2027-01-01T03:00:00.000Z");
  });
});

describe("Argentina dates", () => {
  it("uses the Argentina calendar day for today", () => {
    expect(argentinaToday(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10-31");
    expect(argentinaToday(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11-01");
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-10-25", 7)).toBe("2026-11-01");
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
  });

  it("names the day the budget comes back", () => {
    expect(nextMonthLabel(new Date("2026-10-20T12:00:00Z"))).toBe("1 de noviembre");
  });
});
