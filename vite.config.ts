import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Offline support (D38): after a build, list every file the app needs in dist/precache.json and stamp
 * the service worker with a version, so each deploy installs fresh files and drops the old ones.
 */
function precache(): Plugin {
  return {
    name: 'dimensional-precache',
    apply: 'build',
    closeBundle() {
      const dist = 'dist';
      const skip = new Set(['sw.js', '_headers', 'precache.json', 'og-image.png']);
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else {
            const rel = relative(dist, p).replace(/\\/g, '/');
            if (!skip.has(rel)) files.push('/' + rel);
          }
        }
      };
      walk(dist);
      files.sort();
      const sw = join(dist, 'sw.js');
      // the version changes when a file is added, removed or renamed, or when the page or worker changes
      const version = createHash('sha256')
        .update(files.join('\n'))
        .update(readFileSync(sw))
        .update(readFileSync(join(dist, 'index.html')))
        .digest('hex')
        .slice(0, 12);
      writeFileSync(join(dist, 'precache.json'), JSON.stringify({ version, files: files.map((f) => (f === '/index.html' ? '/' : f)) }));
      writeFileSync(sw, readFileSync(sw, 'utf8').replace("'dimensional-dev'", `'dimensional-${version}'`));
    },
  };
}

export default defineConfig({
  plugins: [react(), precache()],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
} as never);
