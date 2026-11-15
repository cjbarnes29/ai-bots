import { RESULT_OBJECTS, RESULT_OPERATIONS, type ResultSupport } from "../connectors/types.js";

/** Copy only the closed, declarative shape. Missing/malformed metadata is unknown, never inferred from names or descriptions. */
export function copyResultSupport(value: unknown): ResultSupport | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) return undefined;
  const out: { operation: ResultSupport[number]["operation"]; objects: ResultSupport[number]["objects"] }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || !Object.hasOwn(entry, "operation") || !Object.hasOwn(entry, "objects")) return undefined;
    const op = Object.getOwnPropertyDescriptor(entry, "operation"), obj = Object.getOwnPropertyDescriptor(entry, "objects");
    if (!op || !obj || !("value" in op) || !("value" in obj)) return undefined;
    const operation: unknown = op.value, objects: unknown = obj.value;
    if (!(RESULT_OPERATIONS as readonly unknown[]).includes(operation) || !Array.isArray(objects) || objects.length === 0 || objects.length > 32 || objects.some(o => !(RESULT_OBJECTS as readonly unknown[]).includes(o))) return undefined;
    out.push({ operation: operation as ResultSupport[number]["operation"], objects: [...objects] });
  }
  return out;
}
