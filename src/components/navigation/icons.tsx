import {
  Building2,
  CalendarCheck,
  Compass,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  Megaphone,
  Moon,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  UserCog,
  type LucideIcon,
} from "lucide-react";

import type { NavItem } from "@/lib/permissions/permissions";

/**
 * Maps the icon names declared in the navigation definition to components.
 *
 * The navigation definition stays plain data (so it can be shared with server
 * code), and only this module names concrete icons — which keeps the client
 * bundle from pulling in the whole icon set.
 */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Landmark,
  Building2,
  MapPin,
  Compass,
  SlidersHorizontal,
  CalendarCheck,
  Moon,
  Settings2,
  Megaphone,
  LifeBuoy,
  ScrollText,
  UserCog,
};

export function NavIcon({ item, className }: { item: NavItem; className?: string }) {
  const Icon = ICONS[item.icon] ?? LayoutDashboard;
  return <Icon className={className} aria-hidden="true" />;
}
