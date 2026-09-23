// Builds the icon sprite from lib/icons.js: only the Phosphor icons in use (MIT), as inline SVG
// symbols, plus the list the app reads for the picker and the tints. Goal icons come in two
// weights: regular, and bold for small sizes, where a thin stroke would look lighter than the text.
// Rewrites the two marked blocks in public/index.html.
//
//   node scripts/icons.js

const fs = require('fs');
const path = require('path');
const { ICONS, CATEGORIES } = require('../lib/icons');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'node_modules', '@phosphor-icons', 'core', 'assets');
const PAGE = path.join(ROOT, 'public', 'index.html');

// Icons the app itself uses, beyond the goal icons.
const EXTRA = { ui_target: 'target' };

const body = (name, weight = 'regular') => {
  const file = weight === 'regular' ? `${name}.svg` : `${name}-${weight}.svg`;
  const svg = fs.readFileSync(path.join(ASSETS, weight, file), 'utf8');
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<rect width="256" height="256" fill="none"\/>/g, '').trim();
};
const symbols = Object.entries({ ...Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, v[0]])), ...EXTRA })
  .map(([key, name]) => `<symbol id="i-${key}" viewBox="0 0 256 256">${body(name)}</symbol>`).join('') +
  Object.entries(ICONS).map(([key, [name]]) => `<symbol id="ib-${key}" viewBox="0 0 256 256">${body(name, 'bold')}</symbol>`).join('');

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${symbols}</svg>`;
const list = `const GOAL_ICONS = ${JSON.stringify(Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, v.slice(1)])))};\nconst CATEGORIES = ${JSON.stringify(CATEGORIES)};`;

let html = fs.readFileSync(PAGE, 'utf8');
const swap = (start, end, inner) => {
  const a = html.indexOf(start), b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error(`missing ${start}`);
  html = html.slice(0, a + start.length) + '\n' + inner + '\n' + html.slice(b);
};
swap('<!-- Icons: built by scripts/icons.js -->', '<!-- End icons -->', sprite);
swap('/* Icon list: built by scripts/icons.js */', '/* End icon list */', list);
fs.writeFileSync(PAGE, html);
console.log(`${Object.keys(ICONS).length + Object.keys(EXTRA).length} icons in two weights, ${Math.round(sprite.length / 1024)} KB`);
