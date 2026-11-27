import { describe, expect, it } from 'vitest';
import { instance } from './instance';

class Open {
  readonly n = 1;
}
class Closed {
  private constructor(readonly n: number) {}
  static create = () => new Closed(2);
}

describe('instance', () => {
  it('returns an instance of the class, also of a class with a private constructor', () => {
    const open: unknown = new Open();
    const closed: unknown = Closed.create();
    expect(instance(open, Open).n).toBe(1);
    expect(instance(closed, Closed).n).toBe(2);
  });

  it('throws on a value of another class and names the class', () => {
    expect(() => instance(new Open(), Closed)).toThrow(new TypeError('Not an instance of Closed'));
    expect(() => instance(undefined, Open)).toThrow(TypeError);
  });
});
