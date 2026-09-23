// Text cleaning shared by the tools.

// Dashes used as punctuation become commas or plain spaces.
// Hyphens inside words (e.g. "check-in") are left alone.
function cleanText(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/\s+-{1,2}\s+/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

module.exports = { cleanText };
