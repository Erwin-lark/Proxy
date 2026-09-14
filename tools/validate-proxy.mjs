import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './proxy-manifest.mjs';
import { readbackRelease } from './readback-release.mjs';

const FORBIDDEN = [
  /(?:vless|vmess|trojan|ss|socks5):\/\//i,
  /(?:password|api[_-]?key|private[_-]?key|authorization)\s*[:=]/i,
  /(?:^|[^\d])(?:\d{1,3}\.){3}\d{1,3}(?=$|[^\d])/,
];
const ALLOWED_URL_HOSTS = ['github.com', 'raw.githubusercontent.com', 'docs.github.com', 'core.telegram.org'];

function filesUnder(path) {
  const output = [];
  for (const name of readdirSync(path, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(name.name)) continue;
    const full = join(path, name.name);
    if (name.isDirectory()) output.push(...filesUnder(full));
    else if (name.isFile()) output.push(full);
  }
  return output;
}

function checkText(path, text) {
  for (const pattern of FORBIDDEN) {
    if (pattern.test(text)) {
      if (pattern.source.includes('https?') && ALLOWED_URL_HOSTS.some(host => text.includes(host))) continue;
      throw new Error(`sensitive-looking content in ${path}`);
    }
  }
}

const files = filesUnder(ROOT);
for (const path of files) {
  const relative = path.slice(ROOT.length + 1);
  if (relative.startsWith('releases/') && !relative.endsWith('manifest.json')) continue;
  const stat = statSync(path);
  if (stat.size > 1024 * 1024) throw new Error(`managed file exceeds 1 MiB: ${relative}`);
  checkText(relative, readFileSync(path, 'utf8'));
}
const result = readbackRelease({ root: ROOT, releaseId: 'v1.0' });
console.log(JSON.stringify({ ok: true, checkedFiles: files.length, readback: result }, null, 2));
