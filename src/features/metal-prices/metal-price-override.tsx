"use client";

import { HandCoins, TriangleAlert } from "lucide-react";
import { useActionState, useState } from "react";

import { Badge } from "@/components/ui/data";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmSubmitButton } from "@/components/ui/modal";
import { SectionCard } from "@/components/ui/page-header";
import { Alert, EmptyState } from "@/components/ui/states";
import {
  deactivateMetalPriceOverride,
  saveMetalPriceOverride,
  type MetalPriceActionState,
} from "@/features/metal-prices/actions";
import { INITIAL_METAL_PRICE_ACTION_STATE } from "@/features/metal-prices/constants";
import { METAL_OPTIONS, PURITY_OPTIONS, newOverrideDefaults, rateLabel } from "@/features/metal-prices/definitions";
import type { SupersededRateView } from "@/features/metal-prices/views";
import type { MetalPriceRow } from "@/lib/types/database";
import { formatDateTime, formatPricePerGram } from "@/lib/utils/format";

/**
 * Manual reference prices.
 *
 * The entered value is an administrative reference price for one metal and purity
 * — not a market quote, and not a claim about what any individual item is worth.
 * The form says so, because an administrator who mistakes it for a market feed
 * would be misusing the field in a way the panel then publishes to every user.
 *
 * An override takes precedence over synchronization. That is why deactivating one
 * is a separate, explicit action with its own confirmation, and why nothing is
 * promoted on the way past: without a verified replacement the rate becomes
 * unavailable, and the panel says exactly that rather than quietly leaving a stale
 * price in place.
 */
export function MetalPriceOverride({
  overrides,
  superseded,
  today,
  canWrite,
}: {
  overrides: MetalPriceRow[];
  superseded: SupersededRateView[];
  today: string;
  canWrite: boolean;
}) {
  const [state, action] = useActionState<MetalPriceActionState, FormData>(
    saveMetalPriceOverride,
    INITIAL_METAL_PRICE_ACTION_STATE,
  );
  const defaults = newOverrideDefaults(today);

  return (
    <div className="space-y-5">
      <SectionCard
        title="Active manual overrides"
        description="A manual override is the published rate. Synchronization records candidates for comparison but never replaces an override."
      >
        {overrides.length === 0 ? (
          <EmptyState
            title="No manual override is active"
            description="Every published rate came from a reviewed provider record."
          />
        ) : (
          <div className="space-y-4">
            {overrides.map((override) => (
              <OverrideRow
                key={override.id}
                override={override}
                replacements={superseded.filter(
                  (candidate) =>
                    candidate.rate.metal_type === override.metal_type && candidate.rate.purity === override.purity,
                )}
                canWrite={canWrite}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Record a manual reference price"
        description="For when the provider's figures cannot be used — a shop notice, a correction, or a rate the published record does not cover."
      >
        {!canWrite ? (
          <Alert tone="info">
            Your role can see reference prices but not change them. Setting a manual price requires the reference-price
            capability.
          </Alert>
        ) : (
          <form action={action} className="space-y-4">
            {state.status === "error" ? (
              <Alert tone="error" role="alert" title="Not saved">
                {state.message}
              </Alert>
            ) : null}
            {state.status === "success" ? (
              <Alert tone="success" title="Saved">
                {state.message}
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="metal_type" label="Metal" errors={state.fieldErrors?.metal_type}>
                {(props) => (
                  <Select {...props} name="metal_type" defaultValue={String(defaults.metal_type)}>
                    {METAL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field
                name="purity"
                label="Purity category"
                help="K22 is the category the Android app reads by default. Setting a different one does not change what the app uses."
                errors={state.fieldErrors?.purity}
              >
                {(props) => (
                  <Select {...props} name="purity" defaultValue={String(defaults.purity)}>
                    {PURITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <Field
              name="price_per_gram"
              label="Price per gram (BDT)"
              required
              help="An administrative reference price in taka per gram. This is not a market quote and it does not guarantee what any item will fetch: purity, condition, making charges and shop deductions all change the real figure."
              errors={state.fieldErrors?.price_per_gram}
            >
              {(props) => <Input {...props} name="price_per_gram" inputMode="decimal" placeholder="19550.07" />}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="source" label="Source" errors={state.fieldErrors?.source}>
                {(props) => <Input {...props} name="source" placeholder="For example: BAJUS notice, 15 October" />}
              </Field>

              <Field
                name="source_url"
                label="Source URL"
                errors={state.fieldErrors?.source_url}
                help="Where the figure came from, so a colleague can check it later."
              >
                {(props) => <Input {...props} name="source_url" type="url" placeholder="https://" />}
              </Field>
            </div>

            <Field
              name="effective_at"
              label="Effective date"
              help="When this price took effect, if you know. Leave it as today if you are recording it as of now."
              errors={state.fieldErrors?.effective_at}
            >
              {(props) => <Input {...props} name="effective_at" type="date" defaultValue={today} />}
            </Field>

            <Field
              name="reason"
              label="Reason for this manual price"
              required
              help="Required. It is recorded with the rate and is the only thing that tells a future reviewer what this decision was based on."
              errors={state.fieldErrors?.reason}
            >
              {(props) => (
                <Textarea {...props} name="reason" rows={3} placeholder="For example: the published record had not been updated after the BAJUS revision." />
              )}
            </Field>

            <ConfirmSubmitButton
              label="Activate override"
              variant="primary"
              title="Activate this manual reference price?"
              confirmLabel="Activate override"
              confirmLabelPending="Activating…"
              description={
                <>
                  <p>
                    The price becomes the published rate for the metal and purity chosen above, and the Android app will
                    read it.
                  </p>
                  <p>
                    Any rate currently published for that one metal and purity is deactivated and kept in the history. No
                    other rate is touched.
                  </p>
                  <p>
                    Synchronization will keep fetching and validating the provider&apos;s figures, but it will not replace
                    this override until you deactivate it.
                  </p>
                </>
              }
            />
          </form>
        )}
      </SectionCard>
    </div>
  );
}

function OverrideRow({
  override,
  replacements,
  canWrite,
}: {
  override: MetalPriceRow;
  replacements: SupersededRateView[];
  canWrite: boolean;
}) {
  const [state, action] = useActionState<MetalPriceActionState, FormData>(
    deactivateMetalPriceOverride,
    INITIAL_METAL_PRICE_ACTION_STATE,
  );
  const [restoreId, setRestoreId] = useState("");
  const label = rateLabel(override.metal_type, override.purity);

  // The rates the panel will offer to restore: verified, previously published, and
  // for this identity only. A pending candidate is never offered, so it cannot be
  // promoted by the act of turning an override off.
  const usable = replacements.filter((candidate) => !candidate.freshness.refusesPublication);

  return (
    <div className="rounded-xl border border-surface-border bg-surface px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-900">
            <HandCoins className="h-4 w-4 text-amber-700" aria-hidden="true" />
            {label}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {formatPricePerGram(override.price_per_gram)} BDT per gram
            {override.effective_at ? ` · effective from ${formatDateTime(override.effective_at)}` : " · no effective date recorded"}
            {override.reviewed_by ? " · set by an administrator" : null}
          </p>
        </div>
        <Badge tone="amber">Override active</Badge>
      </div>

      {override.review_note ? (
        <p className="mt-3 rounded-lg border border-surface-border bg-surface-muted px-3 py-2 text-xs leading-relaxed text-ink-700">
          <span className="font-medium">Reason recorded: </span>
          {override.review_note}
        </p>
      ) : null}

      {state.status === "error" ? (
        <div className="mt-3">
          <Alert tone="error" role="alert" title="Not deactivated">
            {state.message}
          </Alert>
        </div>
      ) : null}
      {state.status === "success" ? (
        <div className="mt-3">
          <Alert tone="success" title="Done">
            {state.message}
          </Alert>
        </div>
      ) : null}

      <form action={action} className="mt-4 space-y-3 border-t border-surface-border pt-4">
        <input type="hidden" name="id" value={override.id} />

        {usable.length === 0 ? (
          <Alert tone="warning" title="No verified rate to fall back to">
            Nothing has been verified for {label} yet. Deactivating this override leaves the rate unpublished until you
            approve a reviewed candidate — the panel will not promote an unverified price to fill the gap, and it will not
            leave this override in place either.
          </Alert>
        ) : (
          <>
            <Field
              name={`restore_${override.id}`}
              label="Restore a verified rate"
              help="Optional. Only previously verified, published rates for this metal and purity are listed."
            >
              {(props) => (
                <Select
                  {...props}
                  name="restore_id"
                  value={restoreId}
                  disabled={!canWrite}
                  onChange={(event) => setRestoreId(event.target.value)}
                >
                  <option value="">Leave the rate unpublished</option>
                  {usable.map((candidate) => (
                    <option key={candidate.rate.id} value={candidate.rate.id}>
                      {formatPricePerGram(candidate.rate.price_per_gram)} BDT/g — {candidate.freshness.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {restoreId ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <input type="hidden" name="acknowledge_stale" value="true" />
                <p className="flex items-start gap-2 text-xs leading-relaxed text-amber-900">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    You are acknowledging that the restored rate&apos;s freshness has been reviewed. Its provider timestamp
                    records when that document was built, which cannot establish when the price changed.
                  </span>
                </p>
              </div>
            ) : (
              <input type="hidden" name="acknowledge_stale" value="false" />
            )}
          </>
        )}

        <ConfirmSubmitButton
          label="Deactivate override"
          variant="danger"
          size="sm"
          title={`Deactivate the ${label} override?`}
          confirmLabel="Deactivate override"
          confirmLabelPending="Deactivating…"
          disabled={!canWrite}
          description={
            <>
              <p>
                {restoreId
                  ? `The override stops being the published rate and the verified rate you chose is restored.`
                  : `The override stops being the published rate, and ${label} has no published rate afterwards.`}
              </p>
              <p>
                The override is kept in the history with its reason and who recorded it. Reinstating it means recording a
                new one.
              </p>
              <p>No synchronization runs as part of this, and no unverified candidate is promoted.</p>
            </>
          }
        />
      </form>
    </div>
  );
}
