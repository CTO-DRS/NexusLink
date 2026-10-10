// Convert the web theme's oklch tokens to sRGB hex for the Flutter theme.
function oklchToHex(L, C, H, alpha = 1) {
  const rad = (H * Math.PI) / 180
  const a = C * Math.cos(rad)
  const b = C * Math.sin(rad)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  let bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const enc = (x) => {
    x = Math.min(1, Math.max(0, x))
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
  }
  const to8 = (x) => Math.round(enc(x) * 255)
  const hex = (x) => to8(x).toString(16).padStart(2, "0").toUpperCase()
  return `#${hex(r)}${hex(g)}${hex(bb)}`
}
const light = {
  background: [0.98, 0.006, 180], foreground: [0.22, 0.02, 200], card: [1, 0, 0],
  popover: [1, 0, 0], primary: [0.62, 0.11, 185], primaryFg: [0.99, 0, 0],
  secondary: [0.955, 0.012, 180], secondaryFg: [0.3, 0.03, 200],
  muted: [0.955, 0.012, 180], mutedFg: [0.5, 0.02, 200],
  accent: [0.94, 0.03, 180], accentFg: [0.35, 0.05, 190],
  destructive: [0.577, 0.215, 25], border: [0.9, 0.012, 180],
  input: [0.9, 0.012, 180], ring: [0.62, 0.11, 185], sidebar: [1, 0, 0],
}
const dark = {
  background: [0.17, 0.015, 220], foreground: [0.95, 0.008, 180], card: [0.215, 0.018, 215],
  popover: [0.225, 0.018, 215], primary: [0.7, 0.115, 182], primaryFg: [0.16, 0.02, 220],
  secondary: [0.27, 0.02, 215], secondaryFg: [0.95, 0.008, 180],
  muted: [0.27, 0.02, 215], mutedFg: [0.68, 0.015, 200],
  accent: [0.3, 0.03, 200], accentFg: [0.95, 0.008, 180],
  destructive: [0.65, 0.19, 25], border: [1, 0, 0, 0.10], input: [1, 0, 0, 0.14],
  ring: [0.7, 0.115, 182], sidebar: [0.215, 0.018, 215],
}
console.log("== LIGHT ==")
for (const [k, v] of Object.entries(light)) console.log(k.padEnd(14), oklchToHex(...v))
console.log("== DARK ==")
for (const [k, v] of Object.entries(dark)) console.log(k.padEnd(14), oklchToHex(...v))
