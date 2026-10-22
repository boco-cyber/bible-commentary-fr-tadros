# Bible Commentary API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a public, read-only, bilingual REST API for Fr. Tadros Y. Malaty's Bible commentary using Node.js, Express, and SQLite/FTS5.

**Architecture:** One Node 20 service serves `/api/v1` from a read-only SQLite database built at Docker build time from two gzipped JSONL files. Arabic and English sections are joined on `source_record_id`; FTS5 provides bilingual search; Coolify hosts the image and GitHub Actions releases it.

**Tech Stack:** Node.js 20, Express 4, better-sqlite3, FTS5, markdown-it, sanitize-html, supertest, Docker, Coolify, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-22-bible-commentary-api-design.md`

## Global Constraints

- Node.js 20; CommonJS; Express 4.
- Runtime DB access is read-only; no admin, auth, or write endpoints.
- Public base path `/api/v1`; health `/health`; docs `/docs` and `/openapi.json`.
- 67 books, 7,590 section records per language; chapter `0` is the book introduction.
- Exodus 36–40 are source gaps and must be returned as unavailable chapters.
- Join key is `source_record_id`; reference lists are stored per language.
- Arabic normalization: NFKC, strip tashkeel/superscript alef/tatweel, `أإآٱ→ا`, `ى→ي`, `ة→ه`, collapse whitespace.
- Attribution: `Fr. Tadros Y. Malaty / القمص تادرس يعقوب`.
- Tests use `node --test`, no network, under 10 seconds after the DB build.
- Never commit `node_modules/`, `.env`, or `*.sqlite`.
- Commit after every task.

---

## File Structure

```text
Dockerfile
.github/workflows/ci.yml
.github/workflows/deploy.yml
backend/
  package.json
  .env.example
  scripts/lib/jsonl.js
  scripts/prepare-data.js
  scripts/build-db.js
  src/app.js
  src/server.js
  src/config.js
  src/db/connection.js
  src/db/queries.js
  src/routes/{index,meta,catalog,chapters,sections,parallel,references,search}.js
  src/services/{normalize,plain-text,render,search,serializer}.js
  src/middleware/{errors,rate-limit}.js
  src/openapi.yaml
  test/{data,build-db,references,search-index,api,references-api,search,docs,hardening}.test.js
  test/helpers/db.js
data/{catalog.json,attribution.json,en/sections.jsonl.gz,ar/sections.jsonl.gz}
docs/{API.md,ARCHITECTURE.md,DEPLOYMENT.md}
README.md, LICENSE, NOTICE
```

---

### Task 1: API scaffold and health endpoint

**Files:**
- Create: `backend/package.json`, `backend/.gitignore`, `backend/.env.example`
- Create: `backend/src/app.js`, `backend/test/health.test.js`

**Interfaces:**
- Produces: `createApp(db)` returns an Express app; `GET /health` returns `{ status: "ok", service: "bible-commentary-fr-tadros" }`.

- [ ] **Step 1: Write the failing test**

```js
// backend/test/health.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('GET /health returns ok', async () => {
  const res = await request(createApp(null)).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok', service: 'bible-commentary-fr-tadros' });
});

test('unknown route returns JSON 404', async () => {
  const res = await request(createApp(null)).get('/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test test/health.test.js`
Expected: FAIL with `Cannot find module '../src/app'`.

- [ ] **Step 3: Write the minimal implementation**

`backend/package.json`:

```json
{
  "name": "bible-commentary-fr-tadros",
  "version": "1.0.0",
  "private": true,
  "description": "Public bilingual Bible commentary API for Fr. Tadros Y. Malaty",
  "main": "src/server.js",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "build:db": "node scripts/build-db.js",
    "test": "node --test"
  },
  "dependencies": {
    "better-sqlite3": "^11.7.0",
    "compression": "^1.7.5",
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "express-rate-limit": "^7.4.1",
    "helmet": "^8.0.0",
    "js-yaml": "^4.1.0",
    "markdown-it": "^14.1.0",
    "morgan": "^1.10.0",
    "sanitize-html": "^2.13.1",
    "swagger-ui-express": "^5.0.1"
  },
  "devDependencies": {
    "nodemon": "^3.1.7",
    "supertest": "^7.0.0"
  }
}
```

`backend/.gitignore`:

```gitignore
node_modules/
data/*.sqlite
test/.tmp/
.env
*.log
.DS_Store
```

`backend/.env.example`:

```dotenv
PORT=3000
DB_PATH=./data/commentary.sqlite
CORS_ORIGINS=*
RATE_LIMIT_PER_MIN=120
SITE_NAME=Bible Commentary — Fr. Tadros Malaty
PUBLIC_BASE_URL=https://commentary.copticfaith.org
NODE_ENV=development
```

`backend/src/app.js`:

```js
const express = require('express');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'bible-commentary-fr-tadros' });
  });

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 4: Install and verify**

Run: `cd backend && npm install && node --test test/health.test.js`
Expected: PASS, 2 tests; `package-lock.json` created.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/.gitignore backend/.env.example backend/src/app.js backend/test/health.test.js
git commit -m "feat: scaffold commentary API with health endpoint"
```

---

### Task 2: Prepare committed bilingual data

**Files:**
- Create: `backend/scripts/lib/jsonl.js`, `backend/scripts/prepare-data.js`
- Create: `backend/test/data.test.js`
- Generate: `data/en/sections.jsonl.gz`, `data/ar/sections.jsonl.gz`, `data/catalog.json`
- Create: `data/attribution.json`

**Interfaces:**
- Produces: `readJsonlGz(file)` async generator; trimmed JSONL records; 73-book catalog.

- [ ] **Step 1: Write the failing data test**

```js
// backend/test/data.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readJsonlGz } = require('../scripts/lib/jsonl');

const DATA = path.join(__dirname, '..', '..', 'data');

async function load(lang) {
  const rows = [];
  for await (const row of readJsonlGz(path.join(DATA, lang, 'sections.jsonl.gz'))) rows.push(row);
  return rows;
}

test('both languages contain 7,590 trimmed unique records', async () => {
  for (const lang of ['en', 'ar']) {
    const rows = await load(lang);
    assert.equal(rows.length, 7590);
    assert.equal(new Set(rows.map((r) => r.source_record_id)).size, 7590);
    assert.equal(new Set(rows.map((r) => r.book_id)).size, 67);
    assert.equal('content_raw' in rows[0], false);
    assert.ok(fs.statSync(path.join(DATA, lang, 'sections.jsonl.gz')).size < 100 * 1024 * 1024);
  }
});

test('English and Arabic record keys match', async () => {
  const en = new Set((await load('en')).map((r) => r.source_record_id));
  const ar = new Set((await load('ar')).map((r) => r.source_record_id));
  assert.equal(en.size, ar.size);
  for (const key of en) assert.ok(ar.has(key), `missing Arabic key ${key}`);
});

test('catalog has 73 books with 67 included', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(DATA, 'catalog.json'), 'utf8'));
  assert.equal(catalog.books.length, 73);
  assert.equal(catalog.books.filter((b) => !b.excluded_from_commentary).length, 67);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test test/data.test.js`
Expected: FAIL with missing module or data files.

- [ ] **Step 3: Implement the preparation pipeline**

`backend/scripts/lib/jsonl.js`:

```js
const fs = require('node:fs');
const zlib = require('node:zlib');
const readline = require('node:readline');

async function* readJsonlGz(file) {
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line);
  }
}

module.exports = { readJsonlGz };
```

`backend/scripts/prepare-data.js`:

```js
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
```

`data/attribution.json`:

```json
{
  "author": { "en": "Fr. Tadros Y. Malaty", "ar": "القمص تادرس يعقوب" },
  "work": { "en": "Bible Commentary", "ar": "تفسير الكتاب المقدس" },
  "notice": "Commentary text is published for use on copticfaith.org with the permission of the rights holder. The repository's MIT license covers code only, not the commentary text.",
  "source": "Coptic Commentaries app (authorId=ty) English and Arabic databases"
}
```

- [ ] **Step 4: Generate data and run tests**

Run: `cd backend && node scripts/prepare-data.js && node --test test/data.test.js`
Expected: PASS, 3 tests; both gzip files are under 100 MB.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/lib/jsonl.js backend/scripts/prepare-data.js backend/test/data.test.js data
git commit -m "feat: add trimmed bilingual commentary data and preparation script"
```

---

### Task 3: SQLite core (books, chapters, sections, HTML)

**Files:**
- Create: `backend/src/services/render.js`, `plain-text.js`, `normalize.js`
- Create: `backend/src/db/connection.js`
- Create: `backend/scripts/build-db.js`
- Create: `backend/test/build-db.test.js`
- Modify: `backend/package.json` (add `pretest`)

**Interfaces:**
- Produces: `renderMarkdown(md)`, `markdownToPlain(md)`, `normalizeForSearch(text)`, `openDb(file)`, `buildDb({ dataDir, outFile })`; tables `meta`, `books`, `chapters`, `sections`.

- [ ] **Step 1: Write the failing build test**

```js
// backend/test/build-db.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openDb } = require('../src/db/connection');

const DB = process.env.TEST_DB || path.join(__dirname, '.tmp', 'commentary.sqlite');

test('build contains all books, sections, and introductions', () => {
  const db = openDb(DB);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM books').get().n, 67);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sections').get().n, 7590);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chapters WHERE number = 0').get().n, 67);
  assert.equal(db.prepare("SELECT section_count AS n FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='genesis' AND c.number=1").get().n, 9);
  db.close();
});

test('missing Exodus 36-40 are present but empty', () => {
  const db = openDb(DB);
  const rows = db.prepare("SELECT number, section_count FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='exodus' AND number BETWEEN 36 AND 40 ORDER BY number").all();
  assert.deepEqual(rows.map((r) => r.number), [36, 37, 38, 39, 40]);
  assert.ok(rows.every((r) => r.section_count === 0));
  db.close();
});

test('sections contain both languages and safe HTML', () => {
  const db = openDb(DB);
  const row = db.prepare("SELECT * FROM sections WHERE source_record_id='ot_1_1:0'").get();
  assert.equal(row.title_en, 'Chapter Introduction');
  assert.ok(row.content_md_en.includes('Creation'));
  assert.ok(row.content_md_ar.length > 0);
  assert.ok(row.content_html_en.includes('<p>'));
  assert.equal(/<script/i.test(row.content_html_en), false);
  assert.equal(row.content_hash.length, 64);
  db.close();
});

test('meta records schema and counts', () => {
  const db = openDb(DB);
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
  assert.equal(meta.schema_version, '1');
  assert.equal(meta.sections, '7590');
  assert.equal(meta.books, '67');
  db.close();
});
```

- [ ] **Step 2: Add pretest and confirm failure**

Add to `backend/package.json`: `"pretest": "node scripts/build-db.js --out test/.tmp/commentary.sqlite"`.

Run: `cd backend && node --test test/build-db.test.js`
Expected: FAIL with missing `scripts/build-db.js`.

- [ ] **Step 3: Implement shared services and connection**

`backend/src/services/render.js`:

```js
const MarkdownIt = require('markdown-it');
const sanitizeHtml = require('sanitize-html');

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
const allowedTags = sanitizeHtml.defaults.allowedTags.concat([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'hr', 'del', 'ins', 'sup', 'sub', 'mark',
]);

function renderMarkdown(markdown) {
  return sanitizeHtml(md.render(markdown || ''), {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) },
  });
}

module.exports = { renderMarkdown };
```

`backend/src/services/plain-text.js`:

```js
function markdownToPlain(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~|>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { markdownToPlain };
```

`backend/src/services/normalize.js`:

```js
function normalizeForSearch(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { normalizeForSearch };
```

`backend/src/db/connection.js`:

```js
const Database = require('better-sqlite3');

function openDb(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return db;
}

module.exports = { openDb };
```

- [ ] **Step 4: Implement the core build script**

`backend/scripts/build-db.js`:

```js
#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { readJsonlGz } = require('./lib/jsonl');
const { renderMarkdown } = require('../src/services/render');

const EXPECTED = { books: 67, sections: 7590 };
const DEFAULT_DATA = path.join(__dirname, '..', '..', 'data');

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE books (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, book_number INTEGER NOT NULL,
  testament TEXT NOT NULL, name_en TEXT NOT NULL, name_ar TEXT NOT NULL,
  short_en TEXT, short_ar TEXT, chapters_expected INTEGER NOT NULL
);
CREATE TABLE chapters (
  id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES books(id),
  number INTEGER NOT NULL, title_en TEXT, title_ar TEXT,
  section_count INTEGER NOT NULL, UNIQUE (book_id, number)
);
CREATE TABLE sections (
  id INTEGER PRIMARY KEY, source_record_id TEXT NOT NULL UNIQUE,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  sequence_number INTEGER NOT NULL, section_index INTEGER NOT NULL,
  section_count INTEGER NOT NULL, title_en TEXT, title_ar TEXT,
  verse_start INTEGER, verse_end INTEGER, verse_ranges_json TEXT NOT NULL,
  content_md_en TEXT NOT NULL, content_md_ar TEXT NOT NULL,
  content_html_en TEXT NOT NULL, content_html_ar TEXT NOT NULL,
  content_hash TEXT NOT NULL, UNIQUE (chapter_id, section_index)
);
CREATE INDEX idx_chapters_book ON chapters(book_id, number);
CREATE INDEX idx_sections_chapter ON sections(chapter_id, sequence_number);
`;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = args.indexOf('--out');
  const data = args.indexOf('--data-dir');
  return {
    outFile: path.resolve(out >= 0 ? args[out + 1] : path.join(DEFAULT_DATA, 'commentary.sqlite')),
    dataDir: path.resolve(data >= 0 ? args[data + 1] : DEFAULT_DATA),
  };
}

function hashContent(titleEn, titleAr, mdEn, mdAr) {
  return crypto.createHash('sha256').update([titleEn, titleAr, mdEn, mdAr].join('\0')).digest('hex');
}

async function loadMap(file) {
  const map = new Map();
  for await (const row of readJsonlGz(file)) map.set(row.source_record_id, row);
  return map;
}

async function buildDb({ dataDir, outFile }) {
  const catalog = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'));
  const included = catalog.books.filter((book) => !book.excluded_from_commentary);
  if (included.length !== EXPECTED.books) throw new Error(`Expected ${EXPECTED.books} books, got ${included.length}`);

  const en = await loadMap(path.join(dataDir, 'en', 'sections.jsonl.gz'));
  const ar = await loadMap(path.join(dataDir, 'ar', 'sections.jsonl.gz'));
  if (en.size !== EXPECTED.sections || ar.size !== EXPECTED.sections) {
    throw new Error(`Expected ${EXPECTED.sections} sections per language, got ${en.size}/${ar.size}`);
  }
  for (const key of en.keys()) if (!ar.has(key)) throw new Error(`Missing Arabic record ${key}`);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.rmSync(outFile, { force: true });
  const db = new Database(outFile);
  db.exec(SCHEMA);

  const insertBook = db.prepare(`INSERT INTO books
    (id, slug, book_number, testament, name_en, name_ar, short_en, short_ar, chapters_expected)
    VALUES (@id, @slug, @book_number, @testament, @name_en, @name_ar, @short_en, @short_ar, @chapters_expected)`);
  const insertChapter = db.prepare(`INSERT INTO chapters
    (book_id, number, title_en, title_ar, section_count) VALUES (?, ?, ?, ?, ?)`);
  const insertSection = db.prepare(`INSERT INTO sections
    (source_record_id, chapter_id, sequence_number, section_index, section_count,
     title_en, title_ar, verse_start, verse_end, verse_ranges_json,
     content_md_en, content_md_ar, content_html_en, content_html_ar, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  let inserted = 0;
  const byBookChapter = new Map();
  for (const [key, row] of en) {
    const group = `${row.book_id}:${row.chapter}`;
    if (!byBookChapter.has(group)) byBookChapter.set(group, []);
    byBookChapter.get(group).push(key);
  }
  for (const keys of byBookChapter.values()) keys.sort((a, b) => Number(en.get(a).section_index) - Number(en.get(b).section_index));

  const transaction = db.transaction(() => {
    for (const book of included) {
      insertBook.run({
        id: book.id,
        slug: book.path_stem.replace(/^\d+-/, ''),
        book_number: book.book_number,
        testament: book.testament,
        name_en: book.englishName,
        name_ar: book.name,
        short_en: book.englishShortName,
        short_ar: book.shortName,
        chapters_expected: book.chaptersCount,
      });

      for (let number = 0; number <= book.chaptersCount; number += 1) {
        const keys = byBookChapter.get(`${book.id}:${number}`) || [];
        const first = keys.length ? en.get(keys[0]) : null;
        const firstAr = keys.length ? ar.get(keys[0]) : null;
        const titleEn = first ? first.title || `Chapter ${number}` : number === 0 ? 'Introduction' : `Chapter ${number}`;
        const titleAr = firstAr ? firstAr.title || `الإصحاح ${number}` : number === 0 ? 'مقدمة' : `الإصحاح ${number}`;
        const info = insertChapter.run(book.id, number, titleEn, titleAr, keys.length);
        const chapterId = Number(info.lastInsertRowid);

        for (const key of keys) {
          const enRow = en.get(key);
          const arRow = ar.get(key);
          const mdEn = enRow.content_markdown || '';
          const mdAr = arRow.content_markdown || '';
          if (!mdEn || !mdAr) throw new Error(`Empty content for ${key}`);
          const infoSection = insertSection.run(
            key, chapterId, Number(enRow.sequence_number), Number(enRow.section_index), Number(enRow.section_count),
            enRow.title, arRow.title,
            enRow.verse_start == null ? null : Number(enRow.verse_start),
            enRow.verse_end == null ? null : Number(enRow.verse_end),
            JSON.stringify(enRow.verse_ranges || []),
            mdEn, mdAr, renderMarkdown(mdEn), renderMarkdown(mdAr),
            hashContent(enRow.title || '', arRow.title || '', mdEn, mdAr),
          );
          if (!infoSection.changes) throw new Error(`Failed to insert ${key}`);
          inserted += 1;
        }
      }
    }
    const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    setMeta.run('schema_version', '1');
    setMeta.run('built_at', new Date().toISOString());
    setMeta.run('books', String(included.length));
    setMeta.run('sections', String(inserted));
    setMeta.run('attribution', 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب');
  });
  transaction();
  db.close();
  return { books: included.length, sections: inserted };
}

if (require.main === module) {
  const options = parseArgs();
  buildDb(options)
    .then((result) => console.log(`built ${options.outFile}: ${result.books} books, ${result.sections} sections`))
    .catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { buildDb, EXPECTED };
```

- [ ] **Step 5: Build and verify**

Run: `cd backend && npm test`
Expected: PASS; `pretest` builds `test/.tmp/commentary.sqlite`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services backend/src/db/connection.js backend/scripts/build-db.js backend/test/build-db.test.js backend/package.json
git commit -m "feat: build SQLite core with joined bilingual sections and safe HTML"
```

---

### Task 4: Per-language scripture references

**Files:**
- Modify: `backend/scripts/build-db.js`
- Create: `backend/test/references.test.js`

**Interfaces:**
- Produces: `section_refs(section_id, lang, ref_type, book_id, chapter, verse_start, verse_end, label, display, raw_token)`; meta keys `ref_segments_en`, `ref_segments_ar`.

- [ ] **Step 1: Write the failing test**

```js
// backend/test/references.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openDb } = require('../src/db/connection');

const DB = process.env.TEST_DB || path.join(__dirname, '.tmp', 'commentary.sqlite');

test('reference segments are stored per language', () => {
  const db = openDb(DB);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM section_refs WHERE lang='en'").get().n, 43327);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM section_refs WHERE lang='ar'").get().n, 45235);
  db.close();
});

test('a known reference is queryable', () => {
  const db = openDb(DB);
  const row = db.prepare(`SELECT sr.* FROM section_refs sr
    WHERE sr.book_id=73 AND sr.chapter=20 AND sr.verse_start=2 AND sr.lang='en' LIMIT 1`).get();
  assert.ok(row);
  assert.equal(row.ref_type, 'single');
  assert.ok(row.label.startsWith('Revelation'));
  db.close();
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && npm test`
Expected: FAIL with `no such table: section_refs`.

- [ ] **Step 3: Implement reference insertion**

Add to the `SCHEMA` string:

```sql
CREATE TABLE section_refs (
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  lang TEXT NOT NULL CHECK (lang IN ('en','ar')),
  ref_type TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse_start INTEGER NOT NULL,
  verse_end INTEGER NOT NULL,
  label TEXT NOT NULL,
  display TEXT NOT NULL,
  raw_token TEXT NOT NULL
);
CREATE INDEX idx_refs_target ON section_refs(book_id, chapter, verse_start, verse_end);
CREATE INDEX idx_refs_section ON section_refs(section_id, lang);
```

Add near the other prepared statements:

```js
const insertRef = db.prepare(`INSERT INTO section_refs
  (section_id, lang, ref_type, book_id, chapter, verse_start, verse_end, label, display, raw_token)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const refCounts = { en: 0, ar: 0 };
```

After `insertSection.run(...)`, capture its id and insert refs:

```js
const sectionId = Number(infoSection.lastInsertRowid);
for (const [lang, row] of [['en', enRow], ['ar', arRow]]) {
  for (const ref of row.references || []) {
    for (const segment of ref.segments || []) {
      insertRef.run(
        sectionId, lang, ref.type || 'single', Number(ref.book_id),
        Number(segment.chapter), Number(segment.verse_start), Number(segment.verse_end),
        ref.label || '', ref.display_text || ref.label || '', ref.raw_token || '',
      );
      refCounts[lang] += 1;
    }
  }
}
```

Before `transaction();`, validate and store derived meta:

```js
if (refCounts.en !== 43327 || refCounts.ar !== 45235) {
  throw new Error(`Unexpected reference segment counts: ${refCounts.en}/${refCounts.ar}`);
}
```

Inside the meta block add:

```js
setMeta.run('ref_segments_en', String(refCounts.en));
setMeta.run('ref_segments_ar', String(refCounts.ar));
```

- [ ] **Step 4: Rebuild and verify**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/build-db.js backend/test/references.test.js
git commit -m "feat: store per-language scripture reference segments"
```

---

### Task 5: FTS5 indexes with Arabic normalization

**Files:**
- Modify: `backend/scripts/build-db.js`
- Create: `backend/test/search-index.test.js`

**Interfaces:**
- Produces: `sections_plain_en`, `sections_plain_ar`, `sections_fts_en`, `sections_fts_ar`; normalized Arabic indexed text.

- [ ] **Step 1: Write the failing test**

```js
// backend/test/search-index.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openDb } = require('../src/db/connection');
const { normalizeForSearch } = require('../src/services/normalize');

const DB = process.env.TEST_DB || path.join(__dirname, '.tmp', 'commentary.sqlite');

test('English FTS finds creation commentary', () => {
  const db = openDb(DB);
  const rows = db.prepare('SELECT rowid FROM sections_fts_en WHERE sections_fts_en MATCH ? LIMIT 5').all('"creation"');
  assert.ok(rows.length > 0);
  db.close();
});

test('Arabic FTS matches with and without diacritics', () => {
  const db = openDb(DB);
  const plain = normalizeForSearch('الخليقة');
  assert.equal(plain, 'الخليقه');
  const rows = db.prepare('SELECT rowid FROM sections_fts_ar WHERE sections_fts_ar MATCH ? LIMIT 5').all(`"${plain}"`);
  assert.ok(rows.length > 0);
  assert.equal(normalizeForSearch('الْخَلِيقَة'), plain);
  db.close();
});

test('plain bodies contain no markdown or raw markup', () => {
  const db = openDb(DB);
  const row = db.prepare('SELECT body FROM sections_plain_en LIMIT 1').get();
  assert.equal(/\*\*|\{\{|^#/m.test(row.body), false);
  db.close();
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && npm test`
Expected: FAIL with `no such table: sections_fts_en`.

- [ ] **Step 3: Implement plain tables and FTS**

Add imports:

```js
const { markdownToPlain } = require('../src/services/plain-text');
const { normalizeForSearch } = require('../src/services/normalize');
```

Add to `SCHEMA`:

```sql
CREATE TABLE sections_plain_en (
  id INTEGER PRIMARY KEY REFERENCES sections(id), title TEXT NOT NULL, body TEXT NOT NULL
);
CREATE TABLE sections_plain_ar (
  id INTEGER PRIMARY KEY REFERENCES sections(id), title TEXT NOT NULL, body TEXT NOT NULL
);
CREATE VIRTUAL TABLE sections_fts_en USING fts5(
  title, body, content='sections_plain_en', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE sections_fts_ar USING fts5(
  title, body, content='sections_plain_ar', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
```

Add prepared statements:

```js
const insertPlainEn = db.prepare('INSERT INTO sections_plain_en (id, title, body) VALUES (?, ?, ?)');
const insertPlainAr = db.prepare('INSERT INTO sections_plain_ar (id, title, body) VALUES (?, ?, ?)');
```

Inside the section loop, after inserting refs:

```js
insertPlainEn.run(sectionId, normalizeForSearch(enRow.title || ''), normalizeForSearch(markdownToPlain(mdEn)));
insertPlainAr.run(sectionId, normalizeForSearch(arRow.title || ''), normalizeForSearch(markdownToPlain(mdAr)));
```

After `transaction();` and before `db.close();`:

```js
db.exec("INSERT INTO sections_fts_en(sections_fts_en) VALUES('rebuild')");
db.exec("INSERT INTO sections_fts_ar(sections_fts_ar) VALUES('rebuild')");
```

- [ ] **Step 4: Rebuild and verify**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/build-db.js backend/test/search-index.test.js
git commit -m "feat: build bilingual FTS5 indexes with Arabic normalization"
```

---

### Task 6: Catalog and chapter routes

**Files:**
- Create: `backend/src/config.js`, `backend/src/db/queries.js`
- Create: `backend/src/services/serializer.js`
- Create: `backend/src/middleware/errors.js`
- Create: `backend/src/routes/{meta,catalog,chapters,index}.js`
- Create: `backend/src/server.js`
- Modify: `backend/src/app.js`
- Create: `backend/test/helpers/db.js`, `backend/test/api.test.js`

**Interfaces:**
- Produces: `listBooks`, `findBook`, `listChapters`, `findChapter`, `listSectionSummaries`; `bookSummary`, `bookDetail`, `chapterDetail`; `/api/v1/meta`, `/books`, `/books/:book`, `/books/:book/chapters/:chapter`; `/health` with DB counts.

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/helpers/db.js
const path = require('node:path');
const { openDb } = require('../../src/db/connection');

function openTestDb() {
  return openDb(process.env.TEST_DB || path.join(__dirname, '..', '.tmp', 'commentary.sqlite'));
}

module.exports = { openTestDb };
```

```js
// backend/test/api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 10000 });
test.after(() => db.close());

test('meta describes the corpus', async () => {
  const res = await request(app).get('/api/v1/meta');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.books, 67);
  assert.equal(res.body.data.sections, 7590);
  assert.deepEqual(res.body.data.languages, ['en', 'ar']);
  assert.match(res.body.data.attribution, /Tadros/);
});

test('books can be filtered by testament', async () => {
  assert.equal((await request(app).get('/api/v1/books')).body.data.length, 67);
  assert.equal((await request(app).get('/api/v1/books?testament=nt')).body.data.length, 27);
  assert.equal((await request(app).get('/api/v1/books?testament=x')).status, 400);
});

test('book detail lists chapters including the introduction', async () => {
  const res = await request(app).get('/api/v1/books/genesis');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.slug, 'genesis');
  assert.equal(res.body.data.chapters[0].number, 0);
  assert.equal(res.body.data.chapters.find((c) => c.number === 1).section_count, 9);
});

test('missing Exodus chapters are marked unavailable', async () => {
  const res = await request(app).get('/api/v1/books/exodus');
  const chapter = res.body.data.chapters.find((c) => c.number === 37);
  assert.equal(chapter.available, false);
  assert.equal(chapter.section_count, 0);
});

test('chapter detail returns ordered section summaries', async () => {
  const res = await request(app).get('/api/v1/books/genesis/chapters/1');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.chapter.section_count, 9);
  assert.equal(res.body.data.sections[0].index, 1);
  assert.equal('content' in res.body.data.sections[0], false);
});

test('unknown book returns 404 JSON', async () => {
  const res = await request(app).get('/api/v1/books/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && npm test`
Expected: FAIL with 404 for `/api/v1/meta`.

- [ ] **Step 3: Implement config, errors, queries, serializers, routes**

`backend/src/config.js`:

```js
const path = require('node:path');

module.exports = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'commentary.sqlite'),
  corsOrigins: process.env.CORS_ORIGINS || '*',
  rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN || 120),
  siteName: process.env.SITE_NAME || 'Bible Commentary — Fr. Tadros Malaty',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://commentary.copticfaith.org',
};
```

`backend/src/middleware/errors.js`:

```js
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  const code = error.code || 'INTERNAL_ERROR';
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: { code, message: status >= 500 ? 'Internal server error' : error.message },
  });
}

module.exports = { HttpError, notFoundHandler, errorHandler };
```

`backend/src/db/queries.js`:

```js
const { HttpError } = require('../middleware/errors');

function listBooks(db, testament) {
  const sql = `SELECT * FROM books ${testament ? 'WHERE testament = ?' : ''} ORDER BY book_number`;
  return testament ? db.prepare(sql).all(testament) : db.prepare(sql).all();
}

function findBook(db, idOrSlug) {
  const numeric = /^\d+$/.test(String(idOrSlug));
  const row = numeric
    ? db.prepare('SELECT * FROM books WHERE id = ?').get(Number(idOrSlug))
    : db.prepare('SELECT * FROM books WHERE slug = ?').get(String(idOrSlug));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Book not found');
  return row;
}

function listChapters(db, bookId) {
  return db.prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY number').all(bookId);
}

function findChapter(db, bookId, number) {
  const row = db.prepare('SELECT * FROM chapters WHERE book_id = ? AND number = ?').get(bookId, number);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Chapter not found');
  return row;
}

function listSectionSummaries(db, chapterId) {
  return db.prepare(`SELECT id, section_index, title_en, title_ar, verse_ranges_json
    FROM sections WHERE chapter_id = ? ORDER BY sequence_number`).all(chapterId);
}

module.exports = { listBooks, findBook, listChapters, findChapter, listSectionSummaries };
```

`backend/src/services/serializer.js`:

```js
function bookSummary(row) {
  return {
    id: row.id,
    slug: row.slug,
    book_number: row.book_number,
    testament: row.testament,
    name: { en: row.name_en, ar: row.name_ar },
    short: { en: row.short_en, ar: row.short_ar },
    chapters_expected: row.chapters_expected,
  };
}

function bookDetail(row, chapters) {
  return {
    ...bookSummary(row),
    chapters: chapters.map((chapter) => ({
      number: chapter.number,
      title: { en: chapter.title_en, ar: chapter.title_ar },
      section_count: chapter.section_count,
      available: chapter.section_count > 0,
    })),
  };
}

function chapterDetail(book, chapter, sections) {
  return {
    book: bookSummary(book),
    chapter: {
      number: chapter.number,
      title: { en: chapter.title_en, ar: chapter.title_ar },
      section_count: chapter.section_count,
      available: chapter.section_count > 0,
    },
    sections: sections.map((section) => ({
      id: section.id,
      index: section.section_index,
      title: { en: section.title_en, ar: section.title_ar },
      verse_ranges: JSON.parse(section.verse_ranges_json),
    })),
  };
}

module.exports = { bookSummary, bookDetail, chapterDetail };
```

`backend/src/routes/meta.js`:

```js
const express = require('express');

function metaRouter() {
  const router = express.Router();
  router.get('/meta', (req, res) => {
    const db = req.app.locals.db;
    const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((row) => [row.key, row.value]));
    res.json({
      data: {
        name: 'Bible Commentary — Fr. Tadros Y. Malaty',
        attribution: 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب',
        books: Number(meta.books),
        sections: Number(meta.sections),
        ref_segments: { en: Number(meta.ref_segments_en), ar: Number(meta.ref_segments_ar) },
        languages: ['en', 'ar'],
        schema_version: Number(meta.schema_version),
        build: meta.built_at,
      },
    });
  });
  return router;
}

module.exports = { metaRouter };
```

`backend/src/routes/catalog.js`:

```js
const express = require('express');
const { listBooks, findBook, listChapters } = require('../db/queries');
const { bookSummary, bookDetail } = require('../services/serializer');

function catalogRouter() {
  const router = express.Router();

  router.get('/books', (req, res) => {
    const testament = req.query.testament;
    if (testament && !['ot', 'nt'].includes(testament)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'testament must be ot or nt' } });
    }
    res.json({ data: listBooks(req.app.locals.db, testament).map(bookSummary) });
  });

  router.get('/books/:book', (req, res) => {
    const db = req.app.locals.db;
    const book = findBook(db, req.params.book);
    res.json({ data: bookDetail(book, listChapters(db, book.id)) });
  });

  return router;
}

module.exports = { catalogRouter };
```

`backend/src/routes/chapters.js`:

```js
const express = require('express');
const { findBook, findChapter, listSectionSummaries } = require('../db/queries');
const { chapterDetail } = require('../services/serializer');

function parseChapter(value) {
  if (value === 'intro') return 0;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function chaptersRouter() {
  const router = express.Router();
  router.get('/books/:book/chapters/:chapter', (req, res) => {
    const db = req.app.locals.db;
    const book = findBook(db, req.params.book);
    const number = parseChapter(req.params.chapter);
    if (number === null) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid chapter' } });
    }
    const chapter = findChapter(db, book.id, number);
    res.json({ data: chapterDetail(book, chapter, listSectionSummaries(db, chapter.id)) });
  });
  return router;
}

module.exports = { chaptersRouter, parseChapter };
```

`backend/src/routes/index.js`:

```js
const express = require('express');
const { metaRouter } = require('./meta');
const { catalogRouter } = require('./catalog');
const { chaptersRouter } = require('./chapters');

function apiRouter() {
  const router = express.Router();
  router.use(metaRouter());
  router.use(catalogRouter());
  router.use(chaptersRouter());
  return router;
}

module.exports = { apiRouter };
```

Update `backend/src/app.js`:

```js
const express = require('express');
const config = require('./config');
const { apiRouter } = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

function createApp(db, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.locals.db = db;
  app.locals.options = { ...config, ...options };

  app.get('/health', (req, res) => {
    const body = { status: 'ok', service: 'bible-commentary-fr-tadros' };
    if (db) {
      const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((row) => [row.key, row.value]));
      body.books = Number(meta.books);
      body.sections = Number(meta.sections);
      body.build = meta.built_at;
    }
    res.json(body);
  });

  app.use('/api/v1', apiRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
```

`backend/src/server.js`:

```js
const config = require('./config');
const { openDb } = require('./db/connection');
const { createApp } = require('./app');

const db = openDb(config.dbPath);
const app = createApp(db);
const server = app.listen(config.port, () => console.log(`commentary API listening on ${config.port}`));

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => { db.close(); process.exit(0); });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test/api.test.js backend/test/helpers/db.js
git commit -m "feat: add meta, catalog, and chapter API routes"
```

---

### Task 7: Section routes, formats, and caching

**Files:**
- Create: `backend/src/routes/sections.js`
- Modify: `backend/src/db/queries.js`, `backend/src/services/serializer.js`
- Modify: `backend/src/routes/index.js`, `backend/test/api.test.js`

**Interfaces:**
- Produces: `findSectionById`, `findSectionByIndex`, `listSectionRefs`, `sectionPayload`; `GET /sections/:id`, `GET /books/:book/chapters/:chapter/sections/:index`; strong ETag, immutable cache headers, 304.

- [ ] **Step 1: Append failing tests to `backend/test/api.test.js`**

```js
test('section by chapter and index returns content and refs', async () => {
  const res = await request(app).get('/api/v1/books/genesis/chapters/1/sections/1?lang=en');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.source_id, 'ot_1_1:0');
  assert.ok(res.body.data.content.html.includes('<p>'));
  assert.ok(res.body.data.content.markdown.length > 0);
  assert.ok(Array.isArray(res.body.data.references));
  assert.equal(res.headers.etag, `"${res.body.data.content_hash}"`);
  assert.match(res.headers['cache-control'], /immutable/);
});

test('section supports markdown-only and Arabic responses', async () => {
  const res = await request(app).get('/api/v1/sections/1?lang=ar&format=markdown');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.content.html, undefined);
  assert.ok(res.body.data.content.markdown.length > 0);
  assert.equal(res.body.data.lang, 'ar');
});

test('matching If-None-Match returns 304', async () => {
  const first = await request(app).get('/api/v1/sections/1');
  const second = await request(app).get('/api/v1/sections/1').set('If-None-Match', first.headers.etag);
  assert.equal(second.status, 304);
});

test('unknown chapter and index return 404', async () => {
  assert.equal((await request(app).get('/api/v1/books/genesis/chapters/999')).status, 404);
  assert.equal((await request(app).get('/api/v1/books/genesis/chapters/1/sections/999')).status, 404);
});

test('invalid language and format return 400', async () => {
  assert.equal((await request(app).get('/api/v1/sections/1?lang=fr')).status, 400);
  assert.equal((await request(app).get('/api/v1/sections/1?format=pdf')).status, 400);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && npm test`
Expected: FAIL with 404 for section routes.

- [ ] **Step 3: Implement queries, serializer, route**

Add to `backend/src/db/queries.js`:

```js
function findSectionById(db, id) {
  return db.prepare('SELECT * FROM sections WHERE id = ?').get(Number(id)) || null;
}

function findSectionByIndex(db, chapterId, index) {
  return db.prepare('SELECT * FROM sections WHERE chapter_id = ? AND section_index = ?').get(chapterId, index) || null;
}

function listSectionRefs(db, sectionId, lang) {
  return db.prepare(`SELECT ref_type, book_id, chapter, verse_start, verse_end, label, display, raw_token
    FROM section_refs WHERE section_id = ? AND lang = ? ORDER BY id`).all(sectionId, lang);
}
```

Export all query functions.

Add to `backend/src/services/serializer.js`:

```js
function sectionPayload(row, book, chapter, refs, lang, format, baseUrl) {
  const content = {};
  if (format === 'markdown' || format === 'both') content.markdown = row[`content_md_${lang}`];
  if (format === 'html' || format === 'both') content.html = row[`content_html_${lang}`];
  return {
    id: row.id,
    source_id: row.source_record_id,
    lang,
    book: bookSummary(book),
    chapter: { number: chapter.number, title: { en: chapter.title_en, ar: chapter.title_ar } },
    index: row.section_index,
    section_count: row.section_count,
    title: { [lang]: lang === 'ar' ? row.title_ar : row.title_en },
    verse_ranges: JSON.parse(row.verse_ranges_json),
    content,
    references: refs.map((ref) => ({
      type: ref.ref_type, book_id: ref.book_id, chapter: ref.chapter,
      verse_start: ref.verse_start, verse_end: ref.verse_end,
      label: ref.label, display: ref.display,
    })),
    content_hash: row.content_hash,
    url: `${baseUrl}/api/v1/sections/${row.id}`,
  };
}

module.exports = { bookSummary, bookDetail, chapterDetail, sectionPayload };
```

`backend/src/routes/sections.js`:

```js
const express = require('express');
const { findBook, findChapter, findSectionById, findSectionByIndex, listSectionRefs } = require('../db/queries');
const { sectionPayload } = require('../services/serializer');
const { parseChapter } = require('./chapters');

function parseLanguage(value) {
  const lang = value || 'en';
  return ['en', 'ar'].includes(lang) ? lang : null;
}

function parseFormat(value) {
  const format = value || 'html';
  return ['html', 'markdown', 'both'].includes(format) ? format : null;
}

function sendSection(req, res, section) {
  const db = req.app.locals.db;
  const lang = parseLanguage(req.query.lang);
  const format = parseFormat(req.query.format);
  if (!lang || !format) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid lang or format' } });
  }
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(section.chapter_id);
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(chapter.book_id);
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
  const data = sectionPayload(
    section, book, chapter, listSectionRefs(db, section.id, lang), lang, format,
    req.app.locals.options.publicBaseUrl,
  );
  const etag = `"${section.content_hash}"`;
  res.set('ETag', etag);
  res.set('Cache-Control', 'public, max-age=86400, immutable');
  res.set('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.json({ data, meta: { lang, attribution: 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب', version: meta.built_at } });
}

function sectionsRouter() {
  const router = express.Router();

  router.get('/books/:book/chapters/:chapter/sections/:index', (req, res) => {
    const db = req.app.locals.db;
    const book = findBook(db, req.params.book);
    const number = parseChapter(req.params.chapter);
    const index = Number(req.params.index);
    if (number === null || !Number.isInteger(index)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid chapter or index' } });
    }
    const chapter = findChapter(db, book.id, number);
    const section = findSectionByIndex(db, chapter.id, index);
    if (!section) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Section not found' } });
    sendSection(req, res, section);
  });

  router.get('/sections/:id', (req, res) => {
    const section = findSectionById(req.app.locals.db, req.params.id);
    if (!section) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Section not found' } });
    sendSection(req, res, section);
  });

  return router;
}

module.exports = { sectionsRouter, parseLanguage, parseFormat };
```

Mount in `backend/src/routes/index.js`.

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test/api.test.js
git commit -m "feat: add section routes with language formats and ETag caching"
```

---

### Task 8: Parallel sections and reference lookup

**Files:**
- Create: `backend/src/routes/parallel.js`, `backend/src/routes/references.js`
- Modify: `backend/src/db/queries.js`, `backend/src/routes/index.js`
- Create: `backend/test/references-api.test.js`

**Interfaces:**
- Produces: `GET /parallel?book=&chapter=&index=&format=`, `GET /references?book=&chapter=&verse=&lang=&limit=&offset=`; `findReferenceSections(db, params)`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/references-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 10000 });
test.after(() => db.close());

test('parallel returns both languages for one section', async () => {
  const res = await request(app).get('/api/v1/parallel?book=genesis&chapter=1&index=1');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.en.source_id, res.body.data.ar.source_id);
  assert.ok(res.body.data.en.content.html.length > 0);
  assert.ok(res.body.data.ar.content.html.length > 0);
});

test('references returns sections citing a verse', async () => {
  const res = await request(app).get('/api/v1/references?book=revelation&chapter=20&verse=2&lang=en');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length > 0);
  assert.ok(res.body.pagination.total > 0);
  assert.equal(res.body.data[0].reference.chapter, 20);
});

test('references filters by language and paginates', async () => {
  const en = await request(app).get('/api/v1/references?book=revelation&chapter=20&verse=2&lang=en&limit=1');
  const ar = await request(app).get('/api/v1/references?book=revelation&chapter=20&verse=2&lang=ar&limit=1');
  assert.equal(en.body.data.length, 1);
  assert.equal(ar.body.data.length, 1);
  assert.equal(en.body.pagination.limit, 1);
});

test('unknown verse returns 404', async () => {
  const res = await request(app).get('/api/v1/references?book=genesis&chapter=1&verse=999');
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && npm test`
Expected: FAIL with 404 for `/api/v1/parallel`.

- [ ] **Step 3: Implement queries and routes**

Add to `backend/src/db/queries.js`:

```js
function findReferenceSections(db, { bookId, chapter, verse, lang, limit, offset }) {
  const where = 'r.book_id = ? AND r.chapter = ? AND r.verse_start <= ? AND r.verse_end >= ? AND r.lang = ?';
  const total = db.prepare(`SELECT COUNT(DISTINCT s.id) AS n FROM section_refs r
    JOIN sections s ON s.id = r.section_id WHERE ${where}`).get(bookId, chapter, verse, verse, lang).n;
  const rows = db.prepare(`SELECT s.id, s.section_index, s.title_en, s.title_ar, s.verse_ranges_json,
      c.number AS chapter_number, b.slug AS book_slug, b.name_en, b.name_ar,
      r.label, r.display, r.chapter AS ref_chapter, r.verse_start, r.verse_end
    FROM section_refs r
    JOIN sections s ON s.id = r.section_id
    JOIN chapters c ON c.id = s.chapter_id
    JOIN books b ON b.id = c.book_id
    WHERE ${where}
    GROUP BY s.id
    ORDER BY b.book_number, c.number, s.section_index
    LIMIT ? OFFSET ?`).all(bookId, chapter, verse, verse, lang, limit, offset);
  return { rows, total };
}
```

`backend/src/routes/parallel.js`:

```js
const express = require('express');
const { findBook, findChapter, findSectionByIndex, listSectionRefs } = require('../db/queries');
const { sectionPayload } = require('../services/serializer');
const { parseChapter } = require('./chapters');
const { parseFormat } = require('./sections');

function parallelRouter() {
  const router = express.Router();
  router.get('/parallel', (req, res) => {
    const db = req.app.locals.db;
    const book = findBook(db, req.query.book);
    const number = parseChapter(String(req.query.chapter));
    const index = Number(req.query.index);
    const format = parseFormat(req.query.format);
    if (number === null || !Number.isInteger(index) || !format) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid chapter, index, or format' } });
    }
    const chapter = findChapter(db, book.id, number);
    const section = findSectionByIndex(db, chapter.id, index);
    if (!section) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Section not found' } });
    const baseUrl = req.app.locals.options.publicBaseUrl;
    const make = (lang) => sectionPayload(
      section, book, chapter, listSectionRefs(db, section.id, lang), lang, format, baseUrl,
    );
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.json({ data: { en: make('en'), ar: make('ar') }, meta: { attribution: 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب' } });
  });
  return router;
}

module.exports = { parallelRouter };
```

`backend/src/routes/references.js`:

```js
const express = require('express');
const { findBook, findReferenceSections } = require('../db/queries');

function intParam(value, fallback, min, max) {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function referencesRouter() {
  const router = express.Router();
  router.get('/references', (req, res) => {
    const db = req.app.locals.db;
    const book = findBook(db, req.query.book);
    const chapter = intParam(req.query.chapter, null, 1, 200);
    const verse = intParam(req.query.verse, null, 1, 200);
    const lang = req.query.lang || 'en';
    const limit = intParam(req.query.limit, 20, 1, 50);
    const offset = intParam(req.query.offset, 0, 0, 10000);
    if (chapter === null || verse === null || !['en', 'ar'].includes(lang) || limit === null || offset === null) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid reference parameters' } });
    }
    const { rows, total } = findReferenceSections(db, { bookId: book.id, chapter, verse, lang, limit, offset });
    if (total === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No sections cite this verse' } });
    res.json({
      data: rows.map((row) => ({
        id: row.id,
        book: { slug: row.book_slug, name: { en: row.name_en, ar: row.name_ar } },
        chapter: row.chapter_number,
        index: row.section_index,
        title: { [lang]: lang === 'ar' ? row.title_ar : row.title_en },
        reference: {
          chapter: row.ref_chapter, verse_start: row.verse_start,
          verse_end: row.verse_end, label: row.label, display: row.display,
        },
      })),
      meta: { lang, attribution: 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب' },
      pagination: { limit, offset, total },
    });
  });
  return router;
}

module.exports = { referencesRouter };
```

Mount both in `backend/src/routes/index.js`.

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test/references-api.test.js
git commit -m "feat: add parallel section and cross-reference endpoints"
```

---

### Task 9: Search API

**Files:**
- Create: `backend/src/services/search.js`, `backend/src/routes/search.js`
- Modify: `backend/src/db/queries.js`, `backend/src/routes/index.js`
- Create: `backend/test/search.test.js`

**Interfaces:**
- Produces: `buildMatchQuery(q)`, `searchSections(db, params)`, `GET /search`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/search.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');
const { buildMatchQuery } = require('../src/services/search');

const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 10000 });
test.after(() => db.close());

test('buildMatchQuery quotes terms and preserves phrases', () => {
  assert.equal(buildMatchQuery('creation god'), '"creation" AND "god"');
  assert.equal(buildMatchQuery('"holy spirit" grace'), '"holy spirit" AND "grace"');
  assert.equal(buildMatchQuery('   '), null);
});

test('English search returns highlighted hits', async () => {
  const res = await request(app).get('/api/v1/search?q=creation&lang=en&limit=3');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length > 0);
  assert.ok(res.body.data.some((hit) => /<mark>/.test(hit.snippet)));
  assert.equal(res.body.pagination.limit, 3);
});

test('Arabic search is diacritic-insensitive', async () => {
  const without = await request(app).get('/api/v1/search?q=الخليقة&lang=ar&limit=3');
  const withDiacritics = await request(app).get('/api/v1/search?q=الْخَلِيقَة&lang=ar&limit=3');
  assert.equal(without.status, 200);
  assert.ok(without.body.data.length > 0);
  assert.equal(withDiacritics.body.data.length, without.body.data.length);
});

test('search filters by book and rejects invalid input', async () => {
  const res = await request(app).get('/api/v1/search?q=creation&lang=en&book=genesis');
  assert.ok(res.body.data.every((hit) => hit.book.slug === 'genesis'));
  assert.equal((await request(app).get('/api/v1/search?q=a&lang=en')).status, 400);
  assert.equal((await request(app).get('/api/v1/search?q=creation&lang=fr')).status, 400);
  assert.equal((await request(app).get('/api/v1/search?q=creation&limit=500')).status, 400);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && npm test`
Expected: FAIL with missing `services/search`.

- [ ] **Step 3: Implement search parsing, query, and route**

`backend/src/services/search.js`:

```js
const { normalizeForSearch } = require('./normalize');

function buildMatchQuery(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const parts = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const term = normalizeForSearch((match[1] || match[2]).trim());
    if (term) parts.push(`"${term.replace(/"/g, '""')}"`);
  }
  return parts.length ? parts.join(' AND ') : null;
}

module.exports = { buildMatchQuery };
```

Add to `backend/src/db/queries.js`:

```js
function searchSections(db, { match, lang, bookId, testament, chapter, limit, offset }) {
  const table = lang === 'ar' ? 'sections_fts_ar' : 'sections_fts_en';
  const filters = [];
  const params = [match];
  if (bookId) { filters.push('b.id = ?'); params.push(bookId); }
  if (testament) { filters.push('b.testament = ?'); params.push(testament); }
  if (chapter !== null && chapter !== undefined) { filters.push('c.number = ?'); params.push(chapter); }
  const extra = filters.length ? ` AND ${filters.join(' AND ')}` : '';
  const from = `FROM ${table} f
    JOIN sections s ON s.id = f.rowid
    JOIN chapters c ON c.id = s.chapter_id
    JOIN books b ON b.id = c.book_id
    WHERE ${table} MATCH ?${extra}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params).n;
  const rows = db.prepare(`SELECT s.id, s.section_index, s.title_en, s.title_ar, s.verse_ranges_json,
      c.number AS chapter_number, b.slug AS book_slug, b.name_en, b.name_ar,
      snippet(${table}, 1, '<mark>', '</mark>', '…', 32) AS snippet
    ${from}
    ORDER BY b.book_number, c.number, s.section_index
    LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { rows, total };
}
```

`backend/src/routes/search.js`:

```js
const express = require('express');
const sanitizeHtml = require('sanitize-html');
const { findBook, searchSections } = require('../db/queries');
const { buildMatchQuery } = require('../services/search');

function safeSnippet(value) {
  return sanitizeHtml(value, { allowedTags: ['mark'], allowedAttributes: {} });
}

function intParam(value, fallback, min, max) {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function searchRouter() {
  const router = express.Router();
  router.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    const lang = req.query.lang || 'en';
    const limit = intParam(req.query.limit, 20, 1, 50);
    const offset = intParam(req.query.offset, 0, 0, 10000);
    const testament = req.query.testament;
    const chapter = req.query.chapter === undefined ? null : intParam(req.query.chapter, null, 0, 200);
    if (q.length < 2 || q.length > 200 || !['en', 'ar'].includes(lang) || limit === null || offset === null
        || (testament && !['ot', 'nt'].includes(testament)) || chapter === null) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid search parameters' } });
    }
    const match = buildMatchQuery(q);
    if (!match) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Empty search query' } });
    let bookId = null;
    if (req.query.book) bookId = findBook(req.app.locals.db, req.query.book).id;
    const { rows, total } = searchSections(req.app.locals.db, {
      match, lang, bookId, testament, chapter, limit, offset,
    });
    res.json({
      data: rows.map((row) => ({
        id: row.id,
        book: { slug: row.book_slug, name: { en: row.name_en, ar: row.name_ar } },
        chapter: row.chapter_number,
        index: row.section_index,
        title: { [lang]: lang === 'ar' ? row.title_ar : row.title_en },
        verse_ranges: JSON.parse(row.verse_ranges_json),
        snippet: safeSnippet(row.snippet),
      })),
      meta: { lang, query: q, attribution: 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب' },
      pagination: { limit, offset, total },
    });
  });
  return router;
}

module.exports = { searchRouter };
```

Mount in `backend/src/routes/index.js`.

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test/search.test.js
git commit -m "feat: add bilingual full-text search endpoint"
```

---

### Task 10: OpenAPI, Swagger UI, docs, licenses

**Files:**
- Create: `backend/src/openapi.yaml`
- Modify: `backend/src/app.js`
- Create: `backend/test/docs.test.js`
- Create: `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`
- Create: `README.md`, `LICENSE`, `NOTICE`

**Interfaces:**
- Produces: `GET /openapi.json` and `GET /docs/`; documentation for every endpoint.

- [ ] **Step 1: Write the failing docs test**

```js
// backend/test/docs.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 10000 });
test.after(() => db.close());

test('OpenAPI document covers all endpoints', async () => {
  const res = await request(app).get('/openapi.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.openapi.startsWith('3.'), true);
  for (const path of ['/api/v1/meta', '/api/v1/books', '/api/v1/books/{book}',
    '/api/v1/books/{book}/chapters/{chapter}',
    '/api/v1/books/{book}/chapters/{chapter}/sections/{index}',
    '/api/v1/sections/{id}', '/api/v1/parallel', '/api/v1/search',
    '/api/v1/references', '/health']) {
    assert.ok(res.body.paths[path], `missing ${path}`);
  }
});

test('Swagger UI is served', async () => {
  const res = await request(app).get('/docs/');
  assert.equal(res.status, 200);
  assert.match(res.text, /swagger-ui/i);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && npm test`
Expected: FAIL with 404 for `/openapi.json`.

- [ ] **Step 3: Write the OpenAPI document**

Create `backend/src/openapi.yaml` with `openapi: 3.1.0`, servers `https://commentary.copticfaith.org` and `http://localhost:3000`, and these exact paths. Reuse component schemas from the spec; every operation must have parameters and responses as implemented.

```yaml
openapi: 3.1.0
info:
  title: Bible Commentary — Fr. Tadros Y. Malaty
  version: "1.0.0"
  description: Public read-only bilingual commentary API. No authentication.
servers:
  - url: https://commentary.copticfaith.org
  - url: http://localhost:3000
tags:
  - { name: Meta }
  - { name: Catalog }
  - { name: Sections }
  - { name: Search }
  - { name: References }
paths:
  /health:
    get:
      tags: [Meta]
      summary: Liveness and corpus counts
      responses:
        "200": { description: Healthy, content: { application/json: { schema: { $ref: "#/components/schemas/Health" } } } }
  /api/v1/meta:
    get:
      tags: [Meta]
      summary: Corpus metadata and attribution
      responses:
        "200": { description: Metadata, content: { application/json: { schema: { $ref: "#/components/schemas/MetaResponse" } } } }
  /api/v1/books:
    get:
      tags: [Catalog]
      summary: List books
      parameters:
        - { name: testament, in: query, schema: { type: string, enum: [ot, nt] } }
      responses:
        "200": { description: Books, content: { application/json: { schema: { type: object, properties: { data: { type: array, items: { $ref: "#/components/schemas/Book" } } } } } } }
        "400": { $ref: "#/components/responses/BadRequest" }
  /api/v1/books/{book}:
    get:
      tags: [Catalog]
      summary: Book detail with chapter list
      parameters: [{ $ref: "#/components/parameters/Book" }]
      responses:
        "200": { description: Book, content: { application/json: { schema: { $ref: "#/components/schemas/BookDetailResponse" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
  /api/v1/books/{book}/chapters/{chapter}:
    get:
      tags: [Catalog]
      summary: Chapter detail and section summaries
      parameters:
        - { $ref: "#/components/parameters/Book" }
        - { name: chapter, in: path, required: true, schema: { type: string, examples: ["1", intro] } }
      responses:
        "200": { description: Chapter, content: { application/json: { schema: { $ref: "#/components/schemas/ChapterResponse" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
  /api/v1/books/{book}/chapters/{chapter}/sections/{index}:
    get:
      tags: [Sections]
      summary: Section by chapter and index
      parameters:
        - { $ref: "#/components/parameters/Book" }
        - { name: chapter, in: path, required: true, schema: { type: string } }
        - { name: index, in: path, required: true, schema: { type: integer, minimum: 1 } }
        - { $ref: "#/components/parameters/Lang" }
        - { $ref: "#/components/parameters/Format" }
      responses:
        "200": { description: Section, content: { application/json: { schema: { $ref: "#/components/schemas/SectionResponse" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
  /api/v1/sections/{id}:
    get:
      tags: [Sections]
      summary: Section by id
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
        - { $ref: "#/components/parameters/Lang" }
        - { $ref: "#/components/parameters/Format" }
      responses:
        "200": { description: Section, content: { application/json: { schema: { $ref: "#/components/schemas/SectionResponse" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
  /api/v1/parallel:
    get:
      tags: [Sections]
      summary: Same section in English and Arabic
      parameters:
        - { $ref: "#/components/parameters/Book" }
        - { name: chapter, in: query, required: true, schema: { type: string } }
        - { name: index, in: query, required: true, schema: { type: integer, minimum: 1 } }
        - { $ref: "#/components/parameters/Format" }
      responses:
        "200": { description: Parallel section, content: { application/json: { schema: { $ref: "#/components/schemas/ParallelResponse" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
  /api/v1/search:
    get:
      tags: [Search]
      summary: Bilingual full-text search
      parameters:
        - { name: q, in: query, required: true, schema: { type: string, minLength: 2, maxLength: 200 } }
        - { $ref: "#/components/parameters/Lang" }
        - { name: book, in: query, schema: { type: string } }
        - { name: testament, in: query, schema: { type: string, enum: [ot, nt] } }
        - { name: chapter, in: query, schema: { type: integer, minimum: 0 } }
        - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 50, default: 20 } }
        - { name: offset, in: query, schema: { type: integer, minimum: 0, maximum: 10000, default: 0 } }
      responses:
        "200": { description: Hits, content: { application/json: { schema: { $ref: "#/components/schemas/SearchResponse" } } } }
        "400": { $ref: "#/components/responses/BadRequest" }
  /api/v1/references:
    get:
      tags: [References]
      summary: Sections citing a verse
      parameters:
        - { $ref: "#/components/parameters/Book" }
        - { name: chapter, in: query, required: true, schema: { type: integer, minimum: 1 } }
        - { name: verse, in: query, required: true, schema: { type: integer, minimum: 1 } }
        - { $ref: "#/components/parameters/Lang" }
        - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 50, default: 20 } }
        - { name: offset, in: query, schema: { type: integer, minimum: 0, maximum: 10000, default: 0 } }
      responses:
        "200": { description: Sections, content: { application/json: { schema: { $ref: "#/components/schemas/ReferenceResponse" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
components:
  parameters:
    Book:
      name: book
      in: path
      required: true
      schema: { type: string, examples: [genesis] }
    Lang:
      name: lang
      in: query
      schema: { type: string, enum: [en, ar], default: en }
    Format:
      name: format
      in: query
      schema: { type: string, enum: [html, markdown, both], default: html }
  responses:
    NotFound:
      description: Not found
      content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } }
    BadRequest:
      description: Bad request
      content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } }
  schemas:
    Error:
      type: object
      properties:
        error:
          type: object
          properties:
            code: { type: string }
            message: { type: string }
    Health:
      type: object
      properties:
        status: { type: string }
        service: { type: string }
        books: { type: integer }
        sections: { type: integer }
        build: { type: string }
    Book:
      type: object
      properties:
        id: { type: integer }
        slug: { type: string }
        book_number: { type: integer }
        testament: { type: string, enum: [ot, nt] }
        name: { type: object, properties: { en: { type: string }, ar: { type: string } } }
        short: { type: object, properties: { en: { type: string }, ar: { type: string } } }
        chapters_expected: { type: integer }
    Chapter:
      type: object
      properties:
        number: { type: integer }
        title: { type: object }
        section_count: { type: integer }
        available: { type: boolean }
    Section:
      type: object
      properties:
        id: { type: integer }
        source_id: { type: string }
        lang: { type: string, enum: [en, ar] }
        book: { $ref: "#/components/schemas/Book" }
        chapter: { type: object }
        index: { type: integer }
        section_count: { type: integer }
        title: { type: object }
        verse_ranges: { type: array, items: { type: object } }
        content: { type: object, properties: { html: { type: string }, markdown: { type: string } } }
        references: { type: array, items: { type: object } }
        content_hash: { type: string }
        url: { type: string }
    MetaResponse:
      type: object
      properties:
        data:
          type: object
          properties:
            name: { type: string }
            attribution: { type: string }
            books: { type: integer }
            sections: { type: integer }
            ref_segments: { type: object }
            languages: { type: array, items: { type: string } }
            schema_version: { type: integer }
            build: { type: string }
    BookDetailResponse:
      type: object
      properties:
        data:
          allOf:
            - $ref: "#/components/schemas/Book"
            - type: object
              properties:
                chapters: { type: array, items: { $ref: "#/components/schemas/Chapter" } }
    ChapterResponse:
      type: object
      properties:
        data:
          type: object
          properties:
            book: { $ref: "#/components/schemas/Book" }
            chapter: { $ref: "#/components/schemas/Chapter" }
            sections: { type: array, items: { type: object } }
    SectionResponse:
      type: object
      properties:
        data: { $ref: "#/components/schemas/Section" }
        meta: { type: object }
    ParallelResponse:
      type: object
      properties:
        data:
          type: object
          properties:
            en: { $ref: "#/components/schemas/Section" }
            ar: { $ref: "#/components/schemas/Section" }
    SearchResponse:
      type: object
      properties:
        data: { type: array, items: { type: object } }
        meta: { type: object }
        pagination: { type: object }
    ReferenceResponse:
      type: object
      properties:
        data: { type: array, items: { type: object } }
        meta: { type: object }
        pagination: { type: object }
```

- [ ] **Step 4: Serve OpenAPI and Swagger UI**

Add to `backend/src/app.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');

const openapi = yaml.load(fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf8'));
```

Inside `createApp`, before `app.use('/api/v1', apiRouter())`:

```js
app.get('/openapi.json', (req, res) => res.json(openapi));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
```

- [ ] **Step 5: Write docs and licenses**

`docs/API.md` must contain:

- Base URL and no-auth note.
- `curl` examples for `/meta`, `/books`, `/books/genesis/chapters/1`, `/sections/1`, `/parallel`, `/search?q=creation&lang=en`, `/references?book=revelation&chapter=20&verse=2&lang=ar`.
- The JavaScript example:

```js
const base = 'https://commentary.copticfaith.org/api/v1';
const chapter = await fetch(`${base}/books/genesis/chapters/1?lang=ar`).then((r) => r.json());
for (const summary of chapter.data.sections) {
  const full = await fetch(`${base}/sections/${summary.id}?lang=ar`).then((r) => r.json());
  console.log(full.data.title.ar, full.data.content.html);
}
```

- Response envelope, errors, rate limits (120/min), caching, attribution.

`docs/ARCHITECTURE.md` must contain the spec's diagram, build/import flow, schema summary, and the reason SQLite is built at image build time.

`docs/DEPLOYMENT.md` must contain:

- Coolify app settings: Dockerfile location `/Dockerfile`, base directory `/`, port `3000`, health `/health`, domain `commentary.copticfaith.org`.
- Env vars from `.env.example`.
- GitHub secrets `COOLIFY_BASE_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_APP_UUID`; optional variable `COOLIFY_RESOLVE`.
- Manual deploy curl and rollback (redeploy previous image).

`README.md` quick start:

```bash
cd backend
npm install
node scripts/prepare-data.js
npm run build:db
npm test
npm run dev
```

`LICENSE`: MIT for code only. `NOTICE`: copy the attribution and notice from `data/attribution.json`.

- [ ] **Step 6: Run tests**

Run: `cd backend && npm test`
Expected: PASS; docs tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/openapi.yaml backend/src/app.js backend/test/docs.test.js docs README.md LICENSE NOTICE
git commit -m "docs: add OpenAPI, Swagger UI, and API/deployment documentation"
```

---

### Task 11: Hardening (security headers, CORS, compression, rate limits)

**Files:**
- Create: `backend/src/middleware/rate-limit.js`
- Modify: `backend/src/app.js`
- Create: `backend/test/hardening.test.js`

**Interfaces:**
- Produces: Helmet headers, CORS, gzip, `429` with `Retry-After`, morgan logs.

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/hardening.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

const db = openTestDb();
test.after(() => db.close());

test('security and CORS headers are present', async () => {
  const app = createApp(db, { rateLimitPerMin: 10000 });
  const res = await request(app).get('/api/v1/meta').set('Origin', 'https://example.org');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('rate limit returns 429 with Retry-After', async () => {
  const app = createApp(db, { rateLimitPerMin: 2 });
  await request(app).get('/api/v1/meta');
  await request(app).get('/api/v1/meta');
  const res = await request(app).get('/api/v1/meta');
  assert.equal(res.status, 429);
  assert.ok(res.headers['retry-after']);
  assert.equal(res.body.error.code, 'RATE_LIMITED');
});

test('large JSON responses are compressed', async () => {
  const app = createApp(db, { rateLimitPerMin: 10000 });
  const res = await request(app).get('/api/v1/books').set('Accept-Encoding', 'gzip');
  assert.equal(res.headers['content-encoding'], 'gzip');
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && npm test`
Expected: FAIL (missing security headers / rate limiting).

- [ ] **Step 3: Implement middleware**

`backend/src/middleware/rate-limit.js`:

```js
const { rateLimit } = require('express-rate-limit');

function createRateLimiter(limit) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.set('Retry-After', '60');
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    },
  });
}

module.exports = { createRateLimiter };
```

Update `backend/src/app.js` to add, after `app.set('etag', false)`:

```js
app.set('trust proxy', 1);
app.locals.options = { ...config, ...options };
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "script-src": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:"],
    },
  },
}));
app.use(cors({ origin: app.locals.options.corsOrigins === '*' ? '*' : app.locals.options.corsOrigins.split(',') }));
app.use(compression());
app.use(morgan('combined'));
app.use(createRateLimiter(app.locals.options.rateLimitPerMin));
```

Remove the duplicate `app.locals.options` assignment if present.

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test/hardening.test.js
git commit -m "feat: add security headers, CORS, compression, and rate limiting"
```

---

### Task 12: Docker image

**Files:**
- Create: `Dockerfile`

**Interfaces:**
- Produces: image that builds the DB, runs as non-root, exposes `3000`, and passes `/health`.

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci
COPY backend ./backend
COPY data ./data
RUN cd backend && node scripts/build-db.js --out /app/data/commentary.sqlite

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev && npm cache clean --force
COPY backend/src ./backend/src
COPY data/catalog.json data/attribution.json ./backend/data/
COPY --from=builder /app/data/commentary.sqlite ./backend/data/commentary.sqlite
RUN useradd --system --uid 1001 appuser && chown -R appuser:appuser /app
USER appuser
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
```

- [ ] **Step 2: Build and smoke test**

Run:

```bash
docker build -t commentary:local .
docker run -d --name commentary-smoke -p 3000:3000 commentary:local
sleep 5
curl -fsS http://127.0.0.1:3000/health
curl -fsS 'http://127.0.0.1:3000/api/v1/books/genesis/chapters/1?lang=ar' >/dev/null
docker rm -f commentary-smoke
```

Expected: `/health` returns `{"status":"ok",...}` and both requests exit 0. Record image size with `docker images commentary:local`.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "build: add multi-stage Docker image with prebuilt SQLite database"
```

---

### Task 13: CI and Coolify deploy workflows

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: CI on every push/PR; production deploy on `main` via Coolify.

- [ ] **Step 1: Write CI**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
        working-directory: backend
      - run: npm test
        working-directory: backend
      - run: docker build -t commentary:ci .
      - run: |
          docker run -d --name api -p 3000:3000 commentary:ci
          for i in $(seq 1 30); do
            if curl -fsS http://127.0.0.1:3000/health; then exit 0; fi
            sleep 2
          done
          docker logs api
          exit 1
```

- [ ] **Step 2: Write deploy**

`.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
        working-directory: backend
      - run: npm test
        working-directory: backend

  deploy:
    needs: verify
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Coolify deployment
        env:
          COOLIFY_BASE_URL: ${{ secrets.COOLIFY_BASE_URL }}
          COOLIFY_API_TOKEN: ${{ secrets.COOLIFY_API_TOKEN }}
          COOLIFY_APP_UUID: ${{ secrets.COOLIFY_APP_UUID }}
          COOLIFY_RESOLVE: ${{ vars.COOLIFY_RESOLVE }}
        run: |
          resolve_args=()
          if [ -n "$COOLIFY_RESOLVE" ]; then resolve_args=(--resolve "$COOLIFY_RESOLVE"); fi
          curl -fsS -X POST "${resolve_args[@]}" \
            -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
            "$COOLIFY_BASE_URL/api/v1/deploy?uuid=$COOLIFY_APP_UUID"
      - name: Wait for production health
        run: |
          for i in $(seq 1 60); do
            if curl -fsS https://commentary.copticfaith.org/health >/dev/null; then
              echo "production healthy"; exit 0
            fi
            sleep 10
          done
          echo "deployment did not become healthy"; exit 1
```

- [ ] **Step 3: Validate YAML**

Run: `python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in ['../.github/workflows/ci.yml','../.github/workflows/deploy.yml']]; print('ok')"` from `backend`.

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows
git commit -m "ci: add test pipeline and Coolify deploy workflow"
```

---

### Task 14: Create the GitHub repository and push

**Files:** none.

**Interfaces:**
- Produces: public repo `boco-cyber/bible-commentary-fr-tadros` with all commits on `main`.

- [ ] **Step 1: Confirm clean state and run the full suite**

```bash
cd /home/gergo/bible-commentary-fr-tadros
git status --short
cd backend && npm test
```

Expected: no uncommitted files; all tests pass.

- [ ] **Step 2: Create and push**

```bash
cd /home/gergo/bible-commentary-fr-tadros
gh repo create boco-cyber/bible-commentary-fr-tadros --public --source=. --remote=origin --push
git remote -v
```

Expected: `origin` points to `github.com/boco-cyber/bible-commentary-fr-tadros`; `main` is pushed.

- [ ] **Step 3: Verify CI**

```bash
gh run list --repo boco-cyber/bible-commentary-fr-tadros --limit 3
gh run watch --repo boco-cyber/bible-commentary-fr-tadros
```

Expected: the `CI` workflow succeeds.

---

### Task 15: Coolify app, secrets, and production verification

**Files:** none.

**Interfaces:**
- Produces: a live API at `https://commentary.copticfaith.org`.

- [ ] **Step 1: Create the Coolify application**

In Coolify, create a Dockerfile application from `boco-cyber/bible-commentary-fr-tadros`:

- Base directory: `/`
- Dockerfile: `/Dockerfile`
- Port: `3000`
- Domain: `https://commentary.copticfaith.org`
- Health check: `/health`
- Env: `NODE_ENV=production`, `CORS_ORIGINS=*`, `RATE_LIMIT_PER_MIN=120`, `SITE_NAME`, `PUBLIC_BASE_URL=https://commentary.copticfaith.org`
- No persistent volume.

- [ ] **Step 2: Set GitHub secrets and variable**

```bash
gh secret set COOLIFY_BASE_URL --repo boco-cyber/bible-commentary-fr-tadros --body 'https://hub.copticfaith.org'
gh secret set COOLIFY_API_TOKEN --repo boco-cyber/bible-commentary-fr-tadros
gh secret set COOLIFY_APP_UUID --repo boco-cyber/bible-commentary-fr-tadros --body '<app-uuid>'
gh variable set COOLIFY_RESOLVE --repo boco-cyber/bible-commentary-fr-tadros --body 'hub.copticfaith.org:443:163.192.16.13'
```

Replace `<app-uuid>` with the Coolify application UUID. Skip the variable if the server does not use Cloudflare Bot Fight Mode.

- [ ] **Step 3: Trigger and verify**

```bash
gh workflow run Deploy --repo boco-cyber/bible-commentary-fr-tadros
gh run watch --repo boco-cyber/bible-commentary-fr-tadros
curl -fsS https://commentary.copticfaith.org/health
curl -fsS https://commentary.copticfaith.org/api/v1/meta
curl -fsS 'https://commentary.copticfaith.org/api/v1/books/genesis/chapters/1?lang=ar' | head -c 500
curl -fsS --get --data-urlencode 'q=الخليقة' --data 'lang=ar' https://commentary.copticfaith.org/api/v1/search | head -c 500
curl -sS -o /dev/null -w '%{http_code}\n' https://commentary.copticfaith.org/docs/
```

Expected: health `200`, meta shows 67 books and 7,590 sections, Arabic chapter returns content, Arabic search returns hits, docs returns `200`.

- [ ] **Step 4: Record production verification**

Append the deploy date, image digest, and response timings to `docs/DEPLOYMENT.md`, commit, and push:

```bash
git add docs/DEPLOYMENT.md
git commit -m "docs: record production deployment verification"
git push
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Source data, counts, attribution | 2 |
| Architecture, SQLite build-time | 3, 12 |
| Schema (books/chapters/sections) | 3 |
| Per-language references | 4, 8 |
| FTS5 + Arabic normalization | 5, 9 |
| Catalog/chapter API | 6 |
| Section API, `lang`, `format`, caching | 7 |
| Parallel and reference lookup | 8 |
| Search API | 9 |
| OpenAPI, Swagger, docs, licenses | 10 |
| Helmet/CORS/compression/rate limits | 11 |
| Docker and Coolify | 12, 15 |
| CI and deploy workflows | 13 |
| Repository creation | 14 |
| Acceptance verification | 15 |

**Placeholder scan:** no TBD/TODO markers; every code step contains runnable code or an exact file plus content. The only user-supplied values are the Coolify app UUID and secrets in Task 15, which cannot be known before the app is created.

**Type consistency:** `createApp(db, options)`, `openDb(file)`, `findBook`, `findChapter`, `listSectionRefs`, `sectionPayload`, `buildMatchQuery`, and `searchSections` signatures match across tasks. Route paths use `:book`, `:chapter`, `:index` and are mounted under `/api/v1`. Docker and config both resolve the DB at `backend/data/commentary.sqlite`.

**Known deviation:** the plan puts `Dockerfile` at the repository root (not `backend/Dockerfile`) so Coolify and CI can use the default root context while copying `data/`. The spec is updated to match during implementation.

