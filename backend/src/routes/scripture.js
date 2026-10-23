const express = require('express');
const { findBookAny, listSectionSummaries } = require('../db/queries');
const { parseChapter } = require('./chapters');
const { createScriptureStore } = require('../services/scripture');

function scriptureRouter() {
  const router = express.Router();
  router.get('/books/:book/chapters/:chapter/scripture', (req, res) => {
    const number = parseChapter(req.params.chapter);
    if (number === null || number < 1) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Scripture requires a chapter number greater than zero' } });
    const db = req.app.locals.db;
    const book = findBookAny(db, req.params.book);
    const chapter = db.prepare('SELECT id FROM chapters WHERE book_id=? AND number=?').get(book.id, number);
    req.app.locals.scriptureStore ||= createScriptureStore();
    res.set('Cache-Control', 'public, max-age=3600');
    const data = req.app.locals.scriptureStore.chapter(book.slug, number, chapter ? listSectionSummaries(db, chapter.id) : []);
    if (!chapter && !data.verses.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Chapter not found' } });
    return res.json({ data });
  });
  return router;
}

module.exports = { scriptureRouter };
