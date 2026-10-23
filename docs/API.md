# API Reference

Base URL: `https://commentary.copticfaith.org/api/v1`

All endpoints are public, read-only, `GET`-only, and require no authentication or API key. The machine-readable contract is served at `/openapi.json`, and interactive documentation is available at `/docs/`.

## Conventions

- `lang=en|ar` selects the response language. Default: `en`. `/study` also accepts `lang=both`.
- `format=html|markdown|both` selects section and study-commentary representation. Default: `html`.
- `book` accepts a slug (`genesis`, `1-samuel`) or numeric id.
- `chapter` accepts `0` or `intro` for a book introduction.
- `index` is the 1-based section index within a chapter.
- Numeric path and query parameters must be plain decimal integers (`/^\d+$/`); whitespace, hexadecimal, and exponent forms return `400`.
- `/books` and `/books/:book` expose only the 67 books with commentary. The catalog also contains six excluded books (2 Chronicles, Tobit, Sirach, Baruch, 1 & 2 Maccabees) that can appear only as cross-reference targets.
- Successful responses use an envelope: `{ "data": ..., "meta": ..., "pagination": ... }`.
- Pagination fields are `limit`, `offset`, and `total`; `limit` defaults to 20 (maximum 50) and `offset` defaults to 0 (maximum 10,000).

Errors are returned as JSON:

```json
{ "error": { "code": "NOT_FOUND", "message": "Book not found" } }
```

| Status | Meaning |
|---|---|
| `400` | Invalid parameter or query |
| `404` | Unknown book, chapter, section, verse, or no matching results |
| `429` | Rate limit exceeded; respects `Retry-After` |
| `500` | Internal server error |

## Examples

### Corpus metadata

```bash
curl 'https://commentary.copticfaith.org/api/v1/meta'
```

### Book catalog

```bash
curl 'https://commentary.copticfaith.org/api/v1/books'
curl 'https://commentary.copticfaith.org/api/v1/books?testament=nt'
```

### Chapter with section summaries

```bash
curl 'https://commentary.copticfaith.org/api/v1/books/genesis/chapters/1'
```

### Verses in a chapter

```bash
curl 'https://commentary.copticfaith.org/api/v1/books/john/chapters/3/scripture'
```

### Verses with commentary after each range

```bash
curl 'https://commentary.copticfaith.org/api/v1/books/john/chapters/3/study?lang=both&format=html'
```

### Commentary for one selected verse

```bash
curl 'https://commentary.copticfaith.org/api/v1/books/john/chapters/9/verses/3/commentary?lang=both&format=html'
```

### Full section

```bash
curl 'https://commentary.copticfaith.org/api/v1/sections/1?lang=en&format=html'
```

### Parallel English and Arabic

```bash
curl 'https://commentary.copticfaith.org/api/v1/parallel?book=genesis&chapter=1&index=1'
curl 'https://commentary.copticfaith.org/api/v1/books/genesis/chapters/1/sections/1?parallel=1'
```

`parallel=1` on either section route returns `{ "data": { "en": ..., "ar": ... } }`.

### Search

```bash
curl 'https://commentary.copticfaith.org/api/v1/search?q=creation&lang=en'
curl 'https://commentary.copticfaith.org/api/v1/search?q=الخلق&lang=ar&limit=10'
```

Each hit includes a canonical `url` pointing at its section route. Results are
ordered by absolute canonical book id, then chapter and section.
An empty `chapter=` is treated as an absent filter.

### Cross-references

```bash
curl 'https://commentary.copticfaith.org/api/v1/references?book=revelation&chapter=20&verse=2&lang=ar'
curl 'https://commentary.copticfaith.org/api/v1/references?book=2-chronicles&chapter=20&verse=7&lang=en'
```

References resolve against all 73 catalog books, including excluded books.
Section payloads expose the target `book_slug` (and `book.name`) for every
reference; `/references` exposes `reference.book_slug` for the matched target.
Source sections are ordered by absolute canonical book id.

### JavaScript client

```js
const base = 'https://commentary.copticfaith.org/api/v1';
const chapter = await fetch(`${base}/books/genesis/chapters/1?lang=ar`).then((r) => r.json());
for (const summary of chapter.data.sections) {
  const full = await fetch(`${base}/sections/${summary.id}?lang=ar`).then((r) => r.json());
  console.log(full.data.title.ar, full.data.content.html);
}

const study = await fetch(`${base}/books/john/chapters/3/study?lang=both`).then((r) => r.json());
for (const block of study.data.blocks) {
  if (block.type === 'verses') {
    for (const verse of block.verses) console.log(verse.number, verse.text.en);
  } else {
    console.log(block.title.en, block.content.en.html);
  }
}
```

## Caching

Section and parallel responses include an `ETag` derived from the content hash and representation. Send it back with `If-None-Match` to receive `304 Not Modified`:

```bash
curl -H 'If-None-Match: "<etag>"' 'https://commentary.copticfaith.org/api/v1/sections/1'
```

- Section content: `Cache-Control: public, max-age=86400, immutable` and `Vary: Accept-Encoding`.
- Study responses: `Cache-Control: public, max-age=86400, immutable` and `Vary: Accept-Encoding`; the ETag covers the full study payload.
- Per-verse commentary responses: `Cache-Control: public, max-age=86400, immutable` and `Vary: Accept-Encoding`; the ETag covers the full response.
- Catalog and metadata: `Cache-Control: public, max-age=3600`.
- ETags are representation-specific, so `lang` and `format` changes produce a different ETag. `parallel=1` uses a `both` representation ETag.
- `/health` reports the build's `schema_version` and `checksum` (the corpus content checksum) and is always `no-store`.

## Rate limits

Requests are limited to 120 per minute per IP by default. The limit is configurable through `RATE_LIMIT_PER_MIN`. Exceeding it returns `429` with a `Retry-After` header.

## Attribution and provenance

The commentary is by Fr. Tadros Y. Malaty / القمص تادرس يعقوب. When displaying content, retain the attribution returned by `/meta` and described in [`NOTICE`](../NOTICE). The repository's MIT license covers code only, not the commentary text.

Scripture is public-domain KJV (English) and Smith–Van Dyke (Arabic). Source URLs, revision, and checksums are in `data/bible/*-source.json` and [DATA.md](DATA.md). NKJV is not bundled.

`/api/v1/meta` also returns the work title in both languages, the attribution
notice, excluded-book counts, dropped invalid reference counts, per-language
commentary chunk counts, the SHA-256 of each committed gzipped source file, the
corpus `content_checksum`, and `schema_version` 4. `/health` repeats the schema version and checksum so
deployments can be verified without cached metadata.

### Scripture and study

`GET /api/v1/books/:book/chapters/:chapter/scripture` returns every available
verse in the chapter, ordered by `number`. Each verse has `text.en` (KJV),
`text.ar` (AVD), and `sections` — the commentary section indices whose recorded
ranges cover it. A commentary section can cover several verses. Verses without
commentary remain present with an empty `sections` array.

`translations.en` identifies KJV and `translations.ar` identifies AVD. Each
translation includes `name`, `language`, `license`, `source`, and `status`
(`available`, `source_required`, or `not_found` for the requested chapter).
Missing text is `null`. Both editions contain 66 books, so deuterocanonical
text is not bundled; commentary ranges retain those verse positions. Chapter
introductions (`0`/`intro`) return 400. NKJV is not bundled.

`GET /api/v1/books/:book/chapters/:chapter/study` combines the same verse text
with full commentary:

- Query params: `lang=en|ar|both` (default `en`) and
  `format=html|markdown|both` (default `html`). These control commentary
  content only; verse text always includes KJV and AVD.
- The response contains `data.translations` and `data.blocks`.
- `blocks` is ordered. Commentary sections with no verse range (chapter
  introductions and general sections) come first. Each `verses` block is
  followed by one `commentary` block after the range it covers.
- Every verse appears exactly once across `verses` blocks. A commentary
  section appears once per range, mirroring the source app's de-duplication.
- `commentary.content` is keyed by language and then by `html`/`markdown`.
  `commentary.references` is keyed by language.
- `commentary.title` always contains both `en` and `ar`.
- Missing Scripture text is `null`; commentary remains present.
- If a chapter has no commentary, the response contains only `verses` blocks.

Example shape:

```json
{
  "data": {
    "book": { "slug": "john" },
    "chapter": { "number": 3 },
    "translations": {
      "en": { "id": "KJV", "status": "available" },
      "ar": { "id": "AVD", "status": "available" }
    },
    "blocks": [
      { "type": "commentary", "id": 5286, "verse_ranges": [], "content": { "en": { "html": "..." } } },
      { "type": "verses", "verses": [{ "number": 1, "text": { "en": "...", "ar": "..." } }] },
      { "type": "commentary", "id": 5287, "verse_ranges": [[1, 13]], "content": { "en": { "html": "..." } } }
    ]
  },
  "meta": { "lang": "en", "format": "html" }
}
```

`lang=both` returns `content.en` and `content.ar`; `format=both` returns both
`html` and `markdown`. Study responses are cacheable and ETagged. See
[DATA.md](DATA.md) for translation provenance.

### Per-verse commentary

`GET /api/v1/books/:book/chapters/:chapter/verses/:verse/commentary` returns the
KJV/AVD verse text plus every split commentary chunk whose range covers the
selected verse. This is the endpoint for a verse picker: the client selects a
verse and displays the returned chunks underneath it.

- `lang=en|ar|both` (default `en`) controls the commentary chunks; verse text
always includes KJV and AVD.
- `format=html|markdown|both` (default `html`) controls each chunk's content.
- `commentary` is an array. Each entry has `id`, `section_id`, `index`, `lang`,
  `title`, `verse_start`, `verse_end`, `content`, `references`, `content_hash`,
  and a parent-section `url`.
- `lang=both` returns one entry per language. Group by `section_id` if the
  client wants a side-by-side view.
- Verses with no commentary in the source return `commentary: []`; the verse
  text is still present. The split does not invent verse boundaries inside a
  continuous commentary section.
- The underlying `commentary_chunks` rows are built from the section Markdown at
  inline verse markers and paragraph boundaries, so paragraphs and tables are
  preserved.


## Website navigation and search tools

These read-only endpoints supply the website's book/chapter/verse picker and command bar.
The website controls presentation; no frontend is bundled.

| Tool | Request | Result |
| --- | --- | --- |
| Pick a book | `GET /api/v1/navigation` | All 73 books, bilingual names and commentary availability |
| Pick a chapter | `GET /api/v1/navigation?book=matthew` | Ordered chapters present in Scripture or commentary |
| Pick a verse | `GET /api/v1/navigation?book=matthew&chapter=2` | Verse numbers, text availability, associated section indices and section outline |
| Go to reference | `GET /api/v1/resolve?q=John%203:16-18` | Canonical book, chapter, verse range, bilingual text and navigation links |
| Find Bible words | `GET /api/v1/scripture/search?q=love&lang=en` | Matching KJV verses with canonical references |
| Find an exact phrase | `GET /api/v1/scripture/search?q=%22God%20so%20loved%22` | Phrase matches; separate unquoted terms use AND |
| Find commentary | `GET /api/v1/search?q=love&lang=en` | Existing commentary full-text search |
| Find citations | `GET /api/v1/references?book=john&chapter=3&verse=16` | Existing commentary sections that cite this reference |

Bible search accepts `lang=en|ar`, optional `book` (slug or catalog ID), `limit=1..50`
(default 20), and `offset=0..100000` (default 0). Responses include `data`, translation
metadata, and `pagination: {total, limit, offset}`. Search uses whole tokens, not substrings;
Arabic diacritics and common letter variants are normalized. User input is quoted before
being passed to FTS; raw FTS operators are not exposed.

The resolver accepts a full English/Arabic name, catalog abbreviation, source book code,
or slug followed by a chapter and optional verse/range. Examples: `John 3`, `John 3:16`,
`1 John 2:1-3`, `يوحنا ٣:١٦`. Ranges stay within one chapter. Invalid syntax returns 400;
unknown books or positions return 404. Text is null where only commentary positions exist.
All navigation results distinguish missing Scripture text from missing commentary.

Schema version 4 adds `scripture_verses` (62,206 rows) and its SQLite FTS5 index,
rebuilt from committed KJV/AVD sources with the database. Runtime access stays read-only.
Rebuild the database before starting this version; there is no live migration.


## Source-faithful commentary availability

Chapter and book chapter-list entries now include `commentary: {available, status, message}`.
Missing source chapters (Exodus 36–40) have no sections and return the bilingual message
`No commentary available` / `لا يوجد تفسير متاح`. Navigation exposes the same status.

The verse commentary endpoint separates:

- `commentary`: only comments individually identified for the selected verse.
- `shared_commentary`: original source text mapped to a verse range, or the full source
  section when no individual marker identifies this verse. Items have stable IDs and
  `scope: range|section`; websites should deduplicate by ID when combining verse requests.
- `commentary_status[lang]`: individual availability. `shared_only` means there is shared
  source context but no separately identified verse comment. Its message says
  `No verse-specific commentary available`.
- `source_commentary_status[lang]`: whether either individual or shared source text exists.
  When neither exists the message is `No commentary available`.

A verse marker does not authorize extending its comment to following unmarked verses.
Sections without inline boundaries retain their original source range as shared context.
Full source text remains accessible through chapter study and section endpoints.
Repeated generated `Chapter Introduction` headings are replaced by localized chapter
labels; genuine source headings are preserved. These changes apply during every database
build across both languages. Mutable catalog and commentary URLs now require cache
revalidation rather than declaring corrected content immutable.

Run `node backend/scripts/audit-commentary.js` to audit all committed records. Add
`--source-dir /path/to/extracted` to compare text, source headings and ranges against the
original extraction. The full audit is committed in `docs/commentary-audit.json`.
