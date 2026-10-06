// Authoritative palette tokens. pages.test.mjs recomputes WCAG contrast for every pair.
export const DEFAULT_PALETTE = 'A'

export const PALETTES = {
  A: {
    name: '黛蓝宣纸',
    light: { bg: '#f6f4ee', bgAlt: '#edeae2', panel: '#fffefb', text: '#1e2430', soft: '#576072', line: '#dfdbd0', link: '#2a4a80', accent: '#2f4f86', accentStrong: '#233d6a', onAccent: '#ffffff', mark: '#8c5616', code: '#ece9e1', note: '#2f5f9e', tip: '#2e7352', important: '#5d4a9a', warning: '#8a5800', caution: '#a8382c' },
    dark: { bg: '#10141c', bgAlt: '#141a24', panel: '#181e29', text: '#e4e7ec', soft: '#9aa3b2', line: '#2a3140', link: '#9dbcf0', accent: '#8fb0e8', accentStrong: '#aec7f0', onAccent: '#0f1420', mark: '#e0b36a', code: '#1f2633', note: '#86aee8', tip: '#79c79f', important: '#b5a3ea', warning: '#e3b450', caution: '#ef8f82' },
  },
  B: {
    name: '墨与朱印',
    light: { bg: '#f8f5ef', bgAlt: '#f0ebe2', panel: '#fffdf8', text: '#22201c', soft: '#5f5a52', line: '#e2dbcf', link: '#2b5573', accent: '#a83a2a', accentStrong: '#8b2e21', onAccent: '#ffffff', mark: '#a83a2a', code: '#efe9df', note: '#2b5573', tip: '#3d6e4a', important: '#6a4a8c', warning: '#8a5800', caution: '#9c2b3a' },
    dark: { bg: '#161514', bgAlt: '#1b1a18', panel: '#201f1c', text: '#ebe6dd', soft: '#a59e92', line: '#34312c', link: '#8fb8d4', accent: '#e07b62', accentStrong: '#ea9781', onAccent: '#1a1310', mark: '#e89a85', code: '#2a2825', note: '#8fb8d4', tip: '#8cc59a', important: '#c3a6e6', warning: '#e3b450', caution: '#f08aa0' },
  },
  C: {
    name: '松烟竹青',
    light: { bg: '#f6f5f0', bgAlt: '#ecede6', panel: '#fefefb', text: '#1f2421', soft: '#59615b', line: '#dcdfd6', link: '#2a6450', accent: '#2f6b55', accentStrong: '#24533f', onAccent: '#ffffff', mark: '#8a5e1f', code: '#ebece5', note: '#2f5f8a', tip: '#2f6b55', important: '#5d4a9a', warning: '#8a5800', caution: '#a8382c' },
    dark: { bg: '#141816', bgAlt: '#181d1a', panel: '#1d2320', text: '#e4e8e4', soft: '#9ba59e', line: '#2c3430', link: '#93cdb2', accent: '#86c2a6', accentStrong: '#a3d4bd', onAccent: '#10201a', mark: '#d9b071', code: '#232a26', note: '#8ab4dc', tip: '#86c2a6', important: '#b5a3ea', warning: '#e3b450', caution: '#ef8f82' },
  },
}

export const PALETTE_KEYS = Object.keys(PALETTES.A.light)
