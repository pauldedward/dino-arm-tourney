#!/usr/bin/env node
import { writeFileSync, readFileSync } from 'fs';

const API_KEY = process.env.VALYU_API_KEY;
const BASE = 'https://api.valyu.ai/v1';

async function answer(query, file) {
  const res = await fetch(`${BASE}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({ query, search_type: 'all', fast_mode: false, data_max_price: 40 })
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!parsed) {
    const lines = text.split('\n').filter(l => l.startsWith('data: '));
    const events = lines.map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
    const contentChunks = events.filter(e => e.content || e.delta).map(e => e.content || e.delta);
    const finalEv = [...events].reverse().find(e => e.contents);
    parsed = finalEv || {
      contents: contentChunks.join(''),
      sources: events.find(e => e.search_results)?.search_results || []
    };
  }
  writeFileSync(file, JSON.stringify(parsed, null, 2));
  console.log(`  -> wrote ${file} (${JSON.stringify(parsed).length} bytes, contents=${(parsed.contents||'').length} chars)`);
}

const queries = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
for (const [q, f] of queries) {
  console.log(`Querying: ${f}`);
  try { await answer(q, f); } catch (e) { console.error(`  FAILED ${f}:`, e.message); }
}
console.log('Done.');
