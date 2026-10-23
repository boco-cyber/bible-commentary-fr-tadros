const express = require('express');
const { findBook, findChapter, listSectionSummaries } = require('../db/queries');
const { chapterDetail } = require('../services/serializer');

function parseChapter(value) {
  if (value === 'intro') return 0;
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function chaptersRouter() {
  const router = express.Router();
  router.get('/books/:book/chapters/:chapter', (req, res) => {
    const db = req.app.locals.db;
    const book = findBook(db, req.params.book);
    const number = parseChapter(req.params.chapter);
    if (number === null) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid chapter' } });
    }
    const chapter = findChapter(db, book.id, number);
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    res.json({ data: chapterDetail(book, chapter, listSectionSummaries(db, chapter.id)) });
  });
  return router;
}

module.exports = { chaptersRouter, parseChapter };
