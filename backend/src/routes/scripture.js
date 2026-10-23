const express = require('express');
const { findBook, findChapter, listSectionSummaries } = require('../db/queries');
const { parseChapter } = require('./chapters');
const { createScriptureStore } = require('../services/scripture');

function scriptureRouter() {
  const router = express.Router();
  let store;
  router.get('/books/:book/chapters/:chapter/scripture', (req, res) => {
    const number = parseChapter(req.params.chapter);
    if (number === null || number < 1) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Scripture requires a chapter number greater than zero' } });
    const db = req.app.locals.db;
    const book = findBook(db, req.params.book);
    const chapter = findChapter(db, book.id, number);
    store ||= createScriptureStore();
    res.set('Cache-Control', 'public, max-age=3600');
    return res.json({ data: store.chapter(book.slug, number, listSectionSummaries(db, chapter.id)) });
  });
  return router;
}

module.exports = { scriptureRouter };
