/** A class as `instanceof` sees it; a class with a private constructor fits too. */
interface Class<T> {
  readonly prototype: T;
  readonly name: string;
  [Symbol.hasInstance](value: unknown): boolean;
}

/** A value that must be an instance of the class; throws instead of an unchecked cast. */
export function instance<T>(value: unknown, type: Class<T>): T {
  if (!type[Symbol.hasInstance](value)) throw new TypeError(`Not an instance of ${type.name}`);
  return value as T;
}
