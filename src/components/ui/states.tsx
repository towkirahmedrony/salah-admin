import Link from "next/link";
import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  Inbox,
  Loader2,
  PlugZap,
  ShieldOff,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";
import { ButtonLink, buttonClass } from "@/components/ui/button";

/**
 * The five states every page in this panel can be in: loading, empty, error,
 * success, and permission-denied.
 *
 * They are shared rather than re-implemented per screen so that an empty
 * database, a missing table and a refused permission are never mistaken for one
 * another — which is the failure mode that makes a dashboard untrustworthy.
 */

export type AlertTone = "success" | "error" | "warning" | "info";

const ALERT_TONES: Record<AlertTone, { wrapper: string; icon: ReactNode }> = {
  success: {
    wrapper: "border-brand-200 bg-brand-50 text-brand-900",
    icon: <CircleCheck className="h-4 w-4 text-brand-700" aria-hidden="true" />,
  },
  error: {
    wrapper: "border-red-200 bg-red-50 text-red-900",
    icon: <CircleAlert className="h-4 w-4 text-red-700" aria-hidden="true" />,
  },
  warning: {
    wrapper: "border-amber-200 bg-amber-50 text-amber-900",
    icon: <TriangleAlert className="h-4 w-4 text-amber-700" aria-hidden="true" />,
  },
  info: {
    wrapper: "border-surface-border bg-surface-muted text-ink-700",
    icon: <Info className="h-4 w-4 text-ink-500" aria-hidden="true" />,
  },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  role = "status",
}: {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
  className?: string;
  role?: "status" | "alert";
}) {
  const tone_ = ALERT_TONES[tone];
  return (
    <div
      role={role}
      className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm", tone_.wrapper, className)}
    >
      <span className="mt-0.5 shrink-0">{tone_.icon}</span>
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="min-w-0 break-words leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-2 rounded-xl border border-surface-border bg-surface px-4 py-12 text-sm text-ink-500"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Skeleton rows for a table, so the layout does not jump when data arrives. */
export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="table-scroll" aria-hidden="true">
      <table className="data-table">
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: columns }).map((__, columnIndex) => (
                <td key={columnIndex}>
                  <span className="block h-3 rounded bg-surface-subtle" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-4 py-14 text-center", className)}>
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-subtle text-ink-400">
        <Inbox className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm leading-relaxed text-ink-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Error state.
 *
 * The `hint` is developer-facing guidance and is collapsed by default: it can
 * name a migration file, but never SQL text, column values or credentials.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  hint,
  action,
}: {
  title?: string;
  message: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card border-red-200">
      <div className="card-body space-y-3">
        <div className="flex items-start gap-2.5">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-900">{title}</p>
            <p className="mt-1 break-words text-sm leading-relaxed text-ink-700">{message}</p>
          </div>
        </div>

        {hint ? (
          <details className="rounded-lg border border-surface-border bg-surface-muted px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-ink-500">
              Technical detail
            </summary>
            <p className="mt-2 break-words font-mono text-xs leading-relaxed text-ink-700">{hint}</p>
          </details>
        ) : null}

        {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * Missing configuration.
 *
 * Shown instead of crashing. The exact variable names are listed because the fix
 * is a deployment step, and guessing which one is missing wastes the operator's
 * time.
 */
export function ConfigurationNotice({
  reason,
  missing = [],
}: {
  reason: string;
  missing?: string[];
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <PlugZap className="h-4 w-4 text-amber-700" aria-hidden="true" />
            <h1 className="text-base font-semibold text-ink-900">Database not configured</h1>
          </div>
        </div>
        <div className="card-body space-y-4 text-sm leading-relaxed text-ink-700">
          <p>{reason}</p>

          {missing.length > 0 ? (
            <div>
              <p className="font-medium text-ink-900">Missing environment variables</p>
              <ul className="mt-1.5 space-y-1 font-mono text-xs">
                {missing.map((name) => (
                  <li key={name} className="rounded border border-surface-border bg-surface-muted px-2 py-1">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="font-medium text-ink-900">To finish setup</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Copy <code className="rounded bg-surface-subtle px-1 py-0.5 text-xs">.env.example</code> to{" "}
                <code className="rounded bg-surface-subtle px-1 py-0.5 text-xs">.env.local</code>.
              </li>
              <li>Fill in the Supabase project URL and publishable key.</li>
              <li>
                Apply the SQL migrations in{" "}
                <code className="rounded bg-surface-subtle px-1 py-0.5 text-xs">supabase/migrations</code>.
              </li>
              <li>Restart the development server.</li>
            </ol>
          </div>

          <p className="rounded-lg border border-surface-border bg-surface-muted px-3 py-2 text-xs">
            Only the publishable (anon) key belongs here. A service-role key must never be placed in a
            <code className="mx-1 rounded bg-surface-subtle px-1 py-0.5">NEXT_PUBLIC_</code>
            variable — anything with that prefix is visible to every visitor.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Forbidden state, for a signed-in user whose role does not allow the page. */
export function PermissionDenied({
  capability,
  roleLabel,
  reason,
}: {
  capability?: string;
  roleLabel?: string;
  reason?: string;
}) {
  const messages: Record<string, string> = {
    "no-admin-record":
      "You are signed in, but this account is not provisioned as an administrator. Ask a super admin to add it in Supabase Auth and promote it from the panel.",
    capability: capability
      ? `Your role${roleLabel ? ` (${roleLabel})` : ""} does not include "${capability.replace(/_/g, " ")}".`
      : "Your role does not allow this page.",
  };

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="card">
        <div className="card-body flex flex-col items-center py-12 text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <ShieldOff className="h-5 w-5" aria-hidden="true" />
          </span>
          <h1 className="text-base font-semibold text-ink-900">Access denied</h1>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">
            {messages[reason ?? "capability"] ?? messages.capability}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href="/dashboard" className={buttonClass("primary", "md")}>
              Back to dashboard
            </Link>
            <Link href="/auth/signout" className={buttonClass("secondary", "md")}>
              Sign out
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export { ButtonLink };
