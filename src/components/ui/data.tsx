import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";
import { buttonClass } from "@/components/ui/button";
import {
  buildQuery,
  pageWindow,
  type RawSearchParams,
} from "@/lib/utils/search-params";
import {
  RECORD_STATUS_LABELS,
  VERIFICATION_STATUS_LABELS,
} from "@/lib/utils/format";
import type {
  FeedbackStatus,
  RecordStatus,
  VerificationStatus,
} from "@/lib/types/database";

/** Neutral chip for metadata. */
export function Badge({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "amber" | "red" | "slate" | "outline";
  className?: string;
  title?: string;
}) {
  const tones = {
    neutral: "border-surface-border bg-surface-muted text-ink-700",
    brand: "border-brand-200 bg-brand-50 text-brand-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-800",
    slate: "border-slate-300 bg-slate-100 text-slate-700",
    outline: "border-surface-border bg-transparent text-ink-500",
  } as const;

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const RECORD_STATUS_TONES: Record<RecordStatus, "slate" | "brand" | "amber"> = {
  draft: "slate",
  published: "brand",
  archived: "amber",
};

export function StatusBadge({ status }: { status: RecordStatus }) {
  return <Badge tone={RECORD_STATUS_TONES[status]}>{RECORD_STATUS_LABELS[status]}</Badge>;
}

const VERIFICATION_TONES: Record<VerificationStatus, "slate" | "brand" | "red"> = {
  unverified: "slate",
  verified: "brand",
  rejected: "red",
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return (
    <Badge tone={VERIFICATION_TONES[status]} title={`Verification status: ${VERIFICATION_STATUS_LABELS[status]}`}>
      {VERIFICATION_STATUS_LABELS[status]}
    </Badge>
  );
}

const FEEDBACK_TONES: Record<FeedbackStatus, "amber" | "brand" | "slate" | "neutral"> = {
  open: "amber",
  in_progress: "neutral",
  resolved: "brand",
  closed: "slate",
};

const FEEDBACK_LABELS: Record<FeedbackStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export function FeedbackStatusBadge({ status }: { status: FeedbackStatus }) {
  return <Badge tone={FEEDBACK_TONES[status]}>{FEEDBACK_LABELS[status]}</Badge>;
}

/** True/false chip with an accessible text label rather than a bare tick. */
export function ActiveBadge({ active }: { active: boolean }) {
  return active ? <Badge tone="brand">Active</Badge> : <Badge tone="slate">Inactive</Badge>;
}

/** Table container that scrolls horizontally on a phone instead of overflowing. */
export function TableShell({
  caption,
  columns,
  children,
  footer,
}: {
  caption?: string;
  columns: string[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="table-scroll">
        <table className="data-table">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          {children}
        </table>
      </div>
      {footer}
    </div>
  );
}

export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tbody>
      <tr>
        <td colSpan={colSpan} className="p-0">
          {children}
        </td>
      </tr>
    </tbody>
  );
}

/**
 * Pagination.
 *
 * Links rather than buttons, so paging works without JavaScript and the current
 * page is shareable.
 */
export function Pagination({
  basePath,
  searchParams,
  page,
  totalPages,
  totalCount,
  pageSize,
}: {
  basePath: string;
  searchParams: RawSearchParams;
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
}) {
  if (totalPages <= 1) {
    return (
      <div className="flex items-center justify-between border-t border-surface-border px-4 py-3 text-xs text-ink-500 sm:px-5">
        <span>
          {totalCount === 0 ? "No records" : `${totalCount} record${totalCount === 1 ? "" : "s"}`}
        </span>
      </div>
    );
  }

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalCount);

  const href = (target: number) =>
    `${basePath}${buildQuery(searchParams, { page: target === 1 ? undefined : target })}`;

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-border px-4 py-3 sm:px-5"
    >
      <p className="text-xs text-ink-500">
        Showing <span className="font-medium text-ink-700">{first}</span>–
        <span className="font-medium text-ink-700">{last}</span> of{" "}
        <span className="font-medium text-ink-700">{totalCount}</span>
      </p>

      <div className="flex items-center gap-1">
        <Link
          href={href(page - 1)}
          aria-disabled={page <= 1}
          tabIndex={page <= 1 ? -1 : undefined}
          className={cn(
            buttonClass("ghost", "sm"),
            page <= 1 && "pointer-events-none opacity-40",
          )}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Previous
        </Link>

        <ul className="hidden items-center gap-1 sm:flex">
          {pageWindow(page, totalPages).map((entry, index) =>
            entry === "gap" ? (
              <li key={`gap-${index}`} className="px-1 text-xs text-ink-400" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={entry}>
                <Link
                  href={href(entry)}
                  aria-current={entry === page ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-medium",
                    entry === page
                      ? "bg-brand-700 text-white"
                      : "text-ink-700 hover:bg-surface-subtle",
                  )}
                >
                  {entry}
                </Link>
              </li>
            ),
          )}
        </ul>

        <Link
          href={href(page + 1)}
          aria-disabled={page >= totalPages}
          tabIndex={page >= totalPages ? -1 : undefined}
          className={cn(
            buttonClass("ghost", "sm"),
            page >= totalPages && "pointer-events-none opacity-40",
          )}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </nav>
  );
}

/** Summary row used at the top of a filtered list. */
export function ResultSummary({
  count,
  noun,
  filters,
}: {
  count: number;
  noun: string;
  filters?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink-500">
        <span className="font-semibold text-ink-900">{count}</span>{" "}
        {count === 1 ? noun : `${noun}s`}
      </p>
      {filters}
    </div>
  );
}
