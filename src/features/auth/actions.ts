"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { readSupabaseEnv } from "@/lib/env";
import { getServerSupabase } from "@/lib/supabase/server";
import { toAppError } from "@/lib/errors";

export interface SignInState {
  status: "idle" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export const INITIAL_SIGN_IN_STATE: SignInState = { status: "idle", message: "" };

const signInSchema = z.object({
  email: z.string().trim().min(1, "Enter your email address.").email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  next: z
    .string()
    .trim()
    .optional()
    // Only same-site relative paths, so a crafted ?next= cannot become an
    // open redirect that makes a phishing page look like this panel.
    .transform((value) => (value && /^\/[^/\\]/.test(value) ? value : undefined)),
});

export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const env = readSupabaseEnv();
  if (!env.ok) {
    return { status: "error", message: env.reason };
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return { status: "error", message: "The database client could not be created." };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // Deliberately identical for an unknown address and a wrong password: the
    // sign-in form must not become a way to enumerate administrator accounts.
    const appError = error?.message?.toLowerCase().includes("email not confirmed")
      ? {
          status: "error" as const,
          message:
            "This account has not been confirmed yet. Confirm the address in Supabase Auth, then sign in.",
        }
      : {
          status: "error" as const,
          message: "Email or password is incorrect.",
        };

    if (error && !/invalid login credentials|email not confirmed/i.test(error.message)) {
      const mapped = toAppError(error);
      return { status: "error", message: mapped.message };
    }

    return appError;
  }

  // A session proves identity, not authorization. If this user has no active
  // roster row, the session is discarded immediately rather than being left to
  // be rejected page by page.
  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("id, is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (adminError) {
    await supabase.auth.signOut();
    const mapped = toAppError(adminError);
    return {
      status: "error",
      message:
        mapped.kind === "schema"
          ? "Signed in, but the administrator table is missing from the database. Apply the migrations in supabase/migrations."
          : `Signed in, but the administrator record could not be read: ${mapped.message}`,
    };
  }

  if (!adminRow || !adminRow.is_active) {
    await supabase.auth.signOut();
    return {
      status: "error",
      message:
        "This account is not an active administrator of Salah Admin. Ask a super admin to promote it from the panel.",
    };
  }

  redirect(parsed.data.next ?? "/dashboard");
}
