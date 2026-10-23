# Bible Commentary API — Fr. Tadros Y. Malaty

A public, read-only, bilingual (English/Arabic) REST API for the Bible
commentary of Fr. Tadros Y. Malaty / القمص تادرس يعقوب.

- Production: `https://commentary.copticfaith.org`
- Interactive docs: `https://commentary.copticfaith.org/docs/`
- OpenAPI document: `https://commentary.copticfaith.org/openapi.json`
- No authentication, no API key, `GET` only.

## What is included

- All 67 covered books (of the 73-book catalog), 7,590 sections in each language.
- Catalog, chapter, section, and parallel English/Arabic endpoints.
- Bilingual full-text search with highlighted snippets.
- Scripture cross-reference lookup in both directions.
- Bilingual verse reader using public-domain KJV and Arabic Smith–Van Dyke.
- Combined `/study` endpoint with commentary blocks placed after each verse range.
- SQLite + FTS5 inside a single image; no external database.

## Quick start

Requires Node.js 20 or newer.

```bash
cd backend
npm install
npm run build:db
npm test
npm run dev
```

The committed gzipped JSONL under `data/` is the source of truth, so no
extraction step is needed for a normal checkout.

The server listens on `http://localhost:3000` by default. Configuration lives
in `backend/.env.example`.

## API overview

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness and corpus counts |
| `GET /api/v1/meta` | Author, attribution, languages, counts, build |
| `GET /api/v1/books` | Book catalog, optionally filtered by testament |
| `GET /api/v1/books/:book` | Book detail and chapter list |
| `GET /api/v1/books/:book/chapters/:chapter` | Chapter and section summaries |
| `GET /api/v1/books/:book/chapters/:chapter/scripture` | Verse text (KJV + AVD) and commentary indices |
| `GET /api/v1/books/:book/chapters/:chapter/study` | Verses with commentary blocks after each verse range |
| `GET /api/v1/books/:book/chapters/:chapter/sections/:index` | Full section |
| `GET /api/v1/sections/:id` | Full section by id |
| `GET /api/v1/parallel` | Same section in English and Arabic |
| `GET /api/v1/search` | Bilingual full-text search |
| `GET /api/v1/references` | Sections citing a verse |

See [docs/API.md](docs/API.md) for parameters, examples, caching, and errors.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data model and build
flow, [docs/DATA.md](docs/DATA.md) for Scripture provenance and formats, and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Coolify deployment.

## Data pipeline

`backend/scripts/build-db.js` validates the committed gzipped JSONL and builds
`commentary.sqlite` during CI and Docker image builds. The server opens the
database read-only and never writes to it at runtime.

`data/bible/` holds the committed public-domain KJV and Arabic Smith–Van Dyke
JSONL. The Scripture and study routes load these once into memory; they are not
part of `commentary.sqlite`. See [docs/DATA.md](docs/DATA.md).

### Regenerating data

Only maintainers with the original extraction need to regenerate the committed
JSONL. Pass the source directory (the one containing `english/json/`,
`arabic/json/`, and `metadata/catalog.json`) and optionally an output directory:

```bash
cd backend
node scripts/prepare-data.js /path/to/extracted
npm run build:db
```

`prepare-data.js` verifies 7,590 records per language and the 67 included
catalog books before writing `data/`.

## License

The code is licensed under the MIT License; see [LICENSE](LICENSE). The
commentary text is not relicensed by the MIT License and remains subject to the
attribution and permission notice in [NOTICE](NOTICE).

## Bible text for the verse reader

The verse reader uses two public-domain translations:

| Language | Translation | File | Verses |
| --- | --- | --- | ---: |
| English | King James Version (KJV) | `data/bible/kjv.jsonl.gz` | 31,102 |
| Arabic | Smith–Van Dyke (AVD, 1865) | `data/bible/avd.jsonl.gz` | 31,104 |

Both are 66-book editions, so deuterocanonical books in the commentary catalog
have verse positions and commentary but `null` Scripture text. Provenance,
source URLs, and SHA-256 checksums are in `data/bible/*-source.json` and
[docs/DATA.md](docs/DATA.md). NKJV is not included.

- `GET /api/v1/books/:book/chapters/:chapter/scripture` returns every verse with both translations and the commentary section indices that cover it.
- `GET /api/v1/books/:book/chapters/:chapter/study` returns ordered `verses` blocks and one `commentary` block after each verse range. Use `lang=en|ar|both` and `format=html|markdown|both` for the commentary representation.

See [docs/API.md](docs/API.md) for the block shape and examples.
