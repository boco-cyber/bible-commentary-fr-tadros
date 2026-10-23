const express = require('express');
const { listBooks, findBook, listChapters } = require('../db/queries');
const { bookSummary, bookDetail } = require('../services/serializer');

function catalogRouter() {
  const router = express.Router();

  router.get('/books', (req, res) => {
    const testament = req.query.testament;
    if (testament && !['ot', 'nt'].includes(testament)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'testament must be ot or nt' } });
    }
    res.json({ data: listBooks(req.app.locals.db, testament).map(bookSummary) });
  });

  router.get('/books/:book', (req, res) => {
    const db = req.app.locals.db;
    const book = findBook(db, req.params.book);
    res.json({ data: bookDetail(book, listChapters(db, book.id)) });
  });

  return router;
}

module.exports = { catalogRouter };
