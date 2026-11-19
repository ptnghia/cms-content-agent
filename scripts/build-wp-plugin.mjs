// Package the WordPress plugin: dist/content-agent-<version>.zip (and dist/content-agent.zip)
//   npm run build:wp
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'wordpress');
const version = /Version:\s*([\d.]+)/.exec(readFileSync(path.join(src, 'content-agent', 'content-agent.php'), 'utf8'))[1];
const dist = path.join(root, 'dist');
const out = path.join(dist, `content-agent-${version}.zip`);
mkdirSync(dist, { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-rq', '-X', out, 'content-agent', '-x', '*.DS_Store'], { cwd: src, stdio: 'inherit' });
copyFileSync(out, path.join(dist, 'content-agent.zip'));
console.log(`built ${path.relative(root, out)}`);
