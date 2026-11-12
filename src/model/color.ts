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

/** OKLCH (L 0–1, C ≈ 0–0.37, h degrees) → '#rrggbb', clamped to the sRGB gamut. */
export function oklchToHex(l: number, c: number, h: number): string {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return linearToHex([
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]);
}
