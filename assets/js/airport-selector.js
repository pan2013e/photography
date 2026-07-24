(function () {
  'use strict';

  const explorer = document.querySelector('.airport-explorer');
  if (!explorer) return;

  const list = document.getElementById('airport-list');
  const search = document.getElementById('airport-search');
  const count = document.getElementById('airport-count');
  const empty = document.getElementById('airport-empty');
  const panel = document.getElementById('airport-selector');
  const countryNames = {
    ca: 'Canada',
    cn: 'China',
    hk: 'Hong Kong, China',
    jp: 'Japan',
    kr: 'South Korea',
    ph: 'Philippines',
    pt: 'Portugal',
    sg: 'Singapore'
  };

  let airports = [];

  function normalized(value) {
    return String(value || '').toLowerCase().trim();
  }

  function galleryUrl(airport) {
    return airport.iata.toLowerCase();
  }

  function createAirportCard(airport) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    const stub = document.createElement('span');
    const iata = document.createElement('strong');
    const icao = document.createElement('span');
    const body = document.createElement('span');
    const routeLine = document.createElement('span');
    const country = document.createElement('span');
    const arrow = document.createElement('i');
    const name = document.createElement('span');

    item.dataset.search = normalized([
      airport.name,
      airport.iata,
      airport.icao,
      airport.country,
      countryNames[normalized(airport.country)]
    ].join(' '));

    link.className = 'airport-card';
    link.href = galleryUrl(airport);
    link.setAttribute('aria-label', `Open ${airport.name} photo gallery`);

    stub.className = 'airport-stub';
    iata.className = 'airport-iata';
    iata.textContent = airport.iata;
    icao.className = 'airport-icao';
    icao.textContent = airport.icao;
    stub.appendChild(iata);
    stub.appendChild(icao);

    body.className = 'airport-card-body';
    routeLine.className = 'airport-route';
    country.className = 'airport-country';
    country.textContent = countryNames[normalized(airport.country)] || airport.country.toUpperCase();
    arrow.className = 'fa fa-arrow-right';
    arrow.setAttribute('aria-hidden', 'true');
    routeLine.appendChild(country);
    routeLine.appendChild(arrow);

    name.className = 'airport-name';
    name.textContent = airport.name.replace(/\//g, ' / ');
    body.appendChild(routeLine);
    body.appendChild(name);

    link.appendChild(stub);
    link.appendChild(body);
    item.appendChild(link);
    return item;
  }

  function renderAirports() {
    const query = normalized(search.value);
    const visible = airports.filter(airport => !query || airport.search.includes(query));

    list.textContent = '';
    visible.forEach(airport => list.appendChild(airport.element));
    empty.hidden = visible.length !== 0;
    count.textContent = String(visible.length);
  }

  function prepareAirports(data) {
    airports = data
      .filter(airport => airport && airport.iata && airport.icao && airport.name)
      .sort((first, second) => first.iata.localeCompare(second.iata))
      .map(airport => ({
        data: airport,
        search: normalized([
          airport.name,
          airport.iata,
          airport.icao,
          airport.country,
          countryNames[normalized(airport.country)]
        ].join(' ')),
        element: createAirportCard(airport)
      }));

    renderAirports();
  }

  search.addEventListener('input', renderAirports);
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

    fetch(explorer.dataset.airportsUrl)
      .then(response => {
        if (!response.ok) throw new Error('Could not load airport galleries.');
        return response.json();
      })
      .then(prepareAirports)
      .catch(error => {
        empty.hidden = false;
        empty.textContent = 'Airport galleries could not be loaded. Please refresh and try again.';
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
