import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "subtle";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand-700 text-white shadow-card hover:bg-brand-800 active:bg-brand-900 disabled:hover:bg-brand-700",
  secondary:
    "border border-surface-border bg-surface text-ink-900 shadow-card hover:bg-surface-muted active:bg-surface-subtle",
  danger:
    "bg-red-700 text-white shadow-card hover:bg-red-800 active:bg-red-900 disabled:hover:bg-red-700",
  ghost: "text-ink-700 hover:bg-surface-subtle hover:text-ink-900",
  subtle: "bg-brand-50 text-brand-800 hover:bg-brand-100",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-10 gap-2 px-3.5 text-sm",
};

export function buttonClass(
  variant: Variant = "secondary",
  size: Size = "md",
  className?: string,
): string {
  return cn(
    "inline-flex select-none items-center justify-center rounded-lg font-medium transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

interface ButtonLinkProps extends Omit<ComponentProps<typeof Link>, "className"> {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}

/** Icon-only control. The accessible name is mandatory, not optional. */
export function IconButton({
  label,
  className,
  ...props
}: ButtonProps & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 transition-colors",
        "hover:bg-surface-subtle hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
