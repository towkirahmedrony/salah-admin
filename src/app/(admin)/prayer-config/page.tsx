import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { roleCan } from "@/lib/permissions/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import { getLocationTree } from "@/features/locations/queries";
import {
  countPrayerConfigsByStatus,
  listPrayerConfigs,
  type PrayerConfigListFilters,
} from "@/features/prayer-config/queries";
import { PrayerConfigList } from "@/features/prayer-config/prayer-config-list";
import { PRAYER_CONFIG_SCOPES } from "@/lib/validation/prayer-config";
import {
  readEnum,
  readPositiveInt,
  readString,
  type RawSearchParams,
} from "@/lib/utils/search-params";
import type { PrayerConfigScope, RecordStatus } from "@/lib/types/database";

export const metadata: Metadata = { title: "Prayer Configuration" };
export const dynamic = "force-dynamic";

const STATUS_VALUES = ["draft", "published", "archived"] as const;

/**
 * Prayer calculation configuration list.
 *
 * The page reads the table for real. A database that is unreachable, a missing
 * table and a genuine empty set are three different renderings — a list that shows
 * "0 configurations" for a failed query is the failure mode this panel is built to
 * avoid.
 */
export default async function PrayerConfigPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const admin = await requireAdmin("view_dashboard");
  const canWrite = roleCan(admin.role, "manage_prayer_config");
  const params = await searchParams;

  const supabase = await getServerSupabase();
  if (!supabase) {
    return (
      <ErrorState
        title="Not connected"
        message="The database client could not be created. Check the environment configuration."
      />
    );
  }

  // Reading the list requires an administrator, because drafts are administrator-only
  // data. A role without the capability sees the list read-only rather than a
  // forbidden page: they can see what is published, not what is being prepared.
  const filters: PrayerConfigListFilters = {
    search: readString(params, "q").slice(0, 120),
    scope: readEnum<PrayerConfigScope>(params, "scope", PRAYER_CONFIG_SCOPES, "") || "",
    status: readEnum<RecordStatus>(params, "status", STATUS_VALUES, "") || "",
    page: readPositiveInt(params, "page", 1),
  };

  const tree = await getLocationTree(supabase);

  const [result, counts] = await Promise.all([
    listPrayerConfigs(supabase, tree, filters),
    countPrayerConfigsByStatus(supabase),
  ]);

  return (
    <>
      <PageHeader
        title="Prayer Configuration"
        breadcrumbs={[{ label: "Prayer & Calendar" }, { label: "Prayer Configuration" }]}
        description="Parameters for the Android app's own offline prayer-time engine. The panel publishes configuration; it never calculates prayer times itself."
        actions={
          canWrite ? (
            <ButtonLink href="/prayer-config/new" variant="primary">
              New configuration
            </ButtonLink>
          ) : undefined
        }
      />

      {tree.error ? (
        <div className="mb-4">
          <ErrorState
            title="Location data could not be read"
            message={`Configurations can still be listed, but their location names cannot be resolved. ${tree.error.message}`}
            hint={tree.error.hint}
          />
        </div>
      ) : null}

      {counts.error ? (
        <div className="mb-4">
          <ErrorState
            title="Status counts could not be read"
            message={counts.error.message}
            hint={counts.error.hint}
          />
        </div>
      ) : null}

      <PrayerConfigList
        result={result}
        filters={filters}
        searchParams={params}
        counts={counts}
        canWrite={canWrite}
      />

      <p className="mt-6 text-xs leading-relaxed text-ink-400">
        Precedence when the app resolves a configuration: a thana/upazila override beats a district one,
        which beats a division one, which beats the global configuration. Only published configurations
        are applied, and a draft never changes what is live. Locality-level overrides are not offered —
        the app stores a neighbourhood name but no stable identifier for it.
      </p>
    </>
  );
}
