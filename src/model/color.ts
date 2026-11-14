/** '#rrggbb' → linear-light RGB in [0, 1] (sRGB EOTF). */
export function hexToLinear(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}

/** Linear-light RGB → '#rrggbb' (sRGB OETF), clamped to [0, 1]. */
export function linearToHex(lin: readonly number[]): string {
  return (
    '#' +
    lin
      .map((v) => {
        const x = Math.min(1, Math.max(0, v));
        const e = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
        return Math.round(e * 255)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}
