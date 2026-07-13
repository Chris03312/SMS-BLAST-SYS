/**
 * normalizePhone — convert local PH numbers to E.164 international format.
 *
 * Rules (in order):
 *  1. Strip whitespace, dashes, parentheses, dots
 *  2. Already starts with '+'   → return as-is
 *  3. Starts with '09'          → '+63' + digits after leading 0   (09171234567 → +639171234567)
 *  4. Starts with '9', 10 digits → '+63' + number                  (9171234567  → +639171234567)
 *  5. Starts with '63'          → '+' + number                     (639171234567 → +639171234567)
 *  6. Anything else             → return as-is and let the gateway decide
 */
export function normalizePhone(raw) {
  const n = String(raw).trim().replace(/[\s\-().;]/g, '');

  if (n.startsWith('+'))               return n;
  if (n.startsWith('09'))              return '+63' + n.slice(1);
  if (n.startsWith('9') && n.length === 10) return '+63' + n;
  if (n.startsWith('63'))              return '+' + n;

  return n;
}
