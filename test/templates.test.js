const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const viewsDir = path.join(__dirname, '..', 'src', 'views');

function templates(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) templates(full, found);
    else if (entry.name.endsWith('.ejs')) found.push(full);
  }
  return found;
}

for (const file of templates(viewsDir)) {
  test('compiles ' + path.relative(viewsDir, file), () => {
    assert.doesNotThrow(() => ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file }));
  });

  test('has no inline event handlers (blocked by the CSP) in ' + path.relative(viewsDir, file), () => {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\son(click|change|input|submit|load)=/i);
  });
}
