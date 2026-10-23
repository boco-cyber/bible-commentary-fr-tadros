const { bookSummary } = require('./serializer');

function languages(lang) {
  return lang === 'both' ? ['en', 'ar'] : [lang];
}

function sectionContent(section, langs, format) {
  const content = {};
  for (const lang of langs) {
    const representation = {};
    if (format === 'markdown' || format === 'both') representation.markdown = section[`content_md_${lang}`];
    if (format === 'html' || format === 'both') representation.html = section[`content_html_${lang}`];
    content[lang] = representation;
  }
  return content;
}

function referencePayload(ref) {
  return {
    type: ref.ref_type,
    book_id: ref.book_id,
    book_slug: ref.book_slug,
    book: { slug: ref.book_slug, name: { en: ref.book_name_en, ar: ref.book_name_ar } },
    chapter: ref.chapter,
    verse_start: ref.verse_start,
    verse_end: ref.verse_end,
    label: ref.label,
    display: ref.display,
  };
}

function groupReferences(refs, langs) {
  const grouped = {};
  for (const lang of langs) {
    const bySection = new Map();
    for (const ref of refs[lang] || []) {
      if (!bySection.has(ref.section_id)) bySection.set(ref.section_id, []);
      bySection.get(ref.section_id).push(referencePayload(ref));
    }
    grouped[lang] = bySection;
  }
  return grouped;
}

function commentaryBlock(section, { langs, format, references, baseUrl }) {
  const refs = {};
  for (const lang of langs) refs[lang] = references[lang].get(section.id) || [];
  return {
    type: 'commentary',
    id: section.id,
    index: section.section_index,
    title: { en: section.title_en, ar: section.title_ar },
    verse_ranges: JSON.parse(section.verse_ranges_json),
    content: sectionContent(section, langs, format),
    references: refs,
    content_hash: section.content_hash,
    url: `${baseUrl}/api/v1/sections/${section.id}`,
  };
}

function buildStudy({ book, chapter, scripture, sections, refs, lang, format, baseUrl }) {
  const langs = languages(lang);
  const references = groupReferences(refs, langs);
  const parsed = [...sections]
    .sort((left, right) => left.sequence_number - right.sequence_number)
    .map((section) => ({ section, ranges: JSON.parse(section.verse_ranges_json) }));

  const context = { langs, format, references, baseUrl };
  const blocks = parsed
    .filter(({ ranges }) => ranges.length === 0)
    .map(({ section }) => commentaryBlock(section, context));

  const byEnd = new Map();
  for (const { section, ranges } of parsed.filter((entry) => entry.ranges.length > 0)) {
    for (const [, end] of ranges) {
      if (!byEnd.has(end)) byEnd.set(end, []);
      byEnd.get(end).push(section);
    }
  }

  let verseBuffer = [];
  for (const verse of scripture.verses) {
    verseBuffer.push({ number: verse.number, text: verse.text });
    const ending = byEnd.get(verse.number);
    if (!ending) continue;
    blocks.push({ type: 'verses', verses: verseBuffer });
    verseBuffer = [];
    for (const section of ending.sort((left, right) => left.sequence_number - right.sequence_number)) {
      blocks.push(commentaryBlock(section, context));
    }
    byEnd.delete(verse.number);
  }
  if (verseBuffer.length) blocks.push({ type: 'verses', verses: verseBuffer });

  return {
    book: bookSummary(book),
    chapter: {
      number: chapter.number,
      title: { en: chapter.title_en, ar: chapter.title_ar },
      section_count: chapter.section_count,
      available: chapter.section_count > 0,
    },
    translations: scripture.translations,
    blocks,
  };
}

module.exports = { buildStudy };
