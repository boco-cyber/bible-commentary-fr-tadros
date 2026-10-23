const crypto = require('node:crypto');
const express = require('express');
const { findBook, findChapter, findSectionById, findSectionByIndex, listSectionRefs } = require('../db/queries');
const { sectionPayload } = require('../services/serializer');
const { parseChapter } = require('./chapters');

function parseLanguage(value) {
  const lang = value || 'en';
  return ['en', 'ar'].includes(lang) ? lang : null;
}

function parseFormat(value) {
  const format = value || 'html';
  return ['html', 'markdown', 'both'].includes(format) ? format : null;
}

function parseStrictInt(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function sectionEtag(section, lang, format) {
  return `"${crypto.createHash('sha256').update(`${section.content_hash}:${lang}:${format}`).digest('hex')}"`;
}

function parallelEtag(section, format) {
  return `"${crypto.createHash('sha256').update(`${section.content_hash}:both:${format}`).digest('hex')}"`;
}

function sendSection(req, res, section) {
  const db = req.app.locals.db;
  const format = parseFormat(req.query.format);
  if (!format) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid lang or format' } });
  }
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(section.chapter_id);
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(chapter.book_id);
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
  const baseUrl = req.app.locals.options.publicBaseUrl;
  const responseMeta = { attribution: 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب', version: meta.built_at };

  if (req.query.parallel === '1') {
    const make = (lang) => sectionPayload(
      section, book, chapter, listSectionRefs(db, section.id, lang), lang, format, baseUrl,
    );
    const etag = parallelEtag(section, format);
    res.set('ETag', etag);
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    res.set('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    return res.json({ data: { en: make('en'), ar: make('ar') }, meta: responseMeta });
  }

  const lang = parseLanguage(req.query.lang);
  if (!lang) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid lang or format' } });
  }
  const data = sectionPayload(
    section,
    book,
    chapter,
    listSectionRefs(db, section.id, lang),
    lang,
    format,
    baseUrl,
  );
  const etag = sectionEtag(section, lang, format);
  res.set('ETag', etag);
  res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  res.set('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.json({ data, meta: { lang, ...responseMeta } });
}

function sectionsRouter() {
  const router = express.Router();

  router.get('/books/:book/chapters/:chapter/sections/:index', (req, res) => {
    const db = req.app.locals.db;
    const book = findBook(db, req.params.book);
    const number = parseChapter(req.params.chapter);
    const index = parseStrictInt(req.params.index);
    if (number === null || index === null || index < 1) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid chapter or index' } });
    }
    const chapter = findChapter(db, book.id, number);
    const section = findSectionByIndex(db, chapter.id, index);
    if (!section) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Section not found' } });
    sendSection(req, res, section);
  });

  router.get('/sections/:id', (req, res) => {
    const id = parseStrictInt(req.params.id);
    if (id === null || id < 1) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid section id' } });
    }
    const section = findSectionById(req.app.locals.db, id);
    if (!section) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Section not found' } });
    sendSection(req, res, section);
  });

  return router;
}

module.exports = { sectionsRouter, parseLanguage, parseFormat, parseStrictInt, sectionEtag, parallelEtag };
