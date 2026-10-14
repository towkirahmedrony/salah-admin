import "server-only";

import { requireAdmin } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { roleCan } from "@/lib/permissions/permissions";
import { ErrorState } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/page-header";
import { LOCATION_RESOURCES, type LocationResourceKey } from "@/features/locations/definitions";
import { getLocationTree, listLocationResource } from "@/features/locations/queries";
import { LocationManager, type LocationFilterState } from "@/features/locations/location-manager";
import {
  PAGE_SIZE,
  readEnum,
  readPositiveInt,
  readString,
  type RawSearchParams,
} from "@/lib/utils/search-params";
import type { VerificationStatus } from "@/lib/types/database";

const VERIFICATION_VALUES = ["unverified", "verified", "rejected"] as const;

/**
 * Shared page body for all four location levels.
 *
 * Each level gets its own route so the sidebar, breadcrumbs and URLs stay
 * meaningful, but the behaviour lives here once — which is why the four levels
 * cannot drift apart in search, paging or permission handling.
 */
export async function LocationResourcePage({
  resource,
  searchParams,
}: {
  resource: LocationResourceKey;
  searchParams: RawSearchParams;
}) {
  const admin = await requireAdmin("manage_locations");
  const definition = LOCATION_RESOURCES[resource];

  const supabase = await getServerSupabase();
  if (!supabase) {
    return (
      <ErrorState
        title="Not connected"
        message="The database client could not be created. Check the environment configuration."
      />
    );
  }

  const filters: LocationFilterState = {
    q: readString(searchParams, "q").slice(0, 120),
    active: readEnum(searchParams, "active", ["all", "active", "inactive"] as const, "all") || "all",
    parent: readString(searchParams, "parent"),
    thana: readString(searchParams, "thana"),
    verification: readEnum(searchParams, "verification", VERIFICATION_VALUES, ""),
    page: readPositiveInt(searchParams, "page", 1),
  };

  const tree = await getLocationTree(supabase);

  const result = await listLocationResource(supabase, tree, resource, {
    search: filters.q,
    isActive: filters.active,
    parentId: filters.parent,
    thanaId: filters.thana,
    verification: filters.verification as VerificationStatus | "",
    page: filters.page,
  });

  return (
    <>
      <PageHeader
        title={definition.plural}
        breadcrumbs={[
          { label: "Location", href: "/locations/divisions" },
          { label: definition.plural },
        ]}
        description={definition.description}
      />

      <LocationManager
        def={definition}
        tree={tree}
        result={result}
        filters={filters}
        canWrite={roleCan(admin.role, "manage_locations")}
      />

      <p className="mt-6 text-xs leading-relaxed text-ink-400">
        Showing up to {PAGE_SIZE} records per page. Bulk CSV import is not part of this version —
        export is provided instead, so the dataset can be reviewed before any import tool is built.
      </p>
    </>
  );
}
