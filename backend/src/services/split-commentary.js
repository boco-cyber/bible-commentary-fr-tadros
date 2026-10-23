const ARABIC_DIGITS = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};
const MARKER = /\\\[(v?)([٠-٩۰-۹0-9]+)\\\]/g;
const LEADING_VERSES = /^(?:\s*\[v[٠-٩۰-۹0-9]+\])+\s*/;

function westernDigits(value) {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGITS[digit]);
}

function paragraphAt(text, index) {
  const before = text.lastIndexOf('\n\n', index);
  const after = text.indexOf('\n\n', index);
  return {
    start: before === -1 ? 0 : before + 2,
    end: after === -1 ? text.length : after,
  };
}

function isBoldOnly(text) {
  const spans = text.match(/\*\*[\s\S]*?\*\*/g) || [];
  if (!spans.length) return false;
  const covered = spans.map((span) => span.replace(/\*\*/g, '')).join('').replace(/\s+/g, '');
  const all = text.replace(/\*\*/g, '').replace(/\s+/g, '');
  return covered.length > 0 && covered === all;
}

function previousParagraph(text, start) {
  if (start <= 0) return null;
  const end = Math.max(0, start - 2);
  const before = text.lastIndexOf('\n\n', end - 1);
  return { start: before === -1 ? 0 : before + 2, end };
}

function quoteStart(text, marker, minimum) {
  let start = marker.paragraphStart;
  while (start > minimum) {
    const previous = previousParagraph(text, start);
    if (!previous || previous.start < minimum || !isBoldOnly(text.slice(previous.start, previous.end))) break;
    start = previous.start;
  }
  return start;
}

function findMarkers(text, verseStart, verseEnd) {
  const candidates = [];
  for (const match of text.matchAll(MARKER)) {
    const explicit = match[1] === 'v';
    const verse = Number(westernDigits(match[2]));
    if (!Number.isInteger(verse) || verse < verseStart || verse > verseEnd) continue;
    const paragraph = paragraphAt(text, match.index);
    const body = text.slice(paragraph.start, paragraph.end);
    if (!explicit && !/\*\*|["“”]/.test(body)) continue;
    candidates.push({ verse, explicit, paragraphStart: paragraph.start, paragraphEnd: paragraph.end });
  }
  candidates.sort((left, right) => left.paragraphStart - right.paragraphStart);
  const selected = [];
  const starts = new Set();
  let lastVerse = verseStart - 1;
  for (const candidate of candidates) {
    if (candidate.verse <= lastVerse || starts.has(candidate.paragraphStart)) continue;
    selected.push(candidate);
    starts.add(candidate.paragraphStart);
    lastVerse = candidate.verse;
  }
  let minimum = 0;
  for (let index = 0; index < selected.length; index += 1) {
    if (index === 0) {
      selected[index].boundaryStart = 0;
    } else {
      const previous = selected[index - 1];
      minimum = Math.max(minimum, previous.paragraphEnd + 2);
      selected[index].boundaryStart = Math.max(minimum, quoteStart(text, selected[index], minimum));
      minimum = Math.max(minimum, selected[index].boundaryStart);
    }
  }
  return selected;
}

function cleanChunk(text, verseStart, verseEnd) {
  return text
    .replace(LEADING_VERSES, '')
    .replace(/\\\[v[٠-٩۰-۹0-9]+\\\]/g, '')
    .replace(/\\\[([٠-٩۰-۹0-9]+)\\\]/g, (match, digits) => {
      const verse = Number(westernDigits(digits));
      return verse >= verseStart && verse <= verseEnd ? '' : match;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitCommentary(markdown, verseStart, verseEnd) {
  const body = String(markdown || '').replace(LEADING_VERSES, '');
  if (!body.trim()) return [];
  const markers = findMarkers(body, verseStart, verseEnd);
  const chunks = [];

  if (markers.length >= 2) {
    for (let index = 0; index < markers.length; index += 1) {
      const start = index === 0 ? 0 : markers[index].boundaryStart;
      const end = index + 1 < markers.length ? markers[index + 1].boundaryStart : body.length;
      const rangeStart = index === 0 ? verseStart : markers[index].verse;
      const rangeEnd = index + 1 < markers.length ? markers[index + 1].verse - 1 : verseEnd;
      chunks.push({
        verseStart: rangeStart,
        verseEnd: Math.max(rangeStart, rangeEnd),
        markdown: cleanChunk(body.slice(start, end), verseStart, verseEnd),
      });
    }
  } else {
    chunks.push({ verseStart, verseEnd, markdown: cleanChunk(body, verseStart, verseEnd) });
  }

  const result = [];
  let expected = verseStart;
  for (const chunk of chunks) {
    if (!chunk.markdown) {
      if (result.length) result[result.length - 1].verseEnd = chunk.verseEnd;
      continue;
    }
    if (chunk.verseStart > expected) chunk.verseStart = expected;
    result.push(chunk);
    expected = chunk.verseEnd + 1;
  }
  if (!result.length) return [{ verseStart, verseEnd, markdown: cleanChunk(body, verseStart, verseEnd) }];
  if (result[0].verseStart > verseStart) result[0].verseStart = verseStart;
  if (result[result.length - 1].verseEnd < verseEnd) result[result.length - 1].verseEnd = verseEnd;
  return result;
}

module.exports = { splitCommentary };
