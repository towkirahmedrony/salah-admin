"use client";

import { RefreshCw } from "lucide-react";
import { useActionState } from "react";

import { Badge } from "@/components/ui/data";
import { SectionCard } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/states";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  INITIAL_METAL_PRICE_SYNC_STATE,
  synchronizeMetalPrices,
  type MetalPriceSyncState,
  type MetalSyncOutcome,
} from "@/features/metal-prices/actions";
import { PROVIDER_LABEL, PROVIDER_MAX_BYTES, PROVIDER_TIMEOUT_MS } from "@/features/metal-prices/constants";
import { METAL_TYPE_LABELS } from "@/lib/validation/metal-prices";
import { formatPricePerGram } from "@/lib/utils/format";

/**
 * The administrator's synchronization control.
 *
 * The button submits to its own server action, so nothing here depends on
 * client-side gating to be correct: the dialog-free form is a normal post, and the
 * action re-checks the capability and refuses a duplicate run itself.
 *
 * The copy is careful about one thing above all: a fetch does not publish. It
 * produces candidates, and saying otherwise would let an administrator believe the
 * app is already using a price nobody has reviewed.
 */
export function MetalPriceSync({ canWrite }: { canWrite: boolean }) {
  const [state, action] = useActionState<MetalPriceSyncState, FormData>(
    synchronizeMetalPrices,
    INITIAL_METAL_PRICE_SYNC_STATE,
  );

  if (!canWrite) {
    return (
      <SectionCard title="Synchronize reference prices">
        <Alert tone="info">
          Your role can see reference prices but not change them. Fetching, reviewing and publishing require the
          reference-price capability.
        </Alert>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Synchronize reference prices"
      description={`Fetches the current gold and silver documents from ${PROVIDER_LABEL} and stores them as candidates for review. It does not publish anything.`}
      actions={
        <form action={action}>
          <SubmitButton variant="primary" pendingLabel="Fetching…">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Fetch current prices
          </SubmitButton>
        </form>
      }
    >
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-ink-500">
          Read-only requests to two public JSON endpoints, {Math.round(PROVIDER_TIMEOUT_MS / 1000)} seconds each, with a{" "}
          {Math.round(PROVIDER_MAX_BYTES / 1024)} kB ceiling per response. Gold and silver are fetched separately, so one
          failing does not discard the other. A run that dies is closed automatically rather than left showing as
          running.
        </p>

        {state.status === "idle" ? null : (
          <Alert
            tone={state.status === "success" ? "success" : state.status === "partial" ? "warning" : "error"}
            role={state.status === "error" ? "alert" : "status"}
            title={
              state.status === "success"
                ? "Fetched and validated"
                : state.status === "partial"
                  ? "Partly completed"
                  : "Synchronization failed"
            }
          >
            <p>{state.message}</p>
          </Alert>
        )}

        {state.outcomes ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {state.outcomes.map((outcome) => (
              <OutcomeCard key={outcome.metal} outcome={outcome} />
            ))}
          </div>
        ) : null}

        {state.totals ? (
          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-surface-border bg-surface-muted px-3.5 py-3 text-xs sm:grid-cols-5">
            <Total label="Gold candidates" value={state.totals.goldCandidates} />
            <Total label="Silver candidates" value={state.totals.silverCandidates} />
            <Total label="Awaiting review" value={state.totals.pending} />
            <Total label="Refused categories" value={state.totals.rejected} />
            <Total label="Overrides preserved" value={state.totals.overridesPreserved} />
          </dl>
        ) : null}

        <p className="text-xs leading-relaxed text-ink-400">
          Nothing is published by fetching. A stored candidate stays pending until an administrator approves it, and the
          Android app never reads a pending record.
        </p>
      </div>
    </SectionCard>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-sm font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

function OutcomeCard({ outcome }: { outcome: MetalSyncOutcome }) {
  const metal = METAL_TYPE_LABELS[outcome.metal];

  return (
    <div className="rounded-lg border border-surface-border bg-surface px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink-900">{metal}</p>
        <Badge tone={outcome.status === "succeeded" ? "brand" : outcome.status === "failed" ? "red" : "slate"}>
          {outcome.status === "succeeded" ? "Fetched and validated" : outcome.status === "failed" ? "Failed" : "Not attempted"}
        </Badge>
      </div>

      {outcome.error ? <p className="mt-2 text-xs leading-relaxed text-red-800">{outcome.error}</p> : null}

      {outcome.recorded.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-ink-700">
          {outcome.recorded.map((entry) => (
            <li key={entry.purity}>
              <span className="font-medium">{entry.purity}</span> {formatPricePerGram(entry.pricePerGram)} BDT per gram —
              stored as a candidate
            </li>
          ))}
        </ul>
      ) : null}

      {outcome.rejected.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-amber-800">Refused</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-amber-900">
            {outcome.rejected.map((entry) => (
              <li key={`${entry.purity}-${entry.reason}`}>
                <span className="font-medium">{entry.purity}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {outcome.notices.length > 0 ? (
        <div className="mt-2 space-y-1 text-xs leading-relaxed text-ink-500">
          {outcome.notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
