export function isSingleRowCoerceError(message: string) {
  const text = message.toLowerCase();
  return text.includes("cannot coerce the result to a single json object") || text.includes("json object requested");
}
