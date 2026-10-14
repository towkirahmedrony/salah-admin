import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-1.5">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-500">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.href && !isLast ? (
                <Link href={item.href} className="rounded hover:text-brand-700 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined} className="text-ink-500">
                  {item.label}
                </span>
              )}
              {!isLast ? (
                <ChevronRight className="h-3 w-3 text-ink-400" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 min-w-0", className)}>
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-500">{description}</p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

/** Content block with an optional title bar. */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  footer,
  id,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={cn("card", className)}>
      {title || actions ? (
        <div className="card-header">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-ink-900">{title}</h2> : null}
            {description ? (
              <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}

      <div className={cn("card-body", bodyClassName)}>{children}</div>

      {footer ? (
        <div className="border-t border-surface-border bg-surface-muted px-4 py-3 sm:px-5">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/** Label/value pair used by detail pages and review summaries. */
export function DetailList({
  items,
  columns = 2,
}: {
  items: Array<{ label: string; value: ReactNode; span?: boolean }>;
  columns?: 1 | 2 | 3;
}) {
  const gridClass = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  }[columns];

  return (
    <dl className={cn("grid gap-4", gridClass)}>
      {items.map((item) => (
        <div key={item.label} className={cn("min-w-0", item.span && "sm:col-span-2 lg:col-span-3")}>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{item.label}</dt>
          <dd className="mt-1 break-words text-sm text-ink-900">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
