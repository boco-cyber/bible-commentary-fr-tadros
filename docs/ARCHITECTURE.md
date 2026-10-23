# Architecture

## Overview

One Node.js 20 + Express service backed by a single read-only SQLite file.

```text
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
   - inserts all rows in one transaction and records attribution, source
     SHA-256s, a corpus content checksum, row/reference counts, and schema
     version 2.
3. The resulting `commentary.sqlite` is copied into the runtime image. Content
   changes therefore ship as new images, not as runtime imports.

## Schema summary

| Table | Purpose |
|---|---|
| `meta` | Build timestamp, schema version 2, row/reference/drop counts, attribution, source SHA-256s, corpus content checksum |
| `books` | Full 73-book catalog: id, slug, book number, testament, English/Arabic names, expected chapters, and `included` |
| `chapters` | One row per expected chapter, including chapter `0` book introductions and missing chapters with `section_count = 0` |
| `sections` | Paired English/Arabic content, titles, verse ranges, rendered HTML/Markdown, and content hash |
| `section_refs` | Per-language scripture reference tokens and resolved target ranges |
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
- `backend/src/routes/` contains the catalog, chapter, section, parallel,
  reference, search, and metadata endpoints.
- `backend/src/db/queries.js` holds prepared read-only queries.
- `backend/src/services/` handles Arabic-aware search parsing, Markdown
  rendering helpers, plain-text extraction, and response serialization.
- `backend/src/middleware/` handles errors and rate limiting.

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
