import { gui } from '@opencode/plugin/gui/vite'
import { defineConfig } from 'vite'

// vite-plugin-solid compiles the JSX before esbuild runs; matching esbuild's JSX
// mode to the `@jsxImportSource solid-js` pragma in src/gui.tsx keeps it quiet.
// The bundle sits alone in its directory so a desktop app whose own server does
// not run the Kiro plugin (e.g. Windows with a WSL server) can list that
// directory as a GUI-only plugin.
export default defineConfig({
  plugins: [gui({ outFile: 'dist/kiro-desktop/gui-experimental.cjs' })],
  esbuild: { jsx: 'automatic', jsxImportSource: 'solid-js' }
})
