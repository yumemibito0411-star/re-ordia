'use strict';
// Bundles the client and the in-browser mock backend into a single HTML file
// that can be opened without the server:  node demo/build.js [output.html]
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const out = process.argv[2] || path.join(__dirname, 'dist', 'chat-demo.html');

let css = read('public/app.css');
// Follow an explicit light/dark choice on the root element as well as the OS setting.
const dark = /@media \(prefers-color-scheme: dark\) \{\n  :root \{([\s\S]*?)\n  \}\n\}/.exec(css);
if (!dark) throw new Error('dark theme block not found in app.css');
css = css.replace(dark[0], `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {${dark[1]}\n  }\n}\n:root[data-theme="dark"] {${dark[1]}\n}`);

const html = read('public/index.html');
const body = /<body>([\s\S]*?)<script src="\/app\.js"><\/script>\s*<\/body>/.exec(html)[1];
const favicon = `data:image/svg+xml,${encodeURIComponent(read('public/favicon.svg').trim())}`;

const page = `<title>re-ordia チャット</title>
<style>
${css}
</style>
${body.replace(/\/favicon\.svg/g, favicon)}
<script>
${read('demo/mock.js')}
</script>
<script>
${read('public/app.js').replace(/\/favicon\.svg/g, favicon)}
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
