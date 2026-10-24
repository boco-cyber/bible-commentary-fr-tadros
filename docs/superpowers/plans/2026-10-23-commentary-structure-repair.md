# Commentary Structure Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chapter labels canonical, move author names into attribution fields, recover only evidence-backed verse ranges, normalize extraction artifacts, and interleave verse-specific commentary correctly in both English and Arabic.

**Architecture:** Keep the committed JSONL corpora as the immutable source of truth. Add one deterministic structure module used by the database builder and audit script. The builder derives chapter/section metadata, normalizes display Markdown, creates evidence-backed ranges and chunks, and stores them in schema version 5. The study endpoint consumes chunks for ranged commentary so 2 Kings 6 is no longer a single block after verse 33.

**Tech Stack:** Node 20, Express, better-sqlite3, node:test, markdown-it, sanitize-html.

**Spec:** User requirements captured in this session plus `docs/commentary-audit.json` as the pre-change baseline. No separate design file exists.

## Global Constraints

- Do not edit `data/en/sections.jsonl.gz` or `data/ar/sections.jsonl.gz` by hand. They remain the raw source.
- Never infer a verse range without explicit source evidence. Evidence is an inline `[vN]` marker or a bold paragraph that begins with a verse number and Scripture-like text.
- Canonical chapter labels are exactly `Introduction`, `Chapter N`, `مقدمة`, `الإصحاح N` using Western digits.
- Author names belong in `attribution_en` / `attribution_ar`, not in title fields.
- Normalize display Markdown without deleting substantive prose, tables, footnotes, or references.
- English and Arabic are processed independently. Never pair chunks across languages unless their ranges match exactly.
- Preserve public section IDs and URLs. Add fields; do not remove existing ones. Bump schema version from 4 to 5.
- Rebuild deterministically with `cd backend && npm run build:db` and verify with `cd backend && npm test`.
- Do not commit unless the user explicitly asks.

---

### Task 1: Add the structure and normalization module

**Files:**
- Create: `backend/src/services/section-structure.js`
- Test: `backend/test/section-structure.test.js`

**Interfaces:**
- Consumes: raw Markdown strings and `source_title` values from JSONL rows.
- Produces: `isAttribution(text, lang)`, `isGenericLabel(text)`, `isDescriptiveHeading(text, lang)`, `firstNameDescriptive(values, lang)`, `canonicalChapterTitle(chapter, lang)`, `generatedSectionTitle({ chapter, ranges }, lang)`, `normalizeMarkdown(markdown)`, `deriveVerseRanges(markdown)`, `sectionKind({ chapter, sectionIndex, ranges, chunkCount, attribution })`, `extractOpeningQuote(markdown, verseStart, verseEnd)`.

- [ ] **Step 1: Write the failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAttribution, isGenericLabel, isDescriptiveHeading, firstNameDescriptive,
  canonicalChapterTitle, generatedSectionTitle, normalizeMarkdown,
  deriveVerseRanges, sectionKind, extractOpeningQuote,
} = require('../src/services/section-structure');

test('detects attributions without matching ordinary headings', () => {
  assert.equal(isAttribution('Origen', 'en'), true);
  assert.equal(isAttribution('St. John Chrysostom', 'en'), true);
  assert.equal(isAttribution('Theodoret, Bishop of Cyrus', 'en'), true);
  assert.equal(isAttribution('From the inspiration of 2 Kings 3', 'en'), false);
  assert.equal(isAttribution('العلامة أوريجينوس', 'ar'), true);
  assert.equal(isAttribution('القديس باسيليوس الكبير', 'ar'), true);
  assert.equal(isAttribution('الأبواق الأربعة', 'ar'), false);
});

test('builds canonical chapter titles and rejects weak descriptions', () => {
  assert.equal(canonicalChapterTitle(0, 'en'), 'Introduction');
  assert.equal(canonicalChapterTitle(2, 'en'), 'Chapter 2');
  assert.equal(canonicalChapterTitle(0, 'ar'), 'مقدمة');
  assert.equal(canonicalChapterTitle(2, 'ar'), 'الإصحاح 2');
  assert.equal(isDescriptiveHeading('The Creation of the World', 'en'), true);
  assert.equal(isDescriptiveHeading('1. Spiritual Commandments:', 'en'), false);
  assert.equal(isDescriptiveHeading('Origen', 'en'), false);
  assert.equal(isDescriptiveHeading('Title', 'en'), false);
  assert.equal(isDescriptiveHeading('الأصحاح التاسع', 'ar'), false);
  assert.equal(firstNameDescriptive(['', '1. First', 'The Jar of Oil'], 'en'), 'The Jar of Oil');
});

test('generates specific section titles when the source title is attribution or generic', () => {
  assert.equal(generatedSectionTitle({ chapter: 6, ranges: [[1, 33]] }, 'en'), 'Chapter 6 commentary');
  assert.equal(generatedSectionTitle({ chapter: 6, ranges: [[1, 33]] }, 'ar'), 'تفسير الإصحاح 6');
  assert.equal(generatedSectionTitle({ chapter: 9, ranges: [[4, 4]] }, 'en'), 'Verses 4');
  assert.equal(generatedSectionTitle({ chapter: 9, ranges: [[4, 4]] }, 'ar'), 'الآيات 4');
});

test('normalizes verse markers and escaped bold without removing footnotes', () => {
  const source = '[v1] [v2]\n\n\\*\\*The First Sermon\\*\\* \\[v1-2\\].\n\n\\* Bullet one\\[1023\\].';
  const result = normalizeMarkdown(source);
  assert.doesNotMatch(result, /\[v[12]\]/);
  assert.match(result, /\*\*The First Sermon\*\*/);
  assert.match(result, /^- Bullet one\\\[1023\\\]\./m);
});

test('recovers only evidence-backed ranges from bold opening quotations', () => {
  const en = 'Intro.\n\n** 1 And the sons of the prophets said.**\n\nText.\n\n** 2 Please, let us go.**\n\nText.';
  const ar = 'مقدمة.\n\n** ١ وقال بنو الأنبياء.**\n\nنص.\n\n** ٢ فلنذهب.**\n\nنص.';
  assert.deepEqual(deriveVerseRanges(en), [[1, 2]]);
  assert.deepEqual(deriveVerseRanges(ar), [[1, 2]]);
  assert.deepEqual(deriveVerseRanges('Plain chapter introduction with no verse quotes.'), []);
});

test('classifies section kinds and extracts opening quotes', () => {
  assert.equal(sectionKind({ chapter: 0, sectionIndex: 1, ranges: [], chunkCount: 0, attribution: null }), 'book_introduction');
  assert.equal(sectionKind({ chapter: 2, sectionIndex: 1, ranges: [], chunkCount: 0, attribution: null }), 'chapter_introduction');
  assert.equal(sectionKind({ chapter: 6, sectionIndex: 1, ranges: [[1, 33]], chunkCount: 33, attribution: 'Origen' }), 'verse_commentary');
  assert.equal(sectionKind({ chapter: 2, sectionIndex: 2, ranges: [[3, 5]], chunkCount: 1, attribution: null }), 'shared_commentary');
  const quote = extractOpeningQuote('** 1 And the sons of the prophets said. **\n\nCommentary.', 1, 2);
  assert.equal(quote.verse, 1);
  assert.match(quote.markdown, /sons of the prophets/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test test/section-structure.test.js`
Expected: FAIL with `Cannot find module '../src/services/section-structure'`.

- [ ] **Step 3: Implement the module**

```js
const ARABIC_DIGITS = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};
const EN_ATTRIBUTION = /^(?:St\.?|Saint|Pope|Fr\.?|Father|Bishop|Theodoret|Origen|Tertullian|Irenaeus|Augustine|Chrysostom|Cyril|Ambrose|Jerome|Basil|Gregory|Athanasius|Clement|Eusebius|Hippolytus|Methodius|Caesarius|Didymus|Dionysius|Justin|Melito|Novatian|Prosper|Salvian|Maximus|Nilus|Pachomius|Serapion|Shenouda)(?=$|[\s,.:;-])/i;
const AR_ATTRIBUTION = /^(?:القديس|العلامة|الأب|البابا|الأنبا|مار|المطران|القس|أوريجينوس|أغسطينوس|كيرلس|أثناسيوس|باسيليوس|إيرينيئوس|ترتليان|إكليمنضس|يوسابيوس|أمبروسيوس|جيروم|غريغوريوس|ثيودوريطس)(?=$|[\s،,.:;-])/;
const GENERIC = /^(?:Book Introduction|Chapter Introduction|Section \d+|Title:?|Introduction:?|Intro|مقدمة(?:\s+السفر|\s+الإصحاح)?:?|العنوان:?|الأصحاح(?:\s+[٠-٩0-9]+)?|Chapter\s+\d+|\d+)$/i;
const NUMBERED = /^[٠-٩0-9]+\s*[.)-]/;
const RANGE_HEADING = /^(?:Chapters?|الأصحاحان|الأصحاح|الفصل|القسم|من وحي|From the inspiration)(?=$|[\s،,.:;-])/i;
const BOLD_QUOTE = /^\s*\*\*\s*(?:\[?v?\s*)?([0-9٠-٩۰-۹]{1,3})(?![0-9٠-٩۰-۹])\s+(?!\.)/gm;

function west(value) { return value.replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGITS[digit]); }
function isAttribution(text, lang) {
  const value = String(text || '').trim();
  return (lang === 'ar' ? AR_ATTRIBUTION : EN_ATTRIBUTION).test(value);
}
function isGenericLabel(text) { return GENERIC.test(String(text || '').trim()); }
function isDescriptiveHeading(text, lang) {
  const value = String(text || '').trim();
  return Boolean(value) && !isGenericLabel(value) && !isAttribution(value, lang)
    && !NUMBERED.test(value) && !RANGE_HEADING.test(value);
}
function firstNameDescriptive(values, lang) {
  for (const value of values) if (isDescriptiveHeading(value, lang)) return String(value).trim();
  return null;
}
function canonicalChapterTitle(chapter, lang) {
  if (Number(chapter) === 0) return lang === 'ar' ? 'مقدمة' : 'Introduction';
  return lang === 'ar' ? `الإصحاح ${Number(chapter)}` : `Chapter ${Number(chapter)}`;
}
function generatedSectionTitle({ chapter, ranges }, lang) {
  if (Number(chapter) === 0) return lang === 'ar' ? 'مقدمة السفر' : 'Book Introduction';
  if (ranges.length === 1 && ranges[0][0] === ranges[0][1]) {
    return lang === 'ar' ? `الآيات ${ranges[0][0]}` : `Verses ${ranges[0][0]}`;
  }
  return lang === 'ar' ? `تفسير الإصحاح ${Number(chapter)}` : `Chapter ${Number(chapter)} commentary`;
}
function normalizeMarkdown(markdown) {
  return String(markdown || '')
    .replace(/^\s*\[v[\d٠-٩۰-۹]+(?:\s*[-–]\s*[\d٠-٩۰-۹]+)?\]\s*$/gm, '')
    .replace(/\s*\\?\[v[\d٠-٩۰-۹]+(?:\s*[-–]\s*[\d٠-٩۰-۹]+)?\\?\]/g, '')
    .replace(/\\\*\\\*/g, '**')
    .replace(/^(\s*)\\\*\s+/gm, '$1- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function deriveVerseRanges(markdown) {
  const numbers = [];
  for (const match of String(markdown || '').matchAll(BOLD_QUOTE)) numbers.push(Number(west(match[1])));
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  if (unique.length < 2 || unique[0] > 2) return [];
  for (let i = 1; i < unique.length; i += 1) if (unique[i] <= unique[i - 1]) return [];
  const ranges = [];
  let start = unique[0];
  let end = unique[0];
  for (const verse of unique.slice(1)) {
    if (verse === end + 1) { end = verse; continue; }
    ranges.push([start, end]);
    start = verse;
    end = verse;
  }
  ranges.push([start, end]);
  return ranges;
}
function sectionKind({ chapter, sectionIndex, ranges, chunkCount, attribution }) {
  if (Number(chapter) === 0) return 'book_introduction';
  if (!ranges.length) return 'chapter_introduction';
  if (chunkCount > 1) return 'verse_commentary';
  if (attribution && Number(sectionIndex) === 1 && ranges.length === 1 && ranges[0][0] <= 2) return 'chapter_commentary';
  return 'shared_commentary';
}
function extractOpeningQuote(markdown, verseStart, verseEnd) {
  const paragraphs = String(markdown || '').trim().split(/\n{2,}/);
  for (const paragraph of paragraphs.slice(0, 3)) {
    const match = [...paragraph.matchAll(BOLD_QUOTE)][0];
    if (!match) continue;
    const verse = Number(west(match[1]));
    if (verse < verseStart || verse > verseEnd) continue;
    if (!paragraph.trim().endsWith('**')) continue;
    return { verse, markdown: paragraph.trim() };
  }
  return null;
}

module.exports = {
  isAttribution, isGenericLabel, isDescriptiveHeading, firstNameDescriptive,
  canonicalChapterTitle, generatedSectionTitle, normalizeMarkdown,
  deriveVerseRanges, sectionKind, extractOpeningQuote, westernDigits: west,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test test/section-structure.test.js`
Expected: PASS.

---

### Task 2: Add bold opening quotations as split boundaries

**Files:**
- Modify: `backend/src/services/split-commentary.js`
- Test: `backend/test/split-commentary.test.js`

**Interfaces:**
- Consumes: raw Markdown, explicit `[vN]` markers, and bold Scripture paragraphs that begin with a verse number.
- Produces: unchanged `splitCommentary(markdown, verseStart, verseEnd)` returning chunks with `{ verseStart, verseEnd, markdown }`.

- [ ] **Step 1: Add failing regression tests for 2 Kings 6**

```js
test('splits 2 Kings 6 bold opening quotations in both languages', () => {
  for (const lang of ['en', 'ar']) {
    const row = section(lang, 'ot_12_6:0');
    const chunks = splitCommentary(row.content_markdown, 1, 33);
    assert.equal(chunks.length, 33);
    assert.deepEqual(ranges(chunks), Array.from({ length: 33 }, (_, i) => [i + 1, i + 1]));
    assert.match(chunks[0].markdown, lang === 'en' ? /sons of the prophets/ : /بنو الأنبياء/);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test test/split-commentary.test.js`
Expected: FAIL because `splitCommentary` returns one chunk for 2 Kings 6.

- [ ] **Step 3: Extend marker discovery**

Add beside `MARKER`:

```js
const BOLD_QUOTE = /^\s*\*\*\s*(?:\[?v?\s*)?([0-9٠-٩۰-۹]{1,3})(?![0-9٠-٩۰-۹])\s+(?!\.)/gm;
```

Inside `findMarkers`, after the existing `MARKER` loop and before sorting, add:

```js
for (const match of text.matchAll(BOLD_QUOTE)) {
  const verse = Number(westernDigits(match[1]));
  if (!Number.isInteger(verse) || verse < verseStart || verse > verseEnd) continue;
  const paragraph = paragraphAt(text, match.index);
  candidates.push({ verse, explicit: true, paragraphStart: paragraph.start, paragraphEnd: paragraph.end });
}
```

The existing de-duplication by `paragraphStart` keeps explicit `[vN]` markers and bold quotations from creating duplicate chunks.

- [ ] **Step 4: Run the split tests**

Run: `cd backend && node --test test/split-commentary.test.js`
Expected: PASS, including the existing John 9 and unmarked-gap tests.

---

### Task 3: Build canonical metadata, normalized content, and evidence-backed ranges

**Files:**
- Modify: `backend/scripts/build-db.js`
- Test: `backend/test/build-db.test.js`

**Interfaces:**
- Consumes: Task 1 structure helpers and Task 2 chunker.
- Produces: schema version 5 with `chapters.description_en/ar`, `sections.attribution_en/ar`, `sections.section_kind`, and `commentary_chunks.quote_md/quote_html`.

- [ ] **Step 1: Add failing database assertions**

Replace the old title tests with:

```js
test('chapter titles are canonical and descriptions are separate', () => {
  const db = openDb(DB);
  const genesis = db.prepare("SELECT c.* FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='genesis' AND c.number=1").get();
  assert.equal(genesis.title_en, 'Chapter 1');
  assert.equal(genesis.title_ar, 'الإصحاح 1');
  assert.equal(genesis.description_en, 'The Creation of the World');
  assert.equal(genesis.description_ar, 'خلقة العالم');
  const kings = db.prepare("SELECT c.* FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='1-kings' AND c.number=2").get();
  assert.equal(kings.title_en, 'Chapter 2');
  assert.equal(kings.title_ar, 'الإصحاح 2');
  assert.equal(kings.description_en, null);
  db.close();
});

test('2 Kings 6 has an evidence-backed range and author attribution in both languages', () => {
  const db = openDb(DB);
  const row = db.prepare("SELECT * FROM sections WHERE source_record_id='ot_12_6:0'").get();
  assert.equal(row.title_en, 'Chapter 6 commentary');
  assert.equal(row.title_ar, 'تفسير الإصحاح 6');
  assert.equal(row.attribution_en, 'Origen');
  assert.equal(row.attribution_ar, 'العلامة أوريجينوس');
  assert.equal(row.verse_ranges_json, '[[1,33]]');
  assert.equal(row.section_kind, 'verse_commentary');
  assert.doesNotMatch(row.content_md_en, /\[v\d+\]/);
  assert.doesNotMatch(row.content_md_ar, /\[v[٠-٩]+\]/);
  db.close();
});

test('display content is normalized while raw source files remain unchanged', () => {
  const db = openDb(DB);
  const row = db.prepare("SELECT * FROM sections WHERE source_record_id='ot_1_1:1'").get();
  assert.doesNotMatch(row.content_md_en, /\[v1\]/);
  assert.doesNotMatch(row.content_md_en, /\\\*\\\*/);
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(path.dirname(CATALOG), 'en', 'sections.jsonl.gz'))).toString();
  assert.match(raw, /\[v1\]/);
  db.close();
});
```

Also update `meta` test to `schema_version === '5'` and the new chunk counts `12858` / `12496`.

- [ ] **Step 2: Run the build tests to verify they fail**

Run: `cd backend && npm test -- --test-name-pattern='canonical|2 Kings 6|normalized|meta records'`
Expected: FAIL on missing columns and old titles/counts.

- [ ] **Step 3: Update the schema and inserts**

Change `EXPECTED.schemaVersion` to `5`, `chunksEn` to `12858`, and `chunksAr` to `12496`.

Add to `chapters`:

```sql
description_en TEXT,
description_ar TEXT,
```

Add to `sections`:

```sql
attribution_en TEXT,
attribution_ar TEXT,
section_kind TEXT NOT NULL,
```

Add to `commentary_chunks`:

```sql
quote_md TEXT,
quote_html TEXT,
```

Update the `insertChapter`, `insertSection`, and `insertChunk` statements to include the new columns.

- [ ] **Step 4: Replace title derivation with structure helpers**

At the top of `build-db.js`:

```js
const {
  canonicalChapterTitle, firstNameDescriptive, isAttribution, isGenericLabel,
  generatedSectionTitle, normalizeMarkdown, deriveVerseRanges, sectionKind, extractOpeningQuote,
} = require('../src/services/section-structure');
```

For each chapter:

```js
const sessionTitleEn = firstNameDescriptive(keys.map((key) => en.get(key).source_title), 'en');
const sessionTitleAr = firstNameDescriptive(keys.map((key) => ar.get(key).source_title), 'ar');
const descriptionEn = sessionTitleEn;
const descriptionAr = sessionTitleAr;
insertChapter.run(
  book.id, number, canonicalChapterTitle(number, 'en'), canonicalChapterTitle(number, 'ar'),
  descriptionEn, descriptionAr, keys.length,
);
```

For each section, derive ranges and titles from raw rows, then normalize only display Markdown:

```js
const rawEn = enRow.content_markdown || '';
const rawAr = arRow.content_markdown || '';
const ranges = enRow.verse_ranges?.length ? enRow.verse_ranges : deriveVerseRanges(rawEn);
const attributionEn = isAttribution(enRow.source_title, 'en') ? enRow.source_title.trim() : null;
const attributionAr = isAttribution(arRow.source_title, 'ar') ? arRow.source_title.trim() : null;
const titleEn = !String(enRow.source_title || '').trim() || isAttribution(enRow.source_title, 'en') || isGenericLabel(enRow.source_title)
  ? generatedSectionTitle({ chapter: number, ranges }, 'en') : enRow.source_title.trim();
const titleAr = !String(arRow.source_title || '').trim() || isAttribution(arRow.source_title, 'ar') || isGenericLabel(arRow.source_title)
  ? generatedSectionTitle({ chapter: number, ranges }, 'ar') : arRow.source_title.trim();
const mdEn = normalizeMarkdown(rawEn);
const mdAr = normalizeMarkdown(rawAr);
```

Set `verse_start`/`verse_end` from the first and last derived range when source values are null.

- [ ] **Step 5: Chunk every range and store quote metadata**

Replace the single-range block with:

```js
for (const [lang, raw] of [['en', rawEn], ['ar', rawAr]]) {
  let chunkIndex = 0;
  for (const [start, end] of ranges) {
    const chunks = splitCommentary(raw, start, end);
    for (const chunk of chunks) {
      const markdown = normalizeMarkdown(chunk.markdown);
      if (!markdown) continue;
      const quote = extractOpeningQuote(markdown, chunk.verseStart, chunk.verseEnd);
      const quoteMd = quote ? normalizeMarkdown(quote.markdown) : null;
      const chunkHash = crypto.createHash('sha256')
        .update([contentHash, lang, chunk.verseStart, chunk.verseEnd, markdown].join('\0'))
        .digest('hex');
      insertChunk.run(
        sectionId, book.id, number, lang, chunkIndex++,
        chunk.verseStart, chunk.verseEnd, markdown, renderMarkdown(markdown),
        quoteMd, quoteMd ? renderMarkdown(quoteMd) : null, chunkHash,
      );
      chunkCounts[lang] += 1;
    }
  }
}
```

Compute `section_kind` after chunks:

```js
const kind = sectionKind({
  chapter: number, sectionIndex: enRow.section_index, ranges,
  chunkCount: /* chunks created for this section in this language run */ 0,
  attribution: attributionEn,
});
```

Because the current insert order creates the section first, compute the kind from the expected split across every range:

```js
const estimatedChunkCount = ranges.reduce(
  (count, [start, end]) => count + splitCommentary(rawEn, start, end).length, 0,
);
const kind = sectionKind({
  chapter: number, sectionIndex: enRow.section_index, ranges,
  chunkCount: estimatedChunkCount,
  attribution: attributionEn,
});
```

Insert it with the section.

- [ ] **Step 6: Update the existing corpus-preservation test**

The old test compares stored content byte-for-byte with raw source. Change it to compare normalized source:

```js
const { normalizeMarkdown } = require('../src/services/section-structure');
// inside the loop:
assert.equal(stored[`content_md_${lang}`], normalizeMarkdown(row.content_markdown));
assert.deepEqual(JSON.parse(stored.verse_ranges_json), row.verse_ranges?.length ? row.verse_ranges : require('../src/services/section-structure').deriveVerseRanges(row.content_markdown));
```

Remove the old `pickTitle` test or replace it with a `canonicalChapterTitle` test imported from Task 1.

- [ ] **Step 7: Rebuild and run the database tests**

Run: `cd backend && npm run build:db && npm test -- --test-name-pattern='canonical|2 Kings 6|normalized|meta records|chapter titles|whole rebuilt corpus'`
Expected: PASS with schema version 5 and chunk counts `12858` / `12496`.

---

### Task 4: Interleave commentary chunks in the study endpoint

**Files:**
- Modify: `backend/src/db/queries.js`
- Modify: `backend/src/routes/study.js`
- Modify: `backend/src/services/study.js`
- Test: `backend/test/study.test.js`

**Interfaces:**
- Consumes: `commentary_chunks` rows for a chapter and language.
- Produces: `listChapterChunks(db, chapterId, lang)` and study commentary blocks generated from chunks. Section-level chapter-wide commentary remains a single block.

- [ ] **Step 1: Add failing study regressions**

```js
test('2 Kings 6 study interleaves verse commentary instead of one block at the end', async () => {
  for (const lang of ['en', 'ar']) {
    const res = await request(app).get(`/api/v1/books/2-kings/chapters/6/study?lang=${lang}`);
    assert.equal(res.status, 200);
    const blocks = res.body.data.blocks;
    assert.equal(blocks[0].type, 'verses');
    const commentary = blocks.filter((block) => block.type === 'commentary');
    assert.ok(commentary.length >= 33);
    assert.deepEqual(commentary[0].verse_ranges, [[1, 1]]);
    assert.equal(commentary[0].title[lang], lang === 'en' ? 'Chapter 6 commentary' : 'تفسير الإصحاح 6');
    const verseOne = blocks.findIndex((block) => block.type === 'verses' && block.verses.some((v) => v.number === 1));
    assert.equal(blocks[verseOne + 1].type, 'commentary');
    assert.deepEqual(blocks[verseOne + 1].verse_ranges, [[1, 1]]);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test test/study.test.js --test-name-pattern='2 Kings 6'`
Expected: FAIL because the section is emitted once after verse 33.

- [ ] **Step 3: Add the chunk query**

```js
function listChapterChunks(db, chapterId, lang) {
  return db.prepare(`SELECT bc.*, s.sequence_number, s.section_index, s.section_count,
      s.title_en, s.title_ar, s.attribution_en, s.attribution_ar
    FROM commentary_chunks bc
    JOIN sections s ON s.id = bc.section_id
    WHERE s.chapter_id = ? AND bc.lang = ?
    ORDER BY s.sequence_number, bc.sequence_number`).all(chapterId, lang);
}
```

Export it from `queries.js`.

- [ ] **Step 4: Change the study composer to use chunks**

In `buildStudy`, accept `chunksByLang`. Build ranged commentary from chunks:

```js
const rangedChunks = [];
for (const lang of langs) {
  for (const chunk of chunksByLang[lang] || []) {
    rangedChunks.push({ lang, chunk });
  }
}
```

For each chunk, create a commentary block with `lang`, section id, `chunk_id`, chunk range, section title/attribution, content only for that language, and references for that section. Skip a chunk if the same `chunk_id` was already emitted.

For non-ranged sections (chapter introductions), keep the existing bilingual section block. For sections with ranges but no chunks, fall back to one section block at its range end.

In `study.js` route, fetch chunks per requested language and pass them:

```js
const chunks = {};
for (const language of langs) chunks[language] = listChapterChunks(db, chapter.id, language);
const data = buildStudy({ book, chapter, scripture, sections, chunks, refs, lang, format, baseUrl });
```

- [ ] **Step 5: Update existing study tests**

Update the John 3 block expectations to chunk-level blocks. Keep the chapter introduction as `verse_ranges: []` and bilingual for `lang=both`. For chunked blocks, assert `block.lang` is present and `block.content` contains only that language.

- [ ] **Step 6: Run study and verse-commentary tests**

Run: `cd backend && node --test test/study.test.js test/verse-commentary.test.js`
Expected: PASS.

---

### Task 5: Expose attribution, kinds, descriptions, and opening quotes in the API

**Files:**
- Modify: `backend/src/services/serializer.js`
- Modify: `backend/src/routes/verse-commentary.js`
- Modify: `backend/src/openapi.yaml`
- Test: `backend/test/api.test.js`, `backend/test/verse-commentary.test.js`, `backend/test/docs.test.js`

**Interfaces:**
- Consumes: new columns from Task 3.
- Produces: chapter `description`, section `kind` and `attribution`, chunk `scripture_quote`.

- [ ] **Step 1: Add failing API assertions**

```js
test('chapter payloads expose canonical title and separate description', async () => {
  const res = await request(app).get('/api/v1/books/genesis/chapters/1');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.chapter.title.en, 'Chapter 1');
  assert.equal(res.body.data.chapter.description.en, 'The Creation of the World');
});

test('2 Kings 6 section and verse commentary expose attribution and quote metadata', async () => {
  const section = await request(app).get('/api/v1/books/2-kings/chapters/6/sections/1?lang=en');
  assert.equal(section.body.data.title.en, 'Chapter 6 commentary');
  assert.equal(section.body.data.attribution.en, 'Origen');
  assert.equal(section.body.data.kind, 'verse_commentary');
  const verse = await request(app).get('/api/v1/books/2-kings/chapters/6/verses/1/commentary?lang=en');
  assert.ok(verse.body.data.commentary[0].scripture_quote.markdown.includes('sons of the prophets'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && node --test test/api.test.js test/verse-commentary.test.js --test-name-pattern='canonical title|2 Kings 6'`
Expected: FAIL on undefined fields.

- [ ] **Step 3: Update serializers and routes**

In `chapterDetail`, `bookDetail`, and study chapter objects add:

```js
description: { en: chapter.description_en, ar: chapter.description_ar },
```

In `sectionPayload` add:

```js
kind: row.section_kind,
attribution: { en: row.attribution_en, ar: row.attribution_ar },
```

In `verse-commentary.js`, after selecting a chunk, include:

```js
scripture_quote: chunk.quote_md ? {
  markdown: format === 'html' ? undefined : chunk.quote_md,
  html: format === 'markdown' ? undefined : chunk.quote_html,
} : null,
```

Omit undefined keys. Include `quote_md`/`quote_html` in `findVerseChunks` queries and `listChapterChunks`.

In `buildStudy`, include the same `scripture_quote` on chunk blocks.

- [ ] **Step 4: Update OpenAPI**

Add `description` to `Chapter`, `kind`/`attribution` to `Section`, and `scripture_quote` to `StudyCommentary` and `VerseCommentaryEntry`. Document that `StudyCommentary.id` is the section id and `chunk_id` identifies the exact chunk.

- [ ] **Step 5: Run API/documentation tests**

Run: `cd backend && node --test test/api.test.js test/verse-commentary.test.js test/docs.test.js`
Expected: PASS.

---

### Task 6: Update the audit and documentation

**Files:**
- Modify: `backend/scripts/audit-commentary.js`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DATA.md`
- Modify: `docs/commentary-audit.json` (generated)

**Interfaces:**
- Consumes: Task 1 normalization/range helpers.
- Produces: an audit report that distinguishes canonical titles, attributions, derived ranges, and unlinked chapter introductions.

- [ ] **Step 1: Extend the audit script**

Add counters per language:

```js
const { isAttribution, isGenericLabel, deriveVerseRanges, normalizeMarkdown } = require('../src/services/section-structure');
// inside the row loop:
if (isAttribution(row.source_title, lang)) attributionTitles += 1;
const ranges = row.verse_ranges.length ? row.verse_ranges : deriveVerseRanges(row.content_markdown);
if (!row.verse_ranges.length && ranges.length) derivedRanges += 1;
if (!ranges.length) unlinkedChapterWide += 1;
const displayHash = crypto.createHash('sha256').update(normalizeMarkdown(row.content_markdown)).digest('hex');
```

Include those counts in `report.languages[lang]`. Keep the source comparison against raw `content_markdown` so it still proves the committed source is unchanged.

- [ ] **Step 2: Regenerate the audit report**

Run: `cd backend && node scripts/audit-commentary.js --source-dir '/home/gergo/Downloads/BIBLE COMMENTARY/extracted' > ../docs/commentary-audit.json`
Expected: exit 0 and no `source_mismatches`. The report should show 20 English and 20 Arabic derived-range sections.

- [ ] **Step 3: Update architecture and data docs**

In `docs/ARCHITECTURE.md`:

- Change schema version references from 3/4 to 5.
- Document canonical chapter titles, separate descriptions, attributions, normalized display Markdown, chunk-backed study blocks, and `scripture_quote`.
- Explain that ranges derived only from bold opening Scripture quotations are marked `verse_commentary`; uncertain material remains `chapter_introduction` with `[]`.

In `docs/DATA.md`:

- State that committed JSONL is raw source and display normalization happens in `build-db`.
- Document `attribution_en/ar`, `section_kind`, `description_en/ar`, and quote columns.

- [ ] **Step 4: Run the audit and documentation tests**

Run: `cd backend && node --test test/docs.test.js test/data.test.js`
Expected: PASS.

---

### Task 7: Full rebuild, regression suite, and before/after verification

**Files:**
- No new files. Verification only.

- [ ] **Step 1: Rebuild from scratch**

Run: `cd backend && npm run build:db`
Expected: `built ...: 67 books, 7590 sections, 12858/12496 commentary chunks` with no warnings other than the two expected dropped Luke references.

- [ ] **Step 2: Run the full test suite**

Run: `cd backend && npm test`
Expected: all tests pass, including new regressions for 1 Kings 2 and 2 Kings 6 in both languages.

- [ ] **Step 3: Verify the before/after examples directly against SQLite**

Run:

```bash
cd backend
node - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database('data/commentary.sqlite', { readonly: true });
for (const row of db.prepare(`SELECT c.title_en, c.title_ar, c.description_en, c.description_ar
  FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='1-kings' AND c.number=2`).all()) console.log(row);
for (const row of db.prepare(`SELECT s.title_en, s.title_ar, s.attribution_en, s.attribution_ar,
  s.verse_ranges_json, s.section_kind FROM sections s WHERE s.source_record_id='ot_12_6:0'`).all()) console.log(row);
for (const row of db.prepare(`SELECT lang, COUNT(*) AS chunks FROM commentary_chunks bc
  JOIN sections s ON s.id=bc.section_id WHERE s.source_record_id='ot_12_6:0' GROUP BY lang`).all()) console.log(row);
NODE
```

Expected:

- 1 Kings 2 chapter title is `Chapter 2` / `الإصحاح 2`, description is null, and the first section title remains `1. Spiritual Commandments:`.
- 2 Kings 6 section title is `Chapter 6 commentary` / `تفسير الإصحاح 6`, attribution is `Origen` / `العلامة أوريجينوس`, range is `[[1,33]]`, and kind is `verse_commentary`.
- Both languages produce 33 chunks for 2 Kings 6.

- [ ] **Step 4: Check for remaining artifacts**

Run:

```bash
cd backend
node - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database('data/commentary.sqlite', { readonly: true });
for (const table of ['sections', 'commentary_chunks']) {
  const column = table === 'sections' ? 'content_md_en' : 'content_md';
  const rows = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} LIKE '%[v%'`).get();
  console.log(table, rows.n);
}
NODE
```

Expected: `0` for both. If not zero, inspect the remaining records and extend `normalizeMarkdown` only for the specific marker shape; do not delete prose.

---

## Unresolved cases to report after implementation

- Chapter descriptions remain null when the source only provides author names, numbered subsection headings, or range headings. This is intentional; do not invent a description.
- Sections without explicit `[vN]` markers or sequential bold verse quotations remain `chapter_introduction` with `verse_ranges = []` and appear as chapter-wide commentary.
- The two per-language invalid Luke 4:0 reference segments remain dropped and logged.
- Exodus 36–40 remain empty source gaps.
