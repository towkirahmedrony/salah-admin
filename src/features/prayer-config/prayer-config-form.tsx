"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";

import { Alert } from "@/components/ui/states";
import { Checkbox, Field, FieldGroup, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/page-header";
import {
  INITIAL_PRAYER_CONFIG_ACTION_STATE,
  savePrayerConfig,
  type PrayerConfigActionState,
} from "@/features/prayer-config/actions";
import {
  ADJUSTMENT_FIELDS,
  ASR_MADHHAB_OPTIONS,
  CALCULATION_METHOD_OPTIONS,
  HIGH_LATITUDE_RULE_HELP_TEXT,
  HIGH_LATITUDE_RULE_OPTIONS,
  SCOPE_OPTIONS,
  type PrayerConfigFormValues,
} from "@/features/prayer-config/definitions";
import { nodeLabel, type LocationTree } from "@/features/locations/queries";
import {
  METHOD_ENGINE_PARAMETERS,
  PRAYER_ADJUSTMENT_LIMIT_MINUTES,
  PRAYER_CONFIG_SCHEMA_VERSION,
  describeAdjustment,
  describeMethod,
} from "@/lib/validation/prayer-config";
import type { PrayerCalculationMethod, PrayerConfigScope } from "@/lib/types/database";

/**
 * Create/edit form for a prayer calculation configuration.
 *
 * The form is grouped so a long list of technical settings stays navigable on a
 * phone. Three things are deliberate:
 *
 *   * the Fajr and Isha angles are shown but not editable, because the engine
 *     derives them from the selected method — offering an input the app ignores
 *     would be an invitation to a configuration that does nothing;
 *   * the location selects cascade from the preloaded tree, so an impossible
 *     combination cannot be expressed, and the server re-checks it regardless;
 *   * the hidden `__expected_updated_at` is the value the page was rendered from,
 *     so a stale form cannot overwrite a newer edit.
 */
export function PrayerConfigForm({
  values,
  tree,
  mode,
}: {
  values: PrayerConfigFormValues;
  tree: LocationTree;
  mode: "create" | "edit";
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<PrayerConfigActionState, FormData>(
    savePrayerConfig,
    INITIAL_PRAYER_CONFIG_ACTION_STATE,
  );

  const [scope, setScope] = useState<PrayerConfigScope>(
    (String(values.scope ?? "global") as PrayerConfigScope) ?? "global",
  );
  const [thanaId, setThanaId] = useState(String(values.thana_id ?? ""));
  const [method, setMethod] = useState<string>(String(values.calculation_method ?? ""));

  /*
   * The cascade selects double as the narrow-the-list filters for the level below
   * them. When editing, the stored row identifies only its own level, so the
   * ancestors are derived from the tree — otherwise a thana-scoped configuration
   * would open with its thana select disabled and its current value unselected,
   * and the next save would clear the target.
   */
  const [districtId, setDistrictId] = useState(() => {
    if (values.district_id) return String(values.district_id);
    if (values.thana_id) {
      return tree.thanasById.get(String(values.thana_id))?.district_id ?? "";
    }
    return "";
  });

  const [divisionId, setDivisionId] = useState(() => {
    if (values.division_id) return String(values.division_id);
    if (values.district_id) {
      return tree.districtsById.get(String(values.district_id))?.division_id ?? "";
    }
    if (values.thana_id) {
      const thana = tree.thanasById.get(String(values.thana_id));
      return thana ? (tree.districtsById.get(thana.district_id)?.division_id ?? "") : "";
    }
    return "";
  });

  useEffect(() => {
    if (state.status !== "success") return;
    if (mode === "create" && state.rowId) {
      router.push(`/prayer-config/${state.rowId}`);
      return;
    }
    // Re-render so the concurrency token and the read-only readouts match what was
    // actually stored.
    router.refresh();
  }, [state.status, state.rowId, mode, router]);

  const errors = state.fieldErrors ?? {};

  const methodParameters = useMemo(
    () => (method ? METHOD_ENGINE_PARAMETERS[method as PrayerCalculationMethod] : null),
    [method],
  );

  const districtOptions = divisionId
    ? tree.districts.filter((district) => district.division_id === divisionId)
    : tree.districts;

  const thanaOptions = districtId
    ? tree.thanas.filter((thana) => thana.district_id === districtId)
    : tree.thanas;

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {values.id ? <input type="hidden" name="id" value={String(values.id)} /> : null}

      {/*
        The token the page was rendered from, keyed on its own value so a refresh
        after a successful save replaces it rather than leaving a stale token that
        would make the next save look like a conflict.
      */}
      <input
        type="hidden"
        name="__expected_updated_at"
        key={String(values.updated_at ?? "new")}
        defaultValue={String(values.updated_at ?? "")}
      />

      {state.status === "error" && state.message ? (
        <Alert tone="error" role="alert" title="Could not save">
          {state.message}
        </Alert>
      ) : null}

      {state.status === "success" && state.message ? (
        <Alert tone="success" title="Saved">
          {state.message}
        </Alert>
      ) : null}

      {/* --- 1. General information ------------------------------------------ */}
      <SectionCard
        title="General information"
        description="What this configuration is called, and where it is in the workflow."
      >
        <FieldGroup columns={2}>
          <Field
            name="name"
            label="Configuration name"
            required
            errors={errors.name}
            help="Something a reviewer will recognise later, for example “Bangladesh default — Karachi, Hanafi Asr”."
          >
            {(props) => (
              <Input {...props} defaultValue={String(values.name ?? "")} placeholder="Bangladesh default" />
            )}
          </Field>

          <Field
            name="timezone"
            label="Timezone"
            required
            errors={errors.timezone}
            help="An IANA identifier. The app renders every calculated time in this zone; Bangladesh uses Asia/Dhaka."
          >
            {(props) => (
              <Input
                {...props}
                defaultValue={String(values.timezone ?? "Asia/Dhaka")}
                placeholder="Asia/Dhaka"
                spellCheck={false}
              />
            )}
          </Field>
        </FieldGroup>

        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ReadOnlyValue label="Status" value={values.status ? String(values.status) : "Draft (new)"} />
          <ReadOnlyValue
            label="Version"
            value={values.version ? String(values.version) : "1 (assigned on create)"}
          />
        </dl>
      </SectionCard>

      {/* --- 2. Location scope ------------------------------------------------ */}
      <SectionCard
        title="Location scope"
        description="Which locations this configuration applies to. A more specific configuration overrides a broader one."
      >
        <FieldGroup columns={2}>
          <Field
            name="scope"
            label="Scope"
            required
            errors={errors.scope}
            help="Thana overrides district, which overrides division, which overrides global."
          >
            {(props) => (
              <Select
                {...props}
                value={scope}
                onChange={(event) => {
                  const next = event.target.value as PrayerConfigScope;
                  setScope(next);
                  // Clear targets that the new scope no longer uses, so the form
                  // cannot hold a combination the hierarchy does not allow.
                  if (next !== "division") setDivisionId("");
                  if (next !== "district") setDistrictId("");
                  if (next !== "thana") setThanaId("");
                }}
              >
                {SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {scope === "global" ? (
            <div className="flex items-start gap-2 self-end rounded-lg border border-surface-border bg-surface-muted px-3 py-2.5 text-xs leading-relaxed text-ink-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden="true" />
              <span>
                A global configuration applies to every location that has no more specific override.
                There can only be one published global configuration at a time.
              </span>
            </div>
          ) : null}
        </FieldGroup>

        {scope !== "global" ? (
          <>
            <p className="mt-4 text-xs leading-relaxed text-ink-500">
              Locality-level overrides are not offered: the Android app stores a neighbourhood name
              but no stable identifier for it, so it could never resolve one.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {scope === "division" ? (
              <Field name="division_id" label="Division" required errors={errors.division_id}>
                {(props) => (
                  <Select
                    {...props}
                    value={divisionId}
                    onChange={(event) => setDivisionId(event.target.value)}
                  >
                    <option value="">Select a division…</option>
                    {tree.divisions.map((division) => (
                      <option key={division.id} value={division.id}>
                        {nodeLabel(division)}
                        {division.is_active ? "" : " (inactive)"}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            {scope === "district" ? (
              <>
                <Field
                  name="division_filter"
                  label="Filter districts by division"
                  help="Narrows the list below. Not stored."
                >
                  {(props) => (
                    <Select
                      {...props}
                      value={divisionId}
                      onChange={(event) => {
                        setDivisionId(event.target.value);
                        setDistrictId("");
                      }}
                    >
                      <option value="">All divisions</option>
                      {tree.divisions.map((division) => (
                        <option key={division.id} value={division.id}>
                          {nodeLabel(division)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field name="district_id" label="District" required errors={errors.district_id}>
                  {(props) => (
                    <Select
                      {...props}
                      value={districtId}
                      onChange={(event) => setDistrictId(event.target.value)}
                    >
                      <option value="">Select a district…</option>
                      {districtOptions.map((district) => (
                        <option key={district.id} value={district.id}>
                          {nodeLabel(district)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </>
            ) : null}

            {scope === "thana" ? (
              <>
                <Field
                  name="district_filter"
                  label="Filter thanas by district"
                  help="Narrows the list below. Not stored."
                >
                  {(props) => (
                    <Select
                      {...props}
                      value={districtId}
                      onChange={(event) => {
                        setDistrictId(event.target.value);
                        setThanaId("");
                      }}
                    >
                      <option value="">All districts</option>
                      {tree.districts.map((district) => (
                        <option key={district.id} value={district.id}>
                          {nodeLabel(district)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field
                  name="thana_id"
                  label="Thana / Upazila"
                  required
                  errors={errors.thana_id}
                  help="The app resolves a thana override against the upazila the user selected."
                >
                  {(props) => (
                    <Select
                      {...props}
                      value={thanaId}
                      onChange={(event) => setThanaId(event.target.value)}
                      disabled={!districtId}
                    >
                      <option value="">
                        {districtId ? "Select a thana/upazila…" : "Choose a district first"}
                      </option>
                      {thanaOptions.map((thana) => (
                        <option key={thana.id} value={thana.id}>
                          {nodeLabel(thana)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </SectionCard>

      {/* --- 3. Calculation method -------------------------------------------- */}
      <SectionCard
        title="Calculation method"
        description="The method the app's own offline engine will use. The engine derives its Fajr and Isha angles from this choice."
      >
        <FieldGroup columns={2}>
          <Field
            name="calculation_method"
            label="Method"
            errors={errors.calculation_method}
            help="Required before publishing. The app rejects a method it does not implement."
          >
            {(props) => (
              <Select
                {...props}
                value={method}
                onChange={(event) => setMethod(event.target.value)}
              >
                <option value="">Not chosen yet</option>
                {CALCULATION_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="rounded-lg border border-surface-border bg-surface-muted px-3 py-2.5 text-xs leading-relaxed text-ink-600">
            <p className="font-medium text-ink-800">What the engine will compute</p>
            {method && methodParameters ? (
              <>
                <p className="mt-1">{describeMethod(method as PrayerCalculationMethod)}</p>
                <p className="mt-1.5 font-mono text-[11px] text-ink-500">
                  fajr_angle {methodParameters.fajrAngleDegrees}°
                  {methodParameters.ishaIntervalMinutes !== null
                    ? ` · isha_interval_minutes ${methodParameters.ishaIntervalMinutes}`
                    : ` · isha_angle ${methodParameters.ishaAngleDegrees}°`}
                </p>
                <p className="mt-1.5">
                  Stored automatically. The app passes the method to its engine and the engine supplies
                  the angles, so these are not editable.
                </p>
              </>
            ) : (
              <p className="mt-1">Choose a method to see the angles the engine will use.</p>
            )}
          </div>
        </FieldGroup>

        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ReadOnlyValue
            label="Engine"
            value={String(values.engine_key ?? "adhan_kotlin")}
            hint="The only engine the Android app ships."
          />
          <ReadOnlyValue
            label="Engine version"
            value={String(values.engine_version ?? "0.0.5")}
            hint="The app refuses parameters for a version it does not carry."
          />
          <ReadOnlyValue
            label="Payload schema version"
            value={String(PRAYER_CONFIG_SCHEMA_VERSION)}
            hint="The app rejects a payload whose version it does not know."
          />
        </dl>

        {/* Fixed by the panel, so they travel as hidden inputs rather than as
            editable fields that would only ever have one valid value. */}
        <input type="hidden" name="engine_key" value={String(values.engine_key ?? "adhan_kotlin")} />
        <input
          type="hidden"
          name="engine_version"
          value={String(values.engine_version ?? "0.0.5")}
        />
      </SectionCard>

      {/* --- 4. Asr ----------------------------------------------------------- */}
      <SectionCard
        title="Asr madhhab"
        description="The juristic rule for the Asr shadow ratio. It moves Asr only."
      >
        <FieldGroup columns={2}>
          <Field
            name="asr_madhhab"
            label="Madhhab"
            required
            errors={errors.asr_madhhab}
            help="The app's shipped default is Hanafi."
          >
            {(props) => (
              <Select {...props} defaultValue={String(values.asr_madhhab ?? "hanafi")}>
                {ASR_MADHHAB_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FieldGroup>
      </SectionCard>

      {/* --- 5. High latitude ------------------------------------------------- */}
      <SectionCard
        title="High-latitude rule"
        description="How Fajr and Isha are bounded when the sun does not reach the twilight angle."
      >
        <FieldGroup columns={2}>
          <Field
            name="high_latitude_rule"
            label="Rule"
            required
            errors={errors.high_latitude_rule}
            help={HIGH_LATITUDE_RULE_HELP_TEXT[String(values.high_latitude_rule ?? "automatic") as keyof typeof HIGH_LATITUDE_RULE_HELP_TEXT]}
          >
            {(props) => (
              <Select {...props} defaultValue={String(values.high_latitude_rule ?? "automatic")}>
                {HIGH_LATITUDE_RULE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="self-end rounded-lg border border-surface-border bg-surface-muted px-3 py-2.5 text-xs leading-relaxed text-ink-600">
            There is no “off”. The engine always applies some bound, because without one a summer Fajr
            or Isha is undefined. At Bangladesh’s latitude the rule is never reached, so it does not
            change any calculated time.
          </div>
        </FieldGroup>
      </SectionCard>

      {/* --- 6. Adjustments --------------------------------------------------- */}
      <SectionCard
        title="Prayer adjustments"
        description={`Manual corrections in minutes, applied by the engine. Between −${PRAYER_ADJUSTMENT_LIMIT_MINUTES} and +${PRAYER_ADJUSTMENT_LIMIT_MINUTES}. Leave at 0 for no correction.`}
      >
        <FieldGroup columns={2}>
          {ADJUSTMENT_FIELDS.map((adjustment) => (
            <Field
              key={adjustment.column}
              name={adjustment.column}
              label={`${adjustment.label} adjustment`}
              errors={errors[adjustment.column]}
              help={describeAdjustment(Number(values[adjustment.column] ?? 0))}
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step="1"
                  min={-PRAYER_ADJUSTMENT_LIMIT_MINUTES}
                  max={PRAYER_ADJUSTMENT_LIMIT_MINUTES}
                  inputMode="numeric"
                  defaultValue={String(values[adjustment.column] ?? "0")}
                />
              )}
            </Field>
          ))}
        </FieldGroup>

        <p className="mt-3 rounded-lg border border-surface-border bg-surface-muted px-3 py-2 text-xs leading-relaxed text-ink-600">
          A positive value moves the time later; a negative value moves it earlier. Sunrise and sunset
          carry no adjustment — they are astronomical events, not prayers, and the engine computes them
          separately so a method offset cannot move the reported sunset.
        </p>
      </SectionCard>

      {/* --- 7. Effective period --------------------------------------------- */}
      <SectionCard
        title="Effective period"
        description="When this configuration applies. A configuration applies only to dates inside its period."
      >
        <FieldGroup columns={2}>
          <Field
            name="effective_from"
            label="Effective from"
            errors={errors.effective_from}
            help="Required before publishing. Without it nobody can tell which of two configurations applies on a given day."
          >
            {(props) => (
              <Input
                {...props}
                type="date"
                defaultValue={String(values.effective_from ?? "")}
              />
            )}
          </Field>

          <Field
            name="effective_to"
            label="Effective to"
            errors={errors.effective_to}
            help="Optional. Leave blank for a configuration with no planned end. Inclusive of the date given."
          >
            {(props) => (
              <Input {...props} type="date" defaultValue={String(values.effective_to ?? "")} />
            )}
          </Field>
        </FieldGroup>
      </SectionCard>

      {/* --- 8. Source and notes --------------------------------------------- */}
      <SectionCard
        title="Source and review notes"
        description="What these parameters came from. A published configuration without a source cannot be reviewed later."
      >
        <FieldGroup columns={2}>
          <Field
            name="source_name"
            label="Source name"
            errors={errors.source_name}
            help="Required before publishing. Name the document, method description or decision this came from."
          >
            {(props) => (
              <Input
                {...props}
                defaultValue={String(values.source_name ?? "")}
                placeholder="e.g. internal decision, 2026-01"
              />
            )}
          </Field>

          <Field
            name="source_url"
            label="Source URL"
            errors={errors.source_url}
            help="Optional. A full http:// or https:// address."
          >
            {(props) => (
              <Input
                {...props}
                type="url"
                inputMode="url"
                defaultValue={String(values.source_url ?? "")}
                placeholder="https://…"
              />
            )}
          </Field>

          <Field
            name="notes"
            label="Notes"
            errors={errors.notes}
            className="sm:col-span-2"
            help="Internal only. These notes are never exposed through the public read the Android app uses."
          >
            {(props) => (
              <Textarea {...props} defaultValue={String(values.notes ?? "")} rows={4} />
            )}
          </Field>
        </FieldGroup>

        <div className="mt-4">
          <Checkbox
            name="confirm_reviewed"
            label="I have checked these parameters against the source named above"
            help="Recorded with the change. Publishing records an administrative review, not a religious verification."
          />
        </div>
      </SectionCard>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-surface-border pt-4">
        <Link href="/prayer-config" className={buttonClass("secondary", "md")}>
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create draft" : "Save draft"}
        </SubmitButton>
      </div>

      <p className="text-xs leading-relaxed text-ink-400">
        Saving never changes the active configuration. A draft only takes effect when it is published,
        and publishing archives whatever was published for the same location before it.
      </p>
    </form>
  );
}

function ReadOnlyValue({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-ink-900">{value}</dd>
      {hint ? <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{hint}</p> : null}
    </div>
  );
}
