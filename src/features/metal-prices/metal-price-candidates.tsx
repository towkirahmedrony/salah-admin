"use client";

import { ExternalLink, HandCoins, TriangleAlert } from "lucide-react";
import { useActionState, useId, useState } from "react";

import { Badge } from "@/components/ui/data";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { ConfirmSubmitButton } from "@/components/ui/modal";
import { SectionCard } from "@/components/ui/page-header";
import { Alert, EmptyState } from "@/components/ui/states";
import {
  publishMetalPriceRate,
  rejectMetalPriceCandidate,
  type MetalPriceActionState,
} from "@/features/metal-prices/actions";
import { INITIAL_METAL_PRICE_ACTION_STATE } from "@/features/metal-prices/constants";
import { rateLabel } from "@/features/metal-prices/definitions";
import type { CandidateView } from "@/features/metal-prices/views";
import { formatDateTime, formatPricePerGram } from "@/lib/utils/format";

/**
 * The review queue.
 *
 * The candidate and the rate it would replace are shown together, because that
 * comparison is the review: a price on its own tells a reviewer almost nothing.
 *
 * Three things the screen refuses to do:
 *   * it never offers to publish a candidate whose timestamp this panel would
 *     refuse — the database would reject it anyway, and offering it would be a
 *     button that cannot work;
 *   * it never publishes without the stale acknowledgement when the policy
 *     requires one, which is a real checkbox whose value the action reads;
 *   * it never implies that rejecting a candidate changes the live rate, which it
 *     does not.
 */
export function MetalPriceCandidates({ views, canWrite }: { views: CandidateView[]; canWrite: boolean }) {
  return (
    <SectionCard
      title="Candidates awaiting review"
      description="Fetched prices that nobody has verified yet. They are not published and the Android app cannot read them."
    >
      {views.length === 0 ? (
        <EmptyState
          title="Nothing is waiting for review"
          description="A fetch stores what the provider published here. When there is nothing to review, no price is pending — which is not the same as the live rates being current."
        />
      ) : (
        <div className="space-y-4">
          {!canWrite ? (
            <Alert tone="info">
              Your role can see candidates but not act on them. Approving and rejecting require the reference-price
              capability.
            </Alert>
          ) : null}

          {views.map((view) => (
            <CandidateCard key={view.candidate.id} view={view} canWrite={canWrite} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function CandidateCard({ view, canWrite }: { view: CandidateView; canWrite: boolean }) {
  const [publishState, publishAction] = useActionState<MetalPriceActionState, FormData>(
    publishMetalPriceRate,
    INITIAL_METAL_PRICE_ACTION_STATE,
  );
  const [rejectState, rejectAction] = useActionState<MetalPriceActionState, FormData>(
    rejectMetalPriceCandidate,
    INITIAL_METAL_PRICE_ACTION_STATE,
  );

  const [acknowledged, setAcknowledged] = useState(false);
  const acknowledgeId = useId();
  const label = rateLabel(view.metal, view.purity);
  const error = [publishState, rejectState].find((state) => state.status === "error");
  const success = [publishState, rejectState].find((state) => state.status === "success");

  const acknowledgedOrNotNeeded = !view.needsAcknowledgement || acknowledged;
  const canPublish = canWrite && !view.blocked && acknowledgedOrNotNeeded;

  return (
    <div className="rounded-xl border border-surface-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-surface-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">{label}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            Proposed {formatPricePerGram(view.candidate.price_per_gram)} BDT per gram
            {view.current ? (
              <>
                {" · "}
                currently {formatPricePerGram(view.current.price_per_gram)} BDT per gram
              </>
            ) : (
              " · nothing is published for this rate"
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-1">
          <DirectionBadge view={view} />
          <Badge tone={view.candidateFreshness.level === "current" ? "brand" : "amber"}>
            {view.candidateFreshness.label}
          </Badge>
          {view.replacesOverride ? (
            <Badge tone="amber" title="Publishing cannot displace an active manual override">
              <HandCoins className="h-3 w-3" aria-hidden="true" />
              Override live
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {view.blocked ? (
          <Alert tone="error" title="This candidate cannot be published" role="alert">
            {view.candidateFreshness.explanation} Fetch the prices again; a later run will produce a candidate that can be
            reviewed.
          </Alert>
        ) : null}

        {view.replacesOverride ? (
          <Alert tone="warning" title="An active manual override is live for this rate">
            <p>
              Publication would be refused while the override is active. Deactivate the override in the section below
              first — that is what keeps a synchronization from quietly replacing an administrator&apos;s decision.
            </p>
          </Alert>
        ) : null}

        <Alert tone={view.candidateFreshness.level === "stale" || view.candidateFreshness.level === "unknown" ? "warning" : "info"}>
          {view.candidateFreshness.explanation}
        </Alert>

        <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
          <Detail label="Source" value={view.candidate.source ?? "Not recorded"} />
          <Detail
            label="Provider data built"
            value={view.candidate.provider_last_update ? formatDateTime(view.candidate.provider_last_update) : "Not supplied"}
            title="The provider's own lastUpdate. It records when its JSON was built, not when a price changed."
          />
          <Detail
            label="Fetched"
            value={view.candidate.fetched_at ? formatDateTime(view.candidate.fetched_at) : "Not recorded"}
            title="When this panel received the provider document."
          />
        </dl>

        {view.candidate.source_url ? (
          <a
            href={view.candidate.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
          >
            Open the source reference
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}

        {error ? (
          <Alert tone="error" role="alert" title="Action not completed">
            {error.message}
          </Alert>
        ) : null}
        {success ? (
          <Alert tone="success" title="Done">
            {success.message}
          </Alert>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          {/* ---------------------------------------------------- publish --- */}
          <form action={publishAction} className="space-y-3 rounded-lg border border-surface-border bg-surface-muted px-3.5 py-3">
            <input type="hidden" name="id" value={view.candidate.id} />

            <p className="text-sm font-semibold text-ink-900">Approve and publish</p>

            <Field
              name={`effective_at_${view.candidate.id}`}
              label="Effective date"
              help="When this rate became effective, if you can establish it. Leave blank when the source does not say — the record will show that no effective time is known."
            >
              {(props) => <Input {...props} type="date" name="effective_at" disabled={!canWrite} />}
            </Field>

            {view.needsAcknowledgement ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <input type="hidden" name="acknowledge_stale" value={acknowledged ? "true" : "false"} />
                <Checkbox
                  id={acknowledgeId}
                  label="I have checked the source and accept that this record cannot show when the price changed."
                  help="The provider's timestamp is when its data file was built, so it does not establish the price's effective date."
                  checked={acknowledged}
                  disabled={!canWrite}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
              </div>
            ) : (
              <input type="hidden" name="acknowledge_stale" value="false" />
            )}

            <ConfirmSubmitButton
              label="Approve and publish"
              variant="primary"
              title={`Publish ${label}?`}
              confirmLabel="Publish rate"
              confirmLabelPending="Publishing…"
              disabled={!canPublish}
              size="sm"
              requireCheckboxLabel={
                view.current && !view.replacesOverride
                  ? `I understand this replaces the currently published ${label} rate of ${formatPricePerGram(view.current.price_per_gram)} BDT per gram.`
                  : undefined
              }
              description={
                <>
                  <p className="flex items-center justify-between gap-4">
                    <span>
                      <span className="font-medium">Current</span>
                      <br />
                      {view.current ? `${formatPricePerGram(view.current.price_per_gram)} BDT/g` : "Not published"}
                    </span>
                    <span className="text-ink-400" aria-hidden="true">
                      →
                    </span>
                    <span>
                      <span className="font-medium">Proposed</span>
                      <br />
                      {formatPricePerGram(view.candidate.price_per_gram)} BDT/g
                    </span>
                  </p>
                  <p>
                    {view.current
                      ? `The published ${label} rate is deactivated and kept in the history; this candidate becomes the rate the Android app reads.`
                      : `${label} has no published rate, so nothing is replaced.`}
                  </p>
                  <p>
                    This records an administrative review of the source and the timestamps. It does not verify the price
                    against BAJUS, and it makes no claim that the price is current beyond what the record shows.
                  </p>
                </>
              }
            />
          </form>

          {/* ----------------------------------------------------- reject --- */}
          <form action={rejectAction} className="space-y-3 rounded-lg border border-surface-border bg-surface-muted px-3.5 py-3">
            <input type="hidden" name="id" value={view.candidate.id} />

            <p className="text-sm font-semibold text-ink-900">Reject</p>

            <Field name={`reason_${view.candidate.id}`} label="Reason" help="Recorded with the rejection and visible later in the history.">
              {(props) => (
                <Textarea {...props} name="reason" rows={3} disabled={!canWrite} placeholder="For example: the source page did not match the feed." />
              )}
            </Field>

            <ConfirmSubmitButton
              label="Reject candidate"
              variant="danger"
              title={`Reject the ${label} candidate?`}
              confirmLabel="Reject candidate"
              confirmLabelPending="Rejecting…"
              disabled={!canWrite}
              size="sm"
              description={
                <>
                  <p>
                    The candidate is marked rejected and cannot be published. The published {label} rate is not affected.
                  </p>
                  <p>
                    Rejection is final for this candidate. A later synchronization stores a fresh candidate rather than
                    reopening this one, so rejecting the wrong candidate costs a fetch, not a price.
                  </p>
                </>
              }
            />
          </form>
        </div>
      </div>
    </div>
  );
}

function DirectionBadge({ view }: { view: CandidateView }) {
  if (view.direction === "unknown") {
    return <Badge tone="outline">No current rate to compare</Badge>;
  }

  const tone = view.direction === "higher" ? "amber" : view.direction === "lower" ? "brand" : "neutral";
  const text = view.direction === "higher" ? "Higher than published" : view.direction === "lower" ? "Lower than published" : "Same as published";

  return (
    <Badge tone={tone}>
      {view.direction === "higher" ? <TriangleAlert className="h-3 w-3" aria-hidden="true" /> : null}
      {text}
    </Badge>
  );
}

function Detail({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium text-ink-500" title={title}>
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-ink-900">{value}</dd>
    </div>
  );
}
