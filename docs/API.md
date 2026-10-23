# API Reference

Base URL: `https://commentary.copticfaith.org/api/v1`

All endpoints are public, read-only, `GET`-only, and require no authentication or API key. The machine-readable contract is served at `/openapi.json`, and interactive documentation is available at `/docs/`.

## Conventions

- `lang=en|ar` selects the response language. Default: `en`.
- `format=html|markdown|both` selects section content representation. Default: `html`.
- `book` accepts a slug (`genesis`, `1-samuel`) or numeric id.
- `chapter` accepts `0` or `intro` for a book introduction.
- `index` is the 1-based section index within a chapter.
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
| `503` | Database unavailable |

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

### Full section

```bash
curl 'https://commentary.copticfaith.org/api/v1/sections/1?lang=en&format=html'
```

### Parallel English and Arabic

```bash
curl 'https://commentary.copticfaith.org/api/v1/parallel?book=genesis&chapter=1&index=1'
```

### Search

```bash
curl 'https://commentary.copticfaith.org/api/v1/search?q=creation&lang=en'
curl 'https://commentary.copticfaith.org/api/v1/search?q=الخلق&lang=ar&limit=10'
```

### Cross-references

```bash
curl 'https://commentary.copticfaith.org/api/v1/references?book=revelation&chapter=20&verse=2&lang=ar'
```

### JavaScript client

```js
const base = 'https://commentary.copticfaith.org/api/v1';
const chapter = await fetch(`${base}/books/genesis/chapters/1?lang=ar`).then((r) => r.json());
for (const summary of chapter.data.sections) {
  const full = await fetch(`${base}/sections/${summary.id}?lang=ar`).then((r) => r.json());
  console.log(full.data.title.ar, full.data.content.html);
}
```

## Caching

Section and parallel responses include an `ETag` derived from the content hash and representation. Send it back with `If-None-Match` to receive `304 Not Modified`:

```bash
curl -H 'If-None-Match: "<etag>"' 'https://commentary.copticfaith.org/api/v1/sections/1'
```

- Section content: `Cache-Control: public, max-age=86400, immutable` and `Vary: Accept-Encoding`.
- Catalog and metadata: `Cache-Control: public, max-age=3600`.
- ETags are representation-specific, so `lang` and `format` changes produce a different ETag.

## Rate limits

Requests are limited to 120 per minute per IP by default. The limit is configurable through `RATE_LIMIT_PER_MIN`. Exceeding it returns `429` with a `Retry-After` header.

## Attribution

The commentary is by Fr. Tadros Y. Malaty / القمص تادرس يعقوب. When displaying content, retain the attribution returned by `/meta` and described in [`NOTICE`](../NOTICE). The repository's MIT license covers code only, not the commentary text.
