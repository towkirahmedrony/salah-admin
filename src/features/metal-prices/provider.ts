import type { MetalPurity, MetalType } from "@/lib/types/database";
import { isPositiveDecimal } from "@/features/metal-prices/decimal";
import { ExactJsonError, parseJsonWithExactNumbers, property, stringProperty, type ExactJson } from "@/features/metal-prices/exact-json";
import {
  PROVIDER_LABEL,
  PROVIDER_MAX_BYTES,
  PROVIDER_TIMEOUT_MS,
} from "@/features/metal-prices/constants";
import { FALLBACK_FRESHNESS_POLICY, type FreshnessPolicy } from "@/features/metal-prices/policy";

/**
 * The external reference-price provider.
 *
 * The endpoints are the documented Gold Price Bangladesh JSON files. They need no
 * account and no key, which is why this feature adds no secret to the
 * deployment.
 *
 * Two things this module is careful not to claim:
 *
 *   * It is **not** an official BAJUS API. The provider states that its prices
 *     come from its own saved BAJUS-based records, and BAJUS is the publisher the
 *     prices are attributed to. The panel says "Bangladesh market reference" and
 *     names the source; it never calls the feed a market or an authority.
 *   * **A successful response is not proof of a current price.** The provider's
 *     `lastUpdate` is when the JSON was built, and the provider says prices may be
 *     unchanged between builds. So the fetch stores it as `provider_last_update`
 *     and nothing more; `effective_at` is left for an administrator who can
 *     establish when the price changed.
 *
 * This module is not marked `server-only` on purpose: the parsing half is the
 * half that needs unit tests, and `server-only` cannot be imported from a test
 * runner. The browser guard below is the real enforcement — it makes an
 * accidental client-side call fail loudly instead of quietly working.
 */

export const PROVIDER = {
  /** Stored on every rate and every log row, so the source of a price is not a guess. */
  name: "gold-price-bd",
  /** Human label shown in the panel and credited in the documentation. */
  label: PROVIDER_LABEL,
  documentationUrl: "https://gold-price.bd/api",
  /** The publisher the provider attributes its prices to. */
  attributionUrl: "https://www.bajus.org/gold-price",
  endpoints: {
    gold: "https://gold-price.bd/api/gold/latest.json",
    silver: "https://gold-price.bd/api/silver/latest.json",
  },
} as const satisfies {
  name: string;
  label: string;
  documentationUrl: string;
  attributionUrl: string;
  endpoints: Record<MetalType, string>;
};

// Re-exported so callers can keep importing them from here; the values live in
// `constants.ts` because the interface needs to display them without pulling this
// module — and therefore the request code — into a client bundle.
export { PROVIDER_MAX_BYTES, PROVIDER_TIMEOUT_MS };

/**
 * The purity categories the provider publishes, and the panel category each maps
 * to. The provider's keys are lower case; the panel and the Android app store and
 * match the upper-case form.
 */
export const PROVIDER_CATEGORIES: ReadonlyArray<{ key: string; purity: MetalPurity }> = [
  { key: "k22", purity: "K22" },
  { key: "k21", purity: "K21" },
  { key: "k18", purity: "K18" },
  { key: "traditional", purity: "TRADITIONAL" },
];

export type ProviderFailureKind =
  | "timeout"
  | "dns"
  | "connection"
  | "http_status"
  | "too_large"
  | "malformed_json"
  | "contract";

export interface ProviderAcceptedRate {
  purity: MetalPurity;
  /** The digits exactly as the provider wrote them. Never a `number`. */
  pricePerGram: string;
}

export interface ProviderRejectedRate {
  purity: MetalPurity;
  reason: string;
}

export interface ProviderReadSuccess {
  ok: true;
  metal: MetalType;
  currency: "BDT";
  unit: "gram";
  source: string | null;
  sourceUrl: string | null;
  /** The provider's build time, or null when it was absent or unreadable. */
  lastUpdate: string | null;
  accepted: ProviderAcceptedRate[];
  rejected: ProviderRejectedRate[];
  /** Anything an operator should know that is not itself a rejection. */
  notices: string[];
}

export interface ProviderReadFailure {
  ok: false;
  metal: MetalType;
  kind: ProviderFailureKind;
  /** Written for an administrator, not for a log parser. */
  message: string;
  detail?: string;
}

export type ProviderReadResult = ProviderReadSuccess | ProviderReadFailure;

interface ParseOptions {
  policy?: FreshnessPolicy;
  now?: Date;
}

/**
 * Validates one provider document. Pure: no network, no clock of its own, so a
 * test can describe any feed the provider might send.
 */
export function parseProviderDocument(
  metal: MetalType,
  body: string,
  options: ParseOptions = {},
): ProviderReadResult {
  const policy = options.policy ?? FALLBACK_FRESHNESS_POLICY;
  const now = options.now ?? new Date();

  let root: ExactJson;
  try {
    root = parseJsonWithExactNumbers(body);
  } catch (error) {
    return failure(
      metal,
      "malformed_json",
      "The provider's response could not be read as JSON, so nothing was recorded from it.",
      error instanceof ExactJsonError ? error.message : undefined,
    );
  }

  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return failure(metal, "contract", "The provider's response was not a JSON object.", undefined);
  }

  // --- the document must be about the metal that was asked for ----------------
  const commodity = (stringProperty(root, "commodity") ?? "").toLowerCase();
  if (commodity !== metal) {
    return failure(
      metal,
      "contract",
      commodity
        ? `The response is for "${commodity}" but a ${metal} price was requested. Nothing was recorded, because accepting it would publish one metal's price under the other's name.`
        : `The response did not say which metal it describes, so it cannot be attributed to ${metal}.`,
    );
  }

  const currency = (stringProperty(root, "currency") ?? "").toUpperCase();
  if (currency !== "BDT") {
    return failure(
      metal,
      "contract",
      currency
        ? `The response quotes prices in ${currency}. Reference prices are published in BDT, and this panel has no conversion policy, so nothing was recorded.`
        : "The response did not state a currency, so the prices cannot be attributed to BDT taka.",
    );
  }

  const unit = (stringProperty(root, "unit") ?? "").toLowerCase();
  if (unit !== "gram") {
    return failure(
      metal,
      "contract",
      unit
        ? `The response quotes prices per ${unit}. The panel and the app work per gram, and the provider's bhori figure is not used to derive one, so nothing was recorded.`
        : "The response did not state a unit, so it cannot be treated as a price per gram.",
    );
  }

  const latest = property(root, "latest");
  if (latest === null || typeof latest !== "object" || Array.isArray(latest)) {
    return failure(metal, "contract", "The response contained no price list, so there was nothing to review.");
  }

  // --- the provider's build time --------------------------------------------
  const notices: string[] = [];
  const rawLastUpdate = stringProperty(root, "lastUpdate");
  let lastUpdate: string | null = null;

  if (!rawLastUpdate) {
    notices.push(
      "The provider did not state when its data was built, so the record will need an explicitly acknowledged review before it can be published.",
    );
  } else {
    const parsed = new Date(rawLastUpdate);
    if (Number.isNaN(parsed.getTime())) {
      notices.push(
        "The provider's build time could not be read as a date and time, so it was not recorded. The rate will need an explicitly acknowledged review.",
      );
    } else {
      const skewMs = policy.maxFutureSkewMinutes * 60 * 1000;
      if (parsed.getTime() > now.getTime() + skewMs) {
        // A build time that has not happened yet means a broken clock or a broken
        // feed. It is not data to review later, it is data to refuse now: the one
        // field that would let a reviewer judge the record is itself untrustworthy.
        return failure(
          metal,
          "contract",
          `The provider says its data was built at ${rawLastUpdate}, which is more than ${policy.maxFutureSkewMinutes} minutes in the future. Nothing was recorded, because a timestamp that has not happened yet cannot be reviewed into validity.`,
        );
      }
      lastUpdate = parsed.toISOString();
    }
  }

  // --- each purity category is judged on its own ----------------------------
  const accepted: ProviderAcceptedRate[] = [];
  const rejected: ProviderRejectedRate[] = [];

  for (const { key, purity } of PROVIDER_CATEGORIES) {
    const raw = property(latest, key);
    const outcome = validatePrice(raw);
    if (outcome.ok) {
      accepted.push({ purity, pricePerGram: outcome.pricePerGram });
    } else {
      rejected.push({ purity, reason: outcome.reason });
    }
  }

  if (accepted.length === 0) {
    return failure(
      metal,
      "contract",
      `No usable ${metal} price could be read from the response. Every category was rejected: ${rejected
        .map((entry) => `${entry.purity} (${entry.reason})`)
        .join("; ")}.`,
    );
  }

  return {
    ok: true,
    metal,
    currency: "BDT",
    unit: "gram",
    source: stringProperty(root, "source") ?? PROVIDER.label,
    sourceUrl: stringProperty(root, "source") ?? PROVIDER.attributionUrl,
    lastUpdate,
    accepted,
    rejected,
    notices,
  };
}

function validatePrice(
  raw: ExactJson | undefined,
): { ok: true; pricePerGram: string } | { ok: false; reason: string } {
  if (raw === undefined || raw === null) {
    return { ok: false, reason: "the provider did not publish a price for this category" };
  }

  if (typeof raw !== "string") {
    return { ok: false, reason: "the price was not a number" };
  }

  if (!isPositiveDecimal(raw)) {
    // Deliberately one message for missing, malformed, zero and negative values:
    // the distinction that matters to an operator is "this is not a price", and
    // none of those may ever be stored as one.
    return { ok: false, reason: `"${raw}" is not a positive price` };
  }

  return { ok: true, pricePerGram: raw };
}

function failure(
  metal: MetalType,
  kind: ProviderFailureKind,
  message: string,
  detail?: string,
): ProviderReadFailure {
  return detail ? { ok: false, metal, kind, message, detail } : { ok: false, metal, kind, message };
}

/**
 * Fetches and validates one metal's document.
 *
 * Gold and silver are fetched by separate calls so that one failing cannot affect
 * the other — the caller runs both and reports each independently.
 */
export async function fetchProviderPrices(
  metal: MetalType,
  options: ParseOptions & { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {},
): Promise<ProviderReadResult> {
  // The one place a provider request could ever be started. If this module were
  // rendered into a client bundle, the request would come from the browser, so it
  // fails loudly instead.
  if (typeof window !== "undefined") {
    throw new Error(
      "Gold and silver reference prices are fetched on the server only. Move this call into a server action.",
    );
  }

  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? PROVIDER_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await doFetch(PROVIDER.endpoints[metal], {
        method: "GET",
        headers: { accept: "application/json" },
        // A redirect would take the request somewhere the panel did not choose.
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      return classifyTransportError(metal, error, timeoutMs);
    }

    if (response.status >= 300 && response.status < 400) {
      return failure(
        metal,
        "http_status",
        `The provider redirected the request (HTTP ${response.status}). The panel does not follow a redirect to a source it did not choose, so nothing was recorded.`,
      );
    }

    if (!response.ok) {
      return failure(
        metal,
        "http_status",
        `The provider answered with HTTP ${response.status}. Nothing was recorded from that response.`,
      );
    }

    const body = await readBodyCapped(response, maxBytes);
    if (body === null) {
      return failure(
        metal,
        "too_large",
        `The provider's response was larger than the ${Math.round(maxBytes / 1024)} kB this panel will read, so it was discarded rather than processed.`,
      );
    }

    return parseProviderDocument(metal, body, options);
  } finally {
    clearTimeout(timer);
  }
}

function classifyTransportError(metal: MetalType, error: unknown, timeoutMs: number): ProviderReadFailure {
  const name = typeof error === "object" && error !== null ? (error as { name?: string }).name : undefined;
  const message = error instanceof Error ? error.message : String(error);

  if (name === "AbortError" || /aborted|timeout/i.test(message)) {
    return failure(
      metal,
      "timeout",
      `The provider did not answer within ${Math.round(timeoutMs / 1000)} seconds, so the request was abandoned. Nothing was recorded.`,
    );
  }

  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return failure(
      metal,
      "dns",
      "The provider's host name could not be resolved. This is usually a network or DNS problem on the server, not a problem with the published prices.",
      message,
    );
  }

  return failure(
    metal,
    "connection",
    "The provider could not be reached. Nothing was recorded, and any published price is unchanged.",
    message,
  );
}

/** Reads at most `maxBytes`, so a misrouted response cannot be read into memory. */
async function readBodyCapped(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  if (!response.body) {
    const text = await response.text();
    return byteLength(text) > maxBytes ? null : text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  return new TextDecoder().decode(concat(chunks, total));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
