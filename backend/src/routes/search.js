const express = require('express');
const sanitizeHtml = require('sanitize-html');
const { findBook, searchSections } = require('../db/queries');
const { buildMatchQuery } = require('../services/search');

function safeSnippet(value) {
  return sanitizeHtml(value, { allowedTags: ['mark'], allowedAttributes: {} });
}

function intParam(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function searchRouter() {
  const router = express.Router();
  router.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    const lang = req.query.lang || 'en';
    const limit = intParam(req.query.limit, 20, 1, 50);
    const offset = intParam(req.query.offset, 0, 0, 10000);
    const testament = req.query.testament;
    const chapter = req.query.chapter === undefined || req.query.chapter === ''
      ? undefined
      : intParam(req.query.chapter, null, 0, 200);
    if (q.length < 2 || q.length > 200 || /[\u0000-\u001F\u007F]/.test(q)
        || !['en', 'ar'].includes(lang) || limit === null || offset === null
        || (testament && !['ot', 'nt'].includes(testament)) || chapter === null) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid search parameters' } });
    }
    const match = buildMatchQuery(q);
    if (!match) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Empty search query' } });
    let bookId = null;
    if (req.query.book) bookId = findBook(req.app.locals.db, req.query.book).id;
    const { rows, total } = searchSections(req.app.locals.db, {
      match, lang, bookId, testament, chapter, limit, offset,
    });
    const baseUrl = req.app.locals.options.publicBaseUrl;
    res.json({
      data: rows.map((row) => ({
        id: row.id,
        book: { slug: row.book_slug, name: { en: row.name_en, ar: row.name_ar } },
        chapter: row.chapter_number,
        index: row.section_index,
        title: { [lang]: lang === 'ar' ? row.title_ar : row.title_en },
        verse_ranges: JSON.parse(row.verse_ranges_json),
        snippet: safeSnippet(row.snippet),
        url: `${baseUrl}/api/v1/books/${row.book_slug}/chapters/${row.chapter_number}/sections/${row.section_index}?lang=${lang}`,
      })),
      meta: { lang, query: q, attribution: 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب' },
      pagination: { limit, offset, total },
    });
  });
  return router;
}

module.exports = { searchRouter };
