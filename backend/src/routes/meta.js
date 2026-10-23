const express = require('express');

function metaRouter() {
  const router = express.Router();
  router.get('/meta', (req, res) => {
    const db = req.app.locals.db;
    const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((row) => [row.key, row.value]));
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      data: {
        name: req.app.locals.options.siteName,
        attribution: meta.attribution,
        author: { en: meta.author_en, ar: meta.author_ar },
        work: { en: meta.work_en, ar: meta.work_ar },
        attribution_notice: meta.attribution_notice,
        notice: meta.attribution_notice,
        license: 'MIT (code only)',
        books: Number(meta.books),
        books_total: Number(meta.books_total),
        sections: Number(meta.sections),
        chunks: { en: Number(meta.chunks_en), ar: Number(meta.chunks_ar) },
        ref_segments: { en: Number(meta.ref_segments_en), ar: Number(meta.ref_segments_ar) },
        dropped_refs: { en: Number(meta.dropped_refs_en), ar: Number(meta.dropped_refs_ar) },
        languages: ['en', 'ar'],
        source_sha256: { en: meta.source_sha256_en, ar: meta.source_sha256_ar },
        source_sha256_en: meta.source_sha256_en,
        source_sha256_ar: meta.source_sha256_ar,
        content_checksum: meta.content_checksum,
        schema_version: Number(meta.schema_version),
        build: meta.built_at,
      },
    });
  });
  return router;
}

module.exports = { metaRouter };
