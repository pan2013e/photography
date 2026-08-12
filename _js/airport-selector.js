(function () {
  'use strict';

  /* Written by the page, in the page's language. See _includes/header.html. */
  const text = window.SiteText || {};

  function say(key, values) {
    const template = text[key];
    if (template === undefined) return '';
    return values ? text.format(template, values) : template;
  }

  const explorer = document.querySelector('.airport-explorer');
  if (!explorer) return;

  const list = document.getElementById('airport-list');
  const search = document.getElementById('airport-search');
  const count = document.getElementById('airport-count');
  const empty = document.getElementById('airport-empty');
  const panel = document.getElementById('airport-selector');

  let airports = [];

  function normalized(value) {
    return String(value || '').toLowerCase().trim();
  }

  function photoCount(airport) {
    return Number.isFinite(airport.count) ? airport.count : 0;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text || text === 0) node.textContent = String(text);
    return node;
  }

  /* 22.31184 -> N22°18'42" -- the way a chart writes it. */
  function degrees(value, positive, negative) {
    if (!Number.isFinite(value)) return null;

    const total = Math.abs(value);
    const whole = Math.floor(total);
    const minutes = Math.floor((total - whole) * 60);
    const seconds = Math.round((((total - whole) * 60) - minutes) * 60);

    return (value < 0 ? negative : positive) + whole + '°' +
      String(minutes).padStart(2, '0') + '′' +
      String(seconds).padStart(2, '0') + '″';
  }

  function coordinates(airport) {
    const north = degrees(airport.lat, 'N', 'S');
    const east = degrees(airport.lon, 'E', 'W');
    return north && east ? north + ' ' + east : null;
  }

  function specification(label, value) {
    if (!value && value !== 0) return null;

    const row = element('span', 'airport-spec');
    row.appendChild(element('span', 'airport-spec-label', label));
    row.appendChild(element('span', 'airport-spec-value', value));
    return row;
  }

  function createAirportCard(airport) {
    const item = document.createElement('li');
    const link = element('a', 'airport-card');
    const where = airport.countryName || airport.country.toUpperCase();
    const count = photoCount(airport);

    link.href = airport.code;
    link.setAttribute('aria-label', say('airport_open', { name: airport.name }));

    /* The IATA code, ghosted, sits behind the card like a drawing number. */
    link.appendChild(element('span', 'airport-watermark', airport.iata));

    const head = element('span', 'airport-head');
    head.appendChild(element('strong', 'airport-iata', airport.iata));
    head.appendChild(element('span', 'airport-icao', airport.icao));
    link.appendChild(head);

    /* City states read badly as "Singapore · Singapore". */
    link.appendChild(element(
      'span',
      'airport-place',
      airport.city && !where.includes(airport.city) ? airport.city + ' · ' + where : where
    ));
    link.appendChild(element('span', 'airport-name', airport.name.replace(/\//g, ' / ')));

    const runway = element('span', 'airport-runway');
    runway.setAttribute('aria-hidden', 'true');
    link.appendChild(runway);

    const specs = element('span', 'airport-specs');
    [
      specification(say('airport_coord'), coordinates(airport)),
      specification(say('airport_elev'), Number.isFinite(airport.elevation)
        ? say('airport_elevation_unit', { feet: airport.elevation })
        : null),
      specification(say('airport_frames'), count)
    ].forEach(row => {
      if (row) specs.appendChild(row);
    });
    link.appendChild(specs);

    item.appendChild(link);
    return item;
  }

  function renderAirports() {
    const query = normalized(search.value);
    const visible = airports.filter(airport => !query || airport.search.includes(query));

    list.textContent = '';
    visible.forEach(airport => list.appendChild(airport.element));
    empty.hidden = visible.length !== 0;
    const withPhotos = visible.filter(airport => photoCount(airport.data) > 0).length;
    count.textContent = say(withPhotos === 1 ? 'galleries_one' : 'galleries_many',
      { count: withPhotos });
  }

  function prepareAirports(data) {
    airports = data
      .filter(airport => airport && airport.iata && airport.icao && airport.name)
      .sort((first, second) => {
        const difference = photoCount(second) - photoCount(first);
        return difference !== 0 ? difference : first.iata.localeCompare(second.iata);
      })
      .map(airport => ({
        data: airport,
        /* `match` is the English name -- a reader on the Chinese page may
           well reach for "Beijing Capital", or the other way round -- and
           `pinyin` is present only where the names are not written in Latin
           letters. Both are prepared at build time. */
        search: normalized([
          airport.name,
          airport.match,
          airport.pinyin,
          airport.iata,
          airport.icao,
          airport.city,
          airport.country,
          airport.countryName
        ].join(' ')),
        element: createAirportCard(airport)
      }));

    renderAirports();
  }

  search.addEventListener('input', renderAirports);

  /* The heading only needs a dividing line once a card has gone past it. */
  const scroller = explorer.querySelector('.airport-scroll');

  if (scroller) {
    scroller.addEventListener('scroll', () => {
      explorer.classList.toggle('has-scrolled', scroller.scrollTop > 4);
    }, { passive: true });
  }
  document.addEventListener('keydown', event => {
    const activeElement = document.activeElement;
    const activePanel = activeElement && activeElement.closest('.panel');
    const isEditing = /input|textarea|select/i.test(activeElement && activeElement.tagName) &&
      (!activePanel || activePanel.classList.contains('active'));
    if (
      event.key === '/' &&
      panel.classList.contains('active') &&
      document.activeElement !== search &&
      !isEditing
    ) {
      event.preventDefault();
      search.focus();
    }
  });

  let dataLoadStarted = false;

  function loadAirportData() {
    if (dataLoadStarted) return;
    dataLoadStarted = true;

    fetch(explorer.dataset.atlasUrl)
      .then(response => {
        if (!response.ok) throw new Error('Could not load airport galleries.');
        return response.json();
      })
      .then(atlas => prepareAirports(atlas.airports || []))
      .catch(error => {
        empty.hidden = false;
        empty.textContent = say('airport_error');
        console.error(error);
      });
  }

  function loadAirportDataWhenVisible() {
    if (panel.classList.contains('active')) loadAirportData();
  }

  if ('MutationObserver' in window) {
    new MutationObserver(loadAirportDataWhenVisible).observe(panel, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  loadAirportDataWhenVisible();
})();
