# Bible Commentary API — Design Spec

**Status:** Approved by user, 2026-10-22
**Repo:** `boco-cyber/bible-commentary-fr-tadros` (public)
**Host:** `https://commentary.copticfaith.org` (Coolify)
**Author:** Fr. Tadros Y. Malaty / القمص تادرس يعقوب

## 1. Purpose

Publish the complete bilingual Bible commentary of Fr. Tadros Y. Malaty as a
public, read-only REST API for use by any website or app. The service must be
cheap to run, require no database administration, support Arabic and English
equally, and deploy through the user's existing Coolify + GitHub Actions
workflow.

Success means:

- Any section of all 67 covered books is retrievable in Arabic and English.
- Full-text search works in both languages with highlighted snippets.
- Scripture cross-references can be resolved in both directions.
- A website can consume the API with plain `fetch` and no API key.
- Deploys are reproducible and atomic; content changes require only a redeploy.

## 2. Source content

The content is already extracted from the Fr. Tadros Malaty databases bundled
with the "Coptic Commentaries" and "تفسير الإنجيل للكنيسة القبطية" apps:

`/home/gergo/Downloads/BIBLE COMMENTARY/extracted/`

| Language | Books | Sections | Characters | Source DB SHA-256 |
|---|---:|---:|---:|---|
| English | 67 | 7,590 | 41,185,343 | `085e481f05a62012e6ab06d96227581fc5beb8697c19868653f165a0d6251d6d` |
| Arabic | 67 | 7,590 | 30,226,755 | `72cc7572dd8e801f8e9032069f402d286aa0ca988cfa7fefd4606a851e86e75d` |

Key facts established during extraction:

- 73 books exist in the app catalog; this author covers 67. Excluded:
  2 Chronicles, Tobit, Sirach, Baruch, 1 Maccabees, 2 Maccabees.
- Exodus chapters 36–40 are absent from both source databases. This is a
  source gap and must be represented as missing, not fabricated.
- Every book has a chapter `0` record representing the book introduction.
- English and Arabic have identical source record keys (7,590 each), enabling
  a lossless one-row-per-section join.
- 36,810 English and 38,468 Arabic structured scripture references; 4,731 EN
  and 4,823 AR sections contain at least one.
- Content contains no images. Markdown links are rare and safe to render with
  raw HTML disabled.

The commitment to publish this text publicly is the user's decision. The repo
must record attribution and a content-permission notice. The source text is
not relicensed by the repository's code license.

## 3. Architecture

One Node.js 20 + Express 4 service backed by a single read-only SQLite file.

```
Browser / website
        |
        v
Coolify reverse proxy (TLS, commentary.copticfaith.org)
        |
        v
Node 20 + Express (port 3000)
        |
        v
better-sqlite3 (read-only) + FTS5
        |
        v
commentary.sqlite  <-- built at Docker build time from gzipped JSONL
```

Decisions:

- **SQLite over PostgreSQL/MongoDB.** The workload is read-only and small
  (7,590 rows). SQLite removes a container, a service, credentials, backups,
  and network latency. FTS5 handles English and Arabic far better than
  MongoDB's text search.
- **Build the DB at image build time.** Content changes only when the repo
  changes, so the DB is a build artifact shipped inside the image. Deploys are
  atomic, rollback is redeploying an old image, and there is no volume to
  corrupt or migrate.
- **No runtime writes.** The server opens the DB with `readonly: true` and
  performs no migrations or imports at startup.
- **HTML generated at build time.** Markdown-it (`html: false`) plus
  sanitization produces safe HTML once, avoiding per-request rendering.

Non-goals for v1: admin UI, authentication, write endpoints, verse text
(commentary only), user accounts, native mobile apps.

## 4. Repository layout

```text
bible-commentary-fr-tadros/
├── backend/
│   ├── src/
│   │   ├── app.js                 # Express app (exported for tests)
│   │   ├── server.js              # listen + graceful shutdown
│   │   ├── db/
│   │   │   ├── connection.js      # read-only better-sqlite3 singleton
│   │   │   └── queries.js         # prepared statements
│   │   ├── routes/
│   │   │   ├── catalog.js
│   │   │   ├── chapters.js
│   │   │   ├── sections.js
│   │   │   ├── search.js
│   │   │   ├── references.js
│   │   │   └── meta.js
│   │   ├── services/
│   │   │   ├── search.js          # query parsing + normalization
│   │   │   └── serializer.js      # response shaping
│   │   ├── middleware/
│   │   │   ├── errors.js
│   │   │   └── rate-limit.js
│   │   └── openapi.yaml
│   ├── scripts/
│   │   ├── prepare-data.js        # one-time extraction -> data/*.jsonl.gz
│   │   └── build-db.js            # JSONL -> commentary.sqlite
│   ├── test/
│   │   ├── api.test.js
│   │   ├── search.test.js
│   │   └── build-db.test.js
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
├── data/
│   ├── catalog.json
│   ├── attribution.json
│   ├── en/sections.jsonl.gz
│   └── ar/sections.jsonl.gz
├── docs/
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── superpowers/specs/2026-10-22-bible-commentary-api-design.md
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
├── LICENSE                        # MIT for code only
├── NOTICE                         # content attribution / permission
└── README.md
```

## 5. Data model

SQLite schema, created by `build-db.js` only.

```sql
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE books (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  book_number   INTEGER NOT NULL,
  testament     TEXT NOT NULL CHECK (testament IN ('ot','nt')),
  name_en       TEXT NOT NULL,
  name_ar       TEXT NOT NULL,
  short_en      TEXT,
  short_ar      TEXT,
  chapters_expected INTEGER NOT NULL
);

CREATE TABLE chapters (
  id          INTEGER PRIMARY KEY,
  book_id     INTEGER NOT NULL REFERENCES books(id),
  number      INTEGER NOT NULL,          -- 0 = book introduction
  title_en    TEXT,
  title_ar    TEXT,
  section_count INTEGER NOT NULL,
  UNIQUE (book_id, number)
);

CREATE TABLE sections (
  id                INTEGER PRIMARY KEY,
  source_record_id  TEXT NOT NULL UNIQUE, -- e.g. 'ot_1_1:0'
  chapter_id        INTEGER NOT NULL REFERENCES chapters(id),
  sequence_number   INTEGER NOT NULL,
  section_index     INTEGER NOT NULL,
  section_count     INTEGER NOT NULL,
  title_en          TEXT,
  title_ar          TEXT,
  verse_start       INTEGER,
  verse_end         INTEGER,
  verse_ranges_json TEXT NOT NULL,
  content_md_en     TEXT NOT NULL,
  content_md_ar     TEXT NOT NULL,
  content_html_en   TEXT NOT NULL,
  content_html_ar   TEXT NOT NULL,
  content_hash      TEXT NOT NULL,        -- SHA-256 of the four content fields
  UNIQUE (chapter_id, section_index)
);

CREATE TABLE section_refs (
  id            INTEGER PRIMARY KEY,
  section_id    INTEGER NOT NULL REFERENCES sections(id),
  ref_type      TEXT NOT NULL,
  book_id       INTEGER NOT NULL,
  chapter       INTEGER NOT NULL,
  verse_start   INTEGER NOT NULL,
  verse_end     INTEGER NOT NULL,
  label_en      TEXT NOT NULL,
  label_ar      TEXT NOT NULL,
  display_en    TEXT NOT NULL,
  display_ar    TEXT NOT NULL,
  raw_token     TEXT NOT NULL
);

CREATE INDEX idx_chapters_book ON chapters(book_id, number);
CREATE INDEX idx_sections_chapter ON sections(chapter_id, sequence_number);
CREATE INDEX idx_refs_target ON section_refs(book_id, chapter, verse_start, verse_end);
CREATE INDEX idx_refs_section ON section_refs(section_id);
```

Full-text tables are FTS5 external-content tables over plain-text versions of
the Markdown, so snippets do not expose Markdown syntax. The plain tables use
the same `id` as `sections`, and every expected chapter is inserted even when
the source has no content for it (projected as missing with `section_count = 0`):

```sql
CREATE TABLE sections_plain_en (
  id    INTEGER PRIMARY KEY REFERENCES sections(id),
  title TEXT NOT NULL,
  body  TEXT NOT NULL
);
CREATE TABLE sections_plain_ar (
  id    INTEGER PRIMARY KEY REFERENCES sections(id),
  title TEXT NOT NULL,
  body  TEXT NOT NULL
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

`sections_plain_en` / `sections_plain_ar` are ordinary tables generated at
build time from the Markdown (markup stripped, links reduced to text).

Arabic search normalization, applied identically to indexed text and queries:

- Unicode NFKC normalization.
- Remove tashkeel (U+064B–U+0652), superscript alef (U+0670), and tatweel.
- Unify alef forms (`أ`, `إ`, `آ`, `ٱ` → `ا`).
- Unify alef maqsura `ى` → `ي` and ta marbuta `ة` → `ه`.
- Collapse whitespace.

Derived fields:

- `slug` comes from the catalog `path_stem` with its numeric prefix removed
  (`01-genesis` → `genesis`, `09-1-samuel` → `1-samuel`), verified unique.
- `chapter.title_en/ar` uses the first non-empty section title of the chapter,
  falling back to `Chapter N` / `الإصحاح N`.
- `content_hash` is used for strong ETags.

## 6. Import pipeline

`prepare-data.js` is run once by the developer, not at build or deploy time.
It produces the committed `data/` files:

1. Read `english/json/sections.jsonl` and `arabic/json/sections.jsonl`.
2. Keep only: `source_record_id`, `chapter`, `sequence_number`,
   `section_index`, `section_count`, `title`, `source_title`, `verse_*`,
   `verse_ranges`, `content_markdown`, `references`.
3. Drop `content_raw`, `source`, and other extraction-only fields.
4. Sort records deterministically by book number, chapter, section index.
5. Write one JSON object per line and gzip with maximum compression.

`build-db.js` runs inside Docker build and in CI:

1. Read and decompress both JSONL files and `catalog.json`.
2. Validate:
   - 67 books with commentary in each language.
   - Exactly 7,590 English and 7,590 Arabic records.
   - Identical `source_record_id` sets across languages.
   - Non-empty content in both languages.
   - Book/chapter numbers within catalog expectations.
   - Reference counts match expectations (36,810 EN / 38,468 AR) and every
     reference segment has a valid book and positive chapter/verse.
3. Join EN/AR by `source_record_id`.
4. Render Markdown to HTML with `markdown-it` (`html: false`, `linkify: true`)
   and sanitize with `sanitize-html` using a conservative allowlist.
5. Generate plain-text search bodies, normalized Arabic text, and both FTS
   indexes.
6. Insert all rows in one transaction and write `meta` (schema version, build
   timestamp, source SHA-256s, row counts, DB checksum).
7. Abort with a non-zero exit code on any validation failure.

The build is deterministic except for `built_at`; content-derived hashes are
stable.

## 7. API

Base URL: `https://commentary.copticfaith.org/api/v1`

All endpoints are public, `GET` only, and require no authentication.

| Endpoint | Description |
|---|---|
| `GET /meta` | Author, attribution, languages, counts, build version, license note |
| `GET /books?testament=ot\|nt` | Book catalog (default all) |
| `GET /books/:book` | Book detail plus chapter list, including missing chapters |
| `GET /books/:book/chapters/:chapter` | Chapter detail plus ordered section summaries |
| `GET /books/:book/chapters/:chapter/sections/:index` | Full section |
| `GET /sections/:id` | Full section by numeric id |
| `GET /parallel?book=&chapter=&index=` | Same section in English and Arabic |
| `GET /search?q=&lang=&book=&testament=&limit=&offset=` | Full-text search |
| `GET /references?book=&chapter=&verse=` | Sections citing a verse |
| `GET /health` | Liveness plus DB counts and checksum |
| `GET /docs` | Swagger UI |
| `GET /openapi.json` | OpenAPI 3.1 document |

### Identifier rules

- `:book` accepts a slug (`genesis`, `1-samuel`) or numeric id.
- `:chapter` accepts `0` (or `intro`) for the book introduction.
- `:index` is the 1-based `section_index` within the chapter.
- `/sections/:id` accepts the numeric primary key.

### Response conventions

- `?lang=en|ar` selects single-language content. Default `en`.
- `?format=html|markdown|both`; default `html`. `both` returns both fields.
- Single-language section payload omits the other language; `parallel=1` on a
  section route returns both.
- Envelope:

```json
{
  "data": {},
  "meta": {
    "lang": "en",
    "attribution": "Fr. Tadros Y. Malaty / القمص تادرس يعقوب",
    "version": "2026-10-22T00:00:00Z"
  },
  "pagination": { "limit": 20, "offset": 0, "total": 125 }
}
```

- Errors:

```json
{ "error": { "code": "NOT_FOUND", "message": "Book not found" } }
```

Status codes: `400` invalid parameters or query, `404` unknown resource,
`429` rate limited, `500` internal error, `503` DB unavailable.

### Search

- `q` is required, 2–200 characters after trimming.
- Multiple terms are combined with AND; `"quoted phrase"` is honored.
- Queries are normalized with the same Arabic rules as the index.
- FTS5 `snippet()` produces highlighted `<mark>` output from plain text; all
  snippet text is HTML-escaped before highlighting.
- `limit` defaults to 20, maximum 50; `offset` defaults to 0, maximum 10,000.
- Optional filters: `lang` (required for deterministic results; default `en`),
  `book` (slug or id), `testament`, `chapter`.
- Each hit returns section id, book/chapter/index, titles, verse ranges,
  snippet, and a language-appropriate link path.

### Cross-references

- Section payloads include resolved refs with book slug, chapter, verse range,
  and EN/AR labels.
- `/references?book=genesis&chapter=1&verse=1` returns every section whose
  reference range covers the verse, ordered by book/chapter/section, paginated.
- Reference ranges are inclusive. A missing verse or book returns `404`.

### Caching, limits, and safety

- Content responses: `ETag: "<content_hash>"`, `Cache-Control: public,
  max-age=86400, immutable`, `Vary: Accept-Encoding`.
- Catalog/meta responses: `max-age=3600`.
- Conditional `If-None-Match` returns `304`.
- `compression` for responses over 1 KB.
- `helmet` with a JSON-only CSP.
- CORS: `CORS_ORIGINS` comma list; default `*` because all endpoints are
  read-only and public.
- Rate limit: 120 requests/minute per IP by default, configurable via
  `RATE_LIMIT_PER_MIN`; returns `429` with `Retry-After`.
- Request logging via `morgan` (no request bodies, no cookies).
- Graceful shutdown on `SIGTERM` (Coolify deploys).

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `data/commentary.sqlite` | SQLite file |
| `CORS_ORIGINS` | `*` | Allowed origins |
| `RATE_LIMIT_PER_MIN` | `120` | Per-IP request limit |
| `SITE_NAME` | `Bible Commentary — Fr. Tadros Malaty` | Meta output |
| `PUBLIC_BASE_URL` | `https://commentary.copticfaith.org` | Links |

## 8. Container and deployment

### Dockerfile

Multi-stage build on `node:20-bookworm-slim`:

1. **builder** — `npm ci`, copy `data/`, run `node scripts/build-db.js`.
2. **runtime** — `npm ci --omit=dev`, copy `src/`, `openapi.yaml`, and the
   built `commentary.sqlite`; create an unprivileged user; `EXPOSE 3000`;
   `HEALTHCHECK` against `/health`; `CMD ["node", "src/server.js"]`.

The DB is never committed. It is built from the committed gzipped JSONL.

### Coolify

- Application type: Dockerfile, repo `boco-cyber/bible-commentary-fr-tadros`.
- Domain: `https://commentary.copticfaith.org`, container port `3000`.
- Health check path: `/health`.
- No persistent volume (DB is in the image).
- Environment: `CORS_ORIGINS`, `RATE_LIMIT_PER_MIN`, `SITE_NAME`,
  `PUBLIC_BASE_URL`, `NODE_ENV=production`.

### GitHub Actions

`ci.yml` on pull requests and pushes to non-main branches:

1. `npm ci`
2. `node scripts/build-db.js`
3. `npm test`
4. `docker build` and curl `/health` inside the built image.

`deploy.yml` on push to `main`:

1. Run the same tests and DB build.
2. `POST` to the Coolify deploy API for the app UUID.
3. Poll the deployment until it succeeds or times out.
4. Fail the workflow on a failed deployment.

Required repository secrets:

- `COOLIFY_BASE_URL` (e.g. `https://hub.copticfaith.org`)
- `COOLIFY_API_TOKEN`
- `COOLIFY_APP_UUID`

Optional repository variable:

- `COOLIFY_RESOLVE` (e.g. `hub.copticfaith.org:443:163.192.16.13`) passed as
  `curl --resolve` to bypass Cloudflare Bot Fight Mode, matching the existing
  deployment pattern.

### Operations

- `/health` reports status, schema version, build timestamp, counts, and DB
  checksum for smoke tests.
- Logs are stdout/stderr, collected by Coolify.
- No backups are required: the image and source JSONL are the source of truth.

## 9. Testing

- `backend/test/build-db.test.js`: build from a small fixture and assert
  schema, counts, EN/AR join, FTS tables, hash stability, and validation
  failures on mismatched counts.
- `backend/test/api.test.js`: catalog, book/chapter/section routes, intro
  chapter, missing Exodus chapters, pagination bounds, 404s, ETag/304,
  caching headers, CORS, and rate-limit headers.
- `backend/test/search.test.js`: English search, Arabic search with and
  without diacritics, alef/ya normalization, phrase queries, filters,
  snippet escaping, and limit clamping.
- Reference tests: section payload refs, `/references` inclusive ranges,
  and empty results as `404`.
- Parallel tests: both languages returned with matching `source_record_id`.
- Full-suite target: < 10 seconds; no network access.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| SQLite DB or image is too large for comfortable deploys | Measure after first build; fallback is a Coolify volume plus a one-shot init job using the same artifacts. |
| Arabic search misses variants | Normalize index and query identically; test tashkeel, alef, ya, and ta marbuta cases. |
| FTS snippets leak Markdown or HTML | Index plain text only; escape snippet text before adding `<mark>`. |
| Content permission changes | Keep `NOTICE` and `attribution.json`; repo visibility can be changed without changing the API. |
| Cloudflare blocks Coolify deploy calls | Support `COOLIFY_RESOLVE` exactly like the existing repos. |
| Git repo size limits | Trimmed gzipped JSONL is expected well under GitHub's 100 MB per-file limit; verify in CI before committing. |
| Source content gaps (Exodus 36–40) | Represent as missing in the catalog response; never synthesize content. |

## 11. Acceptance criteria

1. `npm test` passes locally and in CI.
2. Docker image builds and `/health` returns `200` with correct counts.
3. All 67 books, 7,590 sections, and both languages are queryable.
4. Arabic and English search return relevant, highlighted results.
5. `/references` resolves both directions correctly.
6. `/docs` serves a complete OpenAPI 3.1 document with working examples.
7. A push to `main` deploys successfully through Coolify.
8. `https://commentary.copticfaith.org/api/v1/meta` is reachable publicly.
