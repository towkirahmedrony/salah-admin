import type { MetalPriceActionState, MetalPriceSyncState } from "@/features/metal-prices/actions";

/**
 * Constants shared by the reference-price screens.
 *
 * Everything here is a display or request bound, not a price: no market rate is
 * hardcoded anywhere in this feature, by design. A published rate only ever comes
 * from the database, and a candidate only ever comes from the provider.
 */

export const INITIAL_METAL_PRICE_ACTION_STATE: MetalPriceActionState = {
  status: "idle",
  message: "",
};

export const INITIAL_METAL_PRICE_SYNC_STATE: MetalPriceSyncState = {
  status: "idle",
  message: "",
};

/**
 * How many rate rows are read in one page.
 *
 * The table holds one live row, at most one candidate, and the history for eight
 * rate identities, so this is a ceiling rather than a pagination window — it stops
 * a runaway history from turning a page render into an unbounded query.
 */
export const METAL_PRICES_PAGE_SIZE = 200;

/** How many synchronization runs the history panel shows. */
export const SYNC_HISTORY_LIMIT = 8;

/** The label the panel uses for the provider, wherever it is named. */
export const PROVIDER_LABEL = "Gold Price Bangladesh";

/**
 * Connection and read budget for one provider document.
 *
 * These live here rather than beside the fetch so that a *client* component can
 * state them without importing the module that performs the request. Importing
 * the fetch module from a client component would put the request code into the
 * browser bundle, which is the one thing this feature must not do.
 */
export const PROVIDER_TIMEOUT_MS = 8_000;

/** Ceiling on a response body. The real documents are well under a kilobyte. */
export const PROVIDER_MAX_BYTES = 64 * 1024;

/**
 * Why the panel is careful about the words it uses for the provider.
 *
 * Shown in the documentation and in the interface copy, so the claim is stated in
 * one place instead of being re-improvised on each screen.
 */
export const PROVIDER_DISCLAIMER =
  "Gold Price Bangladesh publishes these figures from its own saved BAJUS-based records. It is not an official BAJUS API, and its timestamps record when its data file was built rather than when a price changed.";
