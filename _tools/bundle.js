#!/usr/bin/env node
/*
 * Builds assets/js/site.min.js: one script for the whole site.
 *
 * The libraries are already minified and are copied through untouched. The
 * site's own scripts are minified with terser, which understands the modern
 * syntax in globe.js and navigate.js. Order is execution order -- jQuery has
 * to be there before poptrox, and main.js before the explorer that calls into
 * it -- so this list is the same list the page used to load one by one.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, '_js');
const VENDOR = path.join(JS, 'vendor');
const TARGET = path.join(ROOT, 'assets', 'js', 'site.min.js');

const LIBRARIES = [
  'jquery.min.js',
  'jquery.poptrox.min.js',
  'skel.min.js',
  'util.min.js',
  'exif.min.js'
];

const SOURCES = [
  'postcard.js',
  'zoom.js',
  'navigate.js',
  'main.js',
  'globe.js',
  'airport-selector.js'
];

async function build() {
  const parts = [];
  let read = 0;

  LIBRARIES.forEach(name => {
    const code = fs.readFileSync(path.join(VENDOR, name), 'utf8');
    read += code.length;
    parts.push(code.trim());
  });

  for (const name of SOURCES) {
    const code = fs.readFileSync(path.join(JS, name), 'utf8');
    read += code.length;

    const result = await minify(code, {
      compress: { passes: 2 },
      mangle: true,
      format: { comments: false }
    });

    if (result.error) throw result.error;
    parts.push(result.code);
  }

  const bundle = parts.join('\n;\n') + '\n';
  fs.writeFileSync(TARGET, bundle);

  const kb = value => (value / 1024).toFixed(1) + ' KB';
  console.log(`site.min.js  ${kb(bundle.length)} from ${kb(read)}`);
}

build().catch(error => {
  console.error(error);
  process.exit(1);
});
