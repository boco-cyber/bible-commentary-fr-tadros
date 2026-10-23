const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DEFAULT_DIR = path.join(__dirname, '..', '..', '..', 'data', 'bible');
const TRANSLATIONS = {
  en: { id: 'KJV', file: 'kjv', name: 'King James Version', language: 'en' },
  ar: { id: 'AVD', file: 'avd', name: 'Arabic Smith–Van Dyke (1865)', language: 'ar' },
};

function readSourceMetadata(directory, file) {
  const filename = path.join(directory, `${file}-source.json`);
  if (!fs.existsSync(filename)) return {};
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function createScriptureStore(directory = DEFAULT_DIR) {
  const sources = {};
  for (const [lang, translation] of Object.entries(TRANSLATIONS)) {
    const file = path.join(directory, `${translation.file}.jsonl.gz`);
    const metadata = readSourceMetadata(directory, translation.file);
    const chapters = new Map();
    const books = new Set();
    let loadedVerses = 0;
    const available = fs.existsSync(file);
    if (available) {
      for (const line of zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').trim().split('\n')) {
        const row = JSON.parse(line);
        const key = `${row.book}:${row.chapter}`;
        if (!chapters.has(key)) chapters.set(key, new Map());
        chapters.get(key).set(row.verse, row.text);
        books.add(row.book);
        loadedVerses += 1;
      }
    }
    sources[lang] = {
      ...translation,
      available,
      chapters,
      verses: metadata.verses || loadedVerses,
      books: metadata.books || books.size,
      chapterCount: metadata.chapters || chapters.size,
      license: metadata.license,
      source: metadata.source,
    };
  }

  const translations = Object.fromEntries(Object.entries(sources).map(([lang, source]) => [lang, {
    id: source.id,
    name: source.name,
    language: source.language,
    license: source.license,
    source: source.source,
    available: source.available,
    verses: source.verses,
    books: source.books,
    chapters: source.chapterCount,
  }]));

  return {
    translations,
    chapter(book, chapter, sections) {
      const key = `${book}:${chapter}`;
      const verseNumbers = new Set();
      const chapterTranslations = {};
      for (const [lang, source] of Object.entries(sources)) {
        const verses = source.chapters.get(key);
        if (verses) for (const number of verses.keys()) verseNumbers.add(number);
        chapterTranslations[lang] = {
          id: source.id,
          name: source.name,
          language: source.language,
          license: source.license,
          source: source.source,
          status: verses ? 'available' : source.available ? 'not_found' : 'source_required',
        };
      }
      // Retain verse positions covered by commentary even when that translation
      // or a deuterocanonical book has no imported Scripture text.
      for (const section of sections) {
        for (const [start, end] of JSON.parse(section.verse_ranges_json)) {
          for (let number = start; number <= end; number += 1) verseNumbers.add(number);
        }
      }
      return {
        book, chapter, translations: chapterTranslations,
        verses: [...verseNumbers].sort((a, b) => a - b).map((number) => ({
          number,
          text: Object.fromEntries(Object.entries(sources).map(([lang, source]) => [lang, source.chapters.get(key)?.get(number) || null])),
          sections: sections.filter((section) => JSON.parse(section.verse_ranges_json).some(([start, end]) => number >= start && number <= end)).map((section) => section.section_index),
        })),
      };
    },
  };
}

module.exports = { createScriptureStore };
