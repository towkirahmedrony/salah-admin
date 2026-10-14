import { z } from "zod";

import {
  booleanFromForm,
  enumFromForm,
  optionalText,
  optionalTimestamp,
  optionalUuid,
  trimmedText,
} from "@/lib/validation/common";
import { compareAppVersions, isValidAppVersion } from "@/lib/utils/version";

export const ANNOUNCEMENT_TYPES = [
  "general",
  "prayer",
  "ramadan",
  "maintenance",
  "urgent",
] as const;

export const TARGET_PLATFORMS = ["android", "all"] as const;

const optionalVersion = (label: string) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .union([z.string().max(32), z.null()])
      .optional()
      .transform((value) => (value === undefined || value === null ? null : value.trim() || null))
      .refine((value) => value === null || isValidAppVersion(value), {
        message: `${label} must look like 1.2.3.`,
      }),
  );

export const announcementSchema = z
  .object({
    id: optionalUuid("Announcement"),
    title_en: trimmedText(160, "English title"),
    body_en: trimmedText(4000, "English body"),
    title_bn: optionalText(160, "Bangla title"),
    body_bn: optionalText(4000, "Bangla body"),
    type: enumFromForm(ANNOUNCEMENT_TYPES, "Announcement type"),
    target_platform: enumFromForm(TARGET_PLATFORMS, "Target platform"),
    min_app_version: optionalVersion("Minimum app version"),
    max_app_version: optionalVersion("Maximum app version"),
    publish_at: optionalTimestamp("Publish time"),
    expires_at: optionalTimestamp("Expiration time"),
    confirm_reviewed: booleanFromForm.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.min_app_version && value.max_app_version) {
      const comparison = compareAppVersions(value.min_app_version, value.max_app_version);
      if (comparison === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max_app_version"],
          message: "One of the version bounds could not be read.",
        });
      } else if (comparison === 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max_app_version"],
          message:
            "The maximum app version is lower than the minimum, so no build would ever see this announcement.",
        });
      }
    }

    if (value.publish_at && value.expires_at && value.expires_at <= value.publish_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires_at"],
        message: "The expiration time must be after the publish time.",
      });
    }

    if (value.type === "urgent" && !value.expires_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires_at"],
        message:
          "An urgent announcement should have an expiration time, otherwise it stays on screen indefinitely.",
      });
    }
  });

export type AnnouncementInput = z.infer<typeof announcementSchema>;

export interface AnnouncementIssue {
  severity: "error" | "warning";
  message: string;
}

export interface AnnouncementForReview {
  title_en: string;
  body_en: string;
  title_bn: string | null;
  body_bn: string | null;
  type: string;
  target_platform: string;
  min_app_version: string | null;
  max_app_version: string | null;
  publish_at: string | null;
  expires_at: string | null;
}

/**
 * Review shown above the publish confirmation.
 *
 * Note what is *not* claimed: publishing schedules an in-app announcement. This
 * project has no push-notification provider, so nothing here says a
 * notification will be sent.
 */
export function reviewAnnouncementForPublish(
  announcement: AnnouncementForReview,
): AnnouncementIssue[] {
  const issues: AnnouncementIssue[] = [];

  if (!announcement.publish_at) {
    issues.push({
      severity: "error",
      message: "A publish time is required, otherwise the announcement has no defined start.",
    });
  } else if (new Date(announcement.publish_at).getTime() > Date.now()) {
    issues.push({
      severity: "warning",
      message: `This announcement will not be visible until ${announcement.publish_at}.`,
    });
  }

  if (!announcement.expires_at) {
    issues.push({
      severity: "warning",
      message:
        "No expiration time is set, so this announcement stays published until it is archived manually.",
    });
  }

  if ((announcement.min_app_version || announcement.max_app_version) && !announcement.target_platform) {
    issues.push({
      severity: "error",
      message: "A version range needs a target platform.",
    });
  }

  if (!announcement.body_bn || !announcement.title_bn) {
    issues.push({
      severity: "warning",
      message:
        "The Bangla title or body is empty. The app falls back to English, so Bangla-reading users will see English text.",
    });
  }

  if (announcement.body_en.length > 1000) {
    issues.push({
      severity: "warning",
      message: "Long announcements are awkward on a phone. Consider shortening the body.",
    });
  }

  return issues;
}

export function announcementIssuesHaveErrors(issues: AnnouncementIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
