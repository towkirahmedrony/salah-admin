/**
 * Exact decimal handling for reference prices.
 *
 * Prices arrive as JSON numbers from the provider and as strings from an
 * administrator, and they are stored in a PostgreSQL `numeric(12,2)` column. The
 * one thing they must never pass through is a JavaScript `number`: `19550.07` is
 * not exactly representable as a double, and a price that is silently a cent out
 * is exactly the kind of fault that survives review because it looks fine.
 *
 * So a price travels as the *literal digits* it was written with — a string —
 * from the provider response all the way to the parameter of a database
 * function. These helpers do the comparisons that would otherwise invite
 * `Number(...)`, using string arithmetic instead.
 */

/** A plain decimal literal: no sign-optional exponent, no leading `+`, no whitespace. */
const DECIMAL_LITERAL = /^-?(\d+)(?:\.(\d+))?$/;

export function isDecimalLiteral(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_LITERAL.test(value.trim());
}

/** The number of digits after the decimal point, or 0 for an integer. */
export function decimalScale(value: string): number {
  const match = DECIMAL_LITERAL.exec(value.trim());
  return match?.[2]?.length ?? 0;
}

function parts(value: string): { negative: boolean; whole: string; fraction: string } {
  const match = DECIMAL_LITERAL.exec(value.trim());
  if (!match) throw new Error(`"${value}" is not a plain decimal literal.`);
  const negative = value.trim().startsWith("-");
  const whole = match[1]!.replace(/^0+(?=\d)/, "");
  return { negative, whole, fraction: match[2] ?? "" };
}

/** True only for a literal that is strictly greater than zero. */
export function isPositiveDecimal(value: unknown): value is string {
  if (!isDecimalLiteral(value)) return false;
  const { negative, whole, fraction } = parts(value);
  if (negative) return false;
  return /[1-9]/.test(whole + fraction);
}

/**
 * Compares two decimal literals exactly. Returns -1, 0 or 1.
 *
 * Used to show whether a candidate is above or below the rate it would replace —
 * the single most useful thing a reviewer can see, and not worth getting wrong by
 * a floating-point ulp.
 */
export function compareDecimals(left: string, right: string): number {
  const a = parts(left);
  const b = parts(right);

  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const magnitude = compareMagnitude(a, b);
  return a.negative ? -magnitude : magnitude;
}

function compareMagnitude(
  a: { whole: string; fraction: string },
  b: { whole: string; fraction: string },
): number {
  if (a.whole.length !== b.whole.length) return a.whole.length < b.whole.length ? -1 : 1;
  if (a.whole !== b.whole) return a.whole < b.whole ? -1 : 1;

  const width = Math.max(a.fraction.length, b.fraction.length);
  const left = a.fraction.padEnd(width, "0");
  const right = b.fraction.padEnd(width, "0");
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * True when `value` has no more than `scale` decimal places.
 *
 * A price with more precision than the column holds is refused rather than
 * rounded: silently rounding 19550.075 to 19550.08 changes a price an
 * administrator typed, without telling them.
 */
export function hasAtMostScale(value: string, scale: number): boolean {
  return decimalScale(value) <= scale;
}
