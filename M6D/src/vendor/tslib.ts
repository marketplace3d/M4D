/* Minimal tslib shim for Vite dependency resolution in this workspace. */
export function __assign<T extends object, U extends object>(target: T, source: U): T & U {
  return Object.assign(target, source)
}

export function __rest<T extends object, K extends keyof T>(source: T, exclude: K[]): Omit<T, K> {
  const out: Partial<T> = {}
  for (const key in source) {
    if (!exclude.includes(key as unknown as K)) {
      out[key] = source[key]
    }
  }
  return out as Omit<T, K>
}

export function __spreadArray<T>(to: T[], from: T[]): T[] {
  return to.concat(from)
}
