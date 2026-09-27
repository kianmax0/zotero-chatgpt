// Mechanical copy compliance check.
//
// Reads every Chinese string literal out of src/data.js and applies the rules
// the marketing docs committed to. Run alongside every render:
//
//   node tools/copy-check.mjs
//
// Exits non-zero on any violation so it can gate a build.
import {readFileSync} from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const BANNED_WORDS = ['免费', '最强', '颠覆', '必装', '保证', '翻倍', '破解', '白嫖'];
const BANNED_TOPICS = ['账号', '加群', '私信', '扫码', '登录'];
const FIRST_PERSON = ['我'];
const DISCLAIMER = '无隶属或背书关系';

const source = readFileSync(path.join(ROOT, 'src/data.js'), 'utf8');
const strings = [...source.matchAll(/['"`]([^'"`\n]*)['"`]/g)]
  .map((m) => m[1])
  .filter((s) => /[\u4e00-\u9fff]/.test(s));

const failures = [];
const check = (label, ok, detail) => {
  if (!ok) failures.push(`${label}: ${detail}`);
};

check('copy extracted', strings.length > 0, 'no Chinese strings found in src/data.js');

for (const word of BANNED_WORDS) {
  const hit = strings.filter((s) => s.includes(word));
  check(`banned word "${word}"`, hit.length === 0, hit.join(' / '));
}

for (const topic of BANNED_TOPICS) {
  const hit = strings.filter((s) => s.includes(topic));
  check(`banned topic "${topic}"`, hit.length === 0, hit.join(' / '));
}

for (const word of FIRST_PERSON) {
  const hit = strings.filter((s) => s.includes(word));
  check(`first person "${word}"`, hit.length === 0, hit.join(' / '));
}

// Every quota mention must be written as "不碰 / 不占", never as a promise.
const quota = strings.filter((s) => s.includes('额度'));
check('quota mentions found', quota.length > 0, 'expected at least one quota line');
check(
  'quota wording',
  quota.every((s) => s.includes('不碰') || s.includes('不占')),
  quota.join(' / '),
);

check('non-affiliation disclaimer present', strings.some((s) => s.includes(DISCLAIMER)), 'missing');

// The style guide forbids "official plugin" framing even though the official
// ChatGPT *page* can be named.
check(
  'no "official plugin" framing',
  !strings.some((s) => s.includes('官方插件') || /官方[^]{0,6}插件/.test(s)),
  strings.filter((s) => /官方/.test(s)).join(' / '),
);

if (failures.length > 0) {
  console.error('COPY CHECK: FAIL');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}

console.log(`COPY CHECK: PASS — ${strings.length} strings checked`);
console.log(`  banned words: none of ${BANNED_WORDS.join(' / ')}`);
console.log(`  first person: none`);
console.log(`  quota mentions: ${quota.length}, all written as 不碰 / 不占`);
console.log(`  non-affiliation disclaimer: present`);
console.log(`  no "official plugin" framing`);
