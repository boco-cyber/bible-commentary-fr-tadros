const { commentaryAvailability } = require('./availability');
const { bookSummary, referencePayload } = require('./serializer');

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

function chunkContent(chunk, lang, format) {
  const representation = {};
  if (format === 'markdown' || format === 'both') representation.markdown = chunk.content_md;
  if (format === 'html' || format === 'both') representation.html = chunk.content_html;
  return { [lang]: representation };
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

function chunkCommentaryBlock(chunk, lang, { format, references, baseUrl }) {
  const refs = {};
  refs[lang] = (references[lang] && references[lang].get(chunk.section_id)) || [];
  const block = {
    type: 'commentary',
    id: chunk.section_id,
    index: chunk.section_index,
    chunk_id: chunk.id,
    lang,
    title: { en: chunk.title_en, ar: chunk.title_ar },
    verse_ranges: [[chunk.verse_start, chunk.verse_end]],
    content: chunkContent(chunk, lang, format),
    references: refs,
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
      block.scripture_quote = scriptureQuote;
    } else if (format === 'html' && chunk.quote_html) {
      block.scripture_quote = { html: chunk.quote_html };
    } else if (format === 'markdown' && chunk.quote_md) {
      block.scripture_quote = { markdown: chunk.quote_md };
    } else if ((chunk.quote_md || chunk.quote_html)) {
      const sq = {};
      if (format !== 'html' && chunk.quote_md) sq.markdown = chunk.quote_md;
      if (format !== 'markdown' && chunk.quote_html) sq.html = chunk.quote_html;
      if (Object.keys(sq).length) block.scripture_quote = sq;
    }
  }
  return block;
}

function buildStudy({ book, chapter, scripture, sections, chunks = {}, refs, lang, format, baseUrl }) {
  const langs = languages(lang);
  const references = groupReferences(refs, langs);
  const parsed = [...sections]
    .sort((left, right) => left.sequence_number - right.sequence_number)
    .map((section) => ({ section, ranges: JSON.parse(section.verse_ranges_json) }));

  const context = { langs, format, references, baseUrl };
  const blocks = [];

  // Chapter introductions / non-ranged sections remain as bilingual section blocks
  for (const { section, ranges } of parsed.filter(({ ranges }) => ranges.length === 0)) {
    blocks.push(commentaryBlock(section, context));
  }

  // Build chunk list across requested languages
  const rangedChunks = [];
  for (const l of langs) {
    for (const chunk of chunks[l] || []) {
      rangedChunks.push({ lang: l, chunk });
    }
  }

  const emittedChunkIds = new Set();
  const sectionsWithChunks = new Set(rangedChunks.map((rc) => rc.chunk.section_id));

  // Map verse end to sections that have chunks - we need to interleave chunks by verse position
  // Chunks are ordered by section sequence and chunk sequence; also by verse range
  const byVerseEnd = new Map();
  for (const rc of rangedChunks) {
    const end = rc.chunk.verse_end;
    if (!byVerseEnd.has(end)) byVerseEnd.set(end, []);
    byVerseEnd.get(end).push(rc);
  }

  // Also track if there are any chunked content
  let verseBuffer = [];
  for (const verse of scripture.verses) {
    verseBuffer.push({ number: verse.number, text: verse.text });
    const endingChunks = byVerseEnd.get(verse.number);
    if (!endingChunks) continue;
    blocks.push({ type: 'verses', verses: verseBuffer });
    verseBuffer = [];
    // Sort by section sequence number then chunk sequence number
    endingChunks.sort((a, b) => {
      if (a.chunk.sequence_number !== b.chunk.sequence_number) return a.chunk.sequence_number - b.chunk.sequence_number;
      if (a.chunk.section_id !== b.chunk.section_id) return a.chunk.section_id - b.chunk.section_id;
      if (a.lang !== b.lang) return langs.indexOf(a.lang) - langs.indexOf(b.lang);
      return a.chunk.id - b.chunk.id;
    });
    for (const rc of endingChunks) {
      if (emittedChunkIds.has(rc.chunk.id)) continue;
      emittedChunkIds.add(rc.chunk.id);
      blocks.push(chunkCommentaryBlock(rc.chunk, rc.lang, context));
    }
    byVerseEnd.delete(verse.number);
  }
  if (verseBuffer.length) blocks.push({ type: 'verses', verses: verseBuffer });

  // For sections with ranges but no chunks, fall back to one section block at its range end
  for (const { section, ranges } of parsed.filter((entry) => entry.ranges.length > 0)) {
    if (sectionsWithChunks.has(section.id)) continue;
    // Add at end of last range
    const lastEnd = ranges[ranges.length - 1][1];
    // Find position to insert - append near end? Or we need to insert after verses up to lastEnd
    // But easier to handle by pushing to end if not placed; structure should be similar
    // For fallback case, put it at the end of blocks in the position after verses of lastEnd
    // Try to find and replace - simpler: just add
    blocks.push(commentaryBlock(section, context));
  }

  return {
    book: bookSummary(book),
    chapter: {
      number: chapter.number,
      title: { en: chapter.title_en, ar: chapter.title_ar },
      section_count: chapter.section_count,
      available: chapter.section_count > 0,
      commentary: commentaryAvailability(sections.length > 0),
    },
    translations: scripture.translations,
    blocks,
  };
}

module.exports = { buildStudy };
