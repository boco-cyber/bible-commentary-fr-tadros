const { commentaryAvailability } = require('../services/availability');
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
    let commentary = [];
    for (const language of langs) {
      const chunks = findVerseChunks(db, { bookId: book.id, chapter: chapterNumber, verse, lang: language });
      for (const chunk of chunks) {
        const entry = {
          id: chunk.id,
          section_id: chunk.section_id,
          scope: chunk.verse_start === chunk.verse_end ? 'verse' : 'range',
          index: chunk.section_index,
          lang: language,
          title: { en: chunk.title_en, ar: chunk.title_ar },
          verse_start: chunk.verse_start,
          verse_end: chunk.verse_end,
          content: chunkContent(chunk, format),
          references: listSectionRefs(db, chunk.section_id, language).map(referencePayload),
          content_hash: chunk.content_hash,
          url: `${baseUrl}/api/v1/sections/${chunk.section_id}`,
        };
        if (chunk.quote_md || chunk.quote_html) {
          const scriptureQuote = {
            markdown: format === 'html' ? undefined : chunk.quote_md,
            html: format === 'markdown' ? undefined : chunk.quote_html,
          };
          if (scriptureQuote.markdown === undefined) delete scriptureQuote.markdown;
          if (scriptureQuote.html === undefined) delete scriptureQuote.html;
          if (Object.keys(scriptureQuote).length > 0) {
            entry.scripture_quote = scriptureQuote;
          } else if (chunk.quote_md || chunk.quote_html) {
            entry.scripture_quote = chunk.quote_md || chunk.quote_html ? {
              ...(format !== 'html' && chunk.quote_md ? { markdown: chunk.quote_md } : {}),
              ...(format !== 'markdown' && chunk.quote_html ? { html: chunk.quote_html } : {}),
            } : null;
            if (entry.scripture_quote && Object.keys(entry.scripture_quote).length === 0) {
              entry.scripture_quote = null;
            }
          }
        }
        commentary.push(entry);
      }
    }

    // Preserve original shared source context without claiming it is verse-specific.
    const sharedCommentary = commentary.filter((entry) => entry.scope === 'range');
    commentary = commentary.filter((entry) => entry.scope === 'verse');
    for (const language of langs) {
      for (const section of sections) {
        if ([...commentary, ...sharedCommentary].some((entry) => entry.lang === language && entry.section_id === section.id)) continue;
        const ranges = JSON.parse(section.verse_ranges_json);
        if (!ranges.some(([start, end]) => verse >= start && verse <= end)) continue;
        const content = {};
        if (format === 'markdown' || format === 'both') content.markdown = section[`content_md_${language}`];
        if (format === 'html' || format === 'both') content.html = section[`content_html_${language}`];
        sharedCommentary.push({
          id: `section:${section.id}:${language}`, section_id: section.id, lang: language,
          scope: 'section', verse_ranges: ranges, title: { en: section.title_en, ar: section.title_ar },
          content, url: `${baseUrl}/api/v1/sections/${section.id}`,
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
        shared_commentary: sharedCommentary,
        source_commentary_status: Object.fromEntries(langs.map((language) => [language,
          commentaryAvailability(commentary.some((entry) => entry.lang === language) || sharedCommentary.some((entry) => entry.lang === language)),
        ])),
        commentary_status: Object.fromEntries(langs.map((language) => [language,
          commentary.some((entry) => entry.lang === language)
            ? commentaryAvailability(true)
            : sharedCommentary.some((entry) => entry.lang === language)
              ? { available: false, status: 'shared_only', message: { en: 'No verse-specific commentary available', ar: 'لا يوجد تفسير خاص بهذه الآية' } }
              : commentaryAvailability(false),
        ])),
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
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    res.set('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    return res.json(payload);
  });

  return router;
}

module.exports = { verseCommentaryRouter };
