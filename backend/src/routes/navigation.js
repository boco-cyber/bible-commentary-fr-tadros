const { commentaryAvailability } = require('../services/availability');
const express = require('express');
const { normalizeForSearch } = require('../services/normalize');
const { buildMatchQuery } = require('../services/search');
const { bookSummary } = require('../services/serializer');
const { findBookAny } = require('../db/queries');
const codes = { ...require('../../../data/bible/book-codes.json'), Jn: 'john', Mt: 'matthew', Mk: 'mark', Lk: 'luke' };

const alias = (value) => normalizeForSearch(value).toLowerCase().replace(/[\s.\-]/g, '');
const positive = (value) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

function navigationRouter() {
  const router = express.Router();
  router.get('/navigation', (req, res) => {
    const db = req.app.locals.db;
    const books = db.prepare('SELECT * FROM books ORDER BY id').all();
    const data = { books: books.map((book) => ({ ...bookSummary(book), commentary_available: !!book.included, commentary: commentaryAvailability(book.included) })) };
    if (req.query.chapter !== undefined && !req.query.book) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'chapter requires book' } });
    if (req.query.book) {
      const book = findBookAny(db, req.query.book);
      data.selected_book = bookSummary(book);
      data.chapters = db.prepare(`SELECT number, MAX(section_count) AS section_count FROM (
        SELECT number, section_count FROM chapters WHERE book_id = ? AND number > 0
        UNION ALL SELECT DISTINCT chapter AS number, 0 AS section_count FROM scripture_verses WHERE book_id = ?
      ) GROUP BY number ORDER BY number`).all(book.id, book.id);
      if (req.query.chapter !== undefined) {
        if (!positive(req.query.chapter)) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid chapter' } });
        const chapter = Number(req.query.chapter);
        if (!data.chapters.some((row) => row.number === chapter)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Chapter not found' } });
        data.chapter = chapter;
        data.commentary = commentaryAvailability(data.chapters.find((row) => row.number === chapter).section_count > 0);
        const numbers = db.prepare('SELECT DISTINCT verse FROM scripture_verses WHERE book_id = ? AND chapter = ? ORDER BY verse').all(book.id, chapter).map((row) => row.verse);
        const sections = db.prepare(`SELECT s.section_index, s.title_en, s.title_ar, s.verse_ranges_json FROM sections s JOIN chapters c ON c.id=s.chapter_id WHERE c.book_id=? AND c.number=? ORDER BY s.sequence_number`).all(book.id, chapter);
        const all = new Set(numbers);
        for (const section of sections) for (const [start, end] of JSON.parse(section.verse_ranges_json)) for (let v = start; v <= end; v++) all.add(v);
        data.verses = [...all].sort((a, b) => a - b).map((number) => ({ number, scripture_available: numbers.includes(number), sections: sections.filter((s) => JSON.parse(s.verse_ranges_json).some(([a, b]) => number >= a && number <= b)).map((s) => s.section_index) }));
        data.sections = sections.map((s) => ({ index: s.section_index, title: { en: s.title_en, ar: s.title_ar }, verse_ranges: JSON.parse(s.verse_ranges_json) }));
      }
    }
    res.json({ data });
  });

  router.get('/resolve', (req, res) => {
    const input = String(req.query.q || '').trim().replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632));
    const match = input.length <= 200 && input.match(/^(.+?)\s+(\d+)(?:\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/u);
    if (!match || !positive(match[2]) || (match[3] && (!positive(match[3]) || (match[4] && (!positive(match[4]) || Number(match[4]) < Number(match[3])))))) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Use a reference such as John 3:16 or John 3:16-18' } });
    const db = req.app.locals.db;
    const key = alias(match[1]);
    const book = db.prepare('SELECT * FROM books').all().find((b) => [b.slug, b.name_en, b.name_ar, b.short_en, b.short_ar, ...Object.keys(codes).filter((code) => codes[code] === b.slug)].filter(Boolean).some((name) => alias(name) === key));
    if (!book) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Book not found' } });
    const chapter = Number(match[2]);
    const start = match[3] ? Number(match[3]) : null;
    const end = match[4] ? Number(match[4]) : start;
    const rows = db.prepare('SELECT verse, lang, text FROM scripture_verses WHERE book_id=? AND chapter=? ORDER BY verse, lang').all(book.id, chapter);
    const sections = db.prepare(`SELECT s.verse_ranges_json FROM sections s JOIN chapters c ON c.id=s.chapter_id WHERE c.book_id=? AND c.number=?`).all(book.id, chapter);
    const numbers = new Set(rows.map((r) => r.verse));
    for (const s of sections) for (const [a, b] of JSON.parse(s.verse_ranges_json)) for (let v = a; v <= b; v++) numbers.add(v);
    if (!numbers.size || (start && (!numbers.has(start) || !numbers.has(end)))) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Reference not found' } });
    const verses = [...numbers].sort((a, b) => a - b).filter((v) => !start || (v >= start && v <= end)).map((number) => ({ number, text: { en: rows.find((r) => r.verse === number && r.lang === 'en')?.text || null, ar: rows.find((r) => r.verse === number && r.lang === 'ar')?.text || null } }));
    res.json({ data: { book: bookSummary(book), chapter, verse_start: start, verse_end: end, verses, links: { navigation: `/api/v1/navigation?book=${book.slug}&chapter=${chapter}`, scripture: `/api/v1/books/${book.slug}/chapters/${chapter}/scripture`, commentary: start && book.included && sections.length ? `/api/v1/books/${book.slug}/chapters/${chapter}/verses/${start}/commentary` : null } } });
  });

  router.get('/scripture/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    const lang = req.query.lang || 'en';
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    const match = buildMatchQuery(q);
    if (q.length < 2 || q.length > 200 || !/[\p{L}\p{N}]/u.test(q) || !['en', 'ar'].includes(lang) || !Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 100000 || !match || /[\u0000-\u001f\u007f]/.test(q)) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid search parameters' } });
    const db = req.app.locals.db;
    const params = [match, lang];
    let filter = '';
    if (req.query.book) { filter = ' AND v.book_id = ?'; params.push(findBookAny(db, req.query.book).id); }
    const from = `FROM scripture_fts f JOIN scripture_verses v ON v.id=f.rowid JOIN books b ON b.id=v.book_id WHERE scripture_fts MATCH ? AND v.lang=?${filter}`;
    const total = db.prepare(`SELECT count(*) AS n ${from}`).get(...params).n;
    const data = db.prepare(`SELECT b.slug, b.name_en, b.name_ar, v.chapter, v.verse, v.text ${from} ORDER BY b.id, v.chapter, v.verse LIMIT ? OFFSET ?`).all(...params, limit, offset).map((row) => ({ book: { slug: row.slug, name: { en: row.name_en, ar: row.name_ar } }, chapter: row.chapter, verse: row.verse, text: row.text, reference: `${row.name_en} ${row.chapter}:${row.verse}`, url: `/api/v1/resolve?q=${encodeURIComponent(`${row.slug} ${row.chapter}:${row.verse}`)}` }));
    res.json({ data, meta: { query: q, lang, translation: lang === 'en' ? 'KJV' : 'AVD' }, pagination: { total, limit, offset } });
  });
  return router;
}
module.exports = { navigationRouter };
