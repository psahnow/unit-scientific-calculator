import { type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Which build this is, for the footer: the package version and the commit it was built from. On
 * Cloudflare Pages or GitHub Actions the commit comes from their environment; locally from git, with
 * a + when there are uncommitted changes (so a local build is never mistaken for a released one).
 */
function buildInfo() {
  const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
  const git = (cmd: string) =>
    execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  let full = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '';
  let dirty = false;
  if (!full)
    try {
      full = git('git rev-parse HEAD');
      dirty = git('git status --porcelain') !== '';
    } catch {
      full = '';
    }
  const short = full ? full.slice(0, 7) + (dirty ? '+' : '') : 'dev';
  // a link only for a commit that exists on GitHub as built
  const url = full && !dirty ? `https://github.com/psahnow/unit-scientific-calculator/commit/${full}` : '';
  return { version, short, url };
}
const BUILD = buildInfo();

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
  define: {
    __APP_VERSION__: JSON.stringify(BUILD.version),
    __APP_COMMIT__: JSON.stringify(BUILD.short),
    __APP_COMMIT_URL__: JSON.stringify(BUILD.url),
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
});
