#!/usr/bin/env node
/*
 * Image sizes.
 *
 *   images/fulls    2048 px  opened by the lightbox
 *   images/thumbs   1024 px  grid on a high-density screen
 *   images/small     640 px  grid everywhere else
 *
 * Two jobs:
 *
 *   npm run images            derive anything missing from images/fulls
 *   npm run images -- --ingest  take new photographs from images_tmp first
 *
 * Ingest names each file <prefix>-<modified-time>.<ext>, keeping the prefix
 * you gave it: shanghai stuff dropped in as "cn-sh-anything.jpg" comes out as
 * cn-sh-1731339471080.jpg. Needs ImageMagick 7 (the `magick` command).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const INBOX = path.join(ROOT, 'images_tmp');
const SIZES = [
  { directory: 'fulls', width: 2048, quality: 88 },
  { directory: 'thumbs', width: 1024, quality: 82 },
  { directory: 'small', width: 640, quality: 80 }
];

const INGEST = process.argv.includes('--ingest');
const FORCE = process.argv.includes('--force');

function magick(args) {
  execFileSync('magick', args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

function isPhotograph(name) {
  return /\.(jpe?g|png|webp)$/i.test(name) && !name.startsWith('.');
}

function render(source, target, size) {
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const args = [source, '-auto-orient', '-resize', `${size.width}x>`,
                '-quality', String(size.quality), '-interlace', 'Plane',
                '-sampling-factor', '4:2:0'];

  /* Grid sizes drop EXIF, IPTC and XMP -- which carry an embedded preview and
     can be half the file -- but keep the colour profile, or a Display P3
     photograph would be read as sRGB and come out oversaturated. The lightbox
     reads EXIF from the full-size file, so nothing is lost. */
  if (size.directory !== 'fulls') args.push('+profile', '!icc,icm,*');

  args.push(target);
  magick(args);
}

function ingest() {
  if (!fs.existsSync(INBOX)) return [];

  const arrivals = fs.readdirSync(INBOX).filter(isPhotograph);
  const named = [];

  arrivals.forEach(name => {
    const source = path.join(INBOX, name);
    const extension = path.extname(name);
    const prefix = path.basename(name, extension).split('-').slice(0, -1).join('-');

    if (!prefix) {
      console.warn(`  skipped ${name}: expected <prefix>-<something>${extension}`);
      return;
    }

    const stamp = fs.statSync(source).mtime.getTime();
    const target = `${prefix}-${stamp}${extension}`;

    SIZES.forEach(size => render(source, path.join(ROOT, 'images', size.directory, target), size));
    fs.unlinkSync(source);
    named.push(target);
    console.log(`  ingested ${name} -> ${target}`);
  });

  return named;
}

function backfill() {
  const fulls = path.join(ROOT, 'images', 'fulls');
  const derived = SIZES.filter(size => size.directory !== 'fulls');
  let written = 0;

  fs.readdirSync(fulls).filter(isPhotograph).forEach(name => {
    derived.forEach(size => {
      const target = path.join(ROOT, 'images', size.directory, name);
      if (!FORCE && fs.existsSync(target)) return;

      render(path.join(fulls, name), target, size);
      written += 1;
      console.log(`  ${size.directory}/${name}`);
    });
  });

  return written;
}

try {
  execFileSync('magick', ['-version'], { stdio: 'ignore' });
} catch (error) {
  console.error('ImageMagick 7 is required: `magick` is not on the PATH.');
  process.exit(1);
}

if (INGEST) {
  const arrivals = ingest();
  console.log(`${arrivals.length} photographs ingested`);
}

const written = backfill();
console.log(written ? `${written} sizes written` : 'every size is up to date');
