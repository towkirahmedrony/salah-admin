/**
 * Small helpers for reading Next.js `searchParams` without scattering
 * `Array.isArray` checks and `Number(...)` casts through every page.
 */

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function readString(
  params: RawSearchParams,
  key: string,
  fallback = "",
): string {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export function readPositiveInt(
  params: RawSearchParams,
  key: string,
  fallback: number,
): number {
  const raw = readString(params, key);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

export function readEnum<T extends string>(
  params: RawSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T | "",
): T | "" {
  const raw = readString(params, key);
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/**
 * Builds a query string while dropping empty values, so filter links stay clean
 * and a cleared filter does not leave `?status=` behind.
 */
export function buildQuery(
  current: RawSearchParams,
  changes: Record<string, string | number | undefined | null>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    if (typeof value === "string" && value.length > 0) {
      params.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === null || value === "") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Page numbers with ellipses, bounded to a predictable width. */
export function pageWindow(
  current: number,
  totalPages: number,
  span = 1,
): Array<number | "gap"> {
  const pages = new Set<number>([1, totalPages, current]);
  for (let offset = 1; offset <= span; offset += 1) {
    if (current - offset > 1) pages.add(current - offset);
    if (current + offset < totalPages) pages.add(current + offset);
  }

  const sorted = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];

  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) result.push("gap");
    result.push(page);
    previous = page;
  }

  return result;
}

export const PAGE_SIZE = 25;

export function rangeFor(page: number, pageSize = PAGE_SIZE): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function totalPagesFor(count: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / pageSize));
}
