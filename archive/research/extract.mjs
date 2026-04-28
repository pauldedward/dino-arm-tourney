import { readFileSync, writeFileSync, readdirSync } from 'fs';

const files = readdirSync('research').filter(f => f.match(/^\d{2}-.*\.json$/)).sort();
let out = '# Research Synthesis Source Material\n\n';
for (const f of files) {
  const j = JSON.parse(readFileSync(`research/${f}`, 'utf-8'));
  out += `\n## ${f}\n\n${j.contents || ''}\n`;
}
writeFileSync('research/00-synthesis-input.md', out);
console.log(`Wrote ${out.length} chars`);
