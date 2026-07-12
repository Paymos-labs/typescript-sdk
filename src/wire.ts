type JsonObject = Record<string, unknown>;

export function toWire<T>(value: T): unknown {
  return mapKeys(value, (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));
}

export function fromWire<T>(value: unknown): T {
  return mapKeys(value, (key) => key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())) as T;
}

function mapKeys(value: unknown, rename: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => mapKeys(item, rename));
  if (!isPlainObject(value)) return value;

  const mapped: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const mappedKey = rename(key);
    if (Object.hasOwn(mapped, mappedKey)) {
      throw new TypeError(`Duplicate Paymos field after case conversion: ${mappedKey}`);
    }
    Object.defineProperty(mapped, mappedKey, {
      value: mapKeys(item, rename),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return mapped;
}

function isPlainObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
