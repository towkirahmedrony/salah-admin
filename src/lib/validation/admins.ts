import { z } from "zod";

import {
  booleanFromForm,
  optionalEmail,
  optionalText,
  optionalUuid,
} from "@/lib/validation/common";
import { ADMIN_ROLES } from "@/lib/permissions/permissions";
import type { AdminRole } from "@/lib/types/database";

/**
 * Administrator provisioning.
 *
 * The panel cannot create Supabase Auth users: that requires the service-role
 * key, which this project deliberately does not have anywhere. So the workflow
 * is: a human creates the account in Supabase Auth, then a super admin promotes
 * it here by email. `provision_admin` performs that promotion with an internal
 * authorization check of its own.
 */
export const provisionAdminSchema = z.object({
  email: optionalEmail("Email address").refine((value) => value !== null, {
    message: "Enter the email address of an existing Supabase Auth user.",
  }),
  full_name: optionalText(160, "Full name"),
  role: z.enum(ADMIN_ROLES as [AdminRole, ...AdminRole[]]),
});

export type ProvisionAdminInput = z.infer<typeof provisionAdminSchema>;

export const adminUpdateSchema = z.object({
  id: optionalUuid("Administrator").refine((value) => value !== undefined, {
    message: "Select an administrator.",
  }),
  full_name: optionalText(160, "Full name"),
  role: z.enum(ADMIN_ROLES as [AdminRole, ...AdminRole[]]),
  is_active: booleanFromForm,
  notes: optionalText(600, "Notes"),
});

export type AdminUpdateInput = z.infer<typeof adminUpdateSchema>;
