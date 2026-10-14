import type { Metadata } from "next";
import Link from "next/link";
import { Activity, CircleAlert, Database, ScrollText } from "lucide-react";

import { requireAdmin } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { getDashboardData } from "@/features/dashboard/queries";
import { PageHeader, SectionCard, DetailList } from "@/components/ui/page-header";
import { Alert, EmptyState, ErrorState } from "@/components/ui/states";
import { FeedbackStatusBadge, Badge } from "@/components/ui/data";
import { actionLabel, entityTableLabel, formatCount, formatRelative } from "@/lib/utils/format";
import { roleCan } from "@/lib/permissions/permissions";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const admin = await requireAdmin("view_dashboard");

  const supabase = await getServerSupabase();
  if (!supabase) {
    return (
      <ErrorState
        title="Not connected"
        message="The database client could not be created. Check the environment configuration."
      />
    );
  }

  const data = await getDashboardData(supabase, admin);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          <>
            Live counts of the data this panel manages. Every figure is read from the database —
            nothing here is estimated or illustrative.
          </>
        }
      />

      <div className="space-y-6">
        {data.schemaIssues.length > 0 ? (
          <Alert tone="error" role="alert" title="Some tables could not be read">
            <p>
              These areas are showing a schema problem rather than an empty result, so their counts
              are hidden instead of being reported as zero:
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              {data.schemaIssues.map((issue) => (
                <li key={issue.label}>
                  <span className="font-medium">{issue.label}</span> — {issue.error.message}
                  {issue.error.hint ? ` ${issue.error.hint}` : ""}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {/* Summary cards */}
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="sr-only">
            Summary
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {data.metrics.map((metric) => (
              <li key={metric.key}>
                <Link
                  href={metric.href}
                  className="card block h-full p-4 transition-shadow hover:shadow-raised focus-visible:shadow-raised"
                >
                  <p className="text-xs font-medium leading-snug text-ink-500">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">
                    {metric.value === null ? "—" : formatCount(metric.value)}
                  </p>
                  {metric.error ? (
                    <p className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-red-700">
                      <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>Not available — schema issue</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] leading-snug text-ink-400">{metric.caption}</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard
            title="Dataset status"
            description="The Bangladesh location hierarchy the Android app resolves places against."
          >
            <StatusList rows={data.datasetStatus} />
          </SectionCard>

          <SectionCard
            title="Configuration status"
            description="What is currently live for the app to read."
          >
            <StatusList rows={data.configStatus} />
          </SectionCard>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard
            title="Recently published"
            description="Latest publication across prayer configuration, Ramadan calendars, app configuration and announcements."
          >
            {data.recentlyPublished.length === 0 ? (
              <EmptyState
                title="Nothing published yet"
                description="Publish a configuration, calendar or announcement and it will appear here."
              />
            ) : (
              <ul className="divide-y divide-surface-border">
                {data.recentlyPublished.map((item) => (
                  <li key={`${item.href}`} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Link
                        href={item.href}
                        className="block truncate text-sm font-medium text-ink-900 hover:text-brand-700 hover:underline"
                      >
                        {item.title}
                      </Link>
                      <p className="text-xs text-ink-500">{item.label}</p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-400">
                      {item.publishedAt ? formatRelative(item.publishedAt) : "no timestamp"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {roleCan(admin.role, "manage_feedback") ? (
            <SectionCard
              title="Recent feedback"
              description="Newest end-user reports."
              actions={
                <Link href="/feedback" className="text-xs font-medium text-brand-700 hover:underline">
                  View all
                </Link>
              }
            >
              {data.recentFeedbackError ? (
                <Alert tone="warning">
                  Feedback could not be read: {data.recentFeedbackError.message}
                </Alert>
              ) : !data.recentFeedback || data.recentFeedback.length === 0 ? (
                <EmptyState
                  title="No feedback yet"
                  description="Reports submitted from the app or the public endpoint appear here."
                />
              ) : (
                <ul className="divide-y divide-surface-border">
                  {data.recentFeedback.map((report) => (
                    <li key={report.id} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/feedback/${report.id}`}
                            className="block truncate text-sm font-medium text-ink-900 hover:text-brand-700 hover:underline"
                          >
                            {report.subject ?? "No subject"}
                          </Link>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {report.category.replace(/_/g, " ")} · {formatRelative(report.createdAt)}
                          </p>
                        </div>
                        <FeedbackStatusBadge status={report.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          ) : null}
        </div>

        {roleCan(admin.role, "view_audit_logs") ? (
          <SectionCard
            title="Recent audit events"
            description="Recorded by database triggers on every managed table."
            actions={
              <Link href="/audit-logs" className="text-xs font-medium text-brand-700 hover:underline">
                View all
              </Link>
            }
          >
            {data.recentAuditError ? (
              <Alert tone="warning">Audit history could not be read: {data.recentAuditError.message}</Alert>
            ) : !data.recentAuditEvents || data.recentAuditEvents.length === 0 ? (
              <EmptyState
                title="No audit events yet"
                description="Create, update, publish and archive operations are recorded automatically."
              />
            ) : (
              <ul className="divide-y divide-surface-border">
                {data.recentAuditEvents.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink-900">
                          <span className="font-medium">{actionLabel(event.action)}</span>{" "}
                          <span className="text-ink-500">{entityTableLabel(event.entityTable)}</span>
                        </p>
                        <p className="truncate text-xs text-ink-500">
                          {event.actorEmail ?? "unknown actor"}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-ink-400">
                      {formatRelative(event.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        ) : null}

        <SectionCard
          title="Connection"
          description="Where this panel is reading from."
        >
          <DetailList
            columns={3}
            items={[
              {
                label: "Database",
                value: (
                  <span className="flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5 text-brand-700" aria-hidden="true" />
                    {data.connectedHost ? (
                      <span className="font-mono text-xs">{data.connectedHost}</span>
                    ) : (
                      "Unavailable"
                    )}
                  </span>
                ),
              },
              {
                label: "Signed in as",
                value: (
                  <span className="flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-brand-700" aria-hidden="true" />
                    <span className="truncate">{admin.email}</span>
                  </span>
                ),
              },
              {
                label: "Authorization",
                value: (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="brand">{admin.role.replace(/_/g, " ")}</Badge>
                    <span className="text-xs text-ink-500">enforced by RLS</span>
                  </span>
                ),
              },
            ]}
          />
        </SectionCard>
      </div>
    </>
  );
}

function StatusList({
  rows,
}: {
  rows: Array<{ label: string; value: string; tone: "ok" | "warn" | "info"; href: string }>;
}) {
  return (
    <ul className="divide-y divide-surface-border">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <Link href={row.href} className="min-w-0 text-sm text-ink-700 hover:text-brand-700 hover:underline">
            {row.label}
          </Link>
          <span
            className={
              row.tone === "ok"
                ? "shrink-0 text-xs font-medium text-brand-800"
                : row.tone === "warn"
                  ? "shrink-0 text-xs font-medium text-amber-800"
                  : "shrink-0 text-xs text-ink-500"
            }
          >
            {row.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

// The dashboard is per-request data: sessions and live counts must never be
// served from a shared cache.
export const revalidate = 0;
