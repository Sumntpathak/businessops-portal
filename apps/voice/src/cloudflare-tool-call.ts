/**
 * GLM-4.7-Flash (via Cloudflare Workers AI) occasionally emits tool-call arguments as
 * "<tool_call>name<arg_key>k</arg_key><arg_value>v</arg_value>...</tool_call>" instead of
 * a JSON object string, despite the OpenAI-compatible response schema. Observed on roughly
 * 1 in 5 requests during testing. This recovers a usable object from that shape so callers
 * don't need to retry on a purely cosmetic formatting slip from the model.
 */
export function parseToolCallArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // fall through to the tolerant parser below
  }

  const pairs = [...raw.matchAll(/<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g)];
  if (pairs.length === 0) {
    throw new Error("Tool call arguments were not valid JSON and no <arg_key> pairs were found");
  }

  const result: Record<string, unknown> = {};
  for (const match of pairs) {
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined) continue;
    try {
      result[key] = JSON.parse(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}
