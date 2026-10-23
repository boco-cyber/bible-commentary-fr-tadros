const crypto = require('node:crypto');
const express = require('express');
const {
  findBook, findChapter, listChapterSections, findVerseChunks, listSectionRefs,
} = require('../db/queries');
const { createScriptureStore } = require('../services/scripture');
const { bookSummary, referencePayload } = require('../services/serializer');
const { parseChapter } = require('./chapters');
const { parseFormat, parseStrictInt } = require('./sections');
const { parseStudyLanguage } = require('./study');

function chunkContent(chunk, format) {
  const content = {};
  if (format === 'markdown' || format === 'both') content.markdown = chunk.content_md;
  if (format === 'html' || format === 'both') content.html = chunk.content_html;
  return content;
}

function verseCommentaryRouter() {
  const router = express.Router();

  router.get('/books/:book/chapters/:chapter/verses/:verse/commentary', (req, res) => {
    const chapterNumber = parseChapter(req.params.chapter);
    const verse = parseStrictInt(req.params.verse);
    const lang = parseStudyLanguage(req.query.lang);
    const format = parseFormat(req.query.format);
    if (chapterNumber === null || chapterNumber < 1 || verse === null || verse < 1 || !lang || !format) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid chapter, verse, lang, or format' } });
    }

    const db = req.app.locals.db;
    const book = findBook(db, req.params.book);
    const chapter = findChapter(db, book.id, chapterNumber);
    const sections = listChapterSections(db, chapter.id);
    req.app.locals.scriptureStore ||= createScriptureStore();
    const scripture = req.app.locals.scriptureStore.chapter(book.slug, chapterNumber, sections);
    const verseData = scripture.verses.find((row) => row.number === verse);
    if (!verseData) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Verse not found' } });
    }

    const langs = lang === 'both' ? ['en', 'ar'] : [lang];
    const baseUrl = req.app.locals.options.publicBaseUrl;
    const commentary = [];
    for (const language of langs) {
      const chunks = findVerseChunks(db, { bookId: book.id, chapter: chapterNumber, verse, lang: language });
      for (const chunk of chunks) {
        commentary.push({
          id: chunk.id,
          section_id: chunk.section_id,
          index: chunk.section_index,
          lang: language,
          title: { en: chunk.title_en, ar: chunk.title_ar },
          verse_start: chunk.verse_start,
          verse_end: chunk.verse_end,
          content: chunkContent(chunk, format),
          references: listSectionRefs(db, chunk.section_id, language).map(referencePayload),
          content_hash: chunk.content_hash,
          url: `${baseUrl}/api/v1/sections/${chunk.section_id}`,
        });
      }
    }

    const builtAt = db.prepare("SELECT value FROM meta WHERE key = 'built_at'").get()?.value;
    const payload = {
      data: {
        book: bookSummary(book),
        chapter: {
          number: chapter.number,
          title: { en: chapter.title_en, ar: chapter.title_ar },
          section_count: chapter.section_count,
          available: chapter.section_count > 0,
        },
        number: verse,
        text: verseData.text,
        translations: scripture.translations,
        commentary,
      },
      meta: {
        lang,
        format,
        attribution: 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب',
        version: builtAt,
      },
    };
    const etag = `"${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}"`;
    res.set('ETag', etag);
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.set('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    return res.json(payload);
  });

  return router;
}

module.exports = { verseCommentaryRouter };
