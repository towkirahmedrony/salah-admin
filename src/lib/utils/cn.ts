import clsx, { type ClassValue } from "clsx";

/**
 * Class name joiner. A thin alias over `clsx` so components have one import for
 * conditional styling and the pattern is easy to swap later.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
