import type { Metadata } from "next";

import { LocationResourcePage } from "@/features/locations/resource-page";
import type { RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "Thana / Upazila" };
export const dynamic = "force-dynamic";

export default async function ThanasPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <LocationResourcePage resource="thanas" searchParams={await searchParams} />;
}
