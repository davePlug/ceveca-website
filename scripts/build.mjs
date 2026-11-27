import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';

const types = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  webp: 'image/webp',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
};

const assets = {};
for (const entry of await readdir('public', { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = entry.parentPath + '/' + entry.name;
  const type = types[entry.name.split('.').pop()];
  if (!type) throw new Error('Unsupported site asset: ' + path);
  assets['/' + path.replace(/^public\//, '')] = {
    type,
    data: (await readFile(path)).toString('base64'),
  };
}

const worker = await readFile('worker/index.js', 'utf8');
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
await writeFile('dist/server/index.js', 'const SITE_ASSETS = ' + JSON.stringify(assets) + ';\n' + worker);
