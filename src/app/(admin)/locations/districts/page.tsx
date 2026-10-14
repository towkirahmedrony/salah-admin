import type { Metadata } from "next";

import { LocationResourcePage } from "@/features/locations/resource-page";
import type { RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "Districts" };
export const dynamic = "force-dynamic";

export default async function DistrictsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <LocationResourcePage resource="districts" searchParams={await searchParams} />;
}
