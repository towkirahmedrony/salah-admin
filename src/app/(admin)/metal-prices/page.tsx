import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { Alert, ErrorState } from "@/components/ui/states";
import { MetalPriceCandidates } from "@/features/metal-prices/metal-price-candidates";
import { MetalPriceHistory } from "@/features/metal-prices/metal-price-history";
import { MetalPriceOverride } from "@/features/metal-prices/metal-price-override";
import { MetalPriceOverview } from "@/features/metal-prices/metal-price-overview";
import { MetalPriceSync } from "@/features/metal-prices/metal-price-sync";
import { SYNC_HISTORY_LIMIT } from "@/features/metal-prices/constants";
import { getAdminLabels, getMetalPriceSnapshot, listSyncLogs } from "@/features/metal-prices/queries";
import { buildCandidateViews, buildSupersededViews, liveOverrides } from "@/features/metal-prices/views";
import { requireAdmin } from "@/lib/auth/session";
import { roleCan } from "@/lib/permissions/permissions";
import { getServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Metal Reference Prices" };
export const dynamic = "force-dynamic";

/**
 * Gold and silver reference prices.
 *
 * The page reads the tables for real, and a database that is unreachable, a
 * migration that has not been applied, and a genuine absence of published rates
 * are three different renderings. A page that shows "no published prices" because
 * a query failed would be the worst possible answer here: the absence of a rate and
 * the inability to read one look identical to a user, and only one of them means
 * the Android app will fall back to manual entry.
 *
 * The capability is required to open the page at all, which matches the read
 * policy on the table: reference prices in review are management data, and a role
 * without the capability is redirected rather than shown an empty list.
 */
export default async function MetalPricesPage() {
  const admin = await requireAdmin("manage_metal_prices");
  const supabase = await getServerSupabase();

  // The client is null only when the Supabase environment variables are missing.
  // Saying so is better than rendering an empty price list, which would read as
  // "nothing is published".
  if (!supabase) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Metal Reference Prices"
          description="Bangladesh gold and silver reference prices in BDT per gram, as the Zakat calculator reads them."
        />
        <ErrorState
          title="Reference prices are not configured"
          message="This deployment has no Supabase URL and key, so nothing can be read. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then reload."
        />
      </div>
    );
  }

  const canWrite = roleCan(admin.role, "manage_metal_prices");

  const snapshot = await getMetalPriceSnapshot(supabase);
  const history = await listSyncLogs(supabase, SYNC_HISTORY_LIMIT);

  const reviewerIds = [...snapshot.published.values()]
    .map((rate) => rate.reviewed_by)
    .filter((id): id is string => Boolean(id));
  const adminLabels = await getAdminLabels(supabase, reviewerIds);

  const candidates = buildCandidateViews(snapshot);
  const superseded = buildSupersededViews(snapshot);
  const overrides = liveOverrides(snapshot);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Metal Reference Prices"
        description="Bangladesh gold and silver reference prices in BDT per gram, as the Zakat calculator reads them."
      />

      {snapshot.error ? (
        <ErrorState
          title="Reference prices could not be read"
          message="The pricing tables could not be queried, so nothing is shown. Published rates are unaffected — this is a panel problem, not a price problem."
          hint="If the reference-price migration has not been applied to this database yet, apply it and reload. The feature's documentation describes the two migrations and what each one creates."
        />
      ) : (
        <>
          <MetalPriceOverview snapshot={snapshot} adminLabels={adminLabels} />

          <MetalPriceSync canWrite={canWrite} />

          <MetalPriceCandidates views={candidates} canWrite={canWrite} />

          <MetalPriceOverride overrides={overrides} superseded={superseded} today={today} canWrite={canWrite} />

          {history.error ? (
            <Alert tone="warning" title="Synchronization history could not be read">
              The log table could not be queried. The published rates and the review queue above are unaffected.
            </Alert>
          ) : (
            <MetalPriceHistory logs={history.logs} />
          )}

          <section className="card px-4 py-4">
            <h2 className="text-sm font-semibold text-ink-900">How these prices are used</h2>
            <div className="mt-3 space-y-2 text-xs leading-relaxed text-ink-600">
              <p>
                The Android Zakat calculator reads only rates that are published <span className="font-medium">and</span>{" "}
                verified. Its default reference category is <span className="font-medium">K22</span> for both gold and
                silver, in BDT per gram. Nothing here changes a user&apos;s Nisab settings, their metal weights, or any
                other calculation choice.
              </p>
              <p>
                A published reference price is an administrative, market-level figure. It is not the resale value of a
                particular item: purity, condition, making charges, VAT and a shop&apos;s own deductions all change what
                someone is actually offered.
              </p>
              <p>
                Neither the provider nor this panel can promise that a published rate is current. The provider&apos;s
                timestamp records when its data file was built, so it is stored and shown as exactly that — and the
                effective date is only ever filled in by an administrator who could establish it.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
