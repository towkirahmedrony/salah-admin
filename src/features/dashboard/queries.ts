import "server-only";

import type { ServerSupabaseClient } from "@/lib/supabase/server";
import { toAppError, type AppError } from "@/lib/errors";
import type { AuthenticatedAdmin } from "@/lib/auth/session";
import { roleCan } from "@/lib/permissions/permissions";
import type { FeedbackStatus } from "@/lib/types/database";

/**
 * Dashboard data.
 *
 * Every number here comes from a real query. There is no invented figure, no
 * "active users" count and no download total, because this panel has no reliable
 * source for any of them.
 *
 * A count that fails is reported as a failure, never as zero. Presenting a
 * missing table as "0 divisions" is exactly the bug that makes an administrator
 * trust an empty dashboard.
 */

export interface MetricCardData {
  key: string;
  label: string;
  /** null when the query failed — rendered as "—", never as 0. */
  value: number | null;
  href: string;
  caption: string;
  error?: AppError;
}

export interface RecentAuditEvent {
  id: number;
  occurredAt: string;
  actorEmail: string | null;
  action: string;
  entityTable: string;
  entityId: string | null;
}

export interface RecentFeedback {
  id: string;
  category: string;
  status: FeedbackStatus;
  subject: string | null;
  createdAt: string;
}

export interface RecentlyPublished {
  label: string;
  title: string;
  publishedAt: string | null;
  href: string;
}

export interface StatusRow {
  label: string;
  value: string;
  tone: "ok" | "warn" | "info";
  href: string;
}

export interface DashboardData {
  metrics: MetricCardData[];
  schemaIssues: Array<{ label: string; error: AppError }>;
  recentAuditEvents: RecentAuditEvent[] | null;
  recentAuditError: AppError | null;
  recentFeedback: RecentFeedback[] | null;
  recentFeedbackError: AppError | null;
  recentlyPublished: RecentlyPublished[];
  datasetStatus: StatusRow[];
  configStatus: StatusRow[];
  connectedHost: string | null;
}

interface CountResult {
  count: number | null;
  error: AppError | null;
}

function fromCount(count: number | null, error: unknown): CountResult {
  if (error) return { count: null, error: toAppError(error) };
  return { count: count ?? 0, error: null };
}

export async function getDashboardData(
  supabase: ServerSupabaseClient,
  admin: AuthenticatedAdmin,
): Promise<DashboardData> {
  // Each query is written out with a literal table and column, so the generated
  // types actually check it. A stringly-typed count helper would compile while
  // quietly querying a column that does not exist.
  const [
    divisionsResult,
    districtsResult,
    activeThanasResult,
    verifiedLocalitiesResult,
    totalLocalitiesResult,
    publishedConfigsResult,
    publishedTimingsResult,
    publishedRamadanResult,
    openFeedbackResult,
    globalConfigResult,
  ] = await Promise.all([
    supabase.from("divisions").select("*", { count: "exact", head: true }),
    supabase.from("districts").select("*", { count: "exact", head: true }),
    supabase
      .from("thanas")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("localities")
      .select("*", { count: "exact", head: true })
      .eq("verification_status", "verified"),
    supabase.from("localities").select("*", { count: "exact", head: true }),
    supabase
      .from("prayer_calculation_configs")
      .select("*", { count: "exact", head: true })
      .eq("status", "published"),
    supabase
      .from("verified_prayer_timings")
      .select("*", { count: "exact", head: true })
      .eq("status", "published"),
    supabase
      .from("ramadan_calendar_versions")
      .select("*", { count: "exact", head: true })
      .eq("status", "published"),
    supabase
      .from("feedback_reports")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    supabase
      .from("prayer_calculation_configs")
      .select("id, name")
      .eq("scope", "global")
      .eq("status", "published")
      .maybeSingle(),
  ]);

  const divisions = fromCount(divisionsResult.count, divisionsResult.error);
  const districts = fromCount(districtsResult.count, districtsResult.error);
  const activeThanas = fromCount(activeThanasResult.count, activeThanasResult.error);
  const verifiedLocalities = fromCount(
    verifiedLocalitiesResult.count,
    verifiedLocalitiesResult.error,
  );
  const totalLocalities = fromCount(totalLocalitiesResult.count, totalLocalitiesResult.error);
  const publishedConfigs = fromCount(publishedConfigsResult.count, publishedConfigsResult.error);
  const publishedTimings = fromCount(publishedTimingsResult.count, publishedTimingsResult.error);
  const publishedRamadan = fromCount(publishedRamadanResult.count, publishedRamadanResult.error);
  const openFeedback = fromCount(openFeedbackResult.count, openFeedbackResult.error);

  const definitions: Array<{
    key: string;
    label: string;
    href: string;
    caption: string;
    result: CountResult;
  }> = [
    { key: "divisions", label: "Divisions", href: "/locations/divisions", caption: "Total recorded", result: divisions },
    { key: "districts", label: "Districts", href: "/locations/districts", caption: "Total recorded", result: districts },
    { key: "thanas", label: "Active thanas / upazilas", href: "/locations/thanas", caption: "Active records", result: activeThanas },
    {
      key: "localities",
      label: "Verified localities",
      href: "/locations/localities?verification=verified",
      caption:
        totalLocalities.count === null
          ? "Total count unavailable"
          : `${totalLocalities.count} localities in total`,
      result: verifiedLocalities,
    },
    { key: "prayer_configs", label: "Published prayer configurations", href: "/prayer-config?status=published", caption: "Currently live", result: publishedConfigs },
    { key: "prayer_timings", label: "Published timetable records", href: "/prayer-timings?status=published", caption: "Currently live", result: publishedTimings },
    { key: "ramadan", label: "Published Ramadan versions", href: "/ramadan?status=published", caption: "Currently live", result: publishedRamadan },
    { key: "feedback", label: "Pending feedback reports", href: "/feedback?status=open", caption: "Status: open", result: openFeedback },
  ];

  const metrics: MetricCardData[] = definitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    href: definition.href,
    caption: definition.caption,
    value: definition.result.count,
    ...(definition.result.error ? { error: definition.result.error } : {}),
  }));

  const schemaIssues = definitions
    .filter((definition): definition is typeof definition & { result: { error: AppError } } =>
      Boolean(definition.result.error),
    )
    .map((definition) => ({ label: definition.label, error: definition.result.error }));

  // --- Recent audit events (super admins only) -------------------------------
  let recentAuditEvents: RecentAuditEvent[] | null = null;
  let recentAuditError: AppError | null = null;

  if (roleCan(admin.role, "view_audit_logs")) {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("id, occurred_at, actor_email, action, entity_table, entity_id")
      .order("occurred_at", { ascending: false })
      .limit(6);

    if (error) {
      recentAuditError = toAppError(error);
    } else {
      recentAuditEvents = (data ?? []).map((row) => ({
        id: row.id,
        occurredAt: row.occurred_at,
        actorEmail: row.actor_email,
        action: row.action,
        entityTable: row.entity_table,
        entityId: row.entity_id,
      }));
    }
  }

  // --- Recent feedback (support admins only) ---------------------------------
  let recentFeedback: RecentFeedback[] | null = null;
  let recentFeedbackError: AppError | null = null;

  if (roleCan(admin.role, "manage_feedback")) {
    const { data, error } = await supabase
      .from("feedback_reports")
      .select("id, category, status, subject, created_at")
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      recentFeedbackError = toAppError(error);
    } else {
      recentFeedback = (data ?? []).map((row) => ({
        id: row.id,
        category: row.category,
        status: row.status,
        subject: row.subject,
        createdAt: row.created_at,
      }));
    }
  }

  const recentlyPublished = await getRecentlyPublished(supabase);

  // --- Dataset and configuration status --------------------------------------
  const datasetStatus: StatusRow[] = [
    {
      label: "Divisions",
      value: divisions.count === null ? "Unavailable" : String(divisions.count),
      tone: divisions.count === null ? "warn" : "ok",
      href: "/locations/divisions",
    },
    {
      label: "Districts",
      value: districts.count === null ? "Unavailable" : String(districts.count),
      tone: districts.count === null ? "warn" : "ok",
      href: "/locations/districts",
    },
    {
      label: "Active thanas / upazilas",
      value: activeThanas.count === null ? "Unavailable" : String(activeThanas.count),
      tone: activeThanas.count === null ? "warn" : "ok",
      href: "/locations/thanas",
    },
    {
      label: "Locality verification",
      value:
        verifiedLocalities.count === null || totalLocalities.count === null
          ? "Unavailable"
          : `${verifiedLocalities.count} of ${totalLocalities.count} verified`,
      tone:
        verifiedLocalities.count === null || totalLocalities.count === null
          ? "warn"
          : verifiedLocalities.count === 0
            ? "info"
            : "ok",
      href: "/locations/localities",
    },
  ];

  const configStatus: StatusRow[] = [
    publishedConfigs.error
      ? { label: "Prayer configuration", value: "Unavailable", tone: "warn", href: "/prayer-config" }
      : globalConfigResult.error
        ? {
            label: "Prayer configuration",
            value: "Could not be read",
            tone: "warn",
            href: "/prayer-config",
          }
        : globalConfigResult.data
          ? {
              label: "Prayer configuration",
              value: `Published: ${globalConfigResult.data.name}`,
              tone: "ok",
              href: "/prayer-config",
            }
          : {
              label: "Prayer configuration",
              value: "No global configuration published",
              tone: "info",
              href: "/prayer-config",
            },
    {
      label: "Verified timetables",
      value:
        publishedTimings.count === null
          ? "Unavailable"
          : publishedTimings.count === 0
            ? "No published records"
            : `${publishedTimings.count} published`,
      tone:
        publishedTimings.count === null ? "warn" : publishedTimings.count === 0 ? "info" : "ok",
      href: "/prayer-timings",
    },
    {
      label: "Ramadan calendar",
      value:
        publishedRamadan.count === null
          ? "Unavailable"
          : publishedRamadan.count === 0
            ? "No published version"
            : `${publishedRamadan.count} published`,
      tone: publishedRamadan.count === null ? "warn" : publishedRamadan.count === 0 ? "info" : "ok",
      href: "/ramadan",
    },
  ];

  return {
    metrics,
    schemaIssues,
    recentAuditEvents,
    recentAuditError,
    recentFeedback,
    recentFeedbackError,
    recentlyPublished,
    datasetStatus,
    configStatus,
    connectedHost: safeHost(process.env.NEXT_PUBLIC_SUPABASE_URL),
  };
}

function safeHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * The most recent publication across the publishable tables.
 *
 * Each table is queried with a small limit and the results are merged in memory.
 * A union view is not used because no such view exists in the schema, and adding
 * one for a dashboard list would be a migration this version does not need.
 */
async function getRecentlyPublished(
  supabase: ServerSupabaseClient,
): Promise<RecentlyPublished[]> {
  const [configs, ramadan, appConfigs, announcements] = await Promise.all([
    supabase
      .from("prayer_calculation_configs")
      .select("id, name, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(3),
    supabase
      .from("ramadan_calendar_versions")
      .select("id, ramadan_year, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(3),
    supabase
      .from("app_configs")
      .select("id, key, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(3),
    supabase
      .from("announcements")
      .select("id, title_en, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(3),
  ]);

  const merged: RecentlyPublished[] = [];

  for (const row of configs.data ?? []) {
    merged.push({
      label: "Prayer configuration",
      title: row.name,
      publishedAt: row.published_at,
      href: `/prayer-config/${row.id}`,
    });
  }

  for (const row of ramadan.data ?? []) {
    merged.push({
      label: "Ramadan calendar",
      title: `Ramadan ${row.ramadan_year}`,
      publishedAt: row.published_at,
      href: `/ramadan/${row.id}`,
    });
  }

  for (const row of appConfigs.data ?? []) {
    merged.push({
      label: "App configuration",
      title: row.key,
      publishedAt: row.published_at,
      href: `/app-config/${row.id}`,
    });
  }

  for (const row of announcements.data ?? []) {
    merged.push({
      label: "Announcement",
      title: row.title_en,
      publishedAt: row.published_at,
      href: `/announcements/${row.id}`,
    });
  }

  return merged
    .sort((a, b) => {
      const left = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const right = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return right - left;
    })
    .slice(0, 5);
}
