"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert } from "@/components/ui/states";
import { Checkbox, Field, Input, Select, Textarea, FieldGroup } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  INITIAL_LOCATION_ACTION_STATE,
  saveLocationResource,
  type LocationActionState,
} from "@/features/locations/actions";
import {
  VERIFICATION_OPTIONS,
  type LocationFieldDef,
  type LocationResourceDef,
} from "@/features/locations/definitions";
import { nodeLabel, type LocationTree } from "@/features/locations/queries";

export type LocationFormValues = Record<string, string | boolean | null>;

/**
 * Create/edit form for a location record.
 *
 * One component serves all four levels because the differences are declared in
 * `definitions.ts`. Parent selects cascade locally from the preloaded tree, so
 * choosing a division narrows the districts with no round trip — which matters
 * on a phone over a slow connection.
 */
export function LocationForm({
  def,
  tree,
  initialValues,
  onCancel,
  onSaved,
}: {
  def: LocationResourceDef;
  tree: LocationTree;
  initialValues: LocationFormValues;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [state, formAction] = useActionState<LocationActionState, FormData>(
    saveLocationResource,
    INITIAL_LOCATION_ACTION_STATE,
  );

  const [districtId, setDistrictId] = useState<string>(
    String(initialValues.district_id ?? ""),
  );
  const [thanaId, setThanaId] = useState<string>(String(initialValues.thana_id ?? ""));

  useEffect(() => {
    if (state.status === "success") onSaved();
  }, [state.status, onSaved]);

  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="__resource" value={def.key} />
      {typeof initialValues.id === "string" && initialValues.id ? (
        <input type="hidden" name="id" value={initialValues.id} />
      ) : null}

      {state.status === "error" && state.message ? (
        <Alert tone="error" role="alert" title="Could not save">
          {state.message}
        </Alert>
      ) : null}

      <FormFields
        def={def}
        tree={tree}
        values={initialValues}
        errors={errors}
        districtId={districtId}
        thanaId={thanaId}
        onDistrictChange={(value) => {
          setDistrictId(value);
          // A thana belonging to the previous district can no longer be valid.
          setThanaId("");
        }}
        onThanaChange={setThanaId}
      />

      <div className="flex flex-wrap justify-end gap-2 border-t border-surface-border pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-10 items-center rounded-lg border border-surface-border bg-surface px-3.5 text-sm font-medium text-ink-900 hover:bg-surface-muted"
        >
          Cancel
        </button>
        <SubmitButton pendingLabel="Saving…">
          {typeof initialValues.id === "string" && initialValues.id ? "Save changes" : `Add ${def.singular.toLowerCase()}`}
        </SubmitButton>
      </div>
    </form>
  );
}

function FormFields({
  def,
  tree,
  values,
  errors,
  districtId,
  thanaId,
  onDistrictChange,
  onThanaChange,
}: {
  def: LocationResourceDef;
  tree: LocationTree;
  values: LocationFormValues;
  errors: Record<string, string[]>;
  districtId: string;
  thanaId: string;
  onDistrictChange: (value: string) => void;
  onThanaChange: (value: string) => void;
}) {
  const groups = groupFields(def.fields);

  return (
    <>
      {groups.map((group) => (
        <FieldGroup key={group.title} title={group.title} description={group.description} columns={group.columns}>
          {group.fields.map((field) => (
            <FieldInput
              key={field.name}
              field={field}
              tree={tree}
              value={values[field.name] ?? null}
              errors={errors[field.name]}
              districtId={districtId}
              thanaId={thanaId}
              onDistrictChange={onDistrictChange}
              onThanaChange={onThanaChange}
            />
          ))}
        </FieldGroup>
      ))}
    </>
  );
}

interface FieldGrouping {
  title: string;
  description?: string;
  columns: 1 | 2;
  fields: LocationFieldDef[];
}

const GROUP_TITLES: Record<string, string> = {
  code: "Identity",
  name_en: "Identity",
  name_bn: "Identity",
  parent: "Hierarchy",
  latitude: "Reference coordinates",
  longitude: "Reference coordinates",
  alternatives: "Naming",
  source_name: "Provenance",
  source_url: "Provenance",
  verification: "Verification",
  notes: "Additional detail",
  active: "Availability",
};

const GROUP_ORDER = [
  "Identity",
  "Hierarchy",
  "Naming",
  "Reference coordinates",
  "Provenance",
  "Verification",
  "Additional detail",
  "Availability",
];

function groupFields(fields: LocationFieldDef[]): FieldGrouping[] {
  const byTitle = new Map<string, LocationFieldDef[]>();

  for (const field of fields) {
    const title = GROUP_TITLES[field.kind] ?? "Details";
    const existing = byTitle.get(title);
    if (existing) existing.push(field);
    else byTitle.set(title, [field]);
  }

  return GROUP_ORDER.filter((title) => byTitle.has(title)).map((title) => ({
    title,
    description: GROUP_DESCRIPTIONS[title],
    columns: title === "Additional detail" ? 1 : 2,
    fields: byTitle.get(title)!,
  }));
}

const GROUP_DESCRIPTIONS: Record<string, string | undefined> = {
  Hierarchy: "The parent level this record belongs to.",
  "Reference coordinates": "Taken from the source. Leave blank rather than estimating a position.",
  Provenance: "Where the data came from. Required before a locality can be marked verified.",
  Verification: "Verification is a claim about a source, so it is never set automatically.",
  Availability: "Deactivation keeps history intact, unlike deletion.",
};

function FieldInput({
  field,
  tree,
  value,
  errors,
  districtId,
  thanaId,
  onDistrictChange,
  onThanaChange,
}: {
  field: LocationFieldDef;
  tree: LocationTree;
  value: string | boolean | null;
  errors?: string[];
  districtId: string;
  thanaId: string;
  onDistrictChange: (value: string) => void;
  onThanaChange: (value: string) => void;
}) {
  if (field.kind === "active") {
    return (
      <div className="sm:col-span-2">
        <Checkbox
          name={field.name}
          label={field.label}
          help={field.help}
          defaultChecked={value === true || value === null}
        />
      </div>
    );
  }

  if (field.kind === "parent") {
    return (
      <ParentField
        field={field}
        tree={tree}
        value={
          field.parentResource === "thanas"
            ? thanaId
            : field.parentResource === "districts"
              ? districtId
              : String(value ?? "")
        }
        errors={errors}
        districtId={districtId}
        thanaId={thanaId}
        onDistrictChange={onDistrictChange}
        onThanaChange={onThanaChange}
      />
    );
  }

  if (field.kind === "verification") {
    return (
      <Field name={field.name} label={field.label} help={field.help} errors={errors}>
        {(props) => (
          <Select {...props} defaultValue={String(value ?? "unverified")}>
            {VERIFICATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
    );
  }

  if (field.kind === "notes" || field.kind === "alternatives") {
    return (
      <Field
        name={field.name}
        label={field.label}
        help={field.help}
        errors={errors}
        className="sm:col-span-2"
      >
        {(props) => (
          <Textarea
            {...props}
            rows={field.kind === "alternatives" ? 2 : 4}
            defaultValue={String(value ?? "")}
            placeholder={field.placeholder}
          />
        )}
      </Field>
    );
  }

  if (field.kind === "latitude" || field.kind === "longitude") {
    return (
      <Field name={field.name} label={field.label} help={field.help} errors={errors}>
        {(props) => (
          <Input
            {...props}
            type="number"
            step="0.000001"
            min={field.kind === "latitude" ? -90 : -180}
            max={field.kind === "latitude" ? 90 : 180}
            inputMode="decimal"
            defaultValue={String(value ?? "")}
          />
        )}
      </Field>
    );
  }

  return (
    <Field
      name={field.name}
      label={field.label}
      help={field.help}
      errors={errors}
      required={field.required}
    >
      {(props) => (
        <Input
          {...props}
          type={field.kind === "source_url" ? "url" : "text"}
          inputMode={field.kind === "source_url" ? "url" : undefined}
          defaultValue={String(value ?? "")}
          placeholder={field.placeholder}
          className={field.kind === "name_bn" ? `${props.className} font-bangla` : props.className}
          lang={field.kind === "name_bn" ? "bn" : undefined}
        />
      )}
    </Field>
  );
}

/**
 * Cascading parent select.
 *
 * District options are narrowed by the chosen division, and thana options by the
 * chosen district, so the form cannot express a combination the hierarchy does
 * not allow. The server re-checks the relationship regardless.
 */
function ParentField({
  field,
  tree,
  value,
  errors,
  districtId,
  thanaId,
  onDistrictChange,
  onThanaChange,
}: {
  field: LocationFieldDef;
  tree: LocationTree;
  value: string;
  errors?: string[];
  districtId: string;
  thanaId: string;
  onDistrictChange: (value: string) => void;
  onThanaChange: (value: string) => void;
}) {
  if (field.parentResource === "divisions") {
    return (
      <Field name={field.name} label={field.label} help={field.help} errors={errors} required={field.required}>
        {(props) => (
          <Select {...props} defaultValue={value} required={field.required}>
            <option value="">Select a division…</option>
            {tree.divisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.name_en}
                {division.name_bn ? ` — ${division.name_bn}` : ""}
                {division.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </Select>
        )}
      </Field>
    );
  }

  if (field.parentResource === "districts") {
    // Show every district until a thana pins the locality to one, so the field
    // stays freely editable while it is still open.
    const options = thanaId
      ? tree.districts.filter((district) => district.id === districtId)
      : tree.districts;

    return (
      <Field
        name={field.name}
        label={field.label}
        help={field.help}
        errors={errors}
        required={field.required}
      >
        {(props) => (
          <Select
            {...props}
            value={districtId}
            onChange={(event) => onDistrictChange(event.target.value)}
            required={field.required}
          >
            <option value="">Select a district…</option>
            {options.map((district) => (
              <option key={district.id} value={district.id}>
                {district.name_en}
                {district.name_bn ? ` — ${district.name_bn}` : ""}
              </option>
            ))}
          </Select>
        )}
      </Field>
    );
  }

  // thanas
  const options = districtId
    ? tree.thanas.filter((thana) => thana.district_id === districtId)
    : tree.thanas;

  return (
    <Field
      name={field.name}
      label={field.label}
      help={field.help}
      errors={errors}
      required={field.required}
    >
      {(props) => (
        <Select
          {...props}
          value={thanaId}
          onChange={(event) => onThanaChange(event.target.value)}
          required={field.required}
          disabled={!districtId}
        >
          <option value="">
            {districtId ? "Select a thana/upazila…" : "Choose a district first"}
          </option>
          {options.map((thana) => (
            <option key={thana.id} value={thana.id}>
              {nodeLabel(thana)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
