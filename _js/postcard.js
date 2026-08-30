/*
 * Postcards: the reverse side of a photograph in the lightbox.
 *
 * A photograph listed in _data/postcards.yml has a back, and the back is a
 * postcard -- laid out the way China Post lays one out. Six red boxes for the
 * recipient's postcode across the top, the stamp at the right of them, the
 * message down the left of the divider, the address down the right, and the
 * sender's postcode at the foot of it.
 *
 * The card is drawn once, in millimetres, at the size a postcard really is:
 * A6, 148 by 105. `layout` returns that drawing as a list of shapes, and the
 * same list is then either put on screen as an SVG or written out as a PDF.
 * There is one card, in one place, and two ways of looking at it -- so the
 * printed one cannot drift away from the one the reader was shown.
 *
 * Because the card has a shape of its own it no longer takes the shape of the
 * photograph. It is fitted into whatever box the lightbox gives it, and turned
 * a quarter turn where that box is upright, so a phone shows a whole postcard
 * rather than a slice of one.
 *
 *   Postcards.attach(popup)          add the card and its buttons
 *   Postcards.prime()                start loading the card data
 *   Postcards.show(popup, name, img) point a popup at one photograph
 *   Postcards.reset(popup)           turn the card back to the photograph
 */
window.Postcards = (function () {
  'use strict';

  /* Written by the page, in the page's language. See _includes/header.html. */
  const text = window.SiteText || {};

  function say(key, values) {
    const template = text[key];
    if (template === undefined) return '';
    return values ? text.format(template, values) : template;
  }

  const root = document.documentElement;

  let source = root.getAttribute('data-postcards-url');
  let cards = null;
  let loading = null;
  let dataLoadVersion = 0;
  const popups = [];

  /* ------------------------------------------------------------- the card */

  /* A6, the size every postcard printer knows. Everything below is in
     millimetres on this sheet, measured from the top-left corner. */
  const CARD = { width: 148, height: 105 };

  const INK = {
    paper: '#f4f0e7',
    ink: '#23201c',
    soft: '#6f685d',
    rule: '#b6ada0',
    faint: '#d9d2c6',
    post: '#c8102e'
  };

  const SERIF = "'EB Garamond', Georgia, 'Times New Roman', 'Songti SC', 'STSong', SimSun, serif";

  /* The card's furniture, in one place so the drawing below reads as a
     description of a postcard rather than as arithmetic. */
  const BOX = {
    keyline: { x: 4, y: 4, w: 140, h: 97 },
    postcode: { x: 9, y: 7, cell: 7.4, gap: 1.3, count: 6, h: 9.4 },
    stamp: { x: 115.5, y: 7, w: 24.5, h: 22 },
    divider: { x: 76, top: 25, bottom: 92 },
    art: { x: 9, y: 19, w: 63, h: 36 },
    message: { x: 9, right: 72, floor: 95.5 },
    address: { x: 80, right: 140, top: 36, lines: 5 },
    sender: { x: 80, top: 76, lines: 3 },
    footer: { y: 99.2 }
  };

  /* Every line anyone writes on is the same line: ruled at the height the
     writing is set in, so what is typed into the PDF sits on the rule rather
     than floating between two of them. Each rule is a field of its own for
     the same reason -- a viewer decides its own leading inside a box that
     holds several lines, and it never agrees with the ruling. */
  const WRITING = { size: 4.2, leading: 6 };

  function writingLine(add, name, tip, x, right, rule) {
    add({ t: 'line', x1: x, y1: rule, x2: right, y2: rule, stroke: INK.faint, width: 0.2 });
    add({
      t: 'field', name: name, tip: tip,
      x: x, y: rule - WRITING.leading + 0.9, w: right - x,
      h: WRITING.leading - 0.9, size: WRITING.size
    });
  }

  function postcodeWidth(box) {
    return box.count * box.cell + (box.count - 1) * box.gap;
  }

  /* Text that has to fit a given width is set smaller until it does, rather
     than wrapped: a postcard's headline is one line. */
  function fitted(measure, string, size, font, tracking, room) {
    let value = size;
    while (value > size * 0.55 && measure(string, value, font, tracking) > room) {
      value -= size * 0.04;
    }
    return value;
  }

  /* Words where there are spaces, characters where there are not -- which is
     what Chinese needs and what English must not have. */
  function wrap(measure, string, size, font, room, limit) {
    const words = String(string).trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';

    const flush = () => { if (line) lines.push(line); line = ''; };

    const place = piece => {
      const candidate = line ? line + ' ' + piece : piece;
      if (!line || measure(candidate, size, font, 0) <= room) { line = candidate; return; }
      flush();
      line = piece;
    };

    const placeCharacters = piece => {
      for (const character of piece) {
        const candidate = line + character;
        if (!line || measure(candidate, size, font, 0) <= room) { line = candidate; continue; }
        flush();
        line = character;
      }
    };

    words.forEach(word => {
      if (measure(word, size, font, 0) > room) placeCharacters(line ? ' ' + word : word);
      else place(word);
    });
    flush();

    return lines.slice(0, limit);
  }

  /* The whole card, as shapes. `measure` returns the width of a string in
     millimetres; the screen measures with the browser and the PDF measures
     with the font's own metrics, so the two agree to within a hair. */
  function layout(card, options) {
    const measure = options.measure;
    const out = [];
    const add = shape => { out.push(shape); return shape; };

    /* The card's small print is set in letterspaced capitals, the way postal
       stationery sets it. The string is put into capitals here rather than by
       either renderer, so the screen and the PDF are given the same words to
       measure and to draw. */
    const label = (string, x, y, size, colour, align, tracking) => {
      if (!string) return;
      add({
        t: 'text', s: String(string).toUpperCase(), x: x, y: y, size: size, font: 'regular',
        tracking: tracking === undefined ? size * 0.18 : tracking,
        colour: colour, align: align
      });
    };

    add({ t: 'rect', x: 0, y: 0, w: CARD.width, h: CARD.height, fill: INK.paper });
    add({
      t: 'rect', x: BOX.keyline.x, y: BOX.keyline.y, w: BOX.keyline.w, h: BOX.keyline.h,
      stroke: INK.rule, width: 0.25, radius: 1.4
    });

    /* --- the top band: postcode, title of the card, stamp --------------- */

    const postcode = BOX.postcode;
    for (let index = 0; index < postcode.count; index++) {
      add({
        t: 'rect',
        x: postcode.x + index * (postcode.cell + postcode.gap),
        y: postcode.y, w: postcode.cell, h: postcode.h,
        stroke: INK.post, width: 0.35, radius: 0.8
      });
    }
    add({
      t: 'field', name: 'postcode', tip: say('postcard_postcode'),
      x: postcode.x, y: postcode.y, w: postcodeWidth(postcode), h: postcode.h,
      comb: true, maxLength: postcode.count, align: 'center', size: 6
    });
    const stamp = BOX.stamp;
    add({
      t: 'rect', x: stamp.x, y: stamp.y, w: stamp.w, h: stamp.h,
      stroke: INK.rule, width: 0.3, dash: [1.1, 1.1]
    });
    const stampWords = wrap(measure, say('postcard_stamp').toUpperCase(), 2.2, 'regular',
      stamp.w - 7, 3);
    stampWords.forEach((line, index) => {
      label(line, stamp.x + stamp.w / 2,
        stamp.y + stamp.h / 2 + 0.8 - (stampWords.length - 1) * 1.6 + index * 3.2,
        2.2, INK.soft, 'center');
    });

    label(card.kind, (postcode.x + postcodeWidth(postcode) + stamp.x) / 2,
      postcode.y + postcode.h / 2 + 1.1, 3.4, INK.ink, 'center', 1.5);

    add({
      t: 'line', x1: BOX.divider.x, y1: BOX.divider.top, x2: BOX.divider.x, y2: BOX.divider.bottom,
      stroke: INK.faint, width: 0.3
    });

    /* --- the message side ---------------------------------------------- */

    /* The drawing is the picture on a card whose picture is on the other
       side, so it is given the whole width of the message column rather than
       a corner of it. Everything under it is placed relative to what came
       before, so a card with no drawing closes the gap instead of leaving
       one. */
    const left = BOX.message.x;
    const right = BOX.message.right;
    const room = right - left;
    let y = 34;

    /* The drawing is given as much of the column as it can use at its own
       proportions -- the box is fitted to the drawing, not the drawing to the
       box, so nothing is stretched and no band of empty paper is left over.
       What follows starts wherever the drawing actually ended. */
    if (card.illustration) {
      const ratio = options.artRatio || BOX.art.w / BOX.art.h;
      const width = Math.min(BOX.art.w, BOX.art.h * ratio);
      const height = width / ratio;

      add({
        t: 'image', href: card.illustration, ratio: ratio,
        x: BOX.art.x + (BOX.art.w - width) / 2, y: BOX.art.y, w: width, h: height
      });
      y = BOX.art.y + height + 5;
    }

    if (card.title) {
      const size = fitted(measure, card.title, 6.2, 'regular', 0, room);
      add({ t: 'text', s: card.title, x: left, y: y, size: size, font: 'regular', colour: INK.ink });
      y += 4.6;
    }

    /* The place, and the day the card is written -- which is the sender's to
       set, not the photograph's. It is dated today and is a rule to write
       over, and a field in the PDF. When the photograph was taken is a fact
       about the photograph, and is at the foot of the card with the credit. */
    if (card.location) {
      const size = fitted(measure, card.location, 2.6, 'regular', 0.5, room * 0.55);
      label(card.location, left, y, size, INK.soft, 'left', 0.5);
    }

    const dated = options.today || '';
    const dateWidth = 26;

    /* On screen the date is printed, because there is nothing to type into.
       In the PDF the same date is the field's own value, so it is printed
       there by the field and not underneath it -- or writing a new one would
       leave two. */
    add({ t: 'text', s: dated, x: right, y: y, size: 3, font: 'italic',
      colour: INK.soft, align: 'right', screen: true });
    add({ t: 'line', x1: right - dateWidth, y1: y + 1.4, x2: right, y2: y + 1.4,
      stroke: INK.faint, width: 0.2 });
    add({
      t: 'field', name: 'date', tip: say('postcard_date'), value: dated,
      format: options.dateFormat,
      x: right - dateWidth, y: y - 4.2, w: dateWidth, h: 5.4, align: 'right', size: 3.4
    });
    y += 4.6;

    const swatches = card.swatches || [];
    if (swatches.length) {
      swatches.slice(0, 3).forEach((colour, index) => {
        add({ t: 'circle', cx: left + 1 + index * 3.2, cy: y, r: 1, fill: colour });
      });
      y += 4.8;
    }

    if (card.note) {
      const lines = wrap(measure, card.note, 3.3, 'italic', room, 2);
      lines.forEach((line, index) => {
        add({ t: 'text', s: line, x: left, y: y + index * 4.4, size: 3.3,
          font: 'italic', colour: INK.ink });
      });
      y += lines.length * 4.4 + 1.4;
    }

    /* Whatever is left of the card is somewhere to write. */
    const message = BOX.message;
    const first = y + 3.5;
    const rules = Math.max(1, Math.floor((message.floor - first) / WRITING.leading) + 1);

    for (let index = 0; index < rules; index++) {
      writingLine(add, 'message' + (index + 1), say('postcard'), left, right,
        first + index * WRITING.leading);
    }

    /* --- the address side ----------------------------------------------- */

    /* The address side is ruled and nothing more. What goes on which line is
       the oldest convention there is, and printing the words would only take
       room away from the writing. The sender's lines are the group below the
       gap, as they are on a China Post card. */
    const address = BOX.address;
    for (let index = 0; index < address.lines; index++) {
      writingLine(add, 'address' + (index + 1), say('postcard_to'),
        address.x, address.right, address.top + index * WRITING.leading);
    }

    const sender = BOX.sender;
    for (let index = 0; index < sender.lines; index++) {
      writingLine(add, 'sender' + (index + 1), say('postcard_from'),
        sender.x, address.right, sender.top + index * WRITING.leading);
    }

    /* --- the foot -------------------------------------------------------- */

    const credit = [options.rights, card.date].filter(Boolean).join('  ·  ');
    if (credit) {
      add({
        t: 'text', s: credit, x: BOX.keyline.x + 5, y: BOX.footer.y, size: 2.4,
        font: 'regular', colour: INK.soft
      });
    }

    if (options.home) {
      const shown = options.home.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const width = measure(shown, 2.4, 'regular', 0);
      add({
        t: 'text', s: shown, x: BOX.keyline.x + BOX.keyline.w - 5, y: BOX.footer.y, size: 2.4,
        font: 'regular', colour: INK.soft, align: 'right'
      });
      add({
        t: 'link', url: options.home,
        x: BOX.keyline.x + BOX.keyline.w - 5 - width, y: BOX.footer.y - 2.4, w: width, h: 3.2
      });
    }

    return out;
  }

  /* ----------------------------------------------------------- measuring */

  /* The browser's own metrics, which is what the SVG will be set in. Sizes are
     in millimetres, so a scratch canvas is asked at a hundred times that and
     the answer divided back down. */
  const scratch = document.createElement('canvas').getContext('2d');

  function screenMeasure(string, size, font, tracking) {
    scratch.font = (font === 'italic' ? 'italic ' : '') + '400 ' + (size * 100) + 'px ' + SERIF;
    const width = scratch.measureText(String(string)).width / 100;
    return width + (tracking || 0) * Math.max(0, String(string).length - 1);
  }

  /* --------------------------------------------------------------- to SVG */

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgElement(tag, attributes) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attributes).forEach(key => {
      if (attributes[key] !== undefined && attributes[key] !== null) {
        node.setAttribute(key, attributes[key]);
      }
    });
    return node;
  }

  function toSvg(shapes, description) {
    const svg = svgElement('svg', {
      class: 'postcard-card',
      viewBox: '0 0 ' + CARD.width + ' ' + CARD.height,
      xmlns: SVG_NS,
      role: 'img',
      'aria-label': description || ''
    });

    shapes.forEach(shape => {
      let node = null;

      if (shape.t === 'rect') {
        node = svgElement('rect', {
          x: shape.x, y: shape.y, width: shape.w, height: shape.h,
          rx: shape.radius, ry: shape.radius,
          fill: shape.fill || 'none',
          stroke: shape.stroke, 'stroke-width': shape.width,
          'stroke-dasharray': shape.dash ? shape.dash.join(' ') : null
        });
      } else if (shape.t === 'line') {
        node = svgElement('line', {
          x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2,
          stroke: shape.stroke, 'stroke-width': shape.width,
          'stroke-dasharray': shape.dash ? shape.dash.join(' ') : null
        });
      } else if (shape.t === 'circle') {
        node = svgElement('circle', {
          cx: shape.cx, cy: shape.cy, r: shape.r,
          fill: shape.fill || 'none', stroke: shape.stroke, 'stroke-width': shape.width,
          'stroke-dasharray': shape.dash ? shape.dash.join(' ') : null
        });
      } else if (shape.t === 'image') {
        node = svgElement('image', {
          href: shape.href, x: shape.x, y: shape.y, width: shape.w, height: shape.h,
          preserveAspectRatio: 'xMidYMid meet'
        });
      } else if (shape.t === 'text') {
        node = svgElement('text', {
          x: shape.x, y: shape.y, fill: shape.colour,
          'font-size': shape.size,
          'font-family': SERIF,
          'font-style': shape.font === 'italic' ? 'italic' : 'normal',
          'letter-spacing': shape.tracking || null,
          'text-anchor': shape.align === 'center' ? 'middle' : shape.align === 'right' ? 'end' : null
        });
        node.textContent = shape.s;
      }

      if (node) svg.appendChild(node);
    });

    return svg;
  }

  /* --------------------------------------------------------------- to PDF */

  const fontPath = root.getAttribute('data-postcard-font') || '/assets/fonts/';
  let fontsPromise = null;

  function loadFonts() {
    if (fontsPromise) return fontsPromise;

    fontsPromise = Promise.all([
      fetch(fontPath + 'eb-garamond.ttf').then(response => response.arrayBuffer()),
      fetch(fontPath + 'eb-garamond-italic.ttf').then(response => response.arrayBuffer())
    ]).then(buffers => ({
      regular: window.Pdf.font(buffers[0]),
      italic: window.Pdf.font(buffers[1])
    })).catch(error => {
      fontsPromise = null;
      throw error;
    });

    return fontsPromise;
  }

  function pdfMeasure(fonts) {
    return (string, size, font, tracking) => {
      const face = fonts[font === 'italic' ? 'italic' : 'regular'];
      /* Anything the face has no glyph for is measured on screen instead; it
         will be drawn from the screen too. */
      if (!face.covers(string)) return screenMeasure(string, size, font, tracking);
      return face.widthOf(String(string), size) + (tracking || 0) * Math.max(0, String(string).length - 1);
    };
  }

  /* A run the embedded face cannot set -- Chinese, mostly -- is drawn by the
     browser at print resolution and placed as a picture. It is still not text
     anyone can edit, which is the point of outlining the rest. */
  function rasterText(shape, string) {
    const density = 24;
    const canvas = document.createElement('canvas');
    const font = (shape.font === 'italic' ? 'italic ' : '') + '400 ' +
      (shape.size * density) + 'px ' + SERIF;

    const context = canvas.getContext('2d');
    context.font = font;
    const width = Math.ceil(context.measureText(string).width) + density;
    const height = Math.ceil(shape.size * density * 1.6);

    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);

    const paint = canvas.getContext('2d');
    paint.fillStyle = INK.paper;
    paint.fillRect(0, 0, canvas.width, canvas.height);
    paint.font = font;
    paint.fillStyle = shape.colour || INK.ink;
    paint.textBaseline = 'alphabetic';
    paint.fillText(string, density / 2, shape.size * density);

    return {
      bytes: jpegBytes(canvas),
      dimensions: { width: canvas.width, height: canvas.height },
      widthMm: canvas.width / density,
      heightMm: canvas.height / density,
      baselineMm: shape.size
    };
  }

  /* JPEG is the one picture format a PDF can carry without a compressor to
     write it with, so the quality is set high: the drawing sits on a large
     flat field of paper colour, and that is exactly what a thrifty JPEG
     smudges. */
  function jpegBytes(canvas) {
    const url = canvas.toDataURL('image/jpeg', 0.96);
    const binary = atob(url.slice(url.indexOf(',') + 1));
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) out[index] = binary.charCodeAt(index);
    return out;
  }

  /* The drawing, flattened onto the card's paper so that a transparent PNG
     does not arrive as a black rectangle. */
  function imageFor(shape) {
    const image = new Image();
    image.decoding = 'sync';

    return new Promise((resolve, reject) => {
      image.onload = () => {
        const density = 12;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(shape.w * density));
        canvas.height = Math.max(1, Math.round(shape.h * density));

        const context = canvas.getContext('2d');
        context.fillStyle = INK.paper;
        context.fillRect(0, 0, canvas.width, canvas.height);

        /* Contained, the way the screen contains it. */
        const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);

        try {
          resolve({ bytes: jpegBytes(canvas), dimensions: { width: canvas.width, height: canvas.height } });
        } catch (error) {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = shape.href;
    });
  }

  function toPdf(shapes, fonts, meta) {
    const doc = window.Pdf.document({
      width: CARD.width, height: CARD.height,
      info: { title: meta.title, author: meta.author, creator: meta.creator }
    });
    doc.embed(fonts.regular, 'Regular');

    const pending = shapes
      .filter(shape => shape.t === 'image')
      .map(shape => imageFor(shape).then(result => { shape.raster = result; }));

    return Promise.all(pending).then(() => {
      shapes.forEach(shape => {
        if (shape.t === 'rect') {
          doc.rect(shape.x, shape.y, shape.w, shape.h, {
            fill: shape.fill, stroke: shape.stroke, width: shape.width,
            dash: shape.dash, radius: shape.radius
          });
        } else if (shape.t === 'line') {
          doc.line(shape.x1, shape.y1, shape.x2, shape.y2,
            { stroke: shape.stroke, width: shape.width, dash: shape.dash });
        } else if (shape.t === 'circle') {
          doc.circle(shape.cx, shape.cy, shape.r,
            { fill: shape.fill, stroke: shape.stroke, width: shape.width, dash: shape.dash });
        } else if (shape.t === 'image' && shape.raster) {
          doc.image(shape.raster.bytes, shape.x, shape.y, shape.w, shape.h, shape.raster.dimensions);
        } else if (shape.t === 'text' && !shape.screen) {
          const string = String(shape.s);
          const face = fonts[shape.font === 'italic' ? 'italic' : 'regular'];

          if (face.covers(string)) {
            doc.text(face, string, {
              size: shape.size, x: shape.x, y: shape.y, tracking: shape.tracking,
              align: shape.align, colour: shape.colour
            });
          } else {
            const raster = rasterText(shape, string);
            let x = shape.x;
            if (shape.align === 'center') x -= raster.widthMm / 2;
            else if (shape.align === 'right') x -= raster.widthMm;
            doc.image(raster.bytes, x - 0.5, shape.y - raster.baselineMm,
              raster.widthMm, raster.heightMm, raster.dimensions);
          }
        } else if (shape.t === 'field') {
          doc.field({
            name: shape.name, tip: shape.tip, x: shape.x, y: shape.y,
            width: shape.w, height: shape.h, multiline: shape.multiline,
            value: shape.value, comb: shape.comb, maxLength: shape.maxLength,
            format: shape.format, align: shape.align, size: shape.size
          });
        } else if (shape.t === 'link') {
          doc.link({ url: shape.url, x: shape.x, y: shape.y, width: shape.w, height: shape.h });
        }
      });

      return doc.save();
    });
  }

  /* ------------------------------------------------------------ the data */

  function load() {
    if (loading || !source) return loading;
    const version = dataLoadVersion;

    loading = fetch(source)
      .then(response => {
        if (!response.ok) throw new Error(say('postcard_error'));
        return response.json();
      })
      .then(data => {
        if (version !== dataLoadVersion) return;
        cards = data;
        /* Data can land after a popup has already opened. */
        popups.forEach(entry => {
          if (entry.photo) show(entry.popup, entry.photo, entry.image);
        });
      })
      .catch(error => {
        if (version !== dataLoadVersion) return;
        cards = {};
        console.error(error);
      });

    return loading;
  }

  function setLocale(nextSource) {
    if (!nextSource || nextSource === source) return;

    source = nextSource;
    cards = null;
    loading = null;
    dataLoadVersion += 1;
  }

  function entryFor(popup) {
    return popups.find(item => item.popup === popup) || null;
  }

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    return node;
  }

  /* Three colours that read as typical of the photograph, used when the card
     does not name its own swatches. */
  function sampleSwatches(image) {
    const size = 36;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    let pixels;
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, size, size);
      pixels = context.getImageData(0, 0, size, size).data;
    } catch (error) {
      return [];
    }

    const buckets = new Map();
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 128) continue;

      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const key = (red >> 5) + ':' + (green >> 5) + ':' + (blue >> 5);
      const bucket = buckets.get(key) || { red: 0, green: 0, blue: 0, count: 0 };

      bucket.red += red;
      bucket.green += green;
      bucket.blue += blue;
      bucket.count += 1;
      buckets.set(key, bucket);
    }

    const ordered = Array.from(buckets.values())
      .map(bucket => ({
        count: bucket.count,
        red: Math.round(bucket.red / bucket.count),
        green: Math.round(bucket.green / bucket.count),
        blue: Math.round(bucket.blue / bucket.count)
      }))
      .sort((first, second) => second.count - first.count);

    const chosen = [];
    ordered.forEach(colour => {
      if (chosen.length === 3) return;

      const isDistinct = chosen.every(picked => {
        return Math.abs(picked.red - colour.red) +
          Math.abs(picked.green - colour.green) +
          Math.abs(picked.blue - colour.blue) > 110;
      });

      if (isDistinct) chosen.push(colour);
    });

    return chosen.map(colour =>
      '#' + [colour.red, colour.green, colour.blue]
        .map(value => value.toString(16).padStart(2, '0')).join(''));
  }

  /* The photograph's own date is printed beside the credit, so the year is
     only spelled out when there is no date to spell it out for us. */
  function creditFor(card) {
    const author = root.getAttribute('data-postcard-author') || '';
    if (!author) return '';
    return card.year && !card.date
      ? say('postcard_rights', { year: card.year, author: author })
      : say('postcard_rights_undated', { author: author });
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  /* The date mask is the one thing the card and the PDF have to spell the same
     way, because a reader's PDF viewer will reformat the field to it. It is
     written once, in _data/i18n/<locale>.yml, in the notation those viewers
     use: d, dd, m, mm, mmm, mmmm, yy, yyyy. */
  function dateFormat() {
    return say('postcard_date_format') || 'd mmmm yyyy';
  }

  function formatDate(mask, when) {
    const parts = {
      yyyy: String(when.getFullYear()),
      yy: String(when.getFullYear()).slice(-2),
      mmmm: MONTHS[when.getMonth()],
      mmm: MONTHS[when.getMonth()].slice(0, 3),
      mm: String(when.getMonth() + 1).padStart(2, '0'),
      m: String(when.getMonth() + 1),
      dd: String(when.getDate()).padStart(2, '0'),
      d: String(when.getDate())
    };
    return String(mask).replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/g, match => parts[match]);
  }

  function shapesFor(card, options) {
    return layout(card, {
      artRatio: options && options.artRatio,
      measure: (options && options.measure) || screenMeasure,
      rights: creditFor(card),
      today: formatDate(dateFormat(), new Date()),
      dateFormat: dateFormat(),
      home: root.getAttribute('data-postcard-home') || ''
    });
  }

  function describe(card) {
    return [say('postcard'), card.title, card.location, card.date]
      .filter(Boolean).join(', ');
  }

  /* ---------------------------------------------------------- the popups */

  function draw(entry) {
    const card = entry.card;
    if (!card) return;

    const resolved = Object.assign({}, card);
    if (!resolved.swatches && entry.image) resolved.swatches = entry.swatches || [];

    entry.resolved = resolved;
    entry.face.textContent = '';
    entry.face.appendChild(
      toSvg(shapesFor(resolved, { artRatio: entry.artRatio }), describe(resolved)));
  }

  /* The card is laid out around the drawing's own proportions, so it has to
     be asked for them. They are remembered by file name: a gallery of cards
     that share a drawing asks once. */
  const artRatios = {};

  function withArtRatio(entry) {
    const href = entry.card && entry.card.illustration;
    if (!href) return;

    if (artRatios[href]) {
      entry.artRatio = artRatios[href];
      return;
    }

    const drawing = new Image();
    drawing.onload = () => {
      if (!drawing.naturalHeight) return;
      artRatios[href] = drawing.naturalWidth / drawing.naturalHeight;

      if (entry.card && entry.card.illustration === href) {
        entry.artRatio = artRatios[href];
        draw(entry);
      }
    };
    drawing.src = href;
  }

  /* Swatches are sampled from the photograph, which may not have arrived. */
  function withSwatches(entry) {
    if (!entry.card || entry.card.swatches || !entry.image) return;

    const paint = () => {
      if (entry.image.naturalWidth) {
        entry.swatches = sampleSwatches(entry.image);
        draw(entry);
      }
    };

    if (entry.image.complete && entry.image.naturalWidth) paint();
    else entry.image.addEventListener('load', function once() {
      entry.image.removeEventListener('load', once);
      if (entry.card) paint();
    });
  }

  function button(className, icon) {
    const node = element('button', className);
    node.type = 'button';
    node.hidden = true;
    node.innerHTML = '<i class="fa ' + icon + '" aria-hidden="true"></i><span class="sr-only"></span>';
    return node;
  }

  function attach(popup) {
    if (entryFor(popup)) return;

    const face = element('div', 'postcard-face');
    const flip = button('postcard-flip', 'fa-envelope-o');
    const save = button('postcard-export', 'fa-download');

    face.hidden = true;
    face.setAttribute('aria-hidden', 'true');

    /* The popup closes on any click it receives, so the card keeps its own.
       Nothing inside it is draggable and nothing offers a menu: the card is a
       picture of a postcard, not a file. */
    face.addEventListener('click', event => event.stopPropagation());
    ['contextmenu', 'dragstart', 'selectstart'].forEach(kind => {
      face.addEventListener(kind, event => {
        event.preventDefault();
        event.stopPropagation();
      });
    });

    flip.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggle(popup);
    });

    save.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      exportCard(popup);
    });

    popup.appendChild(face);
    popup.appendChild(flip);
    popup.appendChild(save);
    popups.push({
      popup: popup, face: face, button: flip, save: save,
      photo: null, image: null, card: null, swatches: null,
      artRatio: null, busy: false
    });
  }

  /* The button shows what you would get: an envelope for the card, a picture
     to come back. */
  function label(entry, flipped) {
    const words = say(flipped ? 'show_photograph' : 'show_postcard');

    entry.button.querySelector('i').className = flipped ? 'fa fa-picture-o' : 'fa fa-envelope-o';
    entry.button.querySelector('span').textContent = say(flipped ? 'photograph' : 'postcard');
    entry.button.setAttribute('title', words);
    entry.button.setAttribute('aria-label', words);

    const saving = say(entry.busy ? 'postcard_exporting' : 'postcard_export');
    entry.save.querySelector('span').textContent = saving;
    entry.save.setAttribute('title', saving);
    entry.save.setAttribute('aria-label', saving);
    entry.save.hidden = !flipped || !entry.card;
  }

  function reset(popup) {
    const entry = entryFor(popup);
    if (!entry) return;

    popup.classList.remove('is-flipped');
    entry.face.hidden = true;
    entry.face.setAttribute('aria-hidden', 'true');
    entry.button.setAttribute('aria-pressed', 'false');
    label(entry, false);
  }

  function toggle(popup) {
    const entry = entryFor(popup);
    if (!entry || entry.button.hidden) return;

    const flipped = !popup.classList.contains('is-flipped');

    if (flipped) {
      entry.face.hidden = false;
      entry.face.setAttribute('aria-hidden', 'false');
    }

    popup.classList.toggle('is-flipped', flipped);
    entry.button.setAttribute('aria-pressed', flipped ? 'true' : 'false');
    label(entry, flipped);

    if (!flipped) {
      window.setTimeout(() => {
        if (!popup.classList.contains('is-flipped')) {
          entry.face.hidden = true;
          entry.face.setAttribute('aria-hidden', 'true');
        }
      }, 620);
    }
  }

  function show(popup, photo, image) {
    const entry = entryFor(popup);
    if (!entry) return;

    entry.photo = photo;
    entry.image = image || null;
    entry.swatches = null;
    entry.artRatio = null;
    reset(popup);

    if (!cards) {
      load();
      entry.card = null;
      entry.button.hidden = true;
      entry.save.hidden = true;
      return;
    }

    entry.card = cards[photo] || null;
    entry.button.hidden = !entry.card;
    entry.save.hidden = true;
    entry.face.textContent = '';
    if (!entry.card) return;

    withArtRatio(entry);
    draw(entry);
    withSwatches(entry);
  }

  /* ------------------------------------------------------------- the PDF */

  function fileName(entry) {
    const stem = say('postcard_export_name') || 'postcard';
    const photo = String(entry.photo || '').replace(/\.[^.]+$/, '');
    return (photo ? stem + '-' + photo : stem) + '.pdf';
  }

  function exportCard(popup) {
    const entry = entryFor(popup);
    if (!entry || !entry.card || entry.busy) return;

    entry.busy = true;
    popup.classList.add('is-exporting');
    label(entry, popup.classList.contains('is-flipped'));

    loadFonts()
      .then(fonts => {
        const card = entry.resolved || entry.card;
        const shapes = shapesFor(card, {
          measure: pdfMeasure(fonts), artRatio: entry.artRatio
        });
        return toPdf(shapes, fonts, {
          title: describe(card),
          author: root.getAttribute('data-postcard-author') || '',
          creator: root.getAttribute('data-postcard-home') || ''
        });
      })
      .then(bytes => {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName(entry);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      })
      .catch(error => {
        console.error(error);
        window.alert(say('postcard_export_error'));
      })
      .then(() => {
        entry.busy = false;
        popup.classList.remove('is-exporting');
        label(entry, popup.classList.contains('is-flipped'));
      });
  }

  return { attach, prime: load, setLocale, show, reset, toggle, layout, CARD };
})();
