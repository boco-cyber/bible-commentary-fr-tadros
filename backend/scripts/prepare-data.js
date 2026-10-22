#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const readline = require('node:readline');

const SOURCE = process.argv[2] || '/home/gergo/Downloads/BIBLE COMMENTARY/extracted';
const OUT = process.argv[3] || path.join(__dirname, '..', '..', 'data');

const KEEP = [
  'source_record_id', 'book_id', 'book_number', 'testament', 'chapter',
  'sequence_number', 'section_index', 'section_count', 'title', 'source_title',
  'verse_start', 'verse_end', 'verse_ranges', 'content_markdown', 'references',
];

async function readJsonl(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const rows = [];
  for await (const line of rl) if (line.trim()) rows.push(JSON.parse(line));
  return rows;
}

function sortKey(row) {
  return [Number(row.book_number), Number(row.chapter), Number(row.section_index)];
}

async function main() {
  for (const lang of ['en', 'ar']) fs.mkdirSync(path.join(OUT, lang), { recursive: true });
  for (const [lang, dir] of [['en', 'english'], ['ar', 'arabic']]) {
    const rows = await readJsonl(path.join(SOURCE, dir, 'json', 'sections.jsonl'));
    rows.sort((a, b) => {
      const left = sortKey(a);
      const right = sortKey(b);
      return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
    });
    const body = rows.map((row) => {
      const out = {};
      for (const key of KEEP) out[key] = row[key] ?? null;
      return JSON.stringify(out);
    }).join('\n') + '\n';
    fs.writeFileSync(path.join(OUT, lang, 'sections.jsonl.gz'), zlib.gzipSync(Buffer.from(body), { level: 9 }));
    console.log(`${lang}: ${rows.length} records`);
  }
  fs.copyFileSync(path.join(SOURCE, 'metadata', 'catalog.json'), path.join(OUT, 'catalog.json'));
}

main().catch((error) => { console.error(error); process.exit(1); });
