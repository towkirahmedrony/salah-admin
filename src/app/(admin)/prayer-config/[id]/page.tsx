import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { requireAdmin } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { roleCan } from "@/lib/permissions/permissions";
import { PageHeader, SectionCard } from "@/components/ui/page-header";
import { Alert, ErrorState } from "@/components/ui/states";
import { StatusBadge, TableShell } from "@/components/ui/data";
import { buttonClass } from "@/components/ui/button";
import { getLocationTree } from "@/features/locations/queries";
import {
  getAdminLabels,
  getPrayerConfig,
  getPrayerConfigHistory,
  getPublicContractRows,
  resolveEffectiveConfig,
  scopeTargetLabel,
} from "@/features/prayer-config/queries";
import { configToFormValues } from "@/features/prayer-config/definitions";
import { PrayerConfigForm } from "@/features/prayer-config/prayer-config-form";
import { PrayerConfigReview } from "@/features/prayer-config/prayer-config-review";
import { PrayerConfigLifecycle } from "@/features/prayer-config/prayer-config-lifecycle";
import { reviewPrayerConfigForPublish } from "@/lib/validation/prayer-config";
import { formatDate, formatDateTime, todayInDisplayTimezone } from "@/lib/utils/format";
import { readString, type RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "Prayer configuration" };
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One prayer configuration: edit it if it is still a draft, review it either way.
 *
 * Everything shown is read from the row as stored, so what a reviewer sees on this
 * page is what is in the database — not what a form believes is in it.
 */
export default async function PrayerConfigDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const admin = await requireAdmin("view_dashboard");
  const canWrite = roleCan(admin.role, "manage_prayer_config");
  const { id } = await params;
  const query = await searchParams;

  if (!UUID_PATTERN.test(id)) {
    return (
      <>
        <PageHeader
          title="Configuration not found"
          breadcrumbs={[
            { label: "Prayer & Calendar" },
            { label: "Prayer Configuration", href: "/prayer-config" },
          ]}
        />
        <ErrorState
          title="That is not a configuration id"
          message="The address does not identify a prayer configuration."
          action={
            <Link href="/prayer-config" className={buttonClass("secondary", "md")}>
              Back to the list
            </Link>
          }
        />
      </>
    );
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return (
      <ErrorState
        title="Not connected"
        message="The database client could not be created. Check the environment configuration."
      />
    );
  }

  const [tree, loaded] = await Promise.all([getLocationTree(supabase), getPrayerConfig(supabase, id)]);

  if (loaded.error) {
    return (
      <ErrorState
        title="Could not read this configuration"
        message={loaded.error.message}
        hint={loaded.error.hint}
        action={
          <Link href="/prayer-config" className={buttonClass("secondary", "md")}>
            Back to the list
          </Link>
        }
      />
    );
  }

  const config = loaded.config;
  if (!config) {
    return (
      <>
        <PageHeader
          title="Configuration not found"
          breadcrumbs={[
            { label: "Prayer & Calendar" },
            { label: "Prayer Configuration", href: "/prayer-config" },
          ]}
        />
        <ErrorState
          title="No such configuration"
          message="It may have been deleted. Deletion is only possible for a draft, so a published configuration cannot disappear this way."
          action={
            <Link href="/prayer-config" className={buttonClass("secondary", "md")}>
              Back to the list
            </Link>
          }
        />
      </>
    );
  }

  const today = todayInDisplayTimezone();
  const target = scopeTargetLabel(tree, config);

  const [history, publicContract] = await Promise.all([
    getPrayerConfigHistory(supabase, config),
    getPublicContractRows(supabase),
  ]);

  const resolveDate = readString(query, "r_date").slice(0, 10) || today;
  const resolveDivision = readString(query, "r_division");
  const resolveDistrict = readString(query, "r_district");
  const resolveThana = readString(query, "r_thana");

  const resolved = await resolveEffectiveConfig(supabase, {
    divisionId: UUID_PATTERN.test(resolveDivision) ? resolveDivision : null,
    districtId: UUID_PATTERN.test(resolveDistrict) ? resolveDistrict : null,
    thanaId: UUID_PATTERN.test(resolveThana) ? resolveThana : null,
    onDate: resolveDate,
  });

  const issues = reviewPrayerConfigForPublish(config, { today });

  const adminLabels = await getAdminLabels(supabase, [
    ...history.versions.map((row) => row.published_by ?? ""),
    ...history.versions.map((row) => row.reviewed_by ?? ""),
    config.published_by ?? "",
    config.reviewed_by ?? "",
  ]);

  const label = (userId: string | null) =>
    userId ? (adminLabels.labels.get(userId) ?? "Unknown administrator") : "—";

  const engineList = publicContract.error;
  const editable = config.status === "draft" && canWrite;

  return (
    <>
      <PageHeader
        title={config.name}
        breadcrumbs={[
          { label: "Prayer & Calendar" },
          { label: "Prayer Configuration", href: "/prayer-config" },
          { label: `Version ${config.version}` },
        ]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={config.status} />
            <span>
              {target.label}
              {target.code ? <span className="ml-1.5 font-mono text-xs">{target.code}</span> : null} ·
              version {config.version}
            </span>
          </span>
        }
      />

      {/* --- Workflow --------------------------------------------------------- */}
      <SectionCard
        title="Workflow"
        description="Draft, published, archived. Publishing archives whatever was published for the same location, in one operation."
        className="mb-6"
      >
        <PrayerConfigLifecycle
          id={config.id}
          name={config.name}
          status={config.status}
          version={config.version}
          canPublish={canWrite}
        />

        {config.status === "published" ? (
          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            Published {formatDateTime(config.published_at)} by {label(config.published_by)}. Reviewed{" "}
            {formatDateTime(config.reviewed_at)} by {label(config.reviewed_by)}. A published configuration
            is immutable — change it by creating a new draft version, so what the app is using and the
            record of what it used to be both survive.
          </p>
        ) : null}

        {config.status === "archived" ? (
          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            Archived. This row is history: its parameters are preserved verbatim and it is never applied
            as active configuration. Create a new draft version to reuse it.
          </p>
        ) : null}
      </SectionCard>

      {/* --- Form (drafts only) ---------------------------------------------- */}
      {config.status === "draft" ? (
        editable ? (
          <div className="mb-6">
            <PrayerConfigForm mode="edit" tree={tree} values={configToFormValues(config)} />
          </div>
        ) : (
          <div className="mb-6">
            <Alert tone="info" title="Read-only">
              Your role can view this draft but not change it. Editing requires the prayer configuration
              capability.
            </Alert>
          </div>
        )
      ) : null}

      {/* --- Version history -------------------------------------------------- */}
      <SectionCard
        title="Version history"
        description="Every configuration that shares this scope and location, newest version first. Version history is per location: a thana override and the global configuration are different targets."
        className="mb-6"
      >
        {history.error ? (
          <ErrorState
            title="Could not read the version history"
            message={history.error.message}
            hint={history.error.hint}
          />
        ) : history.versions.length === 0 ? (
          <Alert tone="info">
            This is the only configuration for this scope and location. Publishing it will not replace
            anything.
          </Alert>
        ) : (
          <TableShell
            caption="Version history for this scope and location"
            columns={["Version", "Name", "Status", "Effective", "Reviewed by", "Published by", "Published"]}
          >
            <tbody>
              {history.versions.map((row) => (
                <tr key={row.id}>
                  <td className="tabular-nums">
                    <Link
                      href={`/prayer-config/${row.id}`}
                      className="font-medium text-ink-900 hover:text-brand-700 hover:underline"
                    >
                      {row.version}
                    </Link>
                  </td>
                  <td>{row.name}</td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td>
                    {formatDate(row.effective_from)}
                    <span className="text-ink-400">
                      {row.effective_to ? ` → ${formatDate(row.effective_to)}` : " →"}
                    </span>
                  </td>
                  <td className="text-xs">{label(row.reviewed_by)}</td>
                  <td className="text-xs">{label(row.published_by)}</td>
                  <td className="text-xs">{formatDateTime(row.published_at)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>

      {/* --- Review and preview ---------------------------------------------- */}
      <PrayerConfigReview
        config={config}
        tree={tree}
        published={history.published}
        versions={history.versions}
        issues={issues}
        resolved={resolved.resolved}
        resolveError={resolved.error}
        resolveInput={{
          divisionId: resolveDivision,
          districtId: resolveDistrict,
          thanaId: resolveThana,
          onDate: resolveDate,
        }}
        publicRows={engineList ? null : publicContract.rows}
        publicError={publicContract.error}
      />

      <p className="mt-6 flex items-center gap-1.5 text-xs leading-relaxed text-ink-400">
        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>
          The schema, the precedence rule and the Android integration contract are documented in{" "}
          <code className="rounded bg-surface-subtle px-1 py-0.5">docs/PRAYER_CONFIGURATION.md</code>.
        </span>
      </p>
    </>
  );
}
