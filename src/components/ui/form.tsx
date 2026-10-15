import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Form primitives.
 *
 * Every control is associated with its label and its error text through ids, so
 * assistive technology announces the problem with the field rather than the
 * field alone. `aria-invalid` and `aria-describedby` are wired in one place so
 * no screen has to remember them.
 */

const CONTROL_CLASS = cn(
  "block w-full rounded-lg border bg-surface px-3 py-2 text-sm text-ink-900 shadow-card",
  "placeholder:text-ink-400",
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-500",
);

export function FieldError({ id, messages }: { id: string; messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <p id={id} className="field-error" role="alert">
      <span aria-hidden="true">•</span>
      <span>{messages.join(" ")}</span>
    </p>
  );
}

interface FieldProps {
  name: string;
  label: string;
  help?: ReactNode;
  errors?: string[];
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    name: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
    className: string;
  }) => ReactNode;
}

export function Field({
  name,
  label,
  help,
  errors,
  required,
  className,
  children,
}: FieldProps) {
  const hasError = Boolean(errors && errors.length > 0);
  const errorId = `${name}-error`;
  const helpId = `${name}-help`;

  const describedBy =
    [hasError ? errorId : null, help ? helpId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={name} className="field-label">
        {label}
        {required ? (
          <span className="ml-1 text-red-700" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ml-1 text-xs font-normal text-ink-400">(optional)</span>
        )}
      </label>

      {children({
        id: name,
        name,
        "aria-invalid": hasError,
        "aria-describedby": describedBy,
        className: cn(CONTROL_CLASS, hasError ? "border-red-400" : "border-surface-border"),
      })}

      {help ? (
        <p id={helpId} className="field-help">
          {help}
        </p>
      ) : null}
      <FieldError id={errorId} messages={errors} />
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(CONTROL_CLASS, "border-surface-border", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={4}
      className={cn(CONTROL_CLASS, "border-surface-border leading-relaxed", className)}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(CONTROL_CLASS, "border-surface-border pr-8", className)} {...props}>
      {children}
    </select>
  );
}

interface CheckboxProps extends Omit<ComponentProps<"input">, "type"> {
  label: string;
  help?: ReactNode;
}

export function Checkbox({ label, help, className, id, ...props }: CheckboxProps) {
  const inputId = id ?? props.name;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-surface-border text-brand-700 accent-brand-700"
        {...props}
      />
      <div className="min-w-0">
        <label htmlFor={inputId} className="text-sm font-medium text-ink-900">
          {label}
        </label>
        {help ? <p className="field-help">{help}</p> : null}
      </div>
    </div>
  );
}

/**
 * Grouped section inside a long form, so it stays navigable on a phone.
 *
 * `title` is optional. When it is given the group is a `<fieldset>` with a
 * `<legend>`, which is what a screen reader needs in order to announce which group
 * a field belongs to. When it is omitted — because the group sits inside a
 * `SectionCard` that already has a visible heading — no fieldset is rendered at
 * all, rather than an unlabelled one whose legend would be empty.
 */
export function FieldGroup({
  title,
  description,
  columns = 1,
  children,
}: {
  title?: string;
  description?: ReactNode;
  columns?: 1 | 2;
  children: ReactNode;
}) {
  const grid = (
    <div
      className={cn("grid gap-4", columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}
    >
      {children}
    </div>
  );

  if (!title) {
    return (
      <div className="min-w-0">
        {description ? (
          <p className="mb-3 text-xs leading-relaxed text-ink-500">{description}</p>
        ) : null}
        {grid}
      </div>
    );
  }

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold text-ink-900">{title}</legend>
      {description ? <p className="mb-3 text-xs leading-relaxed text-ink-500">{description}</p> : null}
      {grid}
    </fieldset>
  );
}

/** Horizontal scroll wrapper that keeps wide forms usable on a phone. */
export function FormGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-5", className)}>{children}</div>;
}
