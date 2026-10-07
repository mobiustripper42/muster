/**
 * Joins class strings, dropping the empty ones — every `components/ui` look takes an optional
 * layout `className` on top of its own. One copy: the field, choice and card components each
 * wrote their own until issue #484 part 4.
 */
export function join(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
