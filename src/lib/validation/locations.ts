import { z } from "zod";

import {
  banglaText,
  booleanFromForm,
  optionalDecimal,
  optionalHttpUrl,
  optionalStableCode,
  optionalText,
  optionalTextList,
  optionalUuid,
  stableCode,
  trimmedText,
  uuid,
} from "@/lib/validation/common";

/** Division → District → Thana/Upazila → Locality. */

export const divisionSchema = z.object({
  id: optionalUuid("Division"),
  code: stableCode("Division code"),
  name_en: trimmedText(120, "English name"),
  name_bn: banglaText(120, "Bangla name"),
  is_active: booleanFromForm,
});

export const districtSchema = z.object({
  id: optionalUuid("District"),
  division_id: uuid("Division"),
  code: stableCode("District code"),
  name_en: trimmedText(120, "English name"),
  name_bn: banglaText(120, "Bangla name"),
  is_active: booleanFromForm,
});

export const thanaSchema = z.object({
  id: optionalUuid("Thana"),
  district_id: uuid("District"),
  code: stableCode("Thana code"),
  name_en: trimmedText(120, "English name"),
  name_bn: banglaText(120, "Bangla name"),
  latitude: optionalDecimal(-90, 90, "Latitude"),
  longitude: optionalDecimal(-180, 180, "Longitude"),
  is_active: booleanFromForm,
});

export const localitySchema = z
  .object({
    id: optionalUuid("Locality"),
    thana_id: optionalUuid("Thana / Upazila"),
    district_id: optionalUuid("District"),
    code: optionalStableCode("Locality code"),
    name_en: trimmedText(160, "English name"),
    name_bn: banglaText(160, "Bangla name"),
    alternative_names: optionalTextList(12, 120, "Alternative names"),
    latitude: optionalDecimal(-90, 90, "Latitude"),
    longitude: optionalDecimal(-180, 180, "Longitude"),
    source_name: optionalText(200, "Source name"),
    source_url: optionalHttpUrl("Source URL"),
    verification_status: z.enum(["unverified", "verified", "rejected"]),
    is_active: booleanFromForm,
    notes: optionalText(2000, "Notes"),
  })
  .superRefine((value, ctx) => {
    // The schema allows either parent, so exactly one must actually be chosen.
    if (!value.thana_id && !value.district_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["district_id"],
        message: "Select a district, or a thana/upazila if the locality belongs to one.",
      });
    }

    // A coordinate is only meaningful as a pair — the database enforces this
    // too, but a field-level message is far more useful than a constraint error.
    if ((value.latitude === undefined) !== (value.longitude === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [value.latitude === undefined ? "latitude" : "longitude"],
        message: "Provide both latitude and longitude, or leave both blank.",
      });
    }

    // Marking a location verified is a claim about a source. Without one, the
    // claim is unsupported and the database will refuse it anyway.
    if (value.verification_status === "verified" && !value.source_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_name"],
        message: "A verified locality must name the source it was verified against.",
      });
    }
  });

export type DivisionInput = z.infer<typeof divisionSchema>;
export type DistrictInput = z.infer<typeof districtSchema>;
export type ThanaInput = z.infer<typeof thanaSchema>;
export type LocalityInput = z.infer<typeof localitySchema>;
