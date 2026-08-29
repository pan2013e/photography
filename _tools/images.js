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
 * Ingest names each file <prefix>-<modified-time>.<ext>. It keeps the tags you
 * gave it and throws the rest of the name away: shanghai stuff dropped in as
 * "cn-sh-<whatever the camera called it>.jpg" comes out as
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

/* A photograph wider than this is a panorama, and fitting one to a width alone
   ruins it: a 13:1 frame came out 2048x152, which is worse than a thumbnail.
   A panorama is given instead the width that leaves its short edge as tall as
   a 2:1 photograph's would be, up to four times the nominal width. Even at the
   cap that is under twice the pixels of an ordinary photograph, and the height
   is what both the lightbox and the cropped grid cell actually need. */
const PANORAMA = 2;
const PANORAMA_LIMIT = 4;

/* A tag is one hyphen-separated part of the prefix: an ISO country or region
   code, an IATA airport code, or the name of a standalone gallery. Every one
   is a short ASCII word starting with a letter, and that is what tells a tag
   from whatever the camera, the phone or the photographer called the file. */
const TAG = /^[a-z][a-z0-9]{1,3}$/;

const INGEST = process.argv.includes('--ingest');
const FORCE = process.argv.includes('--force');

function magick(args) {
  execFileSync('magick', args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

function isPhotograph(name) {
  return /\.(jpe?g|png|webp)$/i.test(name) && !name.startsWith('.');
}

/* The shape ImageMagick will render, which is not always the shape stored: a
   photograph the camera marked as turned a quarter turn comes out of
   -auto-orient the other way round. */
function shapeOf(source) {
  let read;

  try {
    read = execFileSync('magick',
                        ['identify', '-format', '%w %h %[orientation]', `${source}[0]`],
                        { encoding: 'utf8' }).trim().split(/\s+/);
  } catch (error) {
    return null;
  }

  const width = Number(read[0]);
  const height = Number(read[1]);
  if (!width || !height) return null;

  return ['LeftTop', 'RightTop', 'RightBottom', 'LeftBottom'].includes(read[2])
    ? { width: height, height: width }
    : { width, height };
}

function widthFor(shape, size) {
  if (!shape || shape.width <= shape.height * PANORAMA) return size.width;

  const ratio = shape.width / shape.height;
  return Math.min(size.width * PANORAMA_LIMIT, Math.round((size.width / PANORAMA) * ratio));
}

function render(source, target, size, shape) {
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const args = [source, '-auto-orient', '-resize', `${widthFor(shape, size)}x>`,
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

/* "cn-sh-DSC01234.jpg" -> "cn-sh". Only the tags survive; the rest of the name
   is the photographer's business and has no place in a published file name. */
function tagsIn(name) {
  const tags = [];

  for (const part of path.basename(name, path.extname(name)).toLowerCase().split('-')) {
    if (!TAG.test(part)) break;
    tags.push(part);
  }

  return tags.join('-');
}

function ingest() {
  if (!fs.existsSync(INBOX)) return [];

  const arrivals = fs.readdirSync(INBOX).filter(isPhotograph);
  const named = [];

  /* The name is the tags and the modified time and nothing else, so two
     photographs filed alike and saved in the same millisecond would ask for
     the same name. The second one moves along a millisecond instead of
     landing on top of the first. */
  const taken = new Set();

  arrivals.forEach(name => {
    const source = path.join(INBOX, name);
    const extension = path.extname(name).toLowerCase();
    const prefix = tagsIn(name);

    if (!prefix) {
      console.warn(`  skipped ${name}: no gallery tag at the front of the name`);
      return;
    }

    let stamp = fs.statSync(source).mtime.getTime();
    while (taken.has(`${prefix}-${stamp}`)) stamp += 1;
    taken.add(`${prefix}-${stamp}`);

    const target = `${prefix}-${stamp}${extension}`;
    const shape = shapeOf(source);

    SIZES.forEach(size => render(source, path.join(ROOT, 'images', size.directory, target), size, shape));
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
    const source = path.join(fulls, name);
    let shape = null;

    derived.forEach(size => {
      const target = path.join(ROOT, 'images', size.directory, name);
      if (!FORCE && fs.existsSync(target)) return;

      if (!shape) shape = shapeOf(source);
      render(source, target, size, shape);
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
