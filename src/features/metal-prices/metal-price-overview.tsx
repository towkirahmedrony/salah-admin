import { Coins, ExternalLink, HandCoins, TriangleAlert } from "lucide-react";

import { Badge, TableEmptyRow, TableShell } from "@/components/ui/data";
import { SectionCard } from "@/components/ui/page-header";
import { Alert, EmptyState } from "@/components/ui/states";
import { RATE_MATRIX, rateKey, rateLabel } from "@/features/metal-prices/definitions";
import { assessPublishedAge } from "@/features/metal-prices/policy";
import type { MetalPriceSnapshot } from "@/features/metal-prices/queries";
import { PROVIDER_DISCLAIMER, PROVIDER_LABEL } from "@/features/metal-prices/constants";
import type { MetalPriceRow } from "@/lib/types/database";
import { formatDateTime, formatPricePerGram } from "@/lib/utils/format";

/**
 * The at-a-glance state of every rate the panel manages.
 *
 * Two things it refuses to do, both deliberate:
 *
 *   * It never shows an unpublished or unverified price as a current price. A rate
 *     that is not live reads "Not published", and the panel says whether a
 *     candidate is waiting — which is a different fact from a price.
 *   * It never describes a timestamp as proving the price is current. Each one is
 *     named for what it is, and the provider's own build time is labelled as such.
 */
export function MetalPriceOverview({
  snapshot,
  adminLabels,
}: {
  snapshot: MetalPriceSnapshot;
  adminLabels: Map<string, string>;
}) {
  const published = RATE_MATRIX.map((identity) => ({
    identity,
    rate: snapshot.published.get(rateKey(identity.metal, identity.purity)) ?? null,
  }));

  const missingDefaults = published.filter(
    ({ identity, rate }) => (identity.metal === "gold" || identity.metal === "silver") && identity.purity === "K22" && !rate,
  );

  const needsReview = published
    .filter(({ rate }) => rate !== null)
    .map(({ rate }) => ({ rate: rate as MetalPriceRow, freshness: assessPublishedAge(rate!, snapshot.policy) }))
    .filter(({ freshness }) => freshness.level === "stale" || freshness.level === "unknown" || freshness.level === "implausible");

  const liveOverrides = published.filter(({ rate }) => Boolean(rate?.override_active));

  return (
    <SectionCard
      title="Current published prices"
      description={`Bangladesh reference prices in BDT per gram. ${PROVIDER_LABEL} supplies the figures the panel reviews.`}
    >
      <div className="space-y-4">
        {missingDefaults.length > 0 ? (
          <Alert tone="warning" title="The Android app's default rate is not published">
            <p>
              The app reads <span className="font-medium">Gold K22</span> and{" "}
              <span className="font-medium">Silver K22</span>. Nothing is published for{" "}
              {missingDefaults.map(({ identity }) => rateLabel(identity.metal, identity.purity)).join(" and ")}, so the
              app falls back to manual price entry for it.
            </p>
            <p>
              No other purity is substituted. A 21K or 18K figure is a different price for a different metal content,
              and publishing it under the K22 name would be wrong rather than merely approximate.
            </p>
          </Alert>
        ) : null}

        {needsReview.length > 0 ? (
          <Alert tone="warning" title="Some published rates are due a review">
            <ul className="list-disc space-y-1 pl-5">
              {needsReview.map(({ rate, freshness }) => (
                <li key={rate.id}>
                  <span className="font-medium">{rateLabel(rate.metal_type, rate.purity)}</span> — {freshness.explanation}
                </li>
              ))}
            </ul>
            <p>
              They stay published: the app is reading them, and withdrawing a price without a reviewed replacement would
              leave users with nothing.
            </p>
          </Alert>
        ) : null}

        {liveOverrides.length > 0 ? (
          <Alert tone="info" title="Manual overrides are live">
            <p>
              {liveOverrides.map(({ rate }) => rateLabel(rate!.metal_type, rate!.purity)).join(", ")}{" "}
              {liveOverrides.length === 1 ? "is" : "are"} an administrator&apos;s own reference price. Synchronization records
              candidates for comparison but does not replace an override.
            </p>
          </Alert>
        ) : null}

        <TableShell
          caption="Published gold and silver reference prices"
          columns={["Rate", "Price per gram", "Status", "Source", "Provider record", "Details"]}
        >
          {published.length === 0 ? (
            <TableEmptyRow colSpan={6}>
              <EmptyState
                title="No rates are defined"
                description="This should not be reachable: the rate list is a constant in the panel."
              />
            </TableEmptyRow>
          ) : (
            <tbody>
              {published.map(({ identity, rate }) => (
                <RateRow
                  key={rateKey(identity.metal, identity.purity)}
                  metal={identity.metal}
                  purity={identity.purity}
                  rate={rate}
                  snapshot={snapshot}
                  adminLabels={adminLabels}
                />
              ))}
            </tbody>
          )}
        </TableShell>

        <p className="text-xs leading-relaxed text-ink-400">{PROVIDER_DISCLAIMER}</p>
      </div>
    </SectionCard>
  );
}

function RateRow({
  metal,
  purity,
  rate,
  snapshot,
  adminLabels,
}: {
  metal: MetalPriceRow["metal_type"];
  purity: MetalPriceRow["purity"];
  rate: MetalPriceRow | null;
  snapshot: MetalPriceSnapshot;
  adminLabels: Map<string, string>;
}) {
  const label = rateLabel(metal, purity);
  const candidate = snapshot.candidates.find((row) => row.metal_type === metal && row.purity === purity);
  const freshness = rate ? assessPublishedAge(rate, snapshot.policy) : null;

  return (
    <tr>
      <th scope="row" className="text-left font-medium text-ink-900">
        <span className="inline-flex items-center gap-1.5">
          <Coins className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
          {label}
        </span>
      </th>

      <td className="whitespace-nowrap">
        {rate ? (
          <span className="font-medium text-ink-900">
            {formatPricePerGram(rate.price_per_gram)} <span className="text-xs font-normal text-ink-500">BDT/g</span>
          </span>
        ) : (
          <span className="text-ink-500">Not published</span>
        )}
      </td>

      <td>
        <div className="flex flex-wrap gap-1">
          {rate ? (
            <>
              <Badge tone="brand">Verified</Badge>
              {rate.override_active ? (
                <Badge tone="amber" title="An administrator activated this price as a manual override">
                  <HandCoins className="h-3 w-3" aria-hidden="true" />
                  Override
                </Badge>
              ) : null}
              {freshness && freshness.level !== "current" && freshness.level !== "aging" ? (
                <Badge tone="amber" title={freshness.explanation}>
                  <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                  {freshness.label}
                </Badge>
              ) : null}
            </>
          ) : candidate ? (
            <Badge tone="slate">Candidate awaiting review</Badge>
          ) : (
            <Badge tone="outline">Unavailable</Badge>
          )}
        </div>
      </td>

      <td className="max-w-[14rem] text-xs">
        {rate ? (
          <>
            <span className="block truncate text-ink-700">{rate.source ?? "Not recorded"}</span>
            {rate.source_url ? (
              <a
                href={rate.source_url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-brand-700 hover:underline"
              >
                Source reference
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ) : null}
          </>
        ) : (
          <span className="text-ink-400">—</span>
        )}
      </td>

      <td className="whitespace-nowrap text-xs text-ink-600">
        {rate?.provider_last_update ? (
          <span title="When the provider's data file was built. Not the date the price changed.">
            {formatDateTime(rate.provider_last_update)}
          </span>
        ) : (
          <span className="text-ink-400">No provider timestamp</span>
        )}
      </td>

      <td>
        {rate ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-brand-700">Timestamps and review</summary>
            <dl className="mt-2 space-y-1.5 text-ink-600">
              <TimestampRow
                label="Effective from"
                value={rate.effective_at ? formatDateTime(rate.effective_at) : null}
                fallback="Not established"
                title="When the rate became effective, as recorded by the administrator who published it."
              />
              <TimestampRow
                label="Provider data built"
                value={rate.provider_last_update ? formatDateTime(rate.provider_last_update) : null}
                fallback="Not supplied"
                title="The provider's own lastUpdate. It records when its JSON was built, not when a price changed."
              />
              <TimestampRow
                label="Fetched"
                value={rate.fetched_at ? formatDateTime(rate.fetched_at) : null}
                fallback="Entered manually"
                title="When this panel received the provider document."
              />
              <TimestampRow
                label="Record updated"
                value={formatDateTime(rate.updated_at)}
                fallback="—"
                title="The last write to this record."
              />
              <TimestampRow
                label="Reviewed by"
                value={rate.reviewed_by ? (adminLabels.get(rate.reviewed_by) ?? "An administrator") : null}
                fallback="—"
                title="The administrator whose action made this the published rate."
              />
              {rate.review_note ? (
                <div>
                  <dt className="font-medium text-ink-500">Note</dt>
                  <dd className="break-words">{rate.review_note}</dd>
                </div>
              ) : null}
            </dl>
            {freshness ? <p className="mt-2 text-ink-500">{freshness.explanation}</p> : null}
          </details>
        ) : (
          <span className="text-ink-400">—</span>
        )}
      </td>
    </tr>
  );
}

function TimestampRow({
  label,
  value,
  fallback,
  title,
}: {
  label: string;
  value: string | null;
  fallback: string;
  title: string;
}) {
  return (
    <div>
      <dt className="font-medium text-ink-500" title={title}>
        {label}
      </dt>
      <dd>{value ?? <span className="text-ink-400">{fallback}</span>}</dd>
    </div>
  );
}
