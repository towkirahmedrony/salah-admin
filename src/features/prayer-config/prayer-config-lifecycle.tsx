"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { Alert } from "@/components/ui/states";
import { ConfirmSubmitButton } from "@/components/ui/modal";
import {
  INITIAL_PRAYER_CONFIG_ACTION_STATE,
  archivePrayerConfig,
  createDraftFromPrayerConfig,
  deletePrayerConfig,
  publishPrayerConfig,
  type PrayerConfigActionState,
} from "@/features/prayer-config/actions";
import type { RecordStatus } from "@/lib/types/database";

/**
 * The lifecycle controls for one configuration.
 *
 * Each action is a real form post to its own server action, so nothing here depends
 * on client-side gating to be correct — the dialogs only make an accidental click
 * harder. Publishing is confirmed with an explicit acknowledgement, because it is
 * the one action that changes what the Android app would calculate.
 */
export function PrayerConfigLifecycle({
  id,
  name,
  status,
  version,
  canPublish,
}: {
  id: string;
  name: string;
  status: RecordStatus;
  version: number;
  canPublish: boolean;
}) {
  const router = useRouter();

  const [publishState, publishAction] = useActionState<PrayerConfigActionState, FormData>(
    publishPrayerConfig,
    INITIAL_PRAYER_CONFIG_ACTION_STATE,
  );
  const [archiveState, archiveAction] = useActionState<PrayerConfigActionState, FormData>(
    archivePrayerConfig,
    INITIAL_PRAYER_CONFIG_ACTION_STATE,
  );
  const [draftState, draftAction] = useActionState<PrayerConfigActionState, FormData>(
    createDraftFromPrayerConfig,
    INITIAL_PRAYER_CONFIG_ACTION_STATE,
  );
  const [deleteState, deleteAction] = useActionState<PrayerConfigActionState, FormData>(
    deletePrayerConfig,
    INITIAL_PRAYER_CONFIG_ACTION_STATE,
  );

  const states = [publishState, archiveState, draftState, deleteState];
  const error = states.find((state) => state.status === "error" && state.message);
  const success = states.find((state) => state.status === "success" && state.message);

  useEffect(() => {
    const newDraft = draftState.status === "success" && draftState.rowId;
    if (newDraft) {
      router.push(`/prayer-config/${draftState.rowId}`);
      return;
    }
    if (states.some((state) => state.status === "success")) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishState.status, archiveState.status, draftState.status, deleteState.status, draftState.rowId, router]);

  const message = (
    <div className="space-y-3">
      {error ? (
        <Alert tone="error" role="alert" title="Action not completed">
          {error.message}
        </Alert>
      ) : null}
      {success ? (
        <Alert tone="success" title="Done">
          {success.message}
        </Alert>
      ) : null}
    </div>
  );

  if (!canPublish) {
    return (
      <div className="space-y-3">
        <Alert tone="info">
          Your role can view prayer configuration but not change it. Publishing, archiving and editing
          require the prayer configuration capability.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {message}

      <div className="flex flex-wrap items-center gap-2">
        {/* --- publish --- */}
        {status === "draft" ? (
          <form action={publishAction}>
            <input type="hidden" name="id" value={id} />
            <ConfirmSubmitButton
              label="Publish"
              title="Publish this configuration?"
              variant="primary"
              confirmLabel="Publish configuration"
              confirmLabelPending="Publishing…"
              requireCheckboxLabel="I have reviewed the parameters and the source, and I understand this records an administrative review rather than a religious verification."
              description={
                <>
                  <p>
                    <span className="font-medium">{name}</span> — version {version} — will become the
                    published configuration for its location.
                  </p>
                  <p>
                    Any configuration currently published for the same location is archived in the same
                    operation, so the app never sees two live configurations for one place.
                  </p>
                  <p>
                    This does not verify the times against any authority, and nothing changes on a device
                    until the Android app has a configuration sync — it does not have one yet.
                  </p>
                </>
              }
            />
          </form>
        ) : null}

        {/* --- archive --- */}
        {status !== "archived" ? (
          <form action={archiveAction}>
            <input type="hidden" name="id" value={id} />
            <ConfirmSubmitButton
              label="Archive"
              title="Archive this configuration?"
              variant="secondary"
              confirmLabel="Archive configuration"
              confirmLabelPending="Archiving…"
              description={
                <>
                  <p>
                    <span className="font-medium">{name}</span> will no longer be applied as active
                    configuration.
                  </p>
                  <p>
                    It is not deleted: the row stays in the history with its parameters, who reviewed it
                    and when. Archiving is the supported alternative to deletion for a configuration that
                    has been live.
                  </p>
                </>
              }
            />
          </form>
        ) : null}

        {/* --- new draft version --- */}
        {status !== "draft" ? (
          <form action={draftAction}>
            <input type="hidden" name="id" value={id} />
            <ConfirmSubmitButton
              label="Create new draft version"
              title="Create a new draft version?"
              variant="secondary"
              confirmLabel="Create draft"
              confirmLabelPending="Creating…"
              description={
                <>
                  <p>
                    A new draft is created as a copy of <span className="font-medium">{name}</span>, with
                    the next version number. This is the supported way to change a published
                    configuration: the published row is never rewritten, so what the app is using and the
                    record of what it used to be both survive.
                  </p>
                  <p>The published configuration is not affected until the new draft is published.</p>
                </>
              }
            />
          </form>
        ) : null}

        {/* --- delete, drafts only --- */}
        {status === "draft" ? (
          <form action={deleteAction} className="sm:ml-auto">
            <input type="hidden" name="id" value={id} />
            <ConfirmSubmitButton
              label="Delete draft"
              title="Delete this draft?"
              variant="danger"
              confirmLabel="Delete draft"
              confirmLabelPending="Deleting…"
              description={
                <>
                  <p>
                    <span className="font-medium">{name}</span> will be removed permanently. Drafts can be
                    deleted because they have never been applied.
                  </p>
                  <p>
                    Published and archived configurations cannot be deleted — archive them instead, so the
                    history stays intact.
                  </p>
                </>
              }
            />
          </form>
        ) : null}
      </div>
    </div>
  );
}
