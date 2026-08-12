/*
 * Zine postcards.
 *
 * Photographs listed in _data/postcards.yml have a reverse side. This module
 * builds that card inside the lightbox popup and flips between the two, and
 * exposes three calls used by main.js:
 *
 *   Postcards.attach(popup)          add the card and the flip button
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

  const source = document.documentElement.getAttribute('data-postcards-url');
  let cards = null;
  let loading = null;
  const popups = [];

  function load() {
    if (loading || !source) return loading;

    loading = fetch(source)
      .then(response => {
        if (!response.ok) throw new Error(say('postcard_error'));
        return response.json();
      })
      .then(data => {
        cards = data;
        /* Data can land after a popup has already opened. */
        popups.forEach(entry => {
          if (entry.photo) show(entry.popup, entry.photo, entry.image);
        });
      })
      .catch(error => {
        cards = {};
        console.error(error);
      });

    return loading;
  }

  function entryFor(popup) {
    return popups.find(item => item.popup === popup) || null;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function field(label, value) {
    if (!value) return null;

    const wrapper = element('div', 'postcard-field');
    wrapper.appendChild(element('dt', null, label));
    wrapper.appendChild(element('dd', null, value));
    return wrapper;
  }

  function stamp(number) {
    return say('postcard_number', { number: String(number).padStart(3, '0') });
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

    return chosen.map(colour => 'rgb(' + colour.red + ', ' + colour.green + ', ' + colour.blue + ')');
  }

  function paintSwatches(list, colours) {
    list.textContent = '';
    colours.slice(0, 4).forEach(colour => {
      const swatch = element('li');
      swatch.style.background = colour;
      list.appendChild(swatch);
    });
    list.hidden = colours.length === 0;
  }

  function build(card, image) {
    const sheet = element('div', 'postcard-sheet');
    const copy = element('div', 'postcard-copy');
    const fields = element('dl', 'postcard-fields');
    const swatches = element('ul', 'postcard-swatches');

    /* Anything the photograph could not tell us is left off rather than
       printed blank, so a sparse card still reads as a finished one. */
    if (card.title) copy.appendChild(element('h3', 'postcard-title', card.title));
    copy.appendChild(element('p', 'postcard-kind', card.kind || say('postcard')));

    [
      field(say('postcard_location'), card.location),
      field(say('postcard_date'), card.date),
      field(say('postcard_camera'), card.camera)
    ].forEach(entry => {
      if (entry) fields.appendChild(entry);
    });

    if (fields.children.length) copy.appendChild(fields);
    copy.appendChild(element('p', 'postcard-number', stamp(card.number)));
    copy.appendChild(swatches);
    if (card.note) copy.appendChild(element('p', 'postcard-note', card.note));

    if (card.swatches && card.swatches.length) {
      paintSwatches(swatches, card.swatches);
    } else if (image && image.complete && image.naturalWidth) {
      paintSwatches(swatches, sampleSwatches(image));
    } else if (image) {
      swatches.hidden = true;
      image.addEventListener('load', function once() {
        image.removeEventListener('load', once);
        paintSwatches(swatches, sampleSwatches(image));
      });
    }

    sheet.appendChild(copy);

    if (card.illustration) {
      const art = element('div', 'postcard-art');
      const drawing = element('img');
      drawing.src = card.illustration;
      drawing.alt = '';
      drawing.decoding = 'async';
      art.appendChild(drawing);
      sheet.appendChild(art);
    } else {
      sheet.classList.add('has-no-art');
    }

    return sheet;
  }

  function attach(popup) {
    if (entryFor(popup)) return;

    const face = element('div', 'postcard-face');
    const button = element('button', 'postcard-flip');

    face.hidden = true;
    face.setAttribute('aria-hidden', 'true');
    button.type = 'button';
    button.hidden = true;
    button.innerHTML = '<i class="fa fa-envelope-o" aria-hidden="true"></i>' +
      '<span class="sr-only"></span>';

    /* The popup closes on any click it receives, so the card keeps its own. */
    face.addEventListener('click', event => event.stopPropagation());
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggle(popup);
    });

    popup.appendChild(face);
    popup.appendChild(button);
    popups.push({ popup, face, button, photo: null, image: null });
  }

  /* The button shows what you would get: an envelope for the card, a picture
     to come back. */
  function label(entry, flipped) {
    const words = say(flipped ? 'show_photograph' : 'show_postcard');

    entry.button.querySelector('i').className = flipped
      ? 'fa fa-picture-o'
      : 'fa fa-envelope-o';
    entry.button.querySelector('span').textContent = say(flipped ? 'photograph' : 'postcard');
    entry.button.setAttribute('title', words);
    entry.button.setAttribute('aria-label', words);
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
    reset(popup);

    if (!cards) {
      load();
      entry.button.hidden = true;
      return;
    }

    const card = cards[photo];
    entry.face.textContent = '';
    entry.button.hidden = !card;
    if (!card) return;

    entry.face.appendChild(build(card, entry.image));
  }

  return { attach, prime: load, show, reset, toggle };
})();
