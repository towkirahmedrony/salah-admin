"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LogOut, Menu, ShieldCheck, UserCog, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";
import { NavIcon } from "@/components/navigation/icons";
import {
  ROLE_LABELS,
  navForRole,
  navItemForPath,
  type NavSection,
} from "@/lib/permissions/permissions";
import type { AuthenticatedAdmin } from "@/lib/auth/session";

/**
 * The application shell: persistent sidebar on desktop, a drawer on mobile, and
 * a top bar carrying the current page title and the account menu.
 *
 * The sidebar is rendered from the permission matrix, so an administrator never
 * sees a link to an area their role cannot use. That is a usability decision —
 * the same capability is re-checked on the server and again by RLS, so hiding a
 * link is never what enforces anything.
 */

function SidebarContent({
  sections,
  pathname,
  onNavigate,
}: {
  sections: NavSection[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 pb-6">
      {sections.map((section) => (
        <div key={section.label} className="mt-5 first:mt-2">
          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-200/70">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      active
                        ? "bg-brand-700 font-medium text-white"
                        : "text-brand-50/85 hover:bg-brand-800/70 hover:text-white",
                    )}
                  >
                    <NavIcon item={item} className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 border-b border-brand-800/60 px-4 py-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-white">Salah Admin</span>
        <span className="block truncate text-[11px] text-brand-200">Administration panel</span>
      </span>
    </div>
  );
}

function AccountMenu({
  admin,
  onNavigate,
}: {
  admin: AuthenticatedAdmin;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-subtle"
      >
        <span className="hidden min-w-0 flex-col items-end sm:flex">
          <span className="max-w-[14rem] truncate text-sm font-medium text-ink-900">
            {admin.fullName ?? admin.email}
          </span>
          <span className="text-[11px] text-ink-500">{ROLE_LABELS[admin.role]}</span>
        </span>
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold uppercase text-brand-800"
        >
          {(admin.fullName ?? admin.email).slice(0, 1)}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-64 rounded-xl border border-surface-border bg-surface p-1.5 shadow-raised"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium text-ink-900">
              {admin.fullName ?? "Administrator"}
            </p>
            <p className="truncate text-xs text-ink-500">{admin.email}</p>
            <p className="mt-1 text-[11px] text-ink-400">{ROLE_LABELS[admin.role]}</p>
          </div>

          <div className="my-1 h-px bg-surface-border" />

          <Link
            href="/profile"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-700 hover:bg-surface-subtle"
          >
            <UserCog className="h-4 w-4" aria-hidden="true" />
            Admin profile
          </Link>

          <form action="/auth/signout" method="post">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-red-700 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({
  admin,
  children,
}: {
  admin: AuthenticatedAdmin;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sections = navForRole(admin.role);
  const currentItem = navItemForPath(pathname);
  const currentSection = sections.find((section) =>
    section.items.some((item) => item.href === currentItem?.href),
  );

  // Close the drawer whenever the route changes, so a tapped link does not leave
  // it open behind the new page.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-brand-900 lg:flex lg:min-h-screen">
        <Brand />
        <SidebarContent sections={sections} pathname={pathname} />
        <div className="border-t border-brand-800/60 px-4 py-3">
          <p className="text-[11px] leading-relaxed text-brand-200/80">
            Signed in as {ROLE_LABELS[admin.role]}
          </p>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-ink-900/50"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="relative flex h-full w-72 max-w-[85vw] flex-col bg-brand-900"
          >
            <div className="flex items-start justify-between">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="mr-2 mt-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-brand-100 hover:bg-brand-800"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <SidebarContent
              sections={sections}
              pathname={pathname}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-surface-border bg-surface/95 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-700 hover:bg-surface-subtle lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-900">
                {currentItem?.label ?? "Salah Admin"}
              </p>
              {currentSection ? (
                <p className="truncate text-[11px] text-ink-400">{currentSection.label}</p>
              ) : null}
            </div>

            <AccountMenu admin={admin} />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-content">{children}</div>
        </main>

        <footer className="border-t border-surface-border px-4 py-4 sm:px-6 lg:px-8">
          <p className="mx-auto max-w-content text-[11px] leading-relaxed text-ink-400">
            Salah Admin manages the configuration and datasets used by the Salah Android
            application. Publishing a record here records an administrative review — it is not a
            religious verification.
          </p>
        </footer>
      </div>
    </div>
  );
}
