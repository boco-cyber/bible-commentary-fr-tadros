# Architecture

## Overview

One Node.js 20 + Express service backed by a single read-only SQLite file for
commentary and two committed gzipped JSONL files for public-domain Scripture.

```text
Browser / website
        |
        v
Coolify reverse proxy (TLS, commentary.copticfaith.org)
        |
        v
Node 20 + Express (port 3000)
        |                         |
        v                         v
better-sqlite3 (read-only) + FTS5  in-memory KJV/AVD
        |                         |
        v                         v
commentary.sqlite  <-- built      data/bible/*.jsonl.gz
at Docker build time from         <-- loaded on first
gzipped JSONL                         scripture/study request
```

The API is read-only. There is no admin UI, authentication, write path, runtime
migration, or separate database service.

## Import and build flow

1. `backend/scripts/prepare-data.js` runs once during development, not during
   deployment. It reads the extracted English and Arabic JSONL, keeps only the
   fields the API needs, sorts records deterministically, and writes
   `data/en/sections.jsonl.gz` and `data/ar/sections.jsonl.gz`.
2. `backend/scripts/build-db.js` runs in CI and inside the Docker build. It:
   - decompresses both JSONL files and reads `data/catalog.json` and
     `data/attribution.json`;
   - inserts all 73 catalog books: 67 with commentary (`included = 1`) and six
     excluded books (`included = 0`) that are reference targets only;
   - validates catalog ids, book counts, section counts, matching English/Arabic
     record keys, non-empty content, chapter bounds, and every reference target;
   - drops invalid reference segments (for example Luke 4:0 in the source),
     logs a warning, and records the per-language drop counts;
   - joins English and Arabic records by `source_record_id`;
   - selects localized titles from `source_title`, falling back to `title` and
     then a generated chapter name, and includes them in each content hash;
   - renders Markdown to sanitized HTML with `markdown-it` (`html: false`);
   - generates markup-free plain-text search bodies (stripping horizontal rules
     and Markdown backslash escapes), Arabic normalization, and FTS5 indexes;
   - splits each ranged commentary section into verse-aware Markdown chunks at
     inline verse markers and paragraph boundaries, renders each chunk to
     sanitized HTML, and inserts `commentary_chunks` for English and Arabic;
   - inserts all rows in one transaction and records attribution, source
     SHA-256s, a corpus content checksum, row/reference/chunk counts, and schema
     version 3.
3. The resulting `commentary.sqlite` is copied into the runtime image. Content
   changes therefore ship as new images, not as runtime imports.

Scripture data is separate from this build. `data/bible/kjv.jsonl.gz` and
`data/bible/avd.jsonl.gz` are copied into the image as-is. The first
`/scripture` or `/study` request loads both into memory; no SQLite table or
runtime write is involved. Source provenance is in `data/bible/*-source.json`
and [DATA.md](DATA.md).

## Schema summary

| Table | Purpose |
|---|---|
| `meta` | Build timestamp, schema version 5, row/reference/chunk counts, attribution, source SHA-256s, corpus content checksum |
| `books` | Full 73-book catalog: id, slug, book number, testament, English/Arabic names, expected chapters, and `included` |
| `chapters` | One row per expected chapter, including chapter `0` book introductions and missing chapters with `section_count = 0` |
| `sections` | Paired English/Arabic content, titles, verse ranges, rendered HTML/Markdown, and content hash |
| `section_refs` | Per-language scripture reference tokens and resolved target ranges |
| `commentary_chunks` | Verse-aware commentary chunks: section, book/chapter, language, verse range, Markdown/HTML, and chunk hash |
| `sections_plain_en`, `sections_plain_ar` | Markup-free text used for snippets and search |
| `sections_fts_en`, `sections_fts_ar` | FTS5 external-content indexes with `unicode61 remove_diacritics 2` |

Key indexes cover chapters by book, sections by chapter, references by target,
and references by section and language. The English and Arabic corpora each
contain 7,590 sections across the 67 covered books; the source gap for Exodus
36–40 is represented as missing chapters rather than fabricated content.
Excluded catalog books have no chapters or sections but remain joinable
reference targets.

The build stores 43,326 English and 45,234 Arabic valid reference segments.
It drops one invalid Luke 4:0 segment per language instead of fabricating a
verse, and records those drops in `meta`. `content_checksum` is SHA-256 over
the sorted `source_record_id:content_hash` lines; source SHA-256s cover the
committed gzipped JSONL files. Catalog, search, and reference queries use the
absolute `books.id` order so the Old Testament consistently precedes the New
Testament.

## Runtime structure

- `backend/src/app.js` assembles Express, `/health`, `/openapi.json`, `/docs/`,
  and the `/api/v1` router.
- `backend/src/routes/` contains the catalog, chapter, scripture, study,
  per-verse commentary, section, parallel, reference, search, and metadata
  endpoints.
- `backend/src/db/queries.js` holds prepared read-only queries, including
  chapter-level section and reference fetches for the study composer.
- `backend/src/services/` handles Arabic-aware search parsing, Markdown
  rendering helpers, plain-text extraction, response serialization, Scripture
  loading, commentary splitting, and study-block composition.
- `backend/src/middleware/` handles errors and rate limiting.

## Scripture and study layer

`data/bible/kjv.jsonl.gz` (KJV, 31,102 verses) and `data/bible/avd.jsonl.gz`
(AVD, 31,104 verses) use one JSON object per line: `{ book, chapter, verse,
text }`, with `book` normalized to this repository's slug. `book-codes.json`
maps the 66 source book codes to slugs. `*-source.json` records the pinned
source revision, license, counts, and SHA-256 checksums.

`services/scripture.js` loads each file once per process into a chapter/verse
map and exposes translation metadata (id, name, language, license, source,
counts) and `chapter()`, which returns every verse position from the translation
or from commentary ranges, with `null` text when the translation lacks that
book.

`routes/study.js` composes a chapter in this order:

1. Fetch all commentary sections for the chapter, ordered by `sequence_number`,
   plus their references for each requested language.
2. Emit commentary sections with no verse range first (chapter introductions
   and general sections).
3. Build a map from each range end to its commentary section(s).
4. Walk the sorted verse positions, accumulating a `verses` block. When a
   verse is a range end, flush the verse block and emit the commentary
   block(s), sorted by `sequence_number`.
5. Emit any remaining verses as the final block.

A section therefore appears once per range, not once per verse. This mirrors
the source app's `remove_dups` behavior and avoids duplicating long commentary.
Verse text is always bilingual (KJV and AVD); `lang` and `format` select the
commentary representation. Missing Scripture text is `null`; commentary ranges
still establish verse positions for deuterocanonical books.

`/study` responses are immutable per image build and set
`Cache-Control: public, max-age=86400, immutable` plus an ETag over the full
payload. `/scripture` remains the lighter verse-and-section-index view.

Scripture is deliberately not stored in SQLite. The two 66-book translations
are static, read-only inputs to the study composer, and loading them into memory
keeps the commentary schema and build validation unchanged.

## Per-verse commentary chunks

`backend/src/services/split-commentary.js` splits each ranged section's Markdown
at inline verse markers (`\[vN\]` and `\[N\]`) and at paragraph boundaries, so
tables and paragraphs stay intact. It removes the section's leading
`[v1] [v2]...` metadata list and strips the markers used as boundaries while
keeping out-of-range footnote markers. Arabic-Indic digits are normalized for
marker detection.

`build-db.js` renders each chunk to sanitized HTML and inserts it into
`commentary_chunks` with `(section_id, book_id, chapter, lang, sequence_number,
verse_start, verse_end, content_md, content_html, content_hash)`. The table is
indexed for `(lang, book_id, chapter, verse_start, verse_end)`.

`GET /api/v1/books/:book/chapters/:chapter/verses/:verse/commentary` queries
chunks where `verse_start <= verse <= verse_end`. It returns KJV/AVD text plus
each covering chunk, title, references, and the parent section URL. `lang=both`
returns one entry per language.

The split is source-driven: sections without inline verse markers remain a
single chunk covering their whole range. No verse boundaries are invented.

Current coverage: 6,349 ranged sections per language produce 12,457 English and
11,955 Arabic chunks. 1,928 English and 1,737 Arabic sections split into multiple
chunks; the remaining multi-verse sections stay as range chunks. One section
(`nt_9_6:6`, Galatians 6:6-10) contains only verse metadata and produces no
chunks, so its verses return an empty commentary list.

## Why SQLite is built at image build time

The workload is read-only and small. Building the database from committed
gzipped JSONL at image build time means:

- no database container, credentials, network latency, or backup process;
- no runtime writes, migrations, or volume that can drift or corrupt;
- atomic deploys, because the database is part of the image;
- straightforward rollback, by redeploying a previous image;
- identical content in CI, local Docker builds, and production.

FTS5 also provides better English and Arabic full-text search than a generic
document database text index while remaining inside the same single file.



## Commentary structure (schema v5)

Canonical chapter titles are `Introduction`/`Chapter N` (English) and `مقدمة`/`الإصحاح N` (Arabic). Descriptive session titles from source headings are stored separately as chapter `description_en`/`description_ar` when present; numbered headings, author names, and range labels do not become descriptions.

Author names are extracted to `sections.attribution_en`/`attribution_ar`. Section titles are canonicalized when the source title is attribution, generic, or missing; otherwise descriptive source titles are preserved.

Committed JSONL remains raw source. Display normalization (removing leading `[vN]` metadata, unescaping `\*\*`, normalizing list markers, collapsing blank lines) happens in `build-db.js`; the audit keeps comparisons against raw `content_markdown` to prove the committed source is unchanged.

Verse ranges are only derived when there is explicit evidence: bold opening Scripture quotations beginning with a verse number form a sequential sequence from verse 1 or 2 onward. Such sections are marked `verse_commentary` and chunked per verse/marker boundaries (including bold opening quotations). Sections with uncertain or no evidence remain `chapter_introduction` with `verse_ranges = []`. The study composer interleaves `commentary_chunks` so verse-specific commentary appears next to the corresponding verses; chunk blocks expose `scripture_quote` (the opening bold quotation) when present.

## Navigation and Bible search

Schema v5 stores both bundled translations in `scripture_verses`, keyed by
book/chapter/verse/language, with original display text and normalized search text.
`scripture_fts` indexes that normalized text using FTS5. The database builder
validates source positions and translation counts before atomically publishing
the rebuilt database. Runtime connections remain read-only.

`/navigation` combines Scripture positions with commentary ranges so websites can
construct book/chapter/verse pickers, including books without commentary.
`/resolve` parses explicit English/Arabic references and validates positions.
`/scripture/search` provides paginated whole-word/phrase search independent of
the existing commentary search and reverse citation lookup.
