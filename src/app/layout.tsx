import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Salah Admin",
    template: "%s · Salah Admin",
  },
  description:
    "Administration panel for the Salah Android application: Bangladesh location data, prayer configuration, verified timetables, Ramadan calendars, app configuration and announcements.",
  // An administration panel has no business in a search index.
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#064e3b",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
