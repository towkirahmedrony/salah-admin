import type { Metadata } from "next";

import { LocationResourcePage } from "@/features/locations/resource-page";
import type { RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "Localities" };
export const dynamic = "force-dynamic";

export default async function LocalitiesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <LocationResourcePage resource="localities" searchParams={await searchParams} />;
}
