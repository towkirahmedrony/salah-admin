import Link from "next/link";

import { Badge, Pagination, ResultSummary, StatusBadge, TableEmptyRow, TableShell } from "@/components/ui/data";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import {
  SCOPE_OPTIONS,
  STATUS_OPTIONS,
} from "@/features/prayer-config/definitions";
import type {
  PrayerConfigListFilters,
  PrayerConfigListResult,
} from "@/features/prayer-config/queries";
import { PAGE_SIZE, type RawSearchParams } from "@/lib/utils/search-params";
import { formatDate, formatDateTime } from "@/lib/utils/format";

const COLUMNS = [
  "Configuration",
  "Scope",
  "Location",
  "Calculation method",
  "Version",
  "Status",
  "Effective from",
  "Last updated",
  "Published by",
];

/**
 * The configuration list.
 *
 * Filters are an ordinary `GET` form rather than a client component: the query is
 * server state, so a filtered view is a shareable URL and the page works without
 * JavaScript. No record is ever rendered from a placeholder — an empty table means
 * an empty database, and a failed read renders an error, not `0`.
 */
export function PrayerConfigList({
  result,
  filters,
  searchParams,
  counts,
  canWrite,
}: {
  result: PrayerConfigListResult;
  filters: PrayerConfigListFilters;
  searchParams: RawSearchParams;
  counts: { draft: number; published: number; archived: number };
  canWrite: boolean;
}) {
  if (result.error) {
    return (
      <ErrorState
        title="Could not read prayer configurations"
        message={result.error.message}
        hint={result.error.hint}
      />
    );
  }

  const filtered = Boolean(filters.search || filters.scope || filters.status);

  return (
    <>
      <form
        method="get"
        action="/prayer-config"
        className="mb-4 flex flex-col gap-3 rounded-xl border border-surface-border bg-surface p-4 shadow-card sm:flex-row sm:flex-wrap sm:items-end"
      >
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor="q" className="field-label">
            Search
          </label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={filters.search}
            placeholder="Name, source or notes…"
          />
        </div>

        <div className="min-w-0 sm:w-44">
          <label htmlFor="scope" className="field-label">
            Scope
          </label>
          <Select id="scope" name="scope" defaultValue={filters.scope}>
            <option value="">All scopes</option>
            {SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="min-w-0 sm:w-40">
          <label htmlFor="status" className="field-label">
            Status
          </label>
          <Select id="status" name="status" defaultValue={filters.status}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={buttonClass("secondary", "md")}>
            Apply
          </button>
          {filtered ? (
            <Link href="/prayer-config" className={buttonClass("ghost", "md")}>
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <ResultSummary
        count={result.total}
        noun="configuration"
        filters={
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <Badge tone="slate">{counts.draft} draft</Badge>
            <Badge tone="brand">{counts.published} published</Badge>
            <Badge tone="amber">{counts.archived} archived</Badge>
          </div>
        }
      />

      <div className="mt-3">
        <TableShell
          caption="Prayer calculation configurations"
          columns={COLUMNS}
          footer={
            <Pagination
              basePath="/prayer-config"
              searchParams={searchParams}
              page={result.page}
              totalPages={result.totalPages}
              totalCount={result.total}
              pageSize={PAGE_SIZE}
            />
          }
        >
          {result.rows.length === 0 ? (
            <TableEmptyRow colSpan={COLUMNS.length}>
              <EmptyState
                title={filtered ? "No configurations match these filters" : "No configurations yet"}
                description={
                  filtered
                    ? "Adjust or clear the filters to see more. Nothing has been hidden."
                    : "Create a configuration to describe the parameters the Android app should calculate with. Nothing is created automatically, and nothing is published until you publish it."
                }
                action={
                  canWrite ? (
                    <ButtonLink href="/prayer-config/new" variant="primary">
                      New configuration
                    </ButtonLink>
                  ) : null
                }
              />
            </TableEmptyRow>
          ) : (
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link
                      href={`/prayer-config/${row.id}`}
                      className="font-medium text-ink-900 hover:text-brand-700 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-400">
                      {row.engineLabel}
                    </p>
                  </td>
                  <td>
                    <Badge tone={row.scope === "global" ? "neutral" : "outline"}>
                      {row.scopeLabel}
                    </Badge>
                  </td>
                  <td>
                    <span className="text-ink-700">{row.targetLabel}</span>
                    {row.targetCode ? (
                      <p className="mt-0.5 font-mono text-[11px] text-ink-400">{row.targetCode}</p>
                    ) : null}
                  </td>
                  <td>
                    {row.methodLabel ? (
                      <span className="text-ink-700">{row.methodLabel}</span>
                    ) : (
                      <Badge tone="amber">Not chosen</Badge>
                    )}
                  </td>
                  <td className="tabular-nums">{row.version}</td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td>
                    <span className="text-ink-700">{formatDate(row.effectiveFrom)}</span>
                    <p className="mt-0.5 text-[11px] text-ink-400">
                      {row.effectiveTo ? `to ${formatDate(row.effectiveTo)}` : "open-ended"}
                    </p>
                  </td>
                  <td>
                    <span className="text-ink-700">{formatDateTime(row.updatedAt)}</span>
                    {row.updatedByLabel ? (
                      <p className="mt-0.5 text-[11px] text-ink-400">{row.updatedByLabel}</p>
                    ) : null}
                  </td>
                  <td>
                    {row.publishedByLabel && row.status === "published" ? (
                      <span className="text-ink-700">{row.publishedByLabel}</span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </TableShell>
      </div>
    </>
  );
}
