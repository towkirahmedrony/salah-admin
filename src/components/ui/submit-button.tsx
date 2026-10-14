"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

import { buttonClass } from "@/components/ui/button";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "subtle";

/**
 * Submit button wired to the enclosing form's pending state.
 *
 * Two guarantees this exists for:
 *   * the button disables itself while the action runs, which prevents the
 *     duplicate submission that a fast double-tap on a phone produces;
 *   * the pending label says what is actually happening, so a slow request does
 *     not read as a dead button.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className,
  disabled,
  confirm,
  name,
  value,
  size = "md",
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: Variant;
  className?: string;
  disabled?: boolean;
  /** Native confirmation for a low-risk but not trivially reversible action. */
  confirm?: string;
  name?: string;
  value?: string;
  size?: "sm" | "md";
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) {
          event.preventDefault();
        }
      }}
      className={buttonClass(variant, size, className)}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      {pending ? (pendingLabel ?? "Saving…") : children}
    </button>
  );
}
