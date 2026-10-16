import type { AdminRole } from "@/lib/types/database";

/**
 * The permission matrix.
 *
 * This file is deliberately isomorphic and dependency-free so the sidebar and
 * the server guards cannot disagree. It is a *mirror* of
 * `public.can_admin()` in `20260101000300_functions_and_triggers.sql`.
 *
 * Hiding a navigation item is a courtesy to the administrator, never a security
 * control: the same capability is re-checked on the server for every mutation
 * and again by RLS inside PostgreSQL. If the two ever disagree, the database
 * wins.
 */

export const ADMIN_ROLES: AdminRole[] = [
  "super_admin",
  "location_manager",
  "content_editor",
  "prayer_data_reviewer",
  "support_admin",
];

export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  location_manager: "Location Manager",
  content_editor: "Content Editor",
  prayer_data_reviewer: "Prayer Data Reviewer",
  support_admin: "Support Admin",
};

export const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  super_admin: "Full access to every area, including audit history and administrator accounts.",
  location_manager: "Manages the Bangladesh division, district, thana and locality dataset.",
  content_editor: "Manages app configuration and announcements.",
  prayer_data_reviewer: "Manages prayer calculation parameters, verified timetables and Ramadan calendars.",
  support_admin: "Reviews and replies to feedback and bug reports.",
};

export const CAPABILITIES = [
  "view_dashboard",
  "manage_locations",
  "manage_prayer_config",
  "manage_prayer_timings",
  "manage_ramadan",
  "manage_metal_prices",
  "manage_app_config",
  "manage_announcements",
  "manage_feedback",
  "view_audit_logs",
  "manage_admins",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  view_dashboard: "View dashboard",
  manage_locations: "Manage locations",
  manage_prayer_config: "Manage prayer configuration",
  manage_prayer_timings: "Manage prayer timetables",
  manage_ramadan: "Manage Ramadan calendar",
  manage_metal_prices: "Manage gold and silver reference prices",
  manage_app_config: "Manage app configuration",
  manage_announcements: "Manage announcements",
  manage_feedback: "Manage feedback",
  view_audit_logs: "View audit logs",
  manage_admins: "Manage administrator accounts",
};

const MATRIX: Record<Capability, AdminRole[]> = {
  view_dashboard: [...ADMIN_ROLES],
  manage_locations: ["super_admin", "location_manager"],
  manage_prayer_config: ["super_admin", "prayer_data_reviewer"],
  manage_prayer_timings: ["super_admin", "prayer_data_reviewer"],
  manage_ramadan: ["super_admin", "prayer_data_reviewer"],
  // Reference prices decide what every user's Zakat calculation is based on, so
  // this stays with super admins. Widening it is a deliberate change in two
  // places: this line and the `metal_prices` branch of `public.can_admin()`.
  manage_metal_prices: ["super_admin"],
  manage_app_config: ["super_admin", "content_editor"],
  manage_announcements: ["super_admin", "content_editor"],
  manage_feedback: ["super_admin", "support_admin"],
  view_audit_logs: ["super_admin"],
  manage_admins: ["super_admin"],
};

/** True when `role` may exercise `capability`. */
export function roleCan(role: AdminRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[capability].includes(role);
}

export function rolesFor(capability: Capability): AdminRole[] {
  return MATRIX[capability];
}

/** Every capability a role holds, used by the administrator detail view. */
export function capabilitiesFor(role: AdminRole): Capability[] {
  return CAPABILITIES.filter((capability) => roleCan(role, capability));
}

export interface NavItem {
  href: string;
  label: string;
  /** lucide-react icon name, resolved in the navigation component. */
  icon: string;
  capability: Capability;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", capability: "view_dashboard" },
    ],
  },
  {
    label: "Location",
    items: [
      { href: "/locations/divisions", label: "Divisions", icon: "Landmark", capability: "manage_locations" },
      { href: "/locations/districts", label: "Districts", icon: "Building2", capability: "manage_locations" },
      { href: "/locations/thanas", label: "Thana / Upazila", icon: "MapPin", capability: "manage_locations" },
      { href: "/locations/localities", label: "Localities", icon: "Compass", capability: "manage_locations" },
    ],
  },
  {
    label: "Prayer & Calendar",
    items: [
      { href: "/prayer-config", label: "Prayer Configuration", icon: "SlidersHorizontal", capability: "manage_prayer_config" },
      { href: "/prayer-timings", label: "Verified Timetables", icon: "CalendarCheck", capability: "manage_prayer_timings" },
      { href: "/ramadan", label: "Ramadan Calendar", icon: "Moon", capability: "manage_ramadan" },
    ],
  },
  {
    label: "Zakat",
    items: [
      { href: "/metal-prices", label: "Metal Reference Prices", icon: "Coins", capability: "manage_metal_prices" },
    ],
  },
  {
    label: "App Management",
    items: [
      { href: "/app-config", label: "App Configuration", icon: "Settings2", capability: "manage_app_config" },
      { href: "/announcements", label: "Announcements", icon: "Megaphone", capability: "manage_announcements" },
    ],
  },
  {
    label: "Support",
    items: [
      { href: "/feedback", label: "Feedback & Bug Reports", icon: "LifeBuoy", capability: "manage_feedback" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/audit-logs", label: "Audit Logs", icon: "ScrollText", capability: "view_audit_logs" },
      { href: "/profile", label: "Admin Profile", icon: "UserCog", capability: "view_dashboard" },
    ],
  },
];

/** Navigation sections filtered to what the role may actually open. */
export function navForRole(role: AdminRole | null | undefined): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    label: section.label,
    items: section.items.filter((item) => roleCan(role, item.capability)),
  })).filter((section) => section.items.length > 0);
}

/** Finds the navigation entry that owns a pathname, for page titles/breadcrumbs. */
export function navItemForPath(pathname: string): NavItem | null {
  const items = NAV_SECTIONS.flatMap((section) => section.items);
  return (
    items.find((item) => item.href === pathname) ??
    items.find((item) => pathname.startsWith(`${item.href}/`)) ??
    null
  );
}
