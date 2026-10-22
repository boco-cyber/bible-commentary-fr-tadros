const MarkdownIt = require('markdown-it');
const sanitizeHtml = require('sanitize-html');

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
const allowedTags = sanitizeHtml.defaults.allowedTags.concat([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'hr', 'del', 'ins', 'sup', 'sub', 'mark',
]);

function renderMarkdown(markdown) {
  return sanitizeHtml(md.render(markdown || ''), {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) },
  });
}

module.exports = { renderMarkdown };
