const express = require('express');

function metaRouter() {
  const router = express.Router();
  router.get('/meta', (req, res) => {
    const db = req.app.locals.db;
    const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((row) => [row.key, row.value]));
    res.set('Cache-Control', 'public, max-age=3600');
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
