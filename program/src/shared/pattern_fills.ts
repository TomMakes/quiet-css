// pattern_fills.ts — CSS background values for blind overlay patterns

function _qcHexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 26, g: 26, b: 46 };
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/** Return a contrasting shade of the given hex color (lighten/darken ~15%). */
function _qcContrastShade(hex: string): string {
  const { r, g, b } = _qcHexToRgb(hex);
  // Luminance numbers were taken from Rec. 601 standards for converting RGB values to light values
  // https://en.wikipedia.org/wiki/Luma_(video)#Rec._601_luma_versus_Rec._709_luma_coefficients
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  // The amount to lighten or darken each color value
  const factor = luminance > 128 ? 0.75 : 1.45;
  const clamp = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
  return `rgb(${clamp(r * factor)}, ${clamp(g * factor)}, ${clamp(b * factor)})`;
}

/**
 * Build a CSS background shorthand for a blind overlay.
 * @param pattern - one of the four pattern keys
 * @param color   - hex fill color for the blind (e.g. "#1a1a2e")
 */
function patternBackground(
  pattern: "none" | "dots" | "diagonal" | "grid",
  color: string,
): string {
  const c = _qcContrastShade(color);
  switch (pattern) {
    case "dots":
      return `radial-gradient(circle, ${c} 1.5px, transparent 1.5px) 0 0 / 10px 10px ${color}`;
    case "diagonal":
      return `repeating-linear-gradient(45deg, ${c} 0px, ${c} 1px, transparent 1px, transparent 8px), ${color}`;
    case "grid":
      return `linear-gradient(${c} 1px, transparent 1px) 0 0 / 10px 10px, linear-gradient(90deg, ${c} 1px, transparent 1px) 0 0 / 10px 10px, ${color}`;
    case "none":
    default:
      return color;
  }
}
