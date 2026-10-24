const crypto = require('node:crypto');
const express = require('express');
const {
  findBook, findChapter, listChapterSections, listChapterRefs, listChapterChunks,
} = require('../db/queries');
const { createScriptureStore } = require('../services/scripture');
const { buildStudy } = require('../services/study');
const { parseChapter } = require('./chapters');
const { parseFormat } = require('./sections');

function parseStudyLanguage(value) {
  const lang = value || 'en';
  return ['en', 'ar', 'both'].includes(lang) ? lang : null;
}

function studyRouter() {
  const router = express.Router();

  router.get('/books/:book/chapters/:chapter/study', (req, res) => {
    const number = parseChapter(req.params.chapter);
    const lang = parseStudyLanguage(req.query.lang);
    const format = parseFormat(req.query.format);
    if (number === null || number < 1 || !lang || !format) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid chapter, lang, or format' } });
    }

    const db = req.app.locals.db;
    const book = findBook(db, req.params.book);
    const chapter = findChapter(db, book.id, number);
    const sections = listChapterSections(db, chapter.id);
    const langs = lang === 'both' ? ['en', 'ar'] : [lang];
    const refs = {};
    for (const language of langs) refs[language] = listChapterRefs(db, chapter.id, language);

    const chunks = {};
    for (const language of langs) chunks[language] = listChapterChunks(db, chapter.id, language);

    req.app.locals.scriptureStore ||= createScriptureStore();
    const scripture = req.app.locals.scriptureStore.chapter(book.slug, number, sections);
    const data = buildStudy({
      book,
      chapter,
      scripture,
      sections,
      chunks,
      refs,
      lang,
      format,
      baseUrl: req.app.locals.options.publicBaseUrl,
    });
    const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((row) => [row.key, row.value]));
    const payload = {
      data,
      meta: {
        lang,
        format,
        attribution: 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب',
        version: meta.built_at,
      },
    };
    const etag = `"${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}"`;
    res.set('ETag', etag);
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    res.set('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    return res.json(payload);
  });

  return router;
}

module.exports = { studyRouter, parseStudyLanguage };
