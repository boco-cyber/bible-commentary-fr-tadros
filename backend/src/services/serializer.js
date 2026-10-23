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

module.exports = { bookSummary, bookDetail, chapterDetail };
