import { CheckCircle2, CircleAlert, CircleX, Info } from "lucide-react";

import { SectionCard, DetailList } from "@/components/ui/page-header";
import { Alert, ErrorState } from "@/components/ui/states";
import { Badge, TableShell } from "@/components/ui/data";
import { Input, Select } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import { nodeLabel, type LocationTree } from "@/features/locations/queries";
import { scopeTargetLabel, type PublicContractRow, type ResolvedPrayerConfig } from "@/features/prayer-config/queries";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import {
  ASR_MADHHAB_LABELS,
  HIGH_LATITUDE_RULE_LABELS,
  METHOD_ENGINE_PARAMETERS,
  PRAYER_ADJUSTMENTS,
  PRAYER_CALCULATION_METHOD_LABELS,
  SCOPE_LABELS,
  SCOPE_SHORT_LABELS,
  describeAdjustment,
  describeMethod,
  diffPrayerConfigs,
  isSupportedEngine,
  type PrayerConfigIssue,
} from "@/lib/validation/prayer-config";
import type { AppError } from "@/lib/errors";
import type { PrayerCalculationConfigRow } from "@/lib/types/database";

/**
 * The review and preview panel.
 *
 * Everything here is derived from the row as stored, not from the form, so what a
 * reviewer approves is what will actually be published.
 *
 * There is deliberately **no prayer-time preview**. Computing times would mean a
 * second implementation of the astronomy that could silently disagree with the
 * engine on the device, and a timetable that disagrees is worse than no timetable.
 * The panel validates a configuration; it does not predict times, and it never
 * labels anything here as officially verified.
 */
export function PrayerConfigReview({
  config,
  tree,
  published,
  versions,
  issues,
  resolved,
  resolveError,
  resolveInput,
  publicRows,
  publicError,
}: {
  config: PrayerCalculationConfigRow;
  tree: LocationTree;
  published: PrayerCalculationConfigRow | null;
  versions: PrayerCalculationConfigRow[];
  issues: PrayerConfigIssue[];
  resolved: ResolvedPrayerConfig | null;
  resolveError: AppError | null;
  resolveInput: {
    divisionId: string;
    districtId: string;
    thanaId: string;
    onDate: string;
  };
  publicRows: PublicContractRow[] | null;
  publicError: AppError | null;
}) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const target = scopeTargetLabel(tree, config);
  const engineOk = isSupportedEngine(config.engine_key, config.engine_version);
  const parameters = config.calculation_method
    ? METHOD_ENGINE_PARAMETERS[config.calculation_method]
    : null;

  const differences = published ? diffPrayerConfigs(published, config, (row) => scopeTargetLabel(tree, row).label) : [];

  return (
    <div className="space-y-6">
      {/* --- Validation ------------------------------------------------------- */}
      <SectionCard
        id="validation"
        title="Validation"
        description="Checked against the same rules the database enforces, plus the ones only the panel can explain."
      >
        {errors.length === 0 && warnings.length === 0 ? (
          <Alert tone="success" title="No problems found">
            Every required field is present, the location scope is consistent, and the engine and its
            version are ones the Android app ships.
          </Alert>
        ) : (
          <div className="space-y-3">
            {errors.length > 0 ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-red-900">
                  <CircleX className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {errors.length} problem{errors.length === 1 ? "" : "s"} blocking publication
                </p>
                <ul className="mt-2 space-y-1.5">
                  {errors.map((issue, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm leading-relaxed text-red-900">
                      <span aria-hidden="true">•</span>
                      <span>
                        {issue.field ? (
                          <span className="font-mono text-xs text-red-800">{issue.field}: </span>
                        ) : null}
                        {issue.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {warnings.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {warnings.length} thing{warnings.length === 1 ? "" : "s"} worth knowing
                </p>
                <ul className="mt-2 space-y-1.5">
                  {warnings.map((issue, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm leading-relaxed text-amber-900">
                      <span aria-hidden="true">•</span>
                      <span>{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        {errors.length === 0 ? (
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-500">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-700" aria-hidden="true" />
            <span>
              Publishing records an <strong className="font-medium">administrative review</strong>, not a
              religious verification. This panel does not claim that any method reproduces the timetable
              of Islamic Foundation Bangladesh or any other authority, because no such comparison has
              been performed.
            </span>
          </p>
        ) : null}
      </SectionCard>

      {/* --- Effective parameters -------------------------------------------- */}
      <SectionCard
        id="parameters"
        title="Effective parameters"
        description="Exactly what the Android app's engine will be configured with. Units are shown next to every numeric value."
      >
        <DetailList
          columns={2}
          items={[
            {
              label: "Calculation method",
              value: config.calculation_method ? (
                <>
                  <span>{PRAYER_CALCULATION_METHOD_LABELS[config.calculation_method]}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
                    {describeMethod(config.calculation_method)}
                  </span>
                </>
              ) : (
                <Badge tone="amber">Not chosen — publishing is blocked</Badge>
              ),
            },
            {
              label: "Fajr angle (derived)",
              value: config.fajr_angle !== null ? `${Number(config.fajr_angle)}° below the horizon` : "—",
            },
            {
              label: "Isha definition (derived)",
              value:
                config.isha_interval_minutes !== null
                  ? `${config.isha_interval_minutes} minutes after Maghrib`
                  : config.isha_angle !== null
                    ? `${Number(config.isha_angle)}° below the horizon`
                    : "—",
            },
            {
              label: "Asr madhhab",
              value: ASR_MADHHAB_LABELS[config.asr_madhhab],
            },
            {
              label: "High-latitude rule",
              value: HIGH_LATITUDE_RULE_LABELS[config.high_latitude_rule],
            },
            {
              label: "Timezone",
              value: (
                <>
                  {config.timezone}
                  <span className="mt-0.5 block text-xs text-ink-500">
                    Every calculated time is emitted in this zone.
                  </span>
                </>
              ),
            },
          ]}
        />

        <div className="mt-5">
          <p className="text-sm font-semibold text-ink-900">Per-prayer adjustments</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
            Manual corrections in minutes, applied by the engine. Sunrise and sunset carry none.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRAYER_ADJUSTMENTS.map((adjustment) => (
              <Badge
                key={adjustment.column}
                tone={config[adjustment.column] === 0 ? "outline" : "brand"}
                title={`${adjustment.label}: ${describeAdjustment(config[adjustment.column])}`}
              >
                {adjustment.label}: {describeAdjustment(config[adjustment.column])}
              </Badge>
            ))}
          </div>
        </div>

        <p className="mt-4 rounded-lg border border-surface-border bg-surface-muted px-3 py-2 text-xs leading-relaxed text-ink-600">
          The angles are derived from the method by a database trigger, not typed in. The Android engine
          owns these constants, so a stored angle can never disagree with what the app computes.
          {parameters ? null : " No method is chosen yet, so no angles are stored."}
        </p>
      </SectionCard>

      {/* --- Applicability ---------------------------------------------------- */}
      <SectionCard
        id="applicability"
        title="Where and when this applies"
        description="A configuration applies only to the locations and dates shown here."
      >
        <DetailList
          columns={2}
          items={[
            {
              label: "Scope",
              value: (
                <>
                  {SCOPE_LABELS[config.scope]}
                  <span className="mt-0.5 block text-xs text-ink-500">
                    Precedence: thana → district → division → global.
                  </span>
                </>
              ),
            },
            {
              label: "Location",
              value: (
                <>
                  {target.label}
                  {target.code ? (
                    <span className="mt-0.5 block font-mono text-xs text-ink-500">
                      {target.code}
                      <span className="ml-1.5 font-sans text-ink-400">
                        — the code the app resolves against
                      </span>
                    </span>
                  ) : null}
                </>
              ),
            },
            {
              label: "Effective from",
              value: config.effective_from ? (
                formatDate(config.effective_from)
              ) : (
                <Badge tone="amber">Not set — publishing is blocked</Badge>
              ),
            },
            {
              label: "Effective to",
              value: config.effective_to ? (
                `${formatDate(config.effective_to)} (inclusive)`
              ) : (
                "Open-ended"
              ),
            },
            {
              label: "Payload schema version",
              value: (
                <>
                  {config.schema_version}
                  <span className="mt-0.5 block text-xs text-ink-500">
                    The app must reject a payload version it does not know.
                  </span>
                </>
              ),
            },
            {
              label: "Source",
              value: config.source_name ? (
                <>
                  {config.source_name}
                  {config.source_url ? (
                    <a
                      href={config.source_url}
                      className="mt-0.5 block break-all text-xs text-brand-700 hover:underline"
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      {config.source_url}
                    </a>
                  ) : null}
                </>
              ) : (
                <Badge tone="amber">Not recorded — publishing is blocked</Badge>
              ),
            },
          ]}
        />
      </SectionCard>

      {/* --- Engine compatibility -------------------------------------------- */}
      <SectionCard
        id="engine"
        title="Engine compatibility"
        description="Whether the Android app can read this configuration at all."
      >
        <div
          className={
            engineOk
              ? "rounded-lg border border-brand-200 bg-brand-50 px-3.5 py-3 text-sm text-brand-900"
              : "rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-900"
          }
        >
          <p className="flex items-center gap-2 font-semibold">
            {engineOk ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <CircleX className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            {engineOk
              ? `${config.engine_key} ${config.engine_version} is an engine the app ships`
              : `${config.engine_key} ${config.engine_version} is not an engine the app ships`}
          </p>
          <p className="mt-1 leading-relaxed">
            {engineOk
              ? "Publishing for this engine has an effect. The app must still reject the payload if the schema version or any parameter is outside what its build supports."
              : "Publishing would have no effect, so the panel refuses it. The app only reads parameters for an engine version it carries."}
          </p>
        </div>
      </SectionCard>

      {/* --- Diff ------------------------------------------------------------- */}
      <SectionCard
        id="changes"
        title="Changes from the published version"
        description="Field by field, so a reviewer reads the delta rather than re-reading a form."
      >
        {!published && config.status === "draft" && versions.length === 0 ? (
          <Alert tone="info">
            There is no other configuration for this location, so publishing this one would introduce a
            new override rather than replace an existing one.
          </Alert>
        ) : null}

        {published && differences.length === 0 ? (
          <Alert tone="info" title="Identical to the published configuration">
            Every parameter matches what is already live. Publishing this draft would archive the current
            configuration and publish an equivalent one.
          </Alert>
        ) : null}

        {published && differences.length > 0 ? (
          <TableShell caption="Changes from the published configuration" columns={["Field", "Published", "This draft"]}>
            <tbody>
              {differences.map((difference) => (
                <tr key={difference.label}>
                  <td className="font-medium text-ink-900">{difference.label}</td>
                  <td className="text-ink-600">{difference.before}</td>
                  <td className="font-medium text-ink-900">{difference.after}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        ) : null}

        {!published && versions.length > 0 ? (
          <p className="text-sm leading-relaxed text-ink-600">
            No configuration is currently published for this location, so there is nothing to compare
            against. {versions.length} earlier version{versions.length === 1 ? "" : "s"} exist and are
            listed above.
          </p>
        ) : null}
      </SectionCard>

      {/* --- Precedence ------------------------------------------------------- */}
      <SectionCard
        id="precedence"
        title="Which configuration wins here"
        description="Resolved by the same rule the contract documents: thana, then district, then division, then global."
      >
        <form
          method="get"
          action={`/prayer-config/${config.id}`}
          className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <div className="min-w-0 sm:w-52">
            <label htmlFor="r_division" className="field-label">
              Division
            </label>
            <Select id="r_division" name="r_division" defaultValue={resolveInput.divisionId}>
              <option value="">Not specified</option>
              {tree.divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {nodeLabel(division)}
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-0 sm:w-52">
            <label htmlFor="r_district" className="field-label">
              District
            </label>
            <Select id="r_district" name="r_district" defaultValue={resolveInput.districtId}>
              <option value="">Not specified</option>
              {tree.districts.map((district) => (
                <option key={district.id} value={district.id}>
                  {nodeLabel(district)}
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-0 sm:w-52">
            <label htmlFor="r_thana" className="field-label">
              Thana / Upazila
            </label>
            <Select id="r_thana" name="r_thana" defaultValue={resolveInput.thanaId}>
              <option value="">Not specified</option>
              {tree.thanas.map((thana) => (
                <option key={thana.id} value={thana.id}>
                  {nodeLabel(thana)}
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-0 sm:w-44">
            <label htmlFor="r_date" className="field-label">
              On date
            </label>
            <Input id="r_date" name="r_date" type="date" defaultValue={resolveInput.onDate} />
          </div>

          <button type="submit" className={buttonClass("secondary", "md")}>
            Resolve
          </button>
        </form>

        <div className="mt-4">
          {resolveError ? (
            <ErrorState
              title="Could not resolve a configuration"
              message={resolveError.message}
              hint={resolveError.hint}
            />
          ) : resolved ? (
            <Alert
              tone={resolved.id === config.id ? "success" : "info"}
              title={resolved.id === config.id ? "This configuration wins" : "A different configuration wins"}
            >
              <p>
                <span className="font-medium">{resolved.name}</span> — {SCOPE_SHORT_LABELS[resolved.scope]}{" "}
                (version {resolved.version}) applies to the selected location on {formatDate(resolveInput.onDate)}.
              </p>
              <p className="mt-1 text-xs">
                Matched at the {resolved.matchedBy} level
                {resolved.effectiveFrom ? `, effective from ${formatDate(resolved.effectiveFrom)}` : ""}
                {resolved.effectiveTo ? ` to ${formatDate(resolved.effectiveTo)}` : ", open-ended"}.
              </p>
            </Alert>
          ) : (
            <Alert tone="warning" title="No configuration applies">
              No published configuration matches this location and date. The Android app keeps its last
              known valid configuration — the panel does not invent a fallback. Set a location and date
              above, or publish a configuration for this scope.
            </Alert>
          )}
        </div>
      </SectionCard>

      {/* --- Public contract -------------------------------------------------- */}
      <SectionCard
        id="public-contract"
        title="What the Android app currently receives"
        description="Read through the same endpoint an unauthenticated app calls, so this is the payload itself and not a prettier rendering of it."
      >
        {publicError ? (
          <ErrorState
            title="Could not read the public configuration"
            message={publicError.message}
            hint={publicError.hint}
          />
        ) : publicRows && publicRows.length > 0 ? (
          <>
            <TableShell caption="Published configurations exposed publicly" columns={["Scope", "Code", "Configuration", "Method", "Version", "Published"]}>
              <tbody>
                {publicRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Badge tone={row.scope === "global" ? "neutral" : "outline"}>
                        {SCOPE_SHORT_LABELS[row.scope]}
                      </Badge>
                    </td>
                    <td className="font-mono text-xs">{row.scopeCode}</td>
                    <td>{row.name}</td>
                    <td>{PRAYER_CALCULATION_METHOD_LABELS[row.calculationMethod]}</td>
                    <td className="tabular-nums">{row.version}</td>
                    <td>{formatDateTime(row.publishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
            <p className="mt-3 text-xs leading-relaxed text-ink-500">
              Drafts, archived rows, internal notes and the identity of the administrators who reviewed or
              published a configuration are not part of this payload and are not reachable from it.
            </p>
          </>
        ) : (
          <Alert tone="warning" title="No published configuration is exposed">
            Nothing is published, so the public endpoint returns an empty set. The Android app would fall
            back to its own built-in defaults.
          </Alert>
        )}

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-900">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-semibold">The Android app does not read this yet.</strong> It has no
            network client in its current phase, so publishing changes nothing on any device until the
            app-side work in <code className="rounded bg-white/60 px-1">docs/PRAYER_CONFIGURATION.md</code>{" "}
            section 7.3 is done. This page does not claim otherwise: there is no acknowledgement from the
            app, so there is nothing to report.
          </span>
        </div>
      </SectionCard>
    </div>
  );
}
