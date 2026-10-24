#!/usr/bin/env node
// Read-only corpus audit. Optional --source-dir compares with the original extraction.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { splitCommentary } = require('../src/services/split-commentary');
const { isAttribution, isGenericLabel, deriveVerseRanges, normalizeMarkdown } = require('../src/services/section-structure');
const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source-dir');
const sourceDir = sourceIndex >= 0 ? args[sourceIndex + 1] : null;
const root = path.join(__dirname, '..', '..', 'data');
const report = { languages: {}, missing_chapters: [] };
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json')));
for (const [lang, directory] of [['en', 'english'], ['ar', 'arabic']]) {
  const rows = zlib.gunzipSync(fs.readFileSync(path.join(root, lang, 'sections.jsonl.gz'))).toString().trim().split('\n').map(JSON.parse);
  const source = sourceDir ? new Map(fs.readFileSync(path.join(sourceDir, directory, 'json', 'sections.jsonl'), 'utf8').trim().split('\n').map((line) => { const row = JSON.parse(line); return [row.source_record_id, row]; })) : null;
  const groups = new Map();
  const mismatches = [];
  let empty = 0, generic = 0, unsupportedAssignmentsRemoved = 0;
  let attributionTitles = 0;
  let derivedRanges = 0;
  let unlinkedChapterWide = 0;
  for (const row of rows) {
    const normalized = row.content_markdown.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    if (!groups.has(hash)) groups.set(hash, []);
    groups.get(hash).push(row.source_record_id);
    if (!normalized) empty++;
    if (/^(Book Introduction|Chapter Introduction|Section \d+)$/.test(row.title) && !row.source_title) generic++;
    if (isAttribution(row.source_title, lang)) attributionTitles += 1;
    const ranges = row.verse_ranges && row.verse_ranges.length ? row.verse_ranges : deriveVerseRanges(row.content_markdown);
    if (!(row.verse_ranges && row.verse_ranges.length) && ranges.length) derivedRanges += 1;
    if (!ranges.length) unlinkedChapterWide += 1;
    const displayHash = crypto.createHash('sha256').update(normalizeMarkdown(row.content_markdown)).digest('hex');
    if (source) {
      const original = source.get(row.source_record_id);
      if (!original || original.content_markdown !== row.content_markdown || JSON.stringify(original.verse_ranges) !== JSON.stringify(row.verse_ranges) || original.source_title !== row.source_title) mismatches.push(row.source_record_id);
    }
    if (row.verse_ranges && row.verse_ranges.length) {
      for (const [start, end] of row.verse_ranges) {
        const chunks = splitCommentary(row.content_markdown, start, end);
        for (let verse = start; verse <= end; verse++) if (!chunks.some((chunk) => verse >= chunk.verseStart && verse <= chunk.verseEnd)) unsupportedAssignmentsRemoved++;
      }
    }
  }
  report.languages[lang] = { records: rows.length, empty_records: empty, normalized_duplicate_groups: [...groups.values()].filter((g) => g.length > 1), generated_titles_without_source_heading: generic, verse_positions_without_individual_chunk: unsupportedAssignmentsRemoved, original_records_compared: source ? source.size : null, source_mismatches: source ? mismatches : null, attribution_titles: attributionTitles, derived_ranges: derivedRanges, unlinked_chapter_wide: unlinkedChapterWide };
  for (const book of catalog.books.filter((b) => !b.excluded_from_commentary)) {
    const present = new Set(rows.filter((r) => r.book_id === book.id).map((r) => r.chapter));
    for (let chapter = 1; chapter <= book.chaptersCount; chapter++) if (!present.has(chapter)) report.missing_chapters.push({ lang, book: book.path_stem.replace(/^\d+-/, ''), chapter });
  }
}
console.log(JSON.stringify(report, null, 2));
if (Object.values(report.languages).some((lang) => lang.empty_records || lang.source_mismatches?.length)) process.exitCode = 1;
