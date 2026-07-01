import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Code applicatif uniquement : on exclut le build, les assets statiques et les
  // fichiers de configuration outillage (CommonJS, hors périmètre du lint applicatif).
  globalIgnores(['dist', 'public', '*.config.js']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // tsc (noUnusedLocals/Parameters) couvre déjà les variables inutilisées ;
      // la variante TS d'ESLint complète pour les cas que tsc ne voit pas.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      // Règles d'analyse React (react-hooks v7) : en `warn` le temps du refactor
      // Phase 10 (chantier 10.F), puis repassage en `error`. Ne pas supprimer.
      'react-hooks/static-components': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      // Les fichiers ui/* (shadcn) exportent composant + variantes cva : toléré.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
])
