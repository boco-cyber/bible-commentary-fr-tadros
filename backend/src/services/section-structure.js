const ARABIC_DIGITS = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};
const EN_ATTRIBUTION = /^(?:St\.?|Saint|Pope|Fr\.?|Father|Bishop|Theodoret|Origen|Tertullian|Irenaeus|Augustine|Chrysostom|Cyril|Ambrose|Jerome|Basil|Gregory|Athanasius|Clement|Eusebius|Hippolytus|Methodius|Caesarius|Didymus|Dionysius|Justin|Melito|Novatian|Prosper|Salvian|Maximus|Nilus|Pachomius|Serapion|Shenouda)(?=$|[\s,.:;-])/i;
const AR_ATTRIBUTION = /^(?:القديس|العلامة|الأب|البابا|الأنبا|مار|المطران|القس|أوريجينوس|أغسطينوس|كيرلس|أثناسيوس|باسيليوس|إيرينيئوس|ترتليان|إكليمنضس|يوسابيوس|أمبروسيوس|جيروم|غريغوريوس|ثيودوريطس)(?=$|[\s،,.:;-])/;
const GENERIC = /^(?:Book Introduction|Chapter Introduction|Section [0-9٠-٩۰-۹]+|Title:?|Introduction:?|Intro|مقدمة(?:\s+السفر|\s+الإصحاح)?:?|العنوان:?|الأصحاح(?:\s+[٠-٩0-9]+)?|Chapter\s+[0-9٠-٩۰-۹]+|[0-9٠-٩۰-۹]+)$/i;
const RANGE_LABEL = /^(?:Ch|Chapters?|Section|ص|الأصحاح(?:ات|ان)?|الفصل|القسم|الجزء)\s*[0-9٠-٩۰-۹]+(?:\s*[-–—]\s*(?:ص\s*)?[0-9٠-٩۰-۹]+)?\s*:?$/i;
const VERSE_RANGE_LABEL = /^v?\s*[0-9٠-٩۰-۹]+(?:\s*[-–—]\s*v?\s*[0-9٠-٩۰-۹]+)?\s*:?$/i;
const NUMBERED = /^[٠-٩0-9]+\s*[.)-]/;
const RANGE_HEADING = /^(?:Chapters?|Ch|الأصحاحات|الأصحاحان|الأصحاح|الفصل|القسم|ص|من وحي|From the inspiration)(?=$|[\s،,.:;-])/i;
const BOOK_WORD = '(?:[A-Z][A-Za-z.]*|[\u0600-\u06FF]{2,})';
const BOLD_QUOTE = new RegExp(
  '^[ \t]*\\*\\*[ \t]*(?:\\[?v?[ \t]*)?([0-9٠-٩۰-۹]{1,3})(?![0-9٠-٩۰-۹])[ \t]*:?[ \t]+(?!\\.)'
    + `(?!(?:${BOOK_WORD}[ \\t]+){1,4}[0-9٠-٩۰-۹]+[ \\t]*[:：][ \\t]*[0-9٠-٩۰-۹]+)`,
  'gm',
);

function west(value) { return value.replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGITS[digit]); }
function isAttribution(text, lang) {
  const value = String(text || '').trim();
  if (!(lang === 'ar' ? AR_ATTRIBUTION : EN_ATTRIBUTION).test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  return words.length <= 8 && value.length <= 80;
}
function isGenericLabel(text) {
  const value = String(text || '').trim();
  return GENERIC.test(value) || RANGE_LABEL.test(value) || VERSE_RANGE_LABEL.test(value);
}
function isDescriptiveHeading(text, lang) {
  const value = String(text || '').trim();
  return Boolean(value) && !isGenericLabel(value) && !isAttribution(value, lang)
    && !NUMBERED.test(value) && !RANGE_HEADING.test(value);
}
function firstNameDescriptive(values, lang) {
  for (const value of values) if (isDescriptiveHeading(value, lang)) return String(value).trim();
  return null;
}
function canonicalChapterTitle(chapter, lang) {
  if (Number(chapter) === 0) return lang === 'ar' ? 'مقدمة' : 'Introduction';
  return lang === 'ar' ? `الإصحاح ${Number(chapter)}` : `Chapter ${Number(chapter)}`;
}
function generatedSectionTitle({ chapter, ranges }, lang) {
  if (Number(chapter) === 0) return lang === 'ar' ? 'مقدمة السفر' : 'Book Introduction';
  if (ranges.length === 1 && ranges[0][0] === ranges[0][1]) {
    return lang === 'ar' ? `الآيات ${ranges[0][0]}` : `Verses ${ranges[0][0]}`;
  }
  return lang === 'ar' ? `تفسير الإصحاح ${Number(chapter)}` : `Chapter ${Number(chapter)} commentary`;
}
function normalizeMarkdown(markdown) {
  let text = String(markdown || '');
  text = text.replace(/\\\*\\\*/g, '**');
  text = text.replace(/^[ \t]*(?:\\?\[v[^\]\n]*?\\?[\]\)][ \t]*)+$/gm, '');
  text = text.replace(/^[ \t]*\\?\[v[^\]\n]*?\\?[\]\)][ \t]*/gm, '');
  text = text.replace(/[ \t]*\\?\[v[^\]\n]*?\\?[\]\)][ \t]*/g, ' ');
  text = text.replace(/^[ \t]*\d+\][ \t]*$/gm, '');
  text = text.replace(/^[ \t]*\d+\][ \t]*/gm, '');
  text = text.replace(/[ \t]+\d+\]\b/g, ' ');
  text = text.replace(/^([ \t]*)\*[ \t]+/gm, '$1- ');
  text = text.replace(/^([ \t]*)\\\*[ \t]+/gm, '$1- ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/[ \t]*\n[ \t]*/g, '\n');
  return text.trim();
}
function deriveVerseRanges(markdown) {
  const numbers = [];
  for (const match of String(markdown || '').matchAll(BOLD_QUOTE)) {
    const verse = Number(west(match[1]));
    if (verse >= 1 && verse <= 200) numbers.push(verse);
  }
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  if (unique.length < 2 || unique[0] > 2) return [];
  for (let i = 1; i < unique.length; i += 1) if (unique[i] <= unique[i - 1]) return [];
  const ranges = [];
  let start = unique[0];
  let end = unique[0];
  for (const verse of unique.slice(1)) {
    if (verse === end + 1) { end = verse; continue; }
    ranges.push([start, end]);
    start = verse;
    end = verse;
  }
  ranges.push([start, end]);
  return ranges;
}
function sectionKind({ chapter, sectionIndex, ranges, chunkCount, attribution }) {
  if (Number(chapter) === 0) return 'book_introduction';
  if (!ranges.length) return 'chapter_introduction';
  if (chunkCount > 1) return 'verse_commentary';
  if (attribution && Number(sectionIndex) === 1 && ranges.length === 1 && ranges[0][0] <= 2) return 'chapter_commentary';
  return 'shared_commentary';
}
function extractOpeningQuote(markdown, verseStart, verseEnd) {
  const paragraphs = String(markdown || '').trim().split(/\n{2,}/);
  for (const paragraph of paragraphs.slice(0, 10)) {
    const match = [...paragraph.matchAll(BOLD_QUOTE)][0];
    if (!match) continue;
    const verse = Number(west(match[1]));
    if (verse < verseStart || verse > verseEnd) continue;
    if (!paragraph.trim().endsWith('**')) continue;
    return { verse, markdown: paragraph.trim() };
  }
  for (const paragraph of paragraphs) {
    const match = [...paragraph.matchAll(BOLD_QUOTE)][0];
    if (!match) continue;
    const verse = Number(west(match[1]));
    if (verse < verseStart || verse > verseEnd) continue;
    if (!paragraph.trim().endsWith('**')) continue;
    return { verse, markdown: paragraph.trim() };
  }
  return null;
}

module.exports = {
  isAttribution, isGenericLabel, isDescriptiveHeading, firstNameDescriptive,
  canonicalChapterTitle, generatedSectionTitle, normalizeMarkdown,
  deriveVerseRanges, sectionKind, extractOpeningQuote,
};
