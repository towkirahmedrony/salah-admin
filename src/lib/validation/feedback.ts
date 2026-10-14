import { z } from "zod";

import {
  optionalEmail,
  optionalText,
  optionalUuid,
  trimmedText,
} from "@/lib/validation/common";

export const FEEDBACK_CATEGORIES = [
  "general",
  "bug",
  "prayer_times",
  "location",
  "ramadan",
  "notification",
  "ui",
  "performance",
  "other",
] as const;

export const FEEDBACK_CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  bug: "Bug",
  prayer_times: "Prayer times",
  location: "Location",
  ramadan: "Ramadan",
  notification: "Notifications",
  ui: "Interface",
  performance: "Performance",
  other: "Other",
};

export const FEEDBACK_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

/**
 * Public submission.
 *
 * This is the schema the API route applies before calling
 * `public.submit_feedback()`. The database function re-validates everything,
 * because a schema in the application layer is not a boundary — anyone can call
 * the function directly.
 */
export const publicFeedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES).default("general"),
  subject: optionalText(200, "Subject"),
  message: trimmedText(4000, "Message").refine((value) => value.length >= 10, {
    message: "Please describe the issue in at least 10 characters.",
  }),
  contact_email: optionalEmail("Contact email"),
  app_version: optionalText(32, "App version"),
  android_version: optionalText(32, "Android version"),
  device_model: optionalText(120, "Device model"),
  app_language: optionalText(16, "App language"),
  diagnostics: z.record(z.unknown()).optional(),
  client_reference: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{8,80}$/, "client_reference must be 8-80 URL-safe characters.")
    .optional(),
});

export type PublicFeedbackInput = z.infer<typeof publicFeedbackSchema>;

// --- Administrative triage ---------------------------------------------------

export const feedbackUpdateSchema = z
  .object({
    id: optionalUuid("Feedback report"),
    status: z.enum(FEEDBACK_STATUSES),
    assigned_to: optionalUuid("Assignee"),
    admin_reply: optionalText(4000, "Reply"),
  })
  .superRefine((value, ctx) => {
    // Closing a report with no reply leaves the reporter with nothing, and the
    // status change is then the only record that anything happened.
    if ((value.status === "resolved" || value.status === "closed") && !value.admin_reply) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["admin_reply"],
        message: "Add a reply before resolving or closing a report.",
      });
    }
  });

export type FeedbackUpdateInput = z.infer<typeof feedbackUpdateSchema>;
