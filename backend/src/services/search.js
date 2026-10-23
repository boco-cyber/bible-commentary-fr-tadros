const { normalizeForSearch } = require('./normalize');

function buildMatchQuery(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const parts = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const term = normalizeForSearch((match[1] || match[2]).trim());
    if (term) parts.push(`"${term.replace(/"/g, '""')}"`);
  }
  return parts.length ? parts.join(' AND ') : null;
}

module.exports = { buildMatchQuery };
