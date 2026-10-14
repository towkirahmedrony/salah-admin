/**
 * The four Bangladesh location levels.
 *
 * They share one shape — a stable code, a bilingual name, an active flag and a
 * parent — so they share one set of list/form components rather than four
 * near-identical copies. The definition below is the only place their
 * differences live, which is what keeps the search, pagination, validation and
 * permission behaviour identical across all four.
 */

export type LocationResourceKey = "divisions" | "districts" | "thanas" | "localities";

export type LocationFieldKind =
  | "code"
  | "name_en"
  | "name_bn"
  | "parent"
  | "latitude"
  | "longitude"
  | "alternatives"
  | "source_name"
  | "source_url"
  | "verification"
  | "notes"
  | "active";

export interface LocationFieldDef {
  name: string;
  label: string;
  kind: LocationFieldKind;
  required?: boolean;
  help?: string;
  placeholder?: string;
  /** Parent level this select draws from. */
  parentResource?: LocationResourceKey;
  wide?: boolean;
}

export interface LocationResourceDef {
  key: LocationResourceKey;
  table: LocationResourceKey;
  path: string;
  singular: string;
  plural: string;
  description: string;
  /** Parent level, when the resource has one. */
  parentResource?: LocationResourceKey;
  parentColumn?: string;
  parentLabel?: string;
  /** Columns searched by the search box. */
  searchColumns: string[];
  fields: LocationFieldDef[];
  /** Column used for the default ordering. */
  orderColumn: string;
  orderAscending: boolean;
  /** Labels for the columns of the parent cell in the list. */
  parentCellLabel: string;
  emptyHint: string;
}

const ACTIVE_FIELD: LocationFieldDef = {
  name: "is_active",
  label: "Active",
  kind: "active",
  help: "Inactive records are hidden from pickers and are not offered to the app, but their history is preserved.",
};

export const LOCATION_RESOURCES: Record<LocationResourceKey, LocationResourceDef> = {
  divisions: {
    key: "divisions",
    table: "divisions",
    path: "/locations/divisions",
    singular: "Division",
    plural: "Divisions",
    description:
      "The eight administrative divisions of Bangladesh. Divisions are the top level of the location hierarchy.",
    searchColumns: ["name_en", "name_bn", "code"],
    orderColumn: "name_en",
    orderAscending: true,
    parentCellLabel: "Contains",
    emptyHint:
      "Seed the reference dataset, or add a division manually. Nothing is created automatically.",
    fields: [
      { name: "code", label: "Stable code", kind: "code", required: true, placeholder: "BD30", help: "Matches the code used by the Android app's bundled dataset. Must be unique." },
      { name: "name_en", label: "English name", kind: "name_en", required: true, placeholder: "Dhaka" },
      { name: "name_bn", label: "Bangla name", kind: "name_bn", placeholder: "ঢাকা" },
      ACTIVE_FIELD,
    ],
  },

  districts: {
    key: "districts",
    table: "districts",
    path: "/locations/districts",
    singular: "District",
    plural: "Districts",
    description:
      "The 64 districts, each belonging to exactly one division. Deleting a district is refused while thanas still reference it.",
    parentResource: "divisions",
    parentColumn: "division_id",
    parentLabel: "Division",
    searchColumns: ["name_en", "name_bn", "code"],
    orderColumn: "name_en",
    orderAscending: true,
    parentCellLabel: "Division / thanas",
    emptyHint: "Add a district, or seed the reference dataset.",
    fields: [
      { name: "division_id", label: "Division", kind: "parent", parentResource: "divisions", required: true },
      { name: "code", label: "Stable code", kind: "code", required: true, placeholder: "BD3033" },
      { name: "name_en", label: "English name", kind: "name_en", required: true, placeholder: "Gazipur" },
      { name: "name_bn", label: "Bangla name", kind: "name_bn", placeholder: "গাজীপুর" },
      ACTIVE_FIELD,
    ],
  },

  thanas: {
    key: "thanas",
    table: "thanas",
    path: "/locations/thanas",
    singular: "Thana / Upazila",
    plural: "Thanas / Upazilas",
    description:
      "Upazilas and metropolitan thanas, each belonging to one district. These carry the reference coordinates used for prayer-time calculation.",
    parentResource: "districts",
    parentColumn: "district_id",
    parentLabel: "District",
    searchColumns: ["name_en", "name_bn", "code"],
    orderColumn: "name_en",
    orderAscending: true,
    parentCellLabel: "District",
    emptyHint: "Add a thana/upazila, or seed the reference dataset.",
    fields: [
      { name: "district_id", label: "District", kind: "parent", parentResource: "districts", required: true },
      { name: "code", label: "Stable code", kind: "code", required: true, placeholder: "BD30330032" },
      { name: "name_en", label: "English name", kind: "name_en", required: true, placeholder: "Kaliakair" },
      { name: "name_bn", label: "Bangla name", kind: "name_bn", placeholder: "কালিয়াকৈর" },
      { name: "latitude", label: "Latitude", kind: "latitude", help: "Decimal degrees, from the source. Leave blank rather than estimating." },
      { name: "longitude", label: "Longitude", kind: "longitude", help: "Provide both coordinates, or neither." },
      ACTIVE_FIELD,
    ],
  },

  localities: {
    key: "localities",
    table: "localities",
    path: "/locations/localities",
    singular: "Locality",
    plural: "Localities",
    description:
      "Named neighbourhoods. A locality's parent may be a thana/upazila, or a district when that is all the source resolved. Verification is never assumed.",
    searchColumns: ["name_en", "name_bn", "code"],
    orderColumn: "name_en",
    orderAscending: true,
    parentCellLabel: "Parent",
    emptyHint:
      "Localities come from a sourced neighbourhood dataset. Add one manually only when you have a citable source.",
    fields: [
      { name: "district_id", label: "District", kind: "parent", parentResource: "districts", required: false, help: "Required when no thana/upazila is selected." },
      { name: "thana_id", label: "Thana / Upazila", kind: "parent", parentResource: "thanas", required: false, help: "Optional. Use it only when the locality's thana is actually known." },
      { name: "code", label: "Stable code", kind: "code", required: false },
      { name: "name_en", label: "English name", kind: "name_en", required: true, placeholder: "Mirpur" },
      { name: "name_bn", label: "Bangla name", kind: "name_bn", placeholder: "মিরপুর" },
      { name: "alternative_names", label: "Alternative names", kind: "alternatives", help: "Comma or newline separated. Alternate spellings and transliterations." },
      { name: "latitude", label: "Latitude", kind: "latitude" },
      { name: "longitude", label: "Longitude", kind: "longitude" },
      { name: "source_name", label: "Source name", kind: "source_name", help: "Required to mark a locality verified." },
      { name: "source_url", label: "Source URL", kind: "source_url", placeholder: "https://…" },
      { name: "verification_status", label: "Verification status", kind: "verification", help: "Nothing is marked verified automatically. Unverified is the safe default." },
      { name: "notes", label: "Notes", kind: "notes", wide: true },
      ACTIVE_FIELD,
    ],
  },
};

export const LOCATION_RESOURCE_KEYS = Object.keys(LOCATION_RESOURCES) as LocationResourceKey[];

export function isLocationResourceKey(value: string): value is LocationResourceKey {
  return (LOCATION_RESOURCE_KEYS as string[]).includes(value);
}

export const VERIFICATION_OPTIONS = [
  { value: "unverified", label: "Unverified" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
] as const;
