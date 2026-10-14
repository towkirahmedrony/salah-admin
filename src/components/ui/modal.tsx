"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { buttonClass, Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * Accessible modal dialog.
 *
 * Implemented directly rather than pulling in a dialog library: the panel needs
 * exactly two behaviours (Escape to dismiss, focus contained and restored), and
 * a small, readable implementation is easier to audit than a dependency.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    document.addEventListener("keydown", handleKeyDown);

    // Focus the panel itself rather than the first control, so a screen reader
    // announces the dialog title before the fields.
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const maxWidth = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink-900/40 p-0 sm:items-center sm:p-4">
      {/* Backdrop: a real button so pointer and keyboard users both have a
          dismissal target, labelled for assistive technology. */}
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "relative z-10 w-full rounded-t-2xl border border-surface-border bg-surface shadow-raised",
          "sm:rounded-2xl",
          maxWidth,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-surface-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-ink-900">
              {title}
            </h2>
            {description ? (
              <div id={descriptionId} className="mt-1 text-xs leading-relaxed text-ink-500">
                {description}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-surface-subtle hover:text-ink-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-4 sm:px-5">{children}</div>

        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-surface-border bg-surface-muted px-4 py-3 sm:px-5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Confirmation for a destructive or publishing action.
 *
 * The confirm button submits the surrounding form, so the action itself is a
 * normal server action and never depends on client-side gating to be correct.
 * The dialog only makes an accidental click harder.
 */
export function ConfirmSubmitButton({
  label,
  title,
  description,
  confirmLabel,
  confirmLabelPending,
  variant = "danger",
  disabled,
  name,
  value,
  requireCheckboxLabel,
  size = "md",
}: {
  label: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  confirmLabelPending?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  /** Submitted alongside the action, exactly as the replaced button would be. */
  name?: string;
  value?: string;
  /** When set, the confirm button stays disabled until the box is ticked. */
  requireCheckboxLabel?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitterRef = useRef<HTMLButtonElement>(null);
  const checkboxId = useId();

  const close = () => {
    setOpen(false);
    setAcknowledged(false);
  };

  return (
    <>
      <Button variant={variant} size={size} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>

      {/*
        The real submit control. It lives inside the surrounding form but is
        visually hidden, so the actual submission is an ordinary form post with
        the same name/value the visible button would have sent — the dialog only
        makes an accidental click harder, it is not what performs the action.
      */}
      <button
        ref={submitterRef}
        type="submit"
        name={name}
        value={value}
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
      />

      <Modal
        open={open}
        onClose={close}
        title={title}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant={variant}
              disabled={submitting || (requireCheckboxLabel ? !acknowledged : false)}
              onClick={() => {
                const form = submitterRef.current?.form;
                if (!form) {
                  setOpen(false);
                  return;
                }
                setSubmitting(true);
                // requestSubmit passes the hidden submit button as the submitter,
                // so its name/value reach the server action.
                form.requestSubmit(submitterRef.current ?? undefined);
              }}
            >
              {submitting ? (confirmLabelPending ?? "Working…") : confirmLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm leading-relaxed text-ink-700">
          {description}

          {requireCheckboxLabel ? (
            <label className="flex items-start gap-2.5 rounded-lg border border-surface-border bg-surface-muted p-3">
              <input
                id={checkboxId}
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-surface-border accent-brand-700"
              />
              <span className="text-sm text-ink-900">{requireCheckboxLabel}</span>
            </label>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

export { buttonClass };
