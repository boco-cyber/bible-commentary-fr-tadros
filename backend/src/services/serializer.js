function bookSummary(row) {
  return {
    id: row.id,
    slug: row.slug,
    book_number: row.book_number,
    testament: row.testament,
    name: { en: row.name_en, ar: row.name_ar },
    short: { en: row.short_en, ar: row.short_ar },
    chapters_expected: row.chapters_expected,
  };
}

function bookDetail(row, chapters) {
  return {
    ...bookSummary(row),
    chapters: chapters.map((chapter) => ({
      number: chapter.number,
      title: { en: chapter.title_en, ar: chapter.title_ar },
      section_count: chapter.section_count,
      available: chapter.section_count > 0,
    })),
  };
}

function chapterDetail(book, chapter, sections) {
  return {
    book: bookSummary(book),
    chapter: {
      number: chapter.number,
      title: { en: chapter.title_en, ar: chapter.title_ar },
      section_count: chapter.section_count,
      available: chapter.section_count > 0,
    },
    sections: sections.map((section) => ({
      id: section.id,
      index: section.section_index,
      title: { en: section.title_en, ar: section.title_ar },
      verse_ranges: JSON.parse(section.verse_ranges_json),
    })),
  };
}

function sectionPayload(row, book, chapter, refs, lang, format, baseUrl) {
  const content = {};
  if (format === 'markdown' || format === 'both') content.markdown = row[`content_md_${lang}`];
  if (format === 'html' || format === 'both') content.html = row[`content_html_${lang}`];
  return {
    id: row.id,
    source_id: row.source_record_id,
    lang,
    book: bookSummary(book),
    chapter: { number: chapter.number, title: { en: chapter.title_en, ar: chapter.title_ar } },
    index: row.section_index,
    section_count: row.section_count,
    title: { [lang]: lang === 'ar' ? row.title_ar : row.title_en },
    verse_ranges: JSON.parse(row.verse_ranges_json),
    content,
    references: refs.map((ref) => ({
      type: ref.ref_type,
      book_id: ref.book_id,
      chapter: ref.chapter,
      verse_start: ref.verse_start,
      verse_end: ref.verse_end,
      label: ref.label,
      display: ref.display,
    })),
    content_hash: row.content_hash,
    url: `${baseUrl}/api/v1/sections/${row.id}`,
  };
}

module.exports = { bookSummary, bookDetail, chapterDetail, sectionPayload };
