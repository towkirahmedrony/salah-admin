/**
 * App version helpers.
 *
 * Announcements can target a version range, and the same comparison will be
 * needed when the Android app reads remote configuration. A wrong comparison
 * silently hides an announcement from the users who need it, so the parsing is
 * explicit rather than a string comparison: `"1.10.0" < "1.9.0"` is true
 * lexicographically and false in reality.
 */

export type ParsedVersion = readonly [number, number, number];

const VERSION_PATTERN = /^(\d{1,4})(?:\.(\d{1,4}))?(?:\.(\d{1,4}))?$/;

/** Parses "1", "1.2" or "1.2.3". Returns null for anything else. */
export function parseAppVersion(value: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  const patch = Number(match[3] ?? 0);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }
  return [major, minor, patch];
}

/** Returns -1, 0 or 1, or null when either value does not parse. */
export function compareAppVersions(a: string, b: string): number | null {
  const left = parseAppVersion(a);
  const right = parseAppVersion(b);
  if (!left || !right) return null;

  for (let index = 0; index < 3; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

export function isValidAppVersion(value: string): boolean {
  return parseAppVersion(value) !== null;
}

/**
 * Whether `version` falls inside an optional inclusive range.
 *
 * A blank bound means "no bound", which is what an announcer means when they
 * leave the field empty. An unparseable version never matches a bounded range —
 * guessing would risk showing the wrong announcement to the wrong build.
 */
export function isVersionWithinRange(
  version: string | null | undefined,
  min: string | null | undefined,
  max: string | null | undefined,
): boolean {
  if (!min && !max) return true;
  if (!version) return false;

  const parsed = parseAppVersion(version);
  if (!parsed) return false;

  if (min) {
    const minVersion = parseAppVersion(min);
    if (!minVersion) return false;
    if (compareAppVersions(version, min) === -1) return false;
  }

  if (max) {
    const maxVersion = parseAppVersion(max);
    if (!maxVersion) return false;
    if (compareAppVersions(version, max) === 1) return false;
  }

  return true;
}
