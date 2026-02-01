/**
 * Checks if a value looks like a valid CUID2 identifier.
 *
 * Expects: a string value.
 * Returns: true if it matches the CUID2 pattern (24-32 lowercase alphanumeric chars).
 */
export function cronCuid2Validate(value: string): boolean {
  return /^[a-z0-9]{24,32}$/.test(value);
}
