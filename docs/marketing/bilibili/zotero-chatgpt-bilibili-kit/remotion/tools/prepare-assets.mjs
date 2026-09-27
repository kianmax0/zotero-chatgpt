import {copyFile, mkdir, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {DEMO} from '../src/data.js';

const project = path.resolve(import.meta.dirname, '..');
const source = path.resolve(project, '..', 'assets');
const target = path.join(project, 'public', 'assets');

const required = Object.values(DEMO).map(value => value.replace(/^assets\//u, ''));
const svgNames = (await readdir(path.join(source, 'svg'))).filter(name => name.endsWith('.svg'));
required.push(...svgNames.map(name => `svg/${name}`));

const missing = [];
for (const relative of required) {
  const from = path.join(source, relative);
  try {
    if (!(await stat(from)).isFile()) missing.push(relative);
  } catch {
    missing.push(relative);
  }
}
if (missing.length) {
  throw new Error(`Local promo assets are missing from the parent kit's assets directory: ${missing.join(', ')}`);
}

for (const relative of required) {
  const destination = path.join(target, relative);
  await mkdir(path.dirname(destination), {recursive: true});
  await copyFile(path.join(source, relative), destination);
}
console.log(`Prepared ${required.length} local promo assets.`);
