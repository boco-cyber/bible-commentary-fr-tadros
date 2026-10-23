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
| `GET /api/v1/books/:book/chapters/:chapter/sections/:index` | Full section |
| `GET /api/v1/sections/:id` | Full section by id |
| `GET /api/v1/parallel` | Same section in English and Arabic |
| `GET /api/v1/search` | Bilingual full-text search |
| `GET /api/v1/references` | Sections citing a verse |

See [docs/API.md](docs/API.md) for parameters, examples, caching, and errors.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data model and build
flow, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Coolify deployment.

## Data pipeline

`backend/scripts/build-db.js` validates the committed gzipped JSONL and builds
`commentary.sqlite` during CI and Docker image builds. The server opens the
database read-only and never writes to it at runtime.

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
