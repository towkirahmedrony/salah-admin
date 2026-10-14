import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert } from "lucide-react";

import { requireAdmin } from "@/lib/auth/session";
import { navItemForPath } from "@/lib/permissions/permissions";
import { PageHeader, SectionCard } from "@/components/ui/page-header";
import { Alert, PermissionDenied } from "@/components/ui/states";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not implemented" };
export const dynamic = "force-dynamic";

/**
 * Placeholder for the sections whose database schema, validation, permissions and
 * queries exist but whose management pages are not built yet.
 *
 * Why a real page instead of letting the route 404: a 404 reads as a broken
 * deployment, and an operator who sees one may reasonably conclude the panel is
 * untrustworthy. This page states exactly what is and is not usable, and points
 * at the parts that are. It is intentionally loud rather than pretty — it should
 * be deleted one section at a time as each page lands.
 */
export default async function NotImplementedSectionPage({
  params,
}: {
  params: Promise<{ section: string[] }>;
}) {
  const { section } = await params;
  const pathname = `/${section.join("/")}`;

  const admin = await requireAdmin("view_dashboard");
  const navItem = navItemForPath(pathname);

  // Reached by a URL that is not one of the planned sections at all.
  if (!navItem) {
    return (
      <PermissionDenied reason="capability" capability={pathname} roleLabel={admin.role} />
    );
  }

  return (
    <>
      <PageHeader
        title={navItem.label}
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: navItem.label }]}
        description="This section is specified for the panel but its management pages are not part of the version that has been built so far."
      />

      <SectionCard title="Status">
        <Alert tone="warning" role="alert" title="Not implemented yet">
          <p>
            <span className="font-medium">{navItem.label}</span> has no working interface in this
            version. Nothing on this page reads or writes data, and no button here would do
            anything — so there are no buttons.
          </p>
        </Alert>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-700">
          <div>
            <p className="font-medium text-ink-900">What does already exist</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>The database table, its constraints and its row level security policies.</li>
              <li>The validation rules, including the pre-publication checks.</li>
              <li>The permission matrix entry for the roles that may use it.</li>
              <li>The dashboard counts, which read this table for real.</li>
            </ul>
          </div>

          <div>
            <p className="font-medium text-ink-900">What is missing</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>The list, detail and form pages for this section.</li>
              <li>Its publish/review workflow screens.</li>
              <li>Its server actions.</li>
            </ul>
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-surface-border bg-surface-muted px-3 py-2 text-xs">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
            <span>
              Until these pages exist, changes to this data must be made directly in the Supabase
              SQL editor by someone who understands the constraints. Publishing from a raw SQL
              editor bypasses the review step, so the audit trail will show the change without a
              recorded review.
            </span>
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Working sections"
        className="mt-6"
        description="These areas are fully implemented against the database."
      >
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard" className={buttonClass("secondary", "sm")}>
            Dashboard
          </Link>
          <Link href="/locations/divisions" className={buttonClass("secondary", "sm")}>
            Divisions
          </Link>
          <Link href="/locations/districts" className={buttonClass("secondary", "sm")}>
            Districts
          </Link>
          <Link href="/locations/thanas" className={buttonClass("secondary", "sm")}>
            Thana / Upazila
          </Link>
          <Link href="/locations/localities" className={buttonClass("secondary", "sm")}>
            Localities
          </Link>
        </div>
      </SectionCard>
    </>
  );
}
