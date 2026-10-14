import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { readSupabaseEnv } from "@/lib/env";
import { peekAdminSession } from "@/lib/auth/session";
import { SignInForm } from "@/features/auth/sign-in-form";
import { Alert, ConfigurationNotice } from "@/components/ui/states";
import { buttonClass } from "@/components/ui/button";
import { readString, type RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const env = readSupabaseEnv();

  // Render the setup state rather than a form that cannot possibly succeed.
  if (!env.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <ConfigurationNotice reason={env.reason} missing={env.missing} />
      </div>
    );
  }

  const session = await peekAdminSession();

  if (session.kind === "authenticated") {
    redirect("/dashboard");
  }

  const next = readString(params, "next");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-700 text-white">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="text-lg font-semibold text-ink-900">Salah Admin</h1>
          <p className="mt-1 text-sm text-ink-500">
            Sign in with your administrator account to continue.
          </p>
        </div>

        {session.kind === "not_admin" ? (
          <Alert tone="warning" className="mb-4" title="Not provisioned as an administrator">
            <p>
              {session.email ? (
                <>
                  <span className="font-medium">{session.email}</span> has a session but has no
                  active administrator record.
                </>
              ) : (
                "This account has a session but has no active administrator record."
              )}{" "}
              A super admin must promote it before this panel can be used.
            </p>
            <Link href="/auth/signout" className={`${buttonClass("secondary", "sm")} mt-2`}>
              Sign out
            </Link>
          </Alert>
        ) : null}

        {session.kind === "error" ? (
          <Alert tone="error" className="mb-4" title="Database unavailable">
            The administrator table could not be read. Apply the migrations in
            <code className="mx-1 rounded bg-surface-subtle px-1 py-0.5 text-xs">supabase/migrations</code>
            and try again.
          </Alert>
        ) : null}

        <div className="card">
          <div className="card-body">
            <SignInForm next={next || undefined} />
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-ink-400">
          First-time setup?{" "}
          <Link href="/setup" className="text-brand-700 underline underline-offset-2">
            Read the setup steps
          </Link>
        </p>
      </div>
    </div>
  );
}
