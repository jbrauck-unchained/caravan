function isObjectLike(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

/**
 * Read only the reviewed own `_tag` data property. Getters, prototypes, raw
 * messages, causes, stacks, and nested vendor values are deliberately ignored.
 */
export function readReviewedErrorTag(value: unknown): string | undefined {
  if (!isObjectLike(value)) return undefined;

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "_tag");
    if (!descriptor || !("value" in descriptor)) return undefined;
    return typeof descriptor.value === "string" ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}
