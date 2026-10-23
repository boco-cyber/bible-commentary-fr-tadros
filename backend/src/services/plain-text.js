function markdownToPlain(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{[^}]*\}/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\\([\\`*{}\[\]()#+\-.!_>~|])/g, '$1')
    .replace(/^[ \t|:-]*-{3,}[ \t|:-]*$/gm, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\\/g, '')
    .replace(/[*_~|>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { markdownToPlain };
