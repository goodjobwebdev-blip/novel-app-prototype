import { builtInThemes } from './ui-settings'

const replacements = {
  'blue-dark': {
    name: 'Violet Dark',
    palette: {
      background: '#100b19',
      elevated: '#1a1328',
      editor: '#150f21',
      text: '#eee9f5',
      muted: '#aa9dbb',
      border: '#382b4d',
      accent: '#a477d3',
      accentActive: '#c6a4e8',
      selection: '#4b3168',
      error: '#e08d9f',
    },
  },
  'blue-light': {
    name: 'Violet Light',
    palette: {
      background: '#f7f3fb',
      elevated: '#ffffff',
      editor: '#fdfaff',
      text: '#2b1f37',
      muted: '#766784',
      border: '#ddd0e8',
      accent: '#8051ae',
      accentActive: '#63398d',
      selection: '#eadcf5',
      error: '#b94f64',
    },
  },
} as const

for (const theme of builtInThemes) {
  const replacement = replacements[theme.id as keyof typeof replacements]
  if (!replacement) continue
  theme.name = replacement.name
  theme.palette = { ...replacement.palette }
}
