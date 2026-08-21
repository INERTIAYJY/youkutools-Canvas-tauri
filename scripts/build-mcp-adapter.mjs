import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(projectRoot, 'src-tauri', 'resources', 'ai-canvas-mcp.mjs');

await mkdir(dirname(outfile), { recursive: true });
const result = await build({
  entryPoints: [resolve(projectRoot, 'scripts', 'ai-canvas-mcp.mjs')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  minifyWhitespace: true,
  sourcemap: false,
  legalComments: 'none',
  write: false,
});

const bundled = result.outputFiles[0]?.text;
if (!bundled) throw new Error('MCP 适配器构建没有产生输出');
await writeFile(outfile, bundled.replace(/[ \t]+$/gm, ''), 'utf8');
