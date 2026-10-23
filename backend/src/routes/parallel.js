const express = require('express');
const { findBook, findChapter, findSectionByIndex, listSectionRefs } = require('../db/queries');
const { sectionPayload } = require('../services/serializer');
const { parseChapter } = require('./chapters');
const { parseFormat, parseStrictInt, parallelEtag } = require('./sections');

function parallelRouter() {
  const router = express.Router();
  router.get('/parallel', (req, res) => {
    const db = req.app.locals.db;
    const book = findBook(db, req.query.book);
    const number = parseChapter(String(req.query.chapter));
    const index = parseStrictInt(req.query.index);
    const format = parseFormat(req.query.format);
    if (number === null || index === null || index < 1 || !format) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid chapter, index, or format' } });
    }
    const chapter = findChapter(db, book.id, number);
    const section = findSectionByIndex(db, chapter.id, index);
    if (!section) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Section not found' } });
    const baseUrl = req.app.locals.options.publicBaseUrl;
    const make = (lang) => sectionPayload(
      section, book, chapter, listSectionRefs(db, section.id, lang), lang, format, baseUrl,
    );
    const etag = parallelEtag(section, format);
    res.set('ETag', etag);
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.set('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.json({ data: { en: make('en'), ar: make('ar') }, meta: { attribution: 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب' } });
  });
  return router;
}

module.exports = { parallelRouter };
