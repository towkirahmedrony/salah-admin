#!/usr/bin/env node
/**
 * Generates `supabase/seed.sql` — the Bangladesh administrative reference data
 * (8 divisions, 64 districts, 507 upazilas/thanas) used by the Salah Android
 * application.
 *
 * Why a generator rather than hand-written inserts: the dataset already exists
 * in the app repository and must stay byte-identical to it. Regenerating from
 * the same source is how the admin panel avoids inventing its own coordinates
 * or place names.
 *
 * Source
 *   `app/src/main/assets/location/bd_areas.tsv` in towkirahmedrony/prayer.
 *   Derived from COD-AB BGD v03 (valid_on 2023-05-21), OCHA / HDX COD-AB,
 *   licensed CC BY 3.0 IGO. Bangla names joined from nuhil/bangladesh-geocode
 *   (MIT); a blank Bangla field means no name could be matched.
 *
 * Usage
 *   node scripts/generate-reference-locations.mjs <path-to-bd_areas.tsv> [outFile]
 *
 * This script is run by hand; it is not part of the build. The generated file is
 * committed so a fresh database can be seeded without checking out the Android
 * repository.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , inputArg, outputArg] = process.argv;

if (!inputArg) {
  console.error(
    "Usage: node scripts/generate-reference-locations.mjs <bd_areas.tsv> [outFile]",
  );
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = resolve(
  outputArg ?? "supabase/seed.sql",
);

const rows = readFileSync(inputPath, "utf8")
  .split("\n")
  .filter((line) => line.length > 0 && !line.startsWith("#"))
  .map((line) => {
    const [level, id, parentId, name, bnName, latitude, longitude] = line.split("\t");
    return { level, id, parentId, name, bnName, latitude, longitude };
  });

const divisions = rows.filter((r) => r.level === "DIVISION");
const districts = rows.filter((r) => r.level === "DISTRICT");
const thanas = rows.filter((r) => r.level === "UPAZILA");

const levels = new Set(rows.map((r) => r.level));
const unexpected = [...levels].filter((l) => !["DIVISION", "DISTRICT", "UPAZILA"].includes(l));
if (unexpected.length > 0) {
  console.error(`Unexpected level(s) in source: ${unexpected.join(", ")}`);
  process.exit(1);
}

/** PostgreSQL string literal with single quotes escaped. */
const q = (value) => {
  if (value === undefined || value === null || value === "") return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
};

/** numeric literal or null; the source values are already 6-decimal degrees. */
const n = (value) => {
  if (value === undefined || value === null || value === "") return "null";
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Non-numeric coordinate in source: ${value}`);
  }
  return value;
};

const divisionById = new Map(divisions.map((d) => [d.id, d]));
const districtById = new Map(districts.map((d) => [d.id, d]));

// Fail loudly on a broken parent link rather than emitting an orphan row that
// would be silently dropped by the foreign key at insert time.
for (const district of districts) {
  if (!divisionById.has(district.parentId)) {
    throw new Error(`District ${district.id} references unknown division ${district.parentId}`);
  }
}
for (const thana of thanas) {
  if (!districtById.has(thana.parentId)) {
    throw new Error(`Upazila ${thana.id} references unknown district ${thana.parentId}`);
  }
}

const lines = [];

lines.push(`-- =============================================================================`);
lines.push(`-- Salah Admin — reference location data (generated, do not edit by hand)`);
lines.push(`-- =============================================================================`);
lines.push(`--`);
lines.push(`-- Regenerate with:`);
lines.push(`--   node scripts/generate-reference-locations.mjs <bd_areas.tsv>`);
lines.push(`--`);
lines.push(`-- Contents: ${divisions.length} divisions, ${districts.length} districts, ${thanas.length} upazilas/thanas.`);
lines.push(`--`);
lines.push(`-- Source: COD-AB BGD v03 (valid_on 2023-05-21), OCHA / HDX COD-AB,`);
lines.push(`--         licensed CC BY 3.0 IGO.`);
lines.push(`--         Bangla names joined from nuhil/bangladesh-geocode (MIT).`);
lines.push(`--`);
lines.push(`-- Every row is inserted as ACTIVE and is reference data only. No prayer`);
lines.push(`-- timings, latitudes inferred from a district centre, or verification flags`);
lines.push(`-- are produced here: coordinates come from the source file verbatim.`);
lines.push(`--`);
lines.push(`-- Idempotent: re-running updates names and coordinates from the source and`);
lines.push(`-- never deletes a row. Applied by \`supabase db reset\` or manually with`);
lines.push(`-- \`psql -f supabase/seed.sql\`. It is NOT applied automatically to a`);
lines.push(`-- production project.`);
lines.push(`-- =============================================================================`);
lines.push(``);
lines.push(`begin;`);
lines.push(``);

lines.push(`-- --- Divisions ---------------------------------------------------------------`);
for (const division of divisions) {
  lines.push(
    `insert into public.divisions (code, name_en, name_bn, is_active) values (${q(
      division.id,
    )}, ${q(division.name)}, ${q(division.bnName)}, true) ` +
      `on conflict (code) do update set name_en = excluded.name_en, name_bn = excluded.name_bn, updated_at = now();`,
  );
}
lines.push(``);

lines.push(`-- --- Districts --------------------------------------------------------------`);
for (const district of districts) {
  lines.push(
    `insert into public.districts (division_id, code, name_en, name_bn, is_active) ` +
      `select d.id, ${q(district.id)}, ${q(district.name)}, ${q(district.bnName)}, true ` +
      `from public.divisions d where d.code = ${q(district.parentId)} ` +
      `on conflict (code) do update set division_id = excluded.division_id, name_en = excluded.name_en, name_bn = excluded.name_bn, updated_at = now();`,
  );
}
lines.push(``);

lines.push(`-- --- Thanas / Upazilas ------------------------------------------------------`);
for (const thana of thanas) {
  lines.push(
    `insert into public.thanas (district_id, code, name_en, name_bn, latitude, longitude, is_active) ` +
      `select d.id, ${q(thana.id)}, ${q(thana.name)}, ${q(thana.bnName)}, ${n(thana.latitude)}, ${n(
        thana.longitude,
      )}, true ` +
      `from public.districts d where d.code = ${q(thana.parentId)} ` +
      `on conflict (code) do update set district_id = excluded.district_id, name_en = excluded.name_en, name_bn = excluded.name_bn, latitude = excluded.latitude, longitude = excluded.longitude, updated_at = now();`,
  );
}
lines.push(``);

lines.push(`commit;`);
lines.push(``);

writeFileSync(outputPath, lines.join("\n"), "utf8");

console.log(
  `Wrote ${outputPath}: ${divisions.length} divisions, ${districts.length} districts, ${thanas.length} upazilas.`,
);
