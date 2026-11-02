import { gui } from '@opencode/plugin/gui/vite'
import { defineConfig } from 'vite'

// vite-plugin-solid compiles the JSX before esbuild runs; matching esbuild's JSX
// mode to the `@jsxImportSource solid-js` pragma in src/gui.tsx keeps it quiet.
export default defineConfig({
  plugins: [gui()],
  esbuild: { jsx: 'automatic', jsxImportSource: 'solid-js' }
})
