"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/states";
import { Field, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  INITIAL_SIGN_IN_STATE,
  signInAction,
  type SignInState,
} from "@/features/auth/actions";

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<SignInState, FormData>(
    signInAction,
    INITIAL_SIGN_IN_STATE,
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.status === "error" && state.message ? (
        <Alert tone="error" role="alert" title="Could not sign in">
          {state.message}
        </Alert>
      ) : null}

      <Field
        name="email"
        label="Email address"
        required
        errors={state.fieldErrors?.email}
      >
        {(props) => (
          <Input
            {...props}
            type="email"
            autoComplete="username"
            inputMode="email"
            autoFocus
            placeholder="you@example.com"
            required
          />
        )}
      </Field>

      <Field name="password" label="Password" required errors={state.fieldErrors?.password}>
        {(props) => (
          <Input {...props} type="password" autoComplete="current-password" required />
        )}
      </Field>

      <SubmitButton className="w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>

      <p className="text-center text-xs leading-relaxed text-ink-500">
        Administrator accounts are created by an operator in Supabase Auth and promoted from this
        panel. There is no self-registration.
      </p>
    </form>
  );
}
