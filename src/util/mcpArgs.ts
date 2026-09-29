/**
 * Fuuz MCP versions disagree on the wire shape of filter/sort arguments: older
 * servers declare `where` / `fieldsWhere` / `orderBy` as a JSON **string**, newer
 * ones (2026.9+) as an **object/array** and reject a string. Rather than keying
 * on a platform version (not reliably exposed), the extension shapes each call
 * from the tool's own `inputSchema`, and flips the shape once when a server
 * without a known schema rejects it. Pure; no VS Code/Node imports.
 */

/** Argument keys whose wire shape varies between MCP versions. */
export const SHAPEABLE_ARGS = ['where', 'fieldsWhere', 'orderBy'] as const;

type Schema = { properties?: Record<string, { type?: string | string[] }> } | undefined;

function declaredTypes(schema: Schema, key: string): string[] {
  const t = schema?.properties?.[key]?.type;
  return Array.isArray(t) ? t : t ? [t] : [];
}

function parsed(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Coerce one value to the declared type; values that already fit, or can't convert, pass through. */
function coerce(value: unknown, types: string[]): unknown {
  if (!types.length || value === undefined || value === null) return value;
  if (typeof value === 'string') {
    if (types.includes('string')) return value;
    const p = parsed(value.trim() || '{}');
    if (Array.isArray(p) ? types.includes('array') : p !== null && typeof p === 'object' && types.includes('object')) return p;
    return value;
  }
  if (typeof value === 'object' && !types.includes(Array.isArray(value) ? 'array' : 'object') && types.includes('string')) {
    return JSON.stringify(value);
  }
  return value;
}

/** Shape `args` to what the tool's `inputSchema` declares. No schema → unchanged. */
export function shapeArgs(args: Record<string, any>, schema?: Schema): Record<string, any> {
  if (!schema?.properties) return args;
  const out = { ...args };
  for (const key of SHAPEABLE_ARGS) {
    if (key in out) out[key] = coerce(out[key], declaredTypes(schema, key));
  }
  return out;
}

/** The opposite wire shape for every shapeable arg (string ↔ object/array). */
export function flipArgs(args: Record<string, any>): Record<string, any> {
  const out = { ...args };
  for (const key of SHAPEABLE_ARGS) {
    const v = out[key];
    if (typeof v === 'string') {
      const p = parsed(v.trim() || '{}');
      if (p !== undefined && typeof p === 'object') out[key] = p;
    } else if (v !== null && typeof v === 'object') {
      out[key] = JSON.stringify(v);
    }
  }
  return out;
}

/** True when a tool response is an input-validation rejection of a shapeable arg. */
export function isArgShapeError(text: string): boolean {
  return /Input validation error/i.test(text) && new RegExp(`\\b(${SHAPEABLE_ARGS.join('|')})\\b`).test(text);
}

/** True when args contain at least one shapeable key (so a flip could change anything). */
export function hasShapeableArgs(args: Record<string, any>): boolean {
  return SHAPEABLE_ARGS.some(k => k in args);
}
