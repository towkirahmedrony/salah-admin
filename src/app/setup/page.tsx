import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";

import { readSupabaseEnv } from "@/lib/env";
import { getAnonymousSupabase } from "@/lib/supabase/server";
import { toAppError } from "@/lib/errors";
import { ConfigurationNotice } from "@/components/ui/states";
import { buttonClass } from "@/components/ui/button";
import { readString, type RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

/**
 * Deployment and first-run state.
 *
 * This page is what an operator sees when something is missing, and it says
 * exactly which step is outstanding instead of failing with a stack trace. It
 * deliberately reveals nothing about who the administrators are — only whether
 * any exist.
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const reason = readString(params, "reason");

  const env = readSupabaseEnv();

  if (!env.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <ConfigurationNotice reason={env.reason} missing={env.missing} />
      </div>
    );
  }

  let rosterState: "provisioned" | "empty" | "error" = "error";
  let rosterError: string | undefined;

  const supabase = getAnonymousSupabase();
  if (!supabase) {
    rosterState = "error";
    rosterError = "The database client could not be created.";
  } else {
    const { data, error } = await supabase.rpc("administrator_roster_is_provisioned");

    if (error) {
      rosterError = toAppError(error).message;
      if (toAppError(error).hint) {
        rosterError = `${rosterError} ${toAppError(error).hint}`;
      }
    } else {
      rosterState = data ? "provisioned" : "empty";
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="card">
          <div className="card-header">
            <h1 className="text-base font-semibold text-ink-900">Salah Admin setup</h1>
          </div>

          <div className="card-body space-y-6 text-sm leading-relaxed text-ink-700">
            {reason === "database" ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-red-900">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  The database is configured but could not be read. Confirm the project URL and that
                  the migrations have been applied.
                </p>
              </div>
            ) : null}

            <Step
              done
              title="1. Environment variables"
              body={
                <>
                  <code className="rounded bg-surface-subtle px-1 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
                  and{" "}
                  <code className="rounded bg-surface-subtle px-1 py-0.5 text-xs">
                    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
                  </code>{" "}
                  are set. Both are public values; the security boundary is row level security, not
                  the key.
                </>
              }
            />

            <Step
              done={rosterState !== "error"}
              title="2. Database schema"
              body={
                rosterState === "error" ? (
                  <>
                    The schema could not be verified
                    {rosterError ? `: ${rosterError}` : "."} Apply every file in{" "}
                    <code className="rounded bg-surface-subtle px-1 py-0.5 text-xs">
                      supabase/migrations
                    </code>{" "}
                    in filename order, then reload this page.
                  </>
                ) : (
                  <>
                    The schema responds. Reference data is optional; seed the 8 divisions, 64
                    districts and 507 upazilas with{" "}
                    <code className="rounded bg-surface-subtle px-1 py-0.5 text-xs">supabase/seed.sql</code>.
                  </>
                )
              }
            />

            <Step
              done={rosterState === "provisioned"}
              title="3. First administrator"
              body={
                rosterState === "provisioned" ? (
                  <>An active administrator exists. Sign in to continue.</>
                ) : rosterState === "empty" ? (
                  <>
                    <p>
                      No administrator exists yet, and there is no self-registration. Create the
                      account under{" "}
                      <span className="font-medium">Authentication → Users</span> in the Supabase
                      dashboard, then promote it by running this in the SQL editor:
                    </p>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-ink-900 px-3 py-2 text-xs leading-relaxed text-brand-100">
                      <code>{`select public.bootstrap_first_admin('you@example.com', 'Your Name');`}</code>
                    </pre>
                    <p className="mt-2 text-xs text-ink-500">
                      The function only works while no administrator exists, and it is not reachable
                      from the browser. Every later administrator is promoted from the panel.
                    </p>
                  </>
                ) : (
                  <>Provisioning state could not be determined. Resolve the schema step first.</>
                )
              }
            />

            <div className="flex flex-wrap gap-2 border-t border-surface-border pt-4">
              <Link href="/login" className={buttonClass("primary", "md")}>
                Go to sign in
              </Link>
              <Link href="/setup" className={buttonClass("secondary", "md")}>
                Re-check setup
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({
  done,
  title,
  body,
}: {
  done: boolean;
  title: string;
  body: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={
          done
            ? "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-800"
            : "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800"
        }
      >
        {done ? (
          <CircleCheck className="h-4 w-4" aria-hidden="true" />
        ) : (
          <CircleAlert className="h-4 w-4" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0">
        <p className="font-medium text-ink-900">{title}</p>
        <div className="mt-0.5 text-sm leading-relaxed text-ink-700">{body}</div>
      </div>
    </div>
  );
}
