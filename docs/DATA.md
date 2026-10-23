# Scripture data

The API ships two public-domain Scripture translations alongside the commentary.
Both are committed under `data/bible/` and loaded into memory at runtime by
`backend/src/services/scripture.js`. They are not part of `commentary.sqlite`.

## Files

| File | Purpose |
| --- | --- |
| `kjv.jsonl.gz` | King James Version verses, one JSON object per line |
| `kjv-source.json` | KJV provenance, counts, and checksums |
| `avd.jsonl.gz` | Arabic Smith–Van Dyke verses, one JSON object per line |
| `avd-source.json` | AVD provenance, counts, and checksums |
| `book-codes.json` | Maps source book codes to this repository's slugs |

## JSONL format

Each line is a single verse:

```json
{"book":"genesis","chapter":1,"verse":1,"text":"..."}
```

- `book` is the repository slug (`genesis`, `1-samuel`, `song-of-songs`).
- `chapter` and `verse` are positive integers.
- `text` is the verse text.
- Rows follow source book order, then chapter, then verse.
- There are no headers, comments, or blank lines inside the gzip payload.

## Sources and licenses

| Translation | ID | Language | Source | License | Verses | Books | Chapters |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| King James Version | KJV | English | `versions/en/kjv/kjv.json` | Public domain | 31,102 | 66 | 1,189 |
| Smith–Van Dyke | AVD | Arabic | `versions/ar/svd/svd.json` | Public domain | 31,104 | 66 | 1,189 |

Both source files are pinned to the same revision of
[`midvash/bible-data`](https://github.com/midvash/bible-data):

```text
d9fe1779447717bbfcb578e505b893125cad581c
```

Canonical source URLs:

```text
https://raw.githubusercontent.com/midvash/bible-data/d9fe1779447717bbfcb578e505b893125cad581c/versions/en/kjv/kjv.json
https://raw.githubusercontent.com/midvash/bible-data/d9fe1779447717bbfcb578e505b893125cad581c/versions/ar/svd/svd.json
```

`kjv-source.json` and `avd-source.json` record the source URL, source revision,
source SHA-256, JSONL SHA-256, gzip SHA-256, verse/book/chapter counts, and
license. AVD also records the SHA-256 of each of its 66 source book files in
`books_sha256`.

## Canon and missing text

Both files contain the 66-book Protestant canon. The commentary catalog also
contains deuterocanonical books (Wisdom, Sirach, Tobit, Judith, Baruch,
1–2 Maccabees) and Psalm 151. Those chapters have no KJV or AVD text.

`/scripture` and `/study` still expose verse positions derived from commentary
ranges, with missing text represented as `null`. A chapter with Scripture but no
commentary still returns `verses` blocks; a chapter with commentary but no
Scripture returns commentary blocks plus `null` verse text.

NKJV is copyrighted and is not included. Do not add it unless this repository
has a license permitting public redistribution and API serving.

## Regeneration

The committed JSONL files are the source of truth. To regenerate them:

1. Download the pinned source JSON shown above.
2. Convert each `book`, `chapter`, `verse`, and `text` field into one JSONL row
   using `book-codes.json`.
3. Validate the expected totals (KJV 31,102; AVD 31,104 verses, 66 books, 1,189
   chapters).
4. Write the JSONL with `gzip` level 9.
5. Record `source_sha256`, `jsonl_sha256`, and `gzip_sha256` in the matching
   `*-source.json`, along with the source URL, revision, counts, and license.

Keep `book-codes.json` stable unless the upstream book codes change.
