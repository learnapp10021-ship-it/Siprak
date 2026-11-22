// Bundel logika bersama (shared/) menjadi gas/Core.gs agar server memakai kode yang SAMA dengan demo lokal.
import { build } from 'esbuild'

await build({
  entryPoints: ['shared/core.js'],
  bundle: true,
  format: 'iife',
  globalName: 'SiprakCore',
  target: 'es2019',
  outfile: 'gas/Core.gs',
  banner: { js: '// FILE HASIL BUILD - jangan diedit. Jalankan: npm run build:gas (sumber: shared/)' },
  legalComments: 'none',
})
console.log('gas/Core.gs dibuat')
