const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { splitCommentary } = require('../src/services/split-commentary');

const ROOT = path.join(__dirname, '..', '..');

function section(lang, id) {
  const file = path.join(ROOT, 'data', lang, 'sections.jsonl.gz');
  const rows = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').trim().split('\n').map(JSON.parse);
  const row = rows.find((entry) => entry.source_record_id === id);
  assert.ok(row, `missing ${id}`);
  return row;
}

function ranges(chunks) {
  return chunks.map((chunk) => [chunk.verseStart, chunk.verseEnd]);
}

test('splits John 9:1-7 at each inline verse quote', () => {
  const row = section('en', 'nt_4_9:1');
  const chunks = splitCommentary(row.content_markdown, 1, 7);
  assert.deepEqual(ranges(chunks), [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7]]);
  assert.match(chunks[0].markdown, /Now as Jesus passed by/);
  assert.doesNotMatch(chunks[0].markdown, /And His disciples asked/);
  assert.match(chunks[1].markdown, /And His disciples asked/);
  assert.match(chunks[2].markdown, /Jesus answered/);
  assert.match(chunks[3].markdown, /I must work the works/);
  assert.match(chunks[4].markdown, /As long as I am in the world/);
  assert.match(chunks[5].markdown, /He said this and spat on the ground/);
  assert.match(chunks[6].markdown, /Go, wash in the pool of Siloam/);
  for (const chunk of chunks) {
    assert.doesNotMatch(chunk.markdown, /\[v\d+\]/);
    assert.doesNotMatch(chunk.markdown, /^\[v\d+\]/);
  }
});

test('keeps a section with no inline verse markers as one range chunk', () => {
  const row = section('en', 'ot_1_1:3');
  const chunks = splitCommentary(row.content_markdown, 3, 5);
  assert.deepEqual(ranges(chunks), [[3, 5]]);
  assert.match(chunks[0].markdown, /Then God said, 'Let there be light'/);
  assert.doesNotMatch(chunks[0].markdown, /^\[v3\]/);
});

test('does not extend identified verse comments across unmarked gaps', () => {
  const row = section('en', 'ot_1_4:1');
  const chunks = splitCommentary(row.content_markdown, 1, 7);
  assert.deepEqual(ranges(chunks), [[1, 1], [2, 2], [5, 5], [7, 7]]);
  assert.match(chunks[0].markdown, /Now Adam knew Eve/);
  assert.match(chunks[1].markdown, /Then she bore again/);
  assert.match(chunks[2].markdown, /Cain was very angry/);
  assert.match(chunks[3].markdown, /sin lies at the door/);
});

test('splits Arabic sections using Arabic-Indic verse markers', () => {
  const row = section('ar', 'nt_4_9:1');
  const chunks = splitCommentary(row.content_markdown, 1, 7);
  assert.deepEqual(ranges(chunks), [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7]]);
  assert.match(chunks[0].markdown, /وفيما هو مجتاز/);
  assert.ok(chunks[1].markdown.length > 0);
  assert.notEqual(chunks[0].markdown, chunks[1].markdown);
  for (const chunk of chunks) assert.doesNotMatch(chunk.markdown, /\[v\d+\]/);
});

test('does not split paragraphs or Markdown tables', () => {
  const markdown = [
    '[v1] [v2]',
    '',
    '**"Verse one." \\[v1\\]**',
    '',
    'Commentary one.',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| Alpha | 1 |',
    '',
    '**"Verse two." \\[v2\\]**',
    '',
    'Commentary two.',
  ].join('\n');
  const chunks = splitCommentary(markdown, 1, 2);
  assert.deepEqual(ranges(chunks), [[1, 1], [2, 2]]);
  assert.match(chunks[0].markdown, /\| Name \| Value \|/);
  assert.match(chunks[0].markdown, /\| --- \| --- \|/);
  assert.match(chunks[0].markdown, /\| Alpha \| 1 \|/);
  assert.doesNotMatch(chunks[1].markdown, /\| Name \| Value \|/);
});

test('keeps out-of-range footnote markers while removing verse markers', () => {
  const markdown = [
    '[v1] [v2]',
    '',
    '**"Quote one." \\[v1\\]**',
    '',
    'Commentary one\\[1023\\].',
    '',
    '**"Quote two." \\[v2\\]**',
    '',
    'Commentary two\\[1024\\].',
  ].join('\n');
  const chunks = splitCommentary(markdown, 1, 2);
  assert.deepEqual(ranges(chunks), [[1, 1], [2, 2]]);
  assert.match(chunks[0].markdown, /\\\[1023\\\]/);
  assert.match(chunks[1].markdown, /\\\[1024\\\]/);
});

test('returns one clean chunk when no verse boundaries exist', () => {
  const markdown = '[v1] [v2] [v3]\n\nA continuous essay.\n\nSecond paragraph.';
  const chunks = splitCommentary(markdown, 1, 3);
  assert.deepEqual(ranges(chunks), [[1, 3]]);
  assert.match(chunks[0].markdown, /A continuous essay/);
  assert.doesNotMatch(chunks[0].markdown, /^\[v1\]/);
});

test('returns no chunks when the section body is only verse metadata', () => {
  assert.deepEqual(splitCommentary('[v6] [v9] [v10]', 6, 10), []);
});


test('a single inline marker is never extended across the whole source range', () => {
  const chunks = splitCommentary('**"Verse three." [v3]**\n\nCommentary on three.', 1, 5);
  assert.deepEqual(ranges(chunks), [[3, 3]]);
});

test('splits 2 Kings 6 bold opening quotations in both languages', () => {
  for (const lang of ['en', 'ar']) {
    const row = section(lang, 'ot_12_6:0');
    const chunks = splitCommentary(row.content_markdown, 1, 33);
    assert.equal(chunks.length, 33);
    assert.deepEqual(ranges(chunks), Array.from({ length: 33 }, (_, i) => [i + 1, i + 1]));
    assert.match(chunks[0].markdown, lang === 'en' ? /sons of the prophets/ : /بنو الأنبياء/);
  }
});
