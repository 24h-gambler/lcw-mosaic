/** Connector expressions (docs/07 §2 "접속 표현"), shared by the weekly metrics and the dashboard. */

/** docs/07 §2 connector list (language pack, English): counted in `free` utterances. Longest phrases first. */
export const CONNECTOR_EXPRESSIONS = ['so that', 'instead of', 'because', 'although', 'when', 'if', 'so', 'but', 'that', 'after', 'before'] as const;

/** Occurrences of each connector in one text; "so that" is not also counted as "so" or "that". */
export function countConnectors(text: string): Map<string, number> {
  let t = ` ${text.toLowerCase().replace(/[^a-z']+/g, ' ')} `;
  const out = new Map<string, number>();
  for (const expr of CONNECTOR_EXPRESSIONS) {
    const needle = ` ${expr} `;
    let n = 0;
    let i = t.indexOf(needle);
    while (i >= 0) {
      n++;
      t = `${t.slice(0, i)} ${'#'.repeat(expr.length)} ${t.slice(i + needle.length)}`;
      i = t.indexOf(needle);
    }
    if (n > 0) out.set(expr, n);
  }
  return out;
}
