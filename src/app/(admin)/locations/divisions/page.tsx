import type { Metadata } from "next";

import { LocationResourcePage } from "@/features/locations/resource-page";
import type { RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "Divisions" };
export const dynamic = "force-dynamic";

export default async function DivisionsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <LocationResourcePage resource="divisions" searchParams={await searchParams} />;
}
