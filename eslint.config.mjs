import tseslint from 'typescript-eslint'

export default [
  { ignores: ['**/node_modules/**', '**/lib/**', '**/.tmp/**', '**/.webnovel/**', '.trellis/**', 'tools/**', 'scripts/evaluation/**'] },
  {
    files: ['packages/**/*.{ts,tsx,mjs}', 'scripts/release/**/*.mjs', 'site/**/*.mjs'],
    languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
    rules: { 'no-debugger': 'error', 'no-constant-binary-expression': 'error', 'no-dupe-args': 'error', 'no-unreachable': 'error', 'no-sparse-arrays': 'error', 'no-unsafe-finally': 'error' },
  },
]
