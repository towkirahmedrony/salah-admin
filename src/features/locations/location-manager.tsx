"use client";

import Link from "next/link";
import { Download, Pencil, Plus, Search, Trash2, Power } from "lucide-react";
import { useActionState, useCallback, useEffect, useState } from "react";

import { Alert, EmptyState, ErrorState } from "@/components/ui/states";
import { Badge, Pagination, TableShell } from "@/components/ui/data";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal, ConfirmSubmitButton } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate } from "@/lib/utils/format";
import {
  INITIAL_LOCATION_ACTION_STATE,
  deleteLocationResource,
  setLocationResourceActive,
  type LocationActionState,
} from "@/features/locations/actions";
import {
  VERIFICATION_OPTIONS,
  type LocationResourceDef,
} from "@/features/locations/definitions";
import { LocationForm } from "@/features/locations/location-form";
import { nodeLabel, type LocationListResult, type LocationTree } from "@/features/locations/queries";

export interface LocationFilterState {
  q: string;
  active: "all" | "active" | "inactive";
  /** Selected parent (division for districts, district for thanas/localities). */
  parent: string;
  /** Selected thana, localities only. */
  thana: string;
  verification: string;
  page: number;
}

/**
 * The management surface for one location level: filters, the paged table, and
 * the create/edit modal.
 *
 * Filters are a plain GET form, so a filtered view is a real, shareable URL and
 * works without JavaScript. The modal is an enhancement on top of that.
 */
export function LocationManager({
  def,
  tree,
  result,
  filters,
  canWrite,
}: {
  def: LocationResourceDef;
  tree: LocationTree;
  result: LocationListResult;
  filters: LocationFilterState;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState<null | { id?: string; values: Record<string, string | boolean | null> }>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState<{ tone: "success" | "error"; text: string } | null>(
    null,
  );

  const closeModal = useCallback(() => setEditing(null), []);

  return (
    <div className="space-y-5">
      {statusMessage ? (
        <Alert tone={statusMessage.tone} role={statusMessage.tone === "error" ? "alert" : "status"}>
          {statusMessage.text}
        </Alert>
      ) : null}

      {tree.error ? (
        <Alert tone="error" title="Location hierarchy unavailable">
          {tree.error.message} {tree.error.hint ?? ""}
        </Alert>
      ) : null}

      <FilterBar def={def} tree={tree} filters={filters} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-500">
          <span className="font-semibold text-ink-900">{result.total}</span>{" "}
          {result.total === 1 ? def.singular.toLowerCase() : def.plural.toLowerCase()}
          {filters.q ? ` matching “${filters.q}”` : ""}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/locations/export/${def.key}?${new URLSearchParams({
              q: filters.q,
              active: filters.active,
              parent: filters.parent,
              thana: filters.thana,
              verification: filters.verification,
            }).toString()}`}
            prefetch={false}
            className={buttonClass("secondary", "sm")}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export CSV
          </Link>

          {canWrite ? (
            <Button variant="primary" size="sm" onClick={() => setEditing({ values: {} })}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add {def.singular.toLowerCase()}
            </Button>
          ) : null}
        </div>
      </div>

      {result.error ? (
        <ErrorState
          title="Could not load records"
          message={result.error.message}
          hint={result.error.hint}
        />
      ) : result.rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title={
              filters.q || filters.active !== "all" || filters.parent || filters.verification
                ? "No records match these filters"
                : `No ${def.plural.toLowerCase()} recorded yet`
            }
            description={
              filters.q || filters.active !== "all" || filters.parent || filters.verification
                ? "Clear the filters to see everything in this level."
                : def.emptyHint
            }
            action={
              canWrite && !filters.q ? (
                <Button variant="primary" onClick={() => setEditing({ values: {} })}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add {def.singular.toLowerCase()}
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <TableShell
          caption={`${def.plural} list`}
          columns={[
            "Name",
            def.parentCellLabel,
            "Code",
            "Details",
            "Updated",
            canWrite ? "Actions" : "Status",
          ]}
          footer={
            <Pagination
              basePath={def.path}
              searchParams={{
                q: filters.q,
                active: filters.active === "all" ? undefined : filters.active,
                parent: filters.parent,
                thana: filters.thana,
                verification: filters.verification,
                page: filters.page > 1 ? String(filters.page) : undefined,
              }}
              page={result.page}
              totalPages={result.totalPages}
              totalCount={result.total}
              pageSize={25}
            />
          }
        >
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <div className="min-w-0">
                    <p className="break-words font-medium text-ink-900">{row.name_en}</p>
                    {row.name_bn ? (
                      <p className="break-words font-bangla text-xs text-ink-500" lang="bn">
                        {row.name_bn}
                      </p>
                    ) : null}
                  </div>
                </td>
                <td className="text-xs">{row.parentLabel ?? "—"}</td>
                <td>
                  <span className="font-mono text-xs">{row.code ?? "—"}</span>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {!row.is_active ? <Badge tone="slate">Inactive</Badge> : null}
                    {row.facts.map((fact) => (
                      <Badge
                        key={fact.label}
                        tone={fact.tone === "brand" ? "brand" : fact.tone === "amber" ? "amber" : fact.tone === "red" ? "red" : "outline"}
                        title={fact.label}
                      >
                        {fact.value}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap text-xs text-ink-500">{formatDate(row.updatedAt)}</td>
                <td>
                  {canWrite ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditing({ id: row.id, values: row.values })}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </Button>

                      <ActiveToggleForm
                        resourceKey={def.key}
                        id={row.id}
                        isActive={row.is_active}
                        onResult={setStatusMessage}
                      />

                      <DeleteForm
                        resourceKey={def.key}
                        id={row.id}
                        label={row.name_en}
                        singular={def.singular}
                        onResult={setStatusMessage}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-ink-500">Read-only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Modal
        open={editing !== null}
        onClose={closeModal}
        size="lg"
        title={editing?.id ? `Edit ${def.singular.toLowerCase()}` : `Add ${def.singular.toLowerCase()}`}
        description={
          def.key === "localities"
            ? "A locality needs a district, or a thana/upazila when it is actually known. Coordinates and verification are only recorded when the source provides them."
            : "Codes must match the reference dataset. Coordinates are never estimated."
        }
      >
        {editing ? (
          <LocationForm
            key={editing.id ?? "new"}
            def={def}
            tree={tree}
            initialValues={editing.values}
            onCancel={closeModal}
            onSaved={() => {
              closeModal();
              setStatusMessage({
                tone: "success",
                text: editing.id ? `${def.singular} updated.` : `${def.singular} added.`,
              });
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function FilterBar({
  def,
  tree,
  filters,
}: {
  def: LocationResourceDef;
  tree: LocationTree;
  filters: LocationFilterState;
}) {
  const [divisionId, setDivisionId] = useState("");
  // Seeded from the URL so a shared, filtered link restores the same selection.
  const [parentId, setParentId] = useState(filters.parent);
  const [thanaId, setThanaId] = useState(filters.thana);

  // Each level exposes exactly the filters that make sense for it:
  //   divisions  — none (nothing above it)
  //   districts  — division
  //   thanas     — division (to narrow the list) and district
  //   localities — district, thana within it, and verification status
  const districtOptions =
    def.key === "thanas" && divisionId
      ? tree.districts.filter((district) => district.division_id === divisionId)
      : tree.districts;

  const thanaOptions = parentId
    ? tree.thanas.filter((thana) => thana.district_id === parentId)
    : [];

  return (
    <form method="get" action={def.path} className="card">
      <div className="card-body grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field name="q" label="Search" help="English name, Bangla name or code.">
          {(props) => (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
                aria-hidden="true"
              />
              <Input
                {...props}
                defaultValue={filters.q}
                placeholder="e.g. Dhaka or ঢাকা"
                className={`${props.className} pl-8`}
              />
            </div>
          )}
        </Field>

        <Field name="active" label="Availability">
          {(props) => (
            <Select {...props} defaultValue={filters.active}>
              <option value="all">All records</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </Select>
          )}
        </Field>

        {def.key === "thanas" ? (
          <Field name="division" label="Division" help="Narrows the district list. Not submitted as a filter.">
            {(props) => (
              <Select
                {...props}
                value={divisionId}
                onChange={(event) => {
                  setDivisionId(event.target.value);
                  setParentId("");
                  setThanaId("");
                }}
              >
                <option value="">Any division</option>
                {tree.divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name_en}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {def.key === "districts" ? (
          <Field name="parent" label="Division">
            {(props) => (
              <Select
                {...props}
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
              >
                <option value="">Any division</option>
                {tree.divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {nodeLabel(division)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {def.key === "thanas" || def.key === "localities" ? (
          <Field name="parent" label="District">
            {(props) => (
              <Select
                {...props}
                value={parentId}
                onChange={(event) => {
                  setParentId(event.target.value);
                  // A thana from the previous district cannot still apply.
                  setThanaId("");
                }}
              >
                <option value="">Any district</option>
                {districtOptions.map((district) => (
                  <option key={district.id} value={district.id}>
                    {nodeLabel(district)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {def.key === "localities" ? (
          <Field name="thana" label="Thana / Upazila">
            {(props) => (
              <Select
                {...props}
                value={thanaId}
                onChange={(event) => setThanaId(event.target.value)}
                disabled={!parentId}
              >
                <option value="">
                  {parentId ? "Any thana/upazila" : "Choose a district first"}
                </option>
                {thanaOptions.map((thana) => (
                  <option key={thana.id} value={thana.id}>
                    {nodeLabel(thana)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {def.key === "localities" ? (
          <Field name="verification" label="Verification">
            {(props) => (
              <Select {...props} defaultValue={filters.verification}>
                <option value="">Any status</option>
                {VERIFICATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="primary">
            <Search className="h-4 w-4" aria-hidden="true" />
            Apply filters
          </Button>
          <Link href={def.path} className={buttonClass("ghost", "md")}>
            Clear
          </Link>
        </div>
      </div>
    </form>
  );
}

function ActiveToggleForm({
  resourceKey,
  id,
  isActive,
  onResult,
}: {
  resourceKey: string;
  id: string;
  isActive: boolean;
  onResult: (value: { tone: "success" | "error"; text: string }) => void;
}) {
  const [state, formAction] = useActionState<LocationActionState, FormData>(
    setLocationResourceActive,
    INITIAL_LOCATION_ACTION_STATE,
  );

  useEffect(() => {
    if (state.status === "success") onResult({ tone: "success", text: state.message });
    if (state.status === "error") onResult({ tone: "error", text: state.message });
  }, [state, onResult]);

  return (
    <form action={formAction} className="inline-flex">
      <input type="hidden" name="__resource" value={resourceKey} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="is_active" value={isActive ? "false" : "true"} />
      <SubmitButton
        variant="ghost"
        size="sm"
        pendingLabel="…"
        confirm={
          isActive
            ? "Deactivate this record? It will be hidden from pickers but its history is kept."
            : undefined
        }
      >
        <Power className="h-3.5 w-3.5" aria-hidden="true" />
        {isActive ? "Deactivate" : "Activate"}
      </SubmitButton>
    </form>
  );
}

function DeleteForm({
  resourceKey,
  id,
  label,
  singular,
  onResult,
}: {
  resourceKey: string;
  id: string;
  label: string;
  singular: string;
  onResult: (value: { tone: "success" | "error"; text: string }) => void;
}) {
  const [state, formAction] = useActionState<LocationActionState, FormData>(
    deleteLocationResource,
    INITIAL_LOCATION_ACTION_STATE,
  );

  useEffect(() => {
    if (state.status === "success") onResult({ tone: "success", text: state.message });
    if (state.status === "error") onResult({ tone: "error", text: state.message });
  }, [state, onResult]);

  return (
    <form action={formAction} className="inline-flex">
      <input type="hidden" name="__resource" value={resourceKey} />
      <input type="hidden" name="id" value={id} />
      <ConfirmSubmitButton
        size="sm"
        variant="ghost"
        label={
          <span className="inline-flex items-center gap-1.5 text-red-700">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete
          </span>
        }
        title={`Delete ${singular.toLowerCase()}?`}
        description={
          <p>
            <span className="font-medium">{label}</span> will be permanently deleted. Records that
            other data still references are refused, and should be deactivated instead.
          </p>
        }
        confirmLabel="Delete permanently"
        confirmLabelPending="Deleting…"
        requireCheckboxLabel="I understand this cannot be undone."
      />
    </form>
  );
}


