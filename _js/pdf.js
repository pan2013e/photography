/*
 * A small PDF writer, and just enough TrueType to draw with.
 *
 * The postcard is exported in the reader's own browser, so there is nothing
 * here but arithmetic: no server, no library, no network beyond the font file
 * the page already serves.
 *
 * Two things the export needs that a plain canvas cannot give it:
 *
 *   Outlines.  Printed text is written as filled paths taken from the font's
 *              own glyf table, not as PDF text. Nothing in the finished card
 *              is a string a reader could edit, and nothing depends on the
 *              printer having the face.
 *   Forms.     The postcode, the address and the message are real AcroForm
 *              fields, with the same face embedded so that what is typed into
 *              them is set in it.
 *
 * Everything is measured in millimetres from the top-left corner, the way the
 * card is laid out on screen; the page transform at the head of each content
 * stream turns that into PDF's points-from-the-bottom-left.
 *
 *   Pdf.font(arrayBuffer)   read a TrueType face
 *   Pdf.document(options)   start a page
 *   doc.save()              the finished bytes
 */
window.Pdf = (function () {
  'use strict';

  const MM = 72 / 25.4;

  /* What a reader types into the card is set in a pen blue, so that it
     reads as written on the card rather than printed with it. */
  const FIELD_INK = '0.13 0.17 0.36 rg';

  /* ---------------------------------------------------------------- bytes */

  function bytesOf(text) {
    const out = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index++) out[index] = text.charCodeAt(index) & 0xff;
    return out;
  }

  function concat(chunks) {
    let length = 0;
    chunks.forEach(chunk => { length += chunk.length; });

    const out = new Uint8Array(length);
    let at = 0;
    chunks.forEach(chunk => { out.set(chunk, at); at += chunk.length; });
    return out;
  }

  /* A number as PDF writes them: no exponent, no more precision than a
     printer can hold. */
  function num(value) {
    if (!isFinite(value)) return '0';
    const rounded = Math.round(value * 1000) / 1000;
    return String(rounded === 0 ? 0 : rounded);
  }

  /* Every string in the file is written down once, here, and put into the page
     as a mark standing for it. A protected document encrypts each of them on
     the way out, and it can only do that if it knows where they all are -- a
     string is otherwise indistinguishable from the parentheses around it once
     it has been spliced into a dictionary. */
  /* A mark is one byte no PDF syntax uses, so a dictionary can be spliced
     together as text and the strings inside it still be found again. */
  const MARK = String.fromCharCode(1);
  const MARKS = new RegExp(MARK + '(\\d+)' + MARK, 'g');
  let strings = [];

  function mark(bytes) {
    strings.push(bytes);
    return MARK + (strings.length - 1) + MARK;
  }

  function latin1(text) {
    const value = String(text);
    const out = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index++) out[index] = value.charCodeAt(index) & 0xff;
    return out;
  }

  function literal(text) {
    return mark(latin1(text));
  }

  /* Anything that is not plain ASCII goes in as UTF-16, which is the only
     encoding a PDF string can carry every language in. */
  function textString(text) {
    const value = String(text);
    if (/^[\x20-\x7e]*$/.test(value)) return mark(latin1(value));

    const out = new Uint8Array(2 + value.length * 2);
    out[0] = 0xfe;
    out[1] = 0xff;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      out[2 + index * 2] = (code >> 8) & 0xff;
      out[3 + index * 2] = code & 0xff;
    }
    return mark(out);
  }

  /* ( ) and \ are the only characters a literal string has to escape; every
     other byte a postcard carries is written in octal, so that none of it can
     be mistaken for punctuation. */
  function escapeBytes(bytes) {
    let out = '';
    for (let index = 0; index < bytes.length; index++) {
      const byte = bytes[index];
      if (byte === 0x5c || byte === 0x28 || byte === 0x29) out += '\\' + String.fromCharCode(byte);
      else if (byte < 32 || byte > 126) out += '\\' + byte.toString(8).padStart(3, '0');
      else out += String.fromCharCode(byte);
    }
    return out;
  }

  /* For the entries in the encryption dictionary, which are the one part of a
     protected file that is never itself encrypted. */
  function hexString(bytes) {
    let out = '<';
    for (let index = 0; index < bytes.length; index++) {
      out += bytes[index].toString(16).padStart(2, '0');
    }
    return out + '>';
  }

  function joinBytes(parts) {
    let length = 0;
    parts.forEach(part => { length += part.length; });

    const out = new Uint8Array(length);
    let at = 0;
    parts.forEach(part => { out.set(part, at); at += part.length; });
    return out;
  }

  function name(text) {
    return '/' + String(text).replace(/[^\x21-\x7e]|[#()<>\[\]{}\/%]/g, match =>
      '#' + match.charCodeAt(0).toString(16).padStart(2, '0'));
  }

  /* ------------------------------------------------------------ truetype */

  function Reader(view) {
    this.view = view;
    this.at = 0;
  }

  Reader.prototype.u8 = function () { return this.view.getUint8(this.at++); };
  Reader.prototype.u16 = function () { const v = this.view.getUint16(this.at); this.at += 2; return v; };
  Reader.prototype.i16 = function () { const v = this.view.getInt16(this.at); this.at += 2; return v; };
  Reader.prototype.u32 = function () { const v = this.view.getUint32(this.at); this.at += 4; return v; };

  /* The tables a page needs to set type: where the glyphs are, how wide they
     are, and which one a character is. */
  function readFont(buffer) {
    const view = new DataView(buffer);
    const tables = {};
    const count = view.getUint16(4);

    for (let index = 0; index < count; index++) {
      const at = 12 + index * 16;
      let tag = '';
      for (let byte = 0; byte < 4; byte++) tag += String.fromCharCode(view.getUint8(at + byte));
      tables[tag] = { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) };
    }

    if (!tables.glyf || !tables.loca || !tables.head || !tables.cmap ||
        !tables.hhea || !tables.maxp) {
      throw new Error('unsupported font');
    }

    const head = tables.head.offset;
    const font = {
      buffer: buffer,
      view: view,
      tables: tables,
      unitsPerEm: view.getUint16(head + 18) || 1000,
      indexToLocFormat: view.getInt16(head + 50),
      bbox: [
        view.getInt16(head + 36), view.getInt16(head + 38),
        view.getInt16(head + 40), view.getInt16(head + 42)
      ],
      numGlyphs: view.getUint16(tables.maxp.offset + 4),
      ascender: view.getInt16(tables.hhea.offset + 4),
      descender: view.getInt16(tables.hhea.offset + 6),
      numberOfHMetrics: view.getUint16(tables.hhea.offset + 34),
      italicAngle: tables.post ? view.getInt32(tables.post.offset + 4) / 65536 : 0,
      capHeight: 0,
      cache: {},
      glyphCache: {}
    };

    if (tables['OS/2']) {
      const os2 = tables['OS/2'].offset;
      if (view.getUint16(os2) >= 2 && tables['OS/2'].length >= 90) {
        font.capHeight = view.getInt16(os2 + 88);
      }
    }
    if (!font.capHeight) font.capHeight = Math.round(font.ascender * 0.7);

    font.cmap = readCmap(font);
    font.glyphFor = character => font.cmap[character.codePointAt(0)] || 0;
    font.has = character => Boolean(font.cmap[character.codePointAt(0)]);
    font.advance = glyph => advanceOf(font, glyph);

    /* One em is 1000 units in a PDF, whatever the font counts in. */
    font.scale = value => (value * 1000) / font.unitsPerEm;

    font.widthOf = function (text, size) {
      let total = 0;
      for (const character of String(text)) total += advanceOf(font, font.glyphFor(character));
      return (total / font.unitsPerEm) * size;
    };

    font.covers = function (text) {
      for (const character of String(text)) {
        if (character === ' ') continue;
        if (!font.has(character)) return false;
      }
      return true;
    };

    return font;
  }

  function readCmap(font) {
    const view = font.view;
    const base = font.tables.cmap.offset;
    const tables = view.getUint16(base + 2);
    let best = 0;
    let bestScore = -1;

    for (let index = 0; index < tables; index++) {
      const at = base + 4 + index * 8;
      const platform = view.getUint16(at);
      const encoding = view.getUint16(at + 2);
      const offset = view.getUint32(at + 4);
      /* Unicode wins over Windows-BMP, which wins over anything else. */
      const score = platform === 3 && encoding === 10 ? 4
        : platform === 0 ? 3
          : platform === 3 && encoding === 1 ? 2 : 1;

      if (score > bestScore) { bestScore = score; best = base + offset; }
    }

    const map = {};
    const format = view.getUint16(best);

    if (format === 4) {
      const segments = view.getUint16(best + 6) / 2;
      const ends = best + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const ranges = deltas + segments * 2;

      for (let index = 0; index < segments; index++) {
        const end = view.getUint16(ends + index * 2);
        const start = view.getUint16(starts + index * 2);
        const delta = view.getInt16(deltas + index * 2);
        const rangeOffset = view.getUint16(ranges + index * 2);
        if (start === 0xffff) continue;

        for (let code = start; code <= end && code !== 0x10000; code++) {
          let glyph;
          if (rangeOffset === 0) {
            glyph = (code + delta) & 0xffff;
          } else {
            const at = ranges + index * 2 + rangeOffset + (code - start) * 2;
            if (at + 1 >= font.buffer.byteLength) continue;
            glyph = view.getUint16(at);
            if (glyph) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph) map[code] = glyph;
        }
      }
    } else if (format === 12) {
      const groups = view.getUint32(best + 12);
      for (let index = 0; index < groups; index++) {
        const at = best + 16 + index * 12;
        const start = view.getUint32(at);
        const end = view.getUint32(at + 4);
        const glyph = view.getUint32(at + 8);
        for (let code = start; code <= end; code++) map[code] = glyph + (code - start);
      }
    }

    return map;
  }

  function advanceOf(font, glyph) {
    const hmtx = font.tables.hmtx;
    if (!hmtx) return font.unitsPerEm / 2;

    const last = font.numberOfHMetrics - 1;
    const index = Math.min(glyph, last);
    return font.view.getUint16(hmtx.offset + index * 4);
  }

  function locaOf(font, glyph) {
    const loca = font.tables.loca.offset;
    if (font.indexToLocFormat === 0) {
      return [font.view.getUint16(loca + glyph * 2) * 2,
        font.view.getUint16(loca + glyph * 2 + 2) * 2];
    }
    return [font.view.getUint32(loca + glyph * 4), font.view.getUint32(loca + glyph * 4 + 4)];
  }

  /* A glyph as contours of points, in font units. Quadratic curves are the
     only kind TrueType has; they become cubics on the way out. */
  function contoursOf(font, glyph, depth) {
    if (glyph >= font.numGlyphs) return [];
    if (font.glyphCache[glyph]) return font.glyphCache[glyph];

    const bounds = locaOf(font, glyph);
    if (bounds[0] >= bounds[1]) return (font.glyphCache[glyph] = []);

    const start = font.tables.glyf.offset + bounds[0];
    const reader = new Reader(font.view);
    reader.at = start;

    const contourCount = reader.i16();
    reader.at += 8;

    let contours;
    if (contourCount >= 0) {
      contours = simpleGlyph(reader, contourCount);
    } else {
      contours = compositeGlyph(font, reader, depth || 0);
    }

    font.glyphCache[glyph] = contours;
    return contours;
  }

  function simpleGlyph(reader, contourCount) {
    const endPoints = [];
    for (let index = 0; index < contourCount; index++) endPoints.push(reader.u16());

    const total = contourCount ? endPoints[contourCount - 1] + 1 : 0;

    /* The hinting instructions are stepped over, not read. Their length is
       read first and separately: `at += u16()` would take the offset from
       before the read and lose the two bytes the length itself occupies. */
    const instructions = reader.u16();
    reader.at += instructions;

    const flags = [];
    while (flags.length < total) {
      const flag = reader.u8();
      flags.push(flag);
      if (flag & 8) {
        let repeat = reader.u8();
        while (repeat-- > 0 && flags.length < total) flags.push(flag);
      }
    }

    const xs = [];
    let x = 0;
    flags.forEach(flag => {
      if (flag & 2) x += (flag & 16) ? reader.u8() : -reader.u8();
      else if (!(flag & 16)) x += reader.i16();
      xs.push(x);
    });

    const ys = [];
    let y = 0;
    flags.forEach(flag => {
      if (flag & 4) y += (flag & 32) ? reader.u8() : -reader.u8();
      else if (!(flag & 32)) y += reader.i16();
      ys.push(y);
    });

    const contours = [];
    let from = 0;
    endPoints.forEach(end => {
      const points = [];
      for (let index = from; index <= end && index < total; index++) {
        points.push({ x: xs[index], y: ys[index], on: Boolean(flags[index] & 1) });
      }
      if (points.length) contours.push(points);
      from = end + 1;
    });

    return contours;
  }

  function compositeGlyph(font, reader, depth) {
    if (depth > 4) return [];

    const contours = [];
    let more = true;

    while (more) {
      const flags = reader.u16();
      const glyph = reader.u16();
      more = Boolean(flags & 0x20);

      /* The two arguments are words or bytes, and are an offset only when
         ARGS_ARE_XY_VALUES is set; otherwise they are point numbers, which
         nothing in a text face uses. Either way they have to be read past. */
      let first;
      let second;
      if (flags & 1) { first = reader.i16(); second = reader.i16(); }
      else {
        first = reader.u8(); second = reader.u8();
        if (first > 127) first -= 256;
        if (second > 127) second -= 256;
      }

      const dx = (flags & 2) ? first : 0;
      const dy = (flags & 2) ? second : 0;

      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      if (flags & 8) { a = d = reader.i16() / 16384; }
      else if (flags & 0x40) { a = reader.i16() / 16384; d = reader.i16() / 16384; }
      else if (flags & 0x80) {
        a = reader.i16() / 16384; b = reader.i16() / 16384;
        c = reader.i16() / 16384; d = reader.i16() / 16384;
      }

      contoursOf(font, glyph, depth + 1).forEach(contour => {
        contours.push(contour.map(point => ({
          x: a * point.x + c * point.y + dx,
          y: b * point.x + d * point.y + dy,
          on: point.on
        })));
      });
    }

    return contours;
  }

  /* One glyph as PDF path operators, at `size` millimetres, with the baseline
     at (x, y) and y running down the page. */
  function glyphPath(font, glyph, size, x, y, out) {
    const contours = contoursOf(font, glyph, 0);
    const unit = size / font.unitsPerEm;
    const px = value => x + value * unit;
    const py = value => y - value * unit;

    contours.forEach(points => {
      if (!points.length) return;

      /* A contour may open on a control point. Rotate it to start on a point
         that is on the curve, or begin at the midpoint between the two
         controls that surround the gap -- which is where the outline runs. */
      let start;
      let rest;
      const first = points[0];

      if (first.on) {
        start = first;
        rest = points.slice(1);
      } else {
        const last = points[points.length - 1];
        if (last.on) {
          start = last;
          rest = points.slice(0, points.length - 1);
        } else {
          start = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, on: true };
          rest = points.slice();
        }
      }

      out.push(num(px(start.x)) + ' ' + num(py(start.y)) + ' m');

      let current = start;
      let control = null;

      const lineTo = point => {
        out.push(num(px(point.x)) + ' ' + num(py(point.y)) + ' l');
        current = point;
      };

      const curveTo = (quad, point) => {
        const c1 = { x: current.x + (2 / 3) * (quad.x - current.x), y: current.y + (2 / 3) * (quad.y - current.y) };
        const c2 = { x: point.x + (2 / 3) * (quad.x - point.x), y: point.y + (2 / 3) * (quad.y - point.y) };
        out.push(num(px(c1.x)) + ' ' + num(py(c1.y)) + ' ' +
          num(px(c2.x)) + ' ' + num(py(c2.y)) + ' ' +
          num(px(point.x)) + ' ' + num(py(point.y)) + ' c');
        current = point;
      };

      rest.forEach(point => {
        if (point.on) {
          if (control) { curveTo(control, point); control = null; }
          else lineTo(point);
          return;
        }

        if (control) {
          curveTo(control, { x: (control.x + point.x) / 2, y: (control.y + point.y) / 2 });
        }
        control = point;
      });

      if (control) curveTo(control, start);
      out.push('h');
    });
  }

  /* --------------------------------------------------------------- writer */

  function Document(options) {
    strings = [];
    this.width = options.width;
    this.height = options.height;
    this.objects = [null];
    this.ops = [];
    this.images = {};
    this.fields = [];
    this.links = [];
    this.fontResource = null;
    this.info = options.info || {};
  }

  Document.prototype.object = function (body) {
    this.objects.push(body);
    return this.objects.length - 1;
  };

  Document.prototype.stream = function (dictionary, data) {
    const bytes = typeof data === 'string' ? bytesOf(data) : data;
    return this.object({ dictionary: dictionary, stream: bytes });
  };

  Document.prototype.colour = function (colour, stroking) {
    const rgb = parseColour(colour);
    this.ops.push(num(rgb[0]) + ' ' + num(rgb[1]) + ' ' + num(rgb[2]) + (stroking ? ' RG' : ' rg'));
  };

  function parseColour(colour) {
    let value = String(colour || '#000').trim();
    if (value[0] === '#') value = value.slice(1);
    if (value.length === 3) value = value.split('').map(c => c + c).join('');
    const number = parseInt(value, 16);
    return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
  }

  /* fill, stroke, or both, in the order PDF names them. */
  Document.prototype.paint = function (style) {
    if (style.fill) this.colour(style.fill, false);
    if (style.stroke) {
      this.colour(style.stroke, true);
      this.ops.push(num(style.width || 0.2) + ' w');
      if (style.dash) this.ops.push('[' + style.dash.map(num).join(' ') + '] 0 d');
      else this.ops.push('[] 0 d');
    }
    return style.fill && style.stroke ? 'B' : style.fill ? 'f' : 'S';
  };

  Document.prototype.rect = function (x, y, w, h, style) {
    style = style || {};
    this.ops.push('q');
    const op = this.paint(style);

    if (style.radius) roundedRect(this.ops, x, y, w, h, style.radius);
    else this.ops.push(num(x) + ' ' + num(y) + ' ' + num(w) + ' ' + num(h) + ' re');

    this.ops.push(op);
    this.ops.push('Q');
  };

  function roundedRect(ops, x, y, w, h, r) {
    const k = 0.5523 * r;
    ops.push(num(x + r) + ' ' + num(y) + ' m');
    ops.push(num(x + w - r) + ' ' + num(y) + ' l');
    ops.push(num(x + w - r + k) + ' ' + num(y) + ' ' + num(x + w) + ' ' + num(y + r - k) + ' ' + num(x + w) + ' ' + num(y + r) + ' c');
    ops.push(num(x + w) + ' ' + num(y + h - r) + ' l');
    ops.push(num(x + w) + ' ' + num(y + h - r + k) + ' ' + num(x + w - r + k) + ' ' + num(y + h) + ' ' + num(x + w - r) + ' ' + num(y + h) + ' c');
    ops.push(num(x + r) + ' ' + num(y + h) + ' l');
    ops.push(num(x + r - k) + ' ' + num(y + h) + ' ' + num(x) + ' ' + num(y + h - r + k) + ' ' + num(x) + ' ' + num(y + h - r) + ' c');
    ops.push(num(x) + ' ' + num(y + r) + ' l');
    ops.push(num(x) + ' ' + num(y + r - k) + ' ' + num(x + r - k) + ' ' + num(y) + ' ' + num(x + r) + ' ' + num(y) + ' c');
    ops.push('h');
  }

  Document.prototype.line = function (x1, y1, x2, y2, style) {
    style = style || {};
    this.ops.push('q');
    this.paint({ stroke: style.stroke || '#000', width: style.width, dash: style.dash });
    this.ops.push(num(x1) + ' ' + num(y1) + ' m ' + num(x2) + ' ' + num(y2) + ' l S');
    this.ops.push('Q');
  };

  Document.prototype.circle = function (cx, cy, r, style) {
    style = style || {};
    const k = 0.5523 * r;
    this.ops.push('q');
    const op = this.paint(style);
    this.ops.push(num(cx + r) + ' ' + num(cy) + ' m');
    this.ops.push(num(cx + r) + ' ' + num(cy + k) + ' ' + num(cx + k) + ' ' + num(cy + r) + ' ' + num(cx) + ' ' + num(cy + r) + ' c');
    this.ops.push(num(cx - k) + ' ' + num(cy + r) + ' ' + num(cx - r) + ' ' + num(cy + k) + ' ' + num(cx - r) + ' ' + num(cy) + ' c');
    this.ops.push(num(cx - r) + ' ' + num(cy - k) + ' ' + num(cx - k) + ' ' + num(cy - r) + ' ' + num(cx) + ' ' + num(cy - r) + ' c');
    this.ops.push(num(cx + k) + ' ' + num(cy - r) + ' ' + num(cx + r) + ' ' + num(cy - k) + ' ' + num(cx + r) + ' ' + num(cy) + ' c');
    this.ops.push('h ' + op);
    this.ops.push('Q');
  };

  /* Printed text, as outlines. Letterspacing is applied between characters,
     the way a printer would letterspace a small caps line. */
  Document.prototype.text = function (font, text, options) {
    const size = options.size;
    const tracking = options.tracking || 0;
    const width = font.widthOf(text, size) + tracking * Math.max(0, String(text).length - 1);

    let x = options.x;
    if (options.align === 'center') x -= width / 2;
    else if (options.align === 'right') x -= width;

    this.ops.push('q');
    this.colour(options.colour || '#000', false);

    const out = [];
    for (const character of String(text)) {
      const glyph = font.glyphFor(character);
      if (glyph) glyphPath(font, glyph, size, x, options.y, out);
      x += (font.advance(glyph) / font.unitsPerEm) * size + tracking;
    }

    if (out.length) {
      this.ops.push(out.join('\n'));
      this.ops.push('f');
    }
    this.ops.push('Q');
    return width;
  };

  Document.prototype.textWidth = function (font, text, size, tracking) {
    return font.widthOf(text, size) + (tracking || 0) * Math.max(0, String(text).length - 1);
  };

  /* A JPEG, placed the right way up inside the page's flipped space. */
  Document.prototype.image = function (bytes, x, y, w, h, dimensions) {
    const key = 'Im' + (Object.keys(this.images).length + 1);
    this.images[key] = this.stream({
      Type: '/XObject',
      Subtype: '/Image',
      Width: dimensions.width,
      Height: dimensions.height,
      ColorSpace: '/DeviceRGB',
      BitsPerComponent: 8,
      Filter: '/DCTDecode'
    }, bytes);

    this.ops.push('q');
    this.ops.push(num(w) + ' 0 0 ' + num(-h) + ' ' + num(x) + ' ' + num(y + h) + ' cm');
    this.ops.push(name(key) + ' Do');
    this.ops.push('Q');
  };

  Document.prototype.field = function (options) {
    this.fields.push(options);
  };

  Document.prototype.link = function (options) {
    this.links.push(options);
  };

  Document.prototype.embed = function (font, subfamily) {
    this.embedded = { font: font, subfamily: subfamily || 'Regular' };
  };

  /* WinAnsi is the only single-byte encoding a PDF viewer is sure to know.
     It is Latin-1 apart from this window, which carries the typographic
     punctuation a postcard actually uses. */
  const WIN_ANSI_HIGH = {
    0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
    0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
    0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
    0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
    0x9e: 0x017e, 0x9f: 0x0178
  };

  function fontObjects(doc) {
    const font = doc.embedded.font;
    const file = doc.stream({ Length1: font.buffer.byteLength }, new Uint8Array(font.buffer));

    const widths = [];
    for (let code = 32; code <= 255; code++) {
      const point = WIN_ANSI_HIGH[code] || code;
      const glyph = font.cmap[point] || 0;
      widths.push(Math.round(font.scale(font.advance(glyph))));
    }

    const descriptor = doc.object({
      Type: '/FontDescriptor',
      FontName: name(doc.embedded.subfamily === 'Italic' ? 'EBGaramond-Italic' : 'EBGaramond-Regular'),
      Flags: 32 + (font.italicAngle ? 64 : 0),
      FontBBox: '[' + font.bbox.map(value => num(font.scale(value))).join(' ') + ']',
      ItalicAngle: num(font.italicAngle),
      Ascent: num(font.scale(font.ascender)),
      Descent: num(font.scale(font.descender)),
      CapHeight: num(font.scale(font.capHeight)),
      StemV: 80,
      FontFile2: file + ' 0 R'
    });

    return doc.object({
      Type: '/Font',
      Subtype: '/TrueType',
      BaseFont: name(doc.embedded.subfamily === 'Italic' ? 'EBGaramond-Italic' : 'EBGaramond-Regular'),
      FirstChar: 32,
      LastChar: 255,
      Widths: '[' + widths.join(' ') + ']',
      Encoding: '/WinAnsiEncoding',
      FontDescriptor: descriptor + ' 0 R'
    });
  }

  /* The finished bytes, as a promise: a protected card has to wait on the
     browser's own cipher. `options.protect` asks for that protection, and is
     quietly dropped where a browser will not do the arithmetic -- a card
     nobody can print is worse than one they could edit. */
  Document.prototype.save = function (options) {
    const pageWidth = this.width * MM;
    const pageHeight = this.height * MM;

    /* Millimetres from the top-left, for everything drawn above. */
    const content = num(MM) + ' 0 0 ' + num(-MM) + ' 0 ' + num(pageHeight) + ' cm\n' + this.ops.join('\n') + '\n';
    const contentId = this.stream({}, content);
    const fontId = this.embedded ? fontObjects(this) : null;

    /* The widgets name the page they sit on, and the page names them back, so
       its number is claimed before either is written. */
    const pageId = this.object(null);

    /* An AcroForm field is its own annotation: one object that is both. The
       viewer draws it, because NeedAppearances says the file does not. */
    const annotations = [];
    const fieldIds = [];

    this.fields.forEach(field => {
      /* Multiline is bit 13, comb is bit 25; a comb field spreads what is
         typed evenly across MaxLen cells, which is exactly what the postcode
         boxes are. */
      const flags = (field.multiline ? 1 << 12 : 0) | (field.comb ? 1 << 24 : 0);
      const dictionary = {
        Type: '/Annot',
        Subtype: '/Widget',
        FT: '/Tx',
        Ff: flags,
        T: textString(field.name),
        TU: textString(field.tip || field.name),
        V: textString(field.value || ''),
        DV: textString(field.value || ''),
        DA: literal(FIELD_INK + ' /F1 ' + num((field.size || 3.6) * MM) + ' Tf'),
        Q: field.align === 'center' ? 1 : field.align === 'right' ? 2 : 0,
        Rect: '[' + [
          field.x * MM,
          pageHeight - (field.y + field.height) * MM,
          (field.x + field.width) * MM,
          pageHeight - field.y * MM
        ].map(num).join(' ') + ']',
        F: 4,
        P: pageId + ' 0 R',
        MK: '<< >>',
        BS: '<< /W 0 /S /S >>'
      };
      if (field.comb) dictionary.MaxLen = field.maxLength;

      /* A date field. There is no calendar widget in PDF itself: the format
         and keystroke actions below are what a reader such as Acrobat looks
         for before it offers its own date picker, and they keep what is typed
         to the mask in any case. A viewer that does not know them leaves a
         plain text field, already filled in. */
      if (field.format) {
        const mask = escapeBytes(latin1('"' + field.format + '"'));
        dictionary.AA = '<< /F << /S /JavaScript /JS ' +
          literal('AFDate_FormatEx(' + mask + ');') + ' >> /K << /S /JavaScript /JS ' +
          literal('AFDate_KeystrokeEx(' + mask + ');') + ' >> >>';
      }

      const id = this.object(dictionary);
      fieldIds.push(id);
      annotations.push(id);
    });

    this.links.forEach(link => {
      const id = this.object({
        Type: '/Annot',
        Subtype: '/Link',
        Border: '[0 0 0]',
        Rect: '[' + [
          link.x * MM,
          pageHeight - (link.y + link.height) * MM,
          (link.x + link.width) * MM,
          pageHeight - link.y * MM
        ].map(num).join(' ') + ']',
        A: '<< /S /URI /URI ' + literal(link.url) + ' >>'
      });
      annotations.push(id);
    });

    const resources = {
      ProcSet: '[/PDF /Text /ImageC]'
    };
    if (fontId) resources.Font = '<< /F1 ' + fontId + ' 0 R >>';

    const xobjects = Object.keys(this.images)
      .map(key => name(key) + ' ' + this.images[key] + ' 0 R').join(' ');
    if (xobjects) resources.XObject = '<< ' + xobjects + ' >>';

    const page = {
      Type: '/Page',
      MediaBox: '[0 0 ' + num(pageWidth) + ' ' + num(pageHeight) + ']',
      Resources: dictionaryOf(resources),
      Contents: contentId + ' 0 R'
    };
    if (annotations.length) {
      page.Annots = '[' + annotations.map(id => id + ' 0 R').join(' ') + ']';
    }

    this.objects[pageId] = page;
    const pagesId = this.object({
      Type: '/Pages',
      Kids: '[' + pageId + ' 0 R]',
      Count: 1
    });
    page.Parent = pagesId + ' 0 R';

    const catalogue = {
      Type: '/Catalog',
      Pages: pagesId + ' 0 R'
    };
    if (fieldIds.length) {
      catalogue.AcroForm = '<< /Fields [' + fieldIds.map(id => id + ' 0 R').join(' ') +
        '] /NeedAppearances true /DA ' + literal(FIELD_INK + ' /F1 10 Tf') +
        (fontId ? ' /DR << /Font << /F1 ' + fontId + ' 0 R >> >>' : '') + ' >>';
    }
    const catalogueId = this.object(catalogue);

    const infoId = this.object({
      Title: textString(this.info.title || ''),
      Author: textString(this.info.author || ''),
      Creator: textString(this.info.creator || ''),
      Producer: textString(this.info.creator || '')
    });

    if (!options || !options.protect || !CRYPTO) {
      return write(this.objects, catalogueId, infoId, null);
    }

    const objects = this.objects;
    return protection().then(guard => {
      guard.encryptId = objects.length;
      objects.push(guard.dictionary);
      return write(objects, catalogueId, infoId, guard);
    });
  };

  /* --------------------------------------------------------- protection */

  /* What a reader may do with the card: look at it, print it at full
     resolution, and fill in the form. Bits, counting from one: 3 print, 9 fill
     in form fields, 10 read out for accessibility, 12 print without being
     stepped down to a draft. Changing the card, copying out of it, annotating
     it and taking it apart are all refused. Bits 7 and 8 and everything from
     13 up are reserved and set; bits 1 and 2 are reserved and clear.

     0xFFFFFBC4, as the signed 32-bit integer a PDF writes it as. */
  const PERMISSIONS = -1084;

  const CRYPTO = typeof window !== 'undefined' && window.crypto && window.crypto.subtle
    ? window.crypto : null;

  function randomBytes(count) {
    const out = new Uint8Array(count);
    CRYPTO.getRandomValues(out);
    return out;
  }

  function digest(bits, data) {
    return CRYPTO.subtle.digest('SHA-' + bits, data).then(out => new Uint8Array(out));
  }

  function cipher(keyBytes, iv, data) {
    return CRYPTO.subtle
      .importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt'])
      .then(key => CRYPTO.subtle.encrypt({ name: 'AES-CBC', iv: iv }, key, data))
      .then(out => new Uint8Array(out));
  }

  /* PDF asks for CBC with no padding in several places. A browser will only
     pad, so the block it adds is cut back off. */
  function cipherExactly(keyBytes, iv, data) {
    return cipher(keyBytes, iv, data).then(out => out.subarray(0, out.length - 16));
  }

  const NO_IV = new Uint8Array(16);

  /* Algorithm 2.B: the hardened hash a PDF 2.0 file is keyed with. It is
     deliberately slow -- sixty-four rounds at least, and more until a round
     ends on a small enough byte. */
  function hardenedHash(password, salt, extra) {
    const step = key => {
      const block = joinBytes([password, key, extra]);
      const repeated = new Uint8Array(block.length * 64);
      for (let index = 0; index < 64; index++) repeated.set(block, index * block.length);

      return cipherExactly(key.subarray(0, 16), key.subarray(16, 32), repeated).then(E => {
        let sum = 0;
        for (let index = 0; index < 16; index++) sum += E[index];

        const which = sum % 3;
        return digest(which === 0 ? 256 : which === 1 ? 384 : 512, E).then(hashed => {
          step.round += 1;
          if (step.round >= 64 && E[E.length - 1] <= step.round - 32) return hashed.subarray(0, 32);
          return step(hashed);
        });
      });
    };

    step.round = 0;
    return digest(256, joinBytes([password, salt, extra])).then(step);
  }

  /* The standard security handler at its strongest: AES-256, revision 6. The
     user password is empty, so the card opens for anyone; the owner password
     is thirty-two random bytes, used once and never written down, so nobody --
     whoever made the card included -- can lift the restrictions afterwards. */
  function protection() {
    const fileKey = randomBytes(32);
    const owner = randomBytes(32);
    const user = new Uint8Array(0);
    const empty = new Uint8Array(0);

    const userValidation = randomBytes(8);
    const userKey = randomBytes(8);
    const ownerValidation = randomBytes(8);
    const ownerKey = randomBytes(8);

    const sealed = {};
    let U;

    return hardenedHash(user, userValidation, empty)
      .then(hash => {
        U = joinBytes([hash, userValidation, userKey]);
        return hardenedHash(user, userKey, empty);
      })
      .then(intermediate => cipherExactly(intermediate, NO_IV, fileKey))
      .then(UE => {
        sealed.UE = UE;
        return hardenedHash(owner, ownerValidation, U);
      })
      .then(hash => {
        sealed.O = joinBytes([hash, ownerValidation, ownerKey]);
        return hardenedHash(owner, ownerKey, U);
      })
      .then(intermediate => cipherExactly(intermediate, NO_IV, fileKey))
      .then(OE => {
        sealed.OE = OE;

        /* The permissions are repeated inside the file, enciphered, so that a
           reader can tell they have not been edited on the way. */
        const perms = new Uint8Array(16);
        new DataView(perms.buffer).setInt32(0, PERMISSIONS, true);
        perms[4] = perms[5] = perms[6] = perms[7] = 0xff;
        perms[8] = 0x54;
        perms[9] = 0x61;
        perms[10] = 0x64;
        perms[11] = 0x62;
        perms.set(randomBytes(4), 12);

        return cipher(fileKey, NO_IV, perms);
      })
      .then(out => ({
        key: fileKey,
        id: randomBytes(16),
        dictionary: {
          Filter: '/Standard',
          V: 5,
          R: 6,
          Length: 256,
          CF: '<< /StdCF << /CFM /AESV3 /Length 32 /AuthEvent /DocOpen >> >>',
          StmF: '/StdCF',
          StrF: '/StdCF',
          O: hexString(sealed.O),
          U: hexString(U),
          OE: hexString(sealed.OE),
          UE: hexString(sealed.UE),
          Perms: hexString(out.subarray(0, 16)),
          P: PERMISSIONS,
          EncryptMetadata: 'true'
        }
      }));
  }

  /* Every string and every stream is enciphered with the file key, each under
     an initialisation vector of its own, written in front of it. */
  function encipher(key, data) {
    const iv = randomBytes(16);
    return cipher(key, iv, data).then(body => joinBytes([iv, body]));
  }

  /* ------------------------------------------------------------ assembly */

  function dictionaryOf(entries) {
    const parts = Object.keys(entries).map(key => name(key) + ' ' + entries[key]);
    return '<< ' + parts.join(' ') + ' >>';
  }

  function bodyOf(object) {
    if (object.stream) {
      const dictionary = Object.assign({}, object.dictionary, { Length: object.stream.length });
      return { head: dictionaryOf(dictionary) + '\nstream\n', stream: object.stream, tail: '\nendstream' };
    }
    return { head: dictionaryOf(object), stream: null, tail: '' };
  }

  /* The marks left by `mark` are traded back for the strings they stand for,
     enciphered or not, on the way into the file. */
  function withStrings(text, written) {
    return text.replace(MARKS, (match, index) => written[Number(index)]);
  }

  function assemble(objects, catalogueId, infoId, guard, written) {
    const chunks = [];
    const offsets = [0];
    let at = 0;

    const push = data => {
      const bytes = typeof data === 'string' ? bytesOf(data) : data;
      chunks.push(bytes);
      at += bytes.length;
    };

    push('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');

    for (let id = 1; id < objects.length; id++) {
      offsets[id] = at;
      const body = bodyOf(objects[id]);
      push(withStrings(id + ' 0 obj\n' + body.head, written));
      if (body.stream) push(body.stream);
      push(body.tail + '\nendobj\n');
    }

    const xrefAt = at;
    let xref = 'xref\n0 ' + objects.length + '\n0000000000 65535 f \n';
    for (let id = 1; id < objects.length; id++) {
      xref += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);

    const trailer = {
      Size: objects.length,
      Root: catalogueId + ' 0 R',
      Info: infoId + ' 0 R'
    };
    if (guard) {
      trailer.Encrypt = guard.encryptId + ' 0 R';
      trailer.ID = '[' + hexString(guard.id) + ' ' + hexString(guard.id) + ']';
    }

    push('trailer\n' + dictionaryOf(trailer) + '\nstartxref\n' + xrefAt + '\n%%EOF\n');

    return concat(chunks);
  }

  /* Written out plainly, every string is simply escaped. Written out under
     protection, each is enciphered first -- and so is every stream, in place,
     because what the file records as its length is the length of the
     ciphertext. */
  function write(objects, catalogueId, infoId, guard) {
    if (!guard) {
      return Promise.resolve(assemble(objects, catalogueId, infoId, null,
        strings.map(raw => '(' + escapeBytes(raw) + ')')));
    }

    const written = [];
    let work = Promise.resolve();

    strings.forEach((raw, index) => {
      work = work
        .then(() => encipher(guard.key, raw))
        .then(sealed => { written[index] = '(' + escapeBytes(sealed) + ')'; });
    });

    objects.forEach(object => {
      if (!object || !object.stream) return;
      work = work
        .then(() => encipher(guard.key, object.stream))
        .then(sealed => { object.stream = sealed; });
    });

    return work.then(() => assemble(objects, catalogueId, infoId, guard, written));
  }

  return {
    MM: MM,
    font: readFont,
    document: options => new Document(options)
  };
})();
