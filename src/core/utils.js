export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function uniqueStrings(value, allowed) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const output = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowed.includes(item) || output.includes(item)) {
      return null;
    }
    output.push(item);
  }
  return output;
}
