#!/usr/bin/env node
// Import an authorized NKJV JSONL dataset using the existing Arabic Bible schema.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const codes = require('../../data/bible/book-codes.json');
const catalog = require('../../data/catalog.json');

function normalizeScripture(input) {
  const books = new Map(catalog.books.map((book) => [book.path_stem.replace(/^\d+-/, ''), book.chaptersCount]));
  const keys = new Set();
  const rows = input.replace(/^\uFEFF/, '').split('\n').filter((line) => line.trim()).map((line) => {
    const row = JSON.parse(line);
    const book = row.book || codes[row.book_code];
    if (row.translation !== 'NKJV' || !books.has(book) || !Number.isInteger(row.chapter) || row.chapter < 1 || row.chapter > books.get(book)
      || !Number.isInteger(row.verse) || row.verse < 1 || row.verse > 176 || typeof row.text !== 'string' || !row.text.trim()) throw new Error('Invalid NKJV verse');
    const key = `${book}:${row.chapter}:${row.verse}`;
    if (keys.has(key)) throw new Error(`Duplicate verse: ${key}`);
    keys.add(key);
    return { book, chapter: row.chapter, verse: row.verse, text: row.text };
  });
  if (!rows.length) throw new Error('No verses supplied');
  return rows;
}

if (require.main === module) {
  const [file, source] = process.argv.slice(2);
  if (!file || !source) throw new Error('Usage: node scripts/import-scripture.js licensed-nkjv.jsonl "Source and license attribution"');
  const input = fs.readFileSync(file);
  const rows = normalizeScripture(input.toString('utf8'));
  const data = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const directory = path.join(__dirname, '..', '..', 'data', 'bible');
  const target = path.join(directory, 'nkjv.jsonl.gz');
  fs.writeFileSync(target + '.tmp', zlib.gzipSync(data, { level: 9 }));
  fs.renameSync(target + '.tmp', target);
  fs.writeFileSync(path.join(directory, 'nkjv-source.json'), JSON.stringify({ name: 'New King James Version', translation: 'NKJV', language: 'en', source, verses: rows.length, books: new Set(rows.map((row) => row.book)).size, input_sha256: crypto.createHash('sha256').update(input).digest('hex') }, null, 2) + '\n');
  console.log(`Imported ${rows.length} NKJV verses. Restart the API to load the new dataset.`);
}

module.exports = { normalizeScripture };
