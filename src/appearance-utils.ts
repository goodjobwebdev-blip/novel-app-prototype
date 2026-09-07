import type { ThemePalette } from './ui-settings'
export function contrastRatio(left: string, right: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const a = luminance(left), b = luminance(right)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
export function contrastWarnings(palette: ThemePalette) {
  return [
    ['Editor text', palette.text, palette.editor],
    ['Interface text', palette.text, palette.elevated],
    ['Secondary text', palette.muted, palette.elevated],
    ['Selected text', palette.text, palette.selection],
    ['Accent text', palette.accent, palette.editor],
    ['Error text', palette.error, palette.elevated],
  ].map(([label, text, background]) => ({ label, ratio: contrastRatio(text, background) })).filter(item => item.ratio < 4.5)
}
