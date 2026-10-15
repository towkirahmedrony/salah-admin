import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Alert, ErrorState } from "@/components/ui/states";
import { getLocationTree } from "@/features/locations/queries";
import { PrayerConfigForm } from "@/features/prayer-config/prayer-config-form";
import { newConfigDefaults } from "@/features/prayer-config/definitions";
import { todayInDisplayTimezone } from "@/lib/utils/format";

export const metadata: Metadata = { title: "New prayer configuration" };
export const dynamic = "force-dynamic";

/**
 * Create a new prayer calculation configuration.
 *
 * `requireAdmin("manage_prayer_config")` means a role without the capability cannot
 * reach this page at all — and cannot reach the action behind it either, because the
 * action re-checks the same capability and the table's RLS policy decides finally.
 */
export default async function NewPrayerConfigPage() {
  await requireAdmin("manage_prayer_config");

  const supabase = await getServerSupabase();
  if (!supabase) {
    return (
      <ErrorState
        title="Not connected"
        message="The database client could not be created. Check the environment configuration."
      />
    );
  }

  const tree = await getLocationTree(supabase);

  return (
    <>
      <PageHeader
        title="New prayer configuration"
        breadcrumbs={[
          { label: "Prayer & Calendar" },
          { label: "Prayer Configuration", href: "/prayer-config" },
          { label: "New" },
        ]}
        description="Describe the parameters the Android app's engine should calculate with. What you save here is a draft and has no effect until it is published."
      />

      {tree.error ? (
        <div className="mb-5">
          <ErrorState
            title="Location data could not be read"
            message={`A division, district or thana scope cannot be selected until this is resolved. ${tree.error.message}`}
            hint={tree.error.hint}
          />
        </div>
      ) : null}

      {tree.divisions.length === 0 && !tree.error ? (
        <div className="mb-5">
          <Alert tone="warning" title="No location data yet">
            No divisions are recorded, so only the global scope can be used. Seed the reference dataset
            from the Location section before creating a division, district or thana override.
          </Alert>
        </div>
      ) : null}

      <PrayerConfigForm
        mode="create"
        tree={tree}
        values={newConfigDefaults(todayInDisplayTimezone())}
      />
    </>
  );
}
