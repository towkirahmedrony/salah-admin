/**
 * JSON parsing that keeps number literals exactly as they were written.
 *
 * `JSON.parse` turns `19550.07` into a double. For the provider's prices that is
 * the wrong thing to do twice over: the document is a price list, and the digits
 * in it are the price. The fix here is small and total — quote every number
 * literal before handing the text to `JSON.parse`, so every numeric field comes
 * back as the string that was in the document.
 *
 * The scanner is deliberately strict. It walks the body once, tracks whether it
 * is inside a string (including escapes), and treats a `-` or a digit outside a
 * string as the start of a number. `true`, `false` and `null` contain no digits,
 * so nothing else can be mistaken for a number. A literal in scientific notation
 * is refused rather than converted: guessing what `1.955e4` means to a price feed
 * is not this panel's business, and a feed that needs it is a feed to look at.
 */

export type ExactJson = string | boolean | null | ExactJson[] | { [key: string]: ExactJson };

const NUMBER_LITERAL = /^-?(\d+)(?:\.(\d+))?$/;
const NUMBER_START = /[-0-9]/;

export class ExactJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExactJsonError";
  }
}

/**
 * Parses JSON, preserving every number as its literal text.
 *
 * @throws ExactJsonError when the body is not valid JSON, or contains a numeric
 * literal this panel refuses to interpret.
 */
export function parseJsonWithExactNumbers(body: string): ExactJson {
  const rewritten = quoteNumberLiterals(body);
  try {
    return JSON.parse(rewritten) as ExactJson;
  } catch {
    // The rewritten text is only ever longer than the original by two quote
    // characters per number, so a parse failure here means the original was not
    // valid JSON either.
    throw new ExactJsonError("The response is not valid JSON.");
  }
}

function quoteNumberLiterals(body: string): string {
  let out = "";
  let index = 0;
  let inString = false;

  while (index < body.length) {
    const char = body[index]!;

    if (inString) {
      out += char;
      if (char === "\\") {
        // Copy the escaped character verbatim so `\"` does not end the string.
        out += body[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (char === '"') inString = false;
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
      continue;
    }

    if (NUMBER_START.test(char)) {
      const start = index;
      while (index < body.length && /[-+0-9.eE]/.test(body[index]!)) index += 1;
      const literal = body.slice(start, index);

      if (!NUMBER_LITERAL.test(literal)) {
        throw new ExactJsonError(
          `The response contains the number "${literal}", which is not a plain decimal. This panel will not guess at how to read it.`,
        );
      }

      out += `"${literal}"`;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/** Reads an object property, or `undefined` when the value is not an object. */
export function property(value: ExactJson | undefined, key: string): ExactJson | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as { [key: string]: ExactJson })[key];
}

/** Reads a string property, trimmed; `null` for anything else or an empty string. */
export function stringProperty(value: ExactJson | undefined, key: string): string | null {
  const found = property(value, key);
  if (typeof found !== "string") return null;
  const trimmed = found.trim();
  return trimmed.length > 0 ? trimmed : null;
}
