const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
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
  assert.equal(isAttribution('Saint John Chrysostom sees that he refers here to the Christians of the entire province of Achaia and not just the Christians of the city, because all were suffering from the same problem, and all were in need of the same remedy[5].', 'en'), false);
  assert.equal(isAttribution('العلامة أوريجينوس يقول إن هذا النص يشير إلى المسيحيين في كل المقاطعة وليس مدينة واحدة فقط، لأن الجميع كانوا يتألمون من المشكلة ذاتها.', 'ar'), false);
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

test('rejects standalone numerals and range-only labels as descriptions', () => {
  assert.equal(isGenericLabel('٢'), true);
  assert.equal(isGenericLabel('Ch 3-16'), true);
  assert.equal(isGenericLabel('ص ٣-١٦'), true);
  assert.equal(isGenericLabel('الأصحاحات ٢٥-٥٠'), true);
  assert.equal(isGenericLabel('v1-7'), true);
  assert.equal(isDescriptiveHeading('٢', 'ar'), false);
  assert.equal(isDescriptiveHeading('Ch 3-16', 'en'), false);
  assert.equal(isDescriptiveHeading('ص ٣-١٦', 'ar'), false);
  assert.equal(isDescriptiveHeading('الأصحاحات ٢٥-٥٠', 'ar'), false);
  assert.equal(firstNameDescriptive(['Ch 3-16', 'The Jar of Oil'], 'en'), 'The Jar of Oil');
  assert.equal(firstNameDescriptive(['٢', 'دهنة الزيت'], 'ar'), 'دهنة الزيت');
  assert.equal(firstNameDescriptive(['٢'], 'ar'), null);
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

test('preserves paragraph breaks, reference lists, tables, and footnotes', () => {
  const source = [
    'As follows:',
    '',
    '\\[v3\\] from Psalm 42:7;',
    '',
    '\\[v5\\] from Psalm 69:10.',
    '',
    '[v1] [v2]',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    'Footnote\\[1023\\].',
  ].join('\n');
  const result = normalizeMarkdown(source);
  assert.match(result, /As follows:\n\nfrom Psalm 42:7;\n\nfrom Psalm 69:10\./);
  assert.doesNotMatch(result, /\[v[125]\]/);
  assert.match(result, /\| A \| B \|/);
  assert.match(result, /Footnote\\\[1023\\\]\./);
});

test('recovers only evidence-backed ranges from bold opening quotations', () => {
  const en = 'Intro.\n\n** 1 And the sons of the prophets said.**\n\nText.\n\n** 2 Please, let us go.**\n\nText.';
  const ar = 'مقدمة.\n\n** ١ وقال بنو الأنبياء.**\n\nنص.\n\n** ٢ فلنذهب.**\n\nنص.';
  assert.deepEqual(deriveVerseRanges(en), [[1, 2]]);
  assert.deepEqual(deriveVerseRanges(ar), [[1, 2]]);
  assert.deepEqual(deriveVerseRanges('Plain chapter introduction with no verse quotes.'), []);
});

test('accepts v-prefixed verse quotes but rejects numbered book references', () => {
  const en = 'Intro.\n\n**v1: A certain woman cried out.**\n\n** 2 Kings 4:9**\n\n**v2: So Elisha said to her.**';
  const ar = 'مقدمة.\n\n** ١ وقال بنو الأنبياء.**\n\n** ٢ مل ٥: ٩**\n\n** ٣ فلنذهب.**';
  assert.deepEqual(deriveVerseRanges(en), [[1, 2]]);
  assert.deepEqual(deriveVerseRanges(ar), [[1, 1], [3, 3]]);

  const file = path.join(__dirname, '..', '..', 'data', 'en', 'sections.jsonl.gz');
  const rows = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').trim().split('\n').map(JSON.parse);
  const row = rows.find((entry) => entry.source_record_id === 'ot_12_4:0');
  assert.ok(row, 'missing ot_12_4:0');
  assert.deepEqual(deriveVerseRanges(row.content_markdown), [[1, 44]]);
});

test('classifies section kinds and extracts opening quotes', () => {
  assert.equal(sectionKind({ chapter: 0, sectionIndex: 1, ranges: [], chunkCount: 0, attribution: null }), 'book_introduction');
  assert.equal(sectionKind({ chapter: 2, sectionIndex: 1, ranges: [], chunkCount: 0, attribution: null }), 'chapter_introduction');
  assert.equal(sectionKind({ chapter: 6, sectionIndex: 1, ranges: [[1, 33]], chunkCount: 33, attribution: 'Origen' }), 'verse_commentary');
  assert.equal(sectionKind({ chapter: 2, sectionIndex: 2, ranges: [[3, 5]], chunkCount: 1, attribution: null }), 'shared_commentary');
  assert.equal(sectionKind({ chapter: 2, sectionIndex: 1, ranges: [[1, 3]], chunkCount: 1, attribution: 'Origen' }), 'chapter_commentary');
  const quote = extractOpeningQuote('** 1 And the sons of the prophets said. **\n\nCommentary.', 1, 2);
  assert.equal(quote.verse, 1);
  assert.match(quote.markdown, /sons of the prophets/);
});
