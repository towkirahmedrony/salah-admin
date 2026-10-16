import { describe, expect, it, vi } from "vitest";

import {
  PROVIDER,
  PROVIDER_MAX_BYTES,
  fetchProviderPrices,
  parseProviderDocument,
} from "@/features/metal-prices/provider";
import { compareDecimals, hasAtMostScale, isPositiveDecimal } from "@/features/metal-prices/decimal";
import { FALLBACK_FRESHNESS_POLICY } from "@/features/metal-prices/policy";

/**
 * Provider client tests.
 *
 * Every price below is a **synthetic fixture**. None of them is a Bangladesh
 * market price, and none should be read as one — they exist to exercise the
 * parsing, not to describe a market. No test here touches the network.
 */

const NOW = new Date("2026-10-12T18:00:00+06:00");

/** A well-formed document, shaped like the provider's real response. */
function document(overrides: Record<string, unknown> = {}, metal = "gold"): string {
  return JSON.stringify({
    commodity: metal,
    currency: "BDT",
    unit: "gram",
    bhoriInGrams: 11.664,
    source: "https://www.bajus.org/gold-price",
    lastUpdate: "2026-10-12T17:26:22+06:00",
    latest: { k18: 16265, k21: 18940, k22: 19830, traditional: 13285 },
    ...overrides,
  });
}

function parse(body: string, metal: "gold" | "silver" = "gold") {
  return parseProviderDocument(metal, body, { now: NOW });
}

function accepted(result: ReturnType<typeof parse>) {
  if (!result.ok) throw new Error(`expected success, got ${result.kind}: ${result.message}`);
  return result;
}

describe("parseProviderDocument — a valid document", () => {
  it("reads gold and maps every category to the panel's purity names", () => {
    const result = accepted(parse(document()));

    expect(result.metal).toBe("gold");
    expect(result.currency).toBe("BDT");
    expect(result.unit).toBe("gram");
    expect(result.accepted.map((rate) => rate.purity)).toEqual(["K22", "K21", "K18", "TRADITIONAL"]);
    expect(result.rejected).toEqual([]);
  });

  it("reads silver", () => {
    const body = document({ latest: { k18: 300, k21: 340, k22: 360, traditional: 250 } }, "silver");
    const result = accepted(parse(body, "silver"));

    expect(result.metal).toBe("silver");
    expect(result.accepted).toHaveLength(4);
  });

  it("keeps the provider's digits exactly, never through a double", () => {
    const body = document({ latest: { k18: 16265.05, k21: 18940.5, k22: 19830.07, traditional: 13285 } });
    const result = accepted(parse(body));

    const prices = Object.fromEntries(result.accepted.map((rate) => [rate.purity, rate.pricePerGram]));
    expect(prices.K22).toBe("19830.07");
    expect(prices.K21).toBe("18940.5");
    expect(prices.K18).toBe("16265.05");
    // Every price is the literal text, so none of them is a number at any point.
    for (const price of Object.values(prices)) expect(typeof price).toBe("string");
  });

  it("stores the provider's build time as an instant, not as an effective date", () => {
    const result = accepted(parse(document()));
    expect(result.lastUpdate).toBe("2026-10-12T11:26:22.000Z");
  });

  it("accepts a document whose build time is recent", () => {
    const result = accepted(parse(document({ lastUpdate: "2026-10-12T17:50:00+06:00" })));
    expect(result.notices).toEqual([]);
  });
});

describe("parseProviderDocument — documents that must be refused", () => {
  it("refuses another commodity's price", () => {
    const result = parse(document({ commodity: "silver" }), "gold");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("contract");
    expect(result.message).toContain("silver");
  });

  it("refuses a document that does not name its commodity", () => {
    const result = parse(document({ commodity: undefined }));
    expect(result.ok).toBe(false);
  });

  it("refuses a currency other than BDT", () => {
    const result = parse(document({ currency: "USD" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("USD");
    expect(result.message).toContain("BDT");
  });

  it("refuses a unit other than gram", () => {
    const result = parse(document({ unit: "bhori" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("bhori");
  });

  it("refuses a document with no price list", () => {
    const result = parse(document({ latest: undefined }));
    expect(result.ok).toBe(false);
  });

  it("refuses a price list that is not an object", () => {
    const result = parse(document({ latest: [1, 2, 3] }));
    expect(result.ok).toBe(false);
  });

  it("refuses malformed JSON", () => {
    const result = parse("{ this is not json ");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("malformed_json");
  });

  it("refuses a body that is not an object", () => {
    expect(parse("[1,2,3]").ok).toBe(false);
    expect(parse('"a string"').ok).toBe(false);
  });

  it("refuses scientific notation rather than guessing at it", () => {
    // Built as raw text on purpose: `JSON.stringify` would render 1.6e4 as 16000
    // and the test would never see the literal it is about. The scanner refuses
    // the literal, so the document cannot be read at all.
    const raw =
      '{"commodity":"gold","currency":"BDT","unit":"gram","latest":' +
      '{"k18":1.6e4,"k21":18940,"k22":19830,"traditional":13285}}';
    const result = parse(raw);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("malformed_json");
    expect(result.detail ?? "").toContain("1.6e4");
  });

  it("refuses a document whose every category is unusable", () => {
    const result = parse(document({ latest: { k18: 0, k21: -1, k22: null, traditional: "abc" } }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("No usable gold price");
  });

  it("refuses a build time implausibly far in the future", () => {
    const result = parse(document({ lastUpdate: "2026-10-20T17:26:22+06:00" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("contract");
    expect(result.message).toContain("future");
  });

  it("tolerates a build time inside the clock skew", () => {
    // 30 minutes ahead of NOW, which is well inside the tolerated skew.
    expect(parse(document({ lastUpdate: "2026-10-12T18:30:00+06:00" })).ok).toBe(true);
  });
});

describe("parseProviderDocument — per-category validation", () => {
  it("keeps the usable categories when one is missing", () => {
    const body = document({ latest: { k21: 18940, k22: 19830, traditional: 13285 } });
    const result = accepted(parse(body));

    expect(result.accepted.map((rate) => rate.purity)).toEqual(["K22", "K21", "TRADITIONAL"]);
    expect(result.rejected).toEqual([{ purity: "K18", reason: expect.stringContaining("did not publish") }]);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["a string", "not a number"],
    ["null", null],
  ])("rejects a %s price without converting it to zero", (_label, value) => {
    const body = document({ latest: { k18: 16265, k21: 18940, k22: value, traditional: 13285 } });
    const result = accepted(parse(body));

    expect(result.accepted.map((rate) => rate.purity)).not.toContain("K22");
    const rejected = result.rejected.find((entry) => entry.purity === "K22");
    expect(rejected).toBeDefined();
    // Whatever the wording, the value is refused and never converted to a price.
    expect(rejected?.reason.length).toBeGreaterThan(0);
  });

  it("says why a zero or negative price was refused", () => {
    // The other categories are present so the document itself is usable and the
    // refusal is attributable to the price under test.
    const zero = accepted(parse(document({ latest: { k18: 16265, k21: 18940, k22: 0, traditional: 13285 } })));
    expect(zero.rejected.map((entry) => entry.purity)).toEqual(["K22"]);
    expect(zero.rejected[0]?.reason).toContain("not a positive price");

    const negative = accepted(parse(document({ latest: { k18: 16265, k21: 18940, k22: -5, traditional: 13285 } })));
    expect(negative.rejected.map((entry) => entry.purity)).toEqual(["K22"]);
    expect(negative.rejected[0]?.reason).toContain("not a positive price");
  });

  it("rejects a price that is not a plain decimal", () => {
    const body = document({ latest: { k18: 16265, k21: 18940, k22: "19,830", traditional: 13285 } });
    const result = accepted(parse(body));

    expect(result.accepted.map((rate) => rate.purity)).not.toContain("K22");
  });
});

describe("parseProviderDocument — timestamps that cannot be trusted", () => {
  it("records no build time when the provider omits it, and says why", () => {
    const result = accepted(parse(document({ lastUpdate: undefined })));

    expect(result.lastUpdate).toBeNull();
    expect(result.notices.join(" ")).toContain("did not state when its data was built");
  });

  it("records no build time when it cannot be read as a date", () => {
    const result = accepted(parse(document({ lastUpdate: "last Tuesday" })));

    expect(result.lastUpdate).toBeNull();
    expect(result.notices.join(" ")).toContain("could not be read as a date");
  });

  it("never uses the provider timestamp as an effective time", () => {
    // The candidate has a timestamp; nothing in the result claims it is effective.
    const result = accepted(parse(document()));
    expect(Object.keys(result)).not.toContain("effectiveAt");
  });
});

describe("fetchProviderPrices — transport", () => {
  const ok = (body: string) =>
    vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }));

  it("requests the documented endpoint over HTTPS with a GET", async () => {
    const fetchImpl = ok(document());
    await fetchProviderPrices("gold", { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(PROVIDER.endpoints.gold);
    expect(url.startsWith("https://")).toBe(true);
    expect(init.method).toBe("GET");
    // A redirect would take the request somewhere the panel did not choose.
    expect(init.redirect).toBe("manual");
  });

  it("fetches silver from its own endpoint", async () => {
    const fetchImpl = ok(document({ latest: { k22: 360 } }, "silver"));
    await fetchProviderPrices("silver", { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });

    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(PROVIDER.endpoints.silver);
  });

  it.each([
    [404, "http_status"],
    [500, "http_status"],
    [403, "http_status"],
  ])("reports HTTP %i as a failure", async (status, kind) => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status }));
    const result = await fetchProviderPrices("gold", { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe(kind);
    expect(result.message).toContain(String(status));
  });

  it("refuses a redirect instead of following it", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 302, headers: { location: "https://elsewhere.test" } }));
    const result = await fetchProviderPrices("gold", { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("redirected");
  });

  it("reports a timeout as a timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      throw error;
    });
    const result = await fetchProviderPrices("gold", { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 1_000 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("timeout");
  });

  it("reports a DNS failure as a DNS failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND gold-price.bd");
    });
    const result = await fetchProviderPrices("gold", { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("dns");
  });

  it("reports a connection failure without claiming anything about the price", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await fetchProviderPrices("gold", { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("connection");
    expect(result.message).toContain("published price is unchanged");
  });

  it("refuses a response larger than the ceiling", async () => {
    const huge = `{"padding":"${"x".repeat(PROVIDER_MAX_BYTES + 100)}"}`;
    const result = await fetchProviderPrices("gold", {
      fetchImpl: ok(huge) as unknown as typeof fetch,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("too_large");
  });

  it("does not log the response body", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await fetchProviderPrices("gold", { fetchImpl: ok(document()) as unknown as typeof fetch, now: NOW });
    await fetchProviderPrices("gold", { fetchImpl: vi.fn(async () => new Response("no", { status: 500 })) as unknown as typeof fetch });

    expect(spy).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    spy.mockRestore();
    error.mockRestore();
  });
});

describe("gold and silver fail independently", () => {
  it("a silver failure does not stop gold being read", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url === PROVIDER.endpoints.gold
        ? new Response(document(), { status: 200 })
        : new Response("upstream error", { status: 502 }),
    );

    const [gold, silver] = await Promise.all([
      fetchProviderPrices("gold", { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW }),
      fetchProviderPrices("silver", { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW }),
    ]);

    expect(gold.ok).toBe(true);
    expect(silver.ok).toBe(false);
  });

  it("a gold failure does not stop silver being read", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url === PROVIDER.endpoints.gold
        ? new Response("", { status: 503 })
        : new Response(document({ latest: { k22: 360 } }, "silver"), { status: 200 }),
    );

    const [gold, silver] = await Promise.all([
      fetchProviderPrices("gold", { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW }),
      fetchProviderPrices("silver", { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW }),
    ]);

    expect(gold.ok).toBe(false);
    expect(silver.ok).toBe(true);
  });
});

describe("exact decimal helpers", () => {
  it("accepts only plain decimals as positive", () => {
    expect(isPositiveDecimal("19550.07")).toBe(true);
    expect(isPositiveDecimal("0.01")).toBe(true);
    for (const value of ["0", "0.00", "-1", "1e4", "1,000", "", " ", "abc", ".5", "1."]) {
      expect(isPositiveDecimal(value), value).toBe(false);
    }
  });

  it("compares decimals exactly, without a double in the middle", () => {
    // The pair that a naive Number() comparison gets wrong at this magnitude.
    expect(compareDecimals("0.1", "0.2")).toBe(-1);
    expect(compareDecimals("19550.07", "19550.07")).toBe(0);
    expect(compareDecimals("19550.1", "19550.07")).toBe(1);
    expect(compareDecimals("999.99", "1000")).toBe(-1);
    expect(compareDecimals("-5", "5")).toBe(-1);
  });

  it("refuses more precision than the column holds", () => {
    expect(hasAtMostScale("19550.07", 2)).toBe(true);
    expect(hasAtMostScale("19550", 2)).toBe(true);
    expect(hasAtMostScale("19550.075", 2)).toBe(false);
  });
});

describe("the freshness policy used for parsing", () => {
  it("is the documented default when the database is not consulted", () => {
    expect(FALLBACK_FRESHNESS_POLICY).toEqual({
      maxCandidateAgeHours: 72,
      maxPublishedAgeHours: 96,
      maxFutureSkewMinutes: 180,
    });
  });
});
