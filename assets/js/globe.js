(function () {
  'use strict';

  const explorer = document.querySelector('.globe-explorer');
  const canvas = document.getElementById('country-globe');
  if (!explorer || !canvas) return;

  const context = canvas.getContext('2d');
  const selection = document.getElementById('globe-selection');
  const resetButton = document.getElementById('globe-reset');
  const countryList = document.getElementById('country-list');
  const countrySearch = document.getElementById('country-search');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const degrees = Math.PI / 180;

  const state = {
    countries: [],
    geojson: null,
    featurePaths: [],
    destinationMarkers: [],
    hoveredFeature: null,
    rotationLon: 24,
    rotationLat: 18,
    radius: 0,
    centerX: 0,
    centerY: 0,
    width: 0,
    height: 0,
    dpr: 1,
    pointerId: null,
    pointerStartX: 0,
    pointerStartY: 0,
    startLon: 0,
    startLat: 0,
    moved: false,
    hasInteracted: false,
    needsDraw: true,
    lastFrame: performance.now()
  };

  const featureAliases = {
    'Hong Kong': 'Hong Kong, China',
    'Macao': 'Macao, China',
    'Macau': 'Macao, China',
    'United Republic of Tanzania': 'Tanzania',
    'United States of America': 'United States'
  };

  function normalizedName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function countryForFeature(feature) {
    if (!feature) return null;
    if (feature.__country) return feature.__country;
    if (!feature.properties) return null;
    const featureName = featureAliases[feature.properties.name] || feature.properties.name;
    const normalized = normalizedName(featureName);
    return state.countries.find(country => normalizedName(country.name) === normalized) || null;
  }

  function featureForCountry(country) {
    if (!state.geojson) return null;
    return state.geojson.features.find(feature => {
      const match = countryForFeature(feature);
      return match && match.code === country.code;
    }) || {
      type: 'Feature',
      properties: { name: country.name },
      geometry: null,
      __country: country
    };
  }

  function project(lon, lat) {
    const lambda = (lon - state.rotationLon) * degrees;
    const phi = lat * degrees;
    const phi0 = state.rotationLat * degrees;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const cosPhi0 = Math.cos(phi0);
    const sinPhi0 = Math.sin(phi0);
    const cosLambda = Math.cos(lambda);
    const x = cosPhi * Math.sin(lambda);
    const y = cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosLambda;
    const z = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosLambda;

    return {
      x: state.centerX + state.radius * x,
      y: state.centerY - state.radius * y,
      z,
      visible: z >= -0.004
    };
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    if (width === state.width && height === state.height && dpr === state.dpr) return;

    state.width = width;
    state.height = height;
    state.dpr = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    state.centerX = width * 0.52;
    state.centerY = height * 0.51;
    state.radius = Math.max(90, Math.min(width * 0.43, height * 0.43));
    state.needsDraw = true;
  }

  function drawProjectedLine(points) {
    let drawing = false;
    context.beginPath();

    points.forEach(point => {
      const projected = project(point[0], point[1]);
      if (!projected.visible) {
        drawing = false;
        return;
      }

      if (!drawing) {
        context.moveTo(projected.x, projected.y);
        drawing = true;
      } else {
        context.lineTo(projected.x, projected.y);
      }
    });

    context.stroke();
  }

  function drawGraticule() {
    context.save();
    context.strokeStyle = 'rgba(199, 220, 218, 0.10)';
    context.lineWidth = 0.65;

    for (let lat = -60; lat <= 60; lat += 30) {
      const latitude = [];
      for (let lon = -180; lon <= 180; lon += 3) latitude.push([lon, lat]);
      drawProjectedLine(latitude);
    }

    for (let lon = -180; lon < 180; lon += 30) {
      const longitude = [];
      for (let lat = -90; lat <= 90; lat += 2) longitude.push([lon, lat]);
      drawProjectedLine(longitude);
    }

    context.restore();
  }

  function ringsForGeometry(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return geometry.coordinates;
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.reduce((rings, polygon) => rings.concat(polygon), []);
    }
    return [];
  }

  function createFeaturePath(feature) {
    const path = new Path2D();
    let hasVisiblePoint = false;

    ringsForGeometry(feature.geometry).forEach(ring => {
      let drawing = false;
      let visibleInRing = false;

      ring.forEach(coordinate => {
        const projected = project(coordinate[0], coordinate[1]);
        if (!projected.visible) {
          drawing = false;
          return;
        }

        if (!drawing) {
          path.moveTo(projected.x, projected.y);
          drawing = true;
        } else {
          path.lineTo(projected.x, projected.y);
        }
        visibleInRing = true;
        hasVisiblePoint = true;
      });

      if (visibleInRing) path.closePath();
    });

    return hasVisiblePoint ? path : null;
  }

  function drawCountries() {
    state.featurePaths = [];

    if (!state.geojson) {
      context.fillStyle = 'rgba(236, 226, 201, 0.15)';
      context.font = '12px sans-serif';
      context.textAlign = 'center';
      context.fillText('Loading the atlas…', state.centerX, state.centerY);
      return;
    }

    state.geojson.features.forEach(feature => {
      const path = createFeaturePath(feature);
      if (!path) return;

      const availableCountry = countryForFeature(feature);
      const isHovered = state.hoveredFeature === feature;

      context.fillStyle = availableCountry
        ? (isHovered ? '#6fd6c1' : '#34a58e')
        : (isHovered ? 'rgba(169, 193, 188, 0.46)' : 'rgba(154, 179, 175, 0.23)');
      context.strokeStyle = availableCountry
        ? 'rgba(111, 214, 193, 0.78)'
        : 'rgba(208, 225, 221, 0.22)';
      context.lineWidth = isHovered ? 1.35 : 0.65;
      context.fill(path);
      context.stroke(path);

      state.featurePaths.push({ feature, path });
    });
  }

  function drawDestinationMarkers() {
    state.destinationMarkers = [];

    state.countries.forEach(country => {
      if (!Number.isFinite(country.lon) || !Number.isFinite(country.lat)) return;
      const projected = project(country.lon, country.lat);
      if (!projected.visible) return;

      const feature = featureForCountry(country);
      const hoveredCountry = countryForFeature(state.hoveredFeature);
      const isHovered = hoveredCountry && hoveredCountry.code === country.code;
      const radius = isHovered ? 5.5 : 3.25;

      context.save();
      context.shadowColor = '#34a58e';
      context.shadowBlur = isHovered ? 18 : 9;
      context.fillStyle = isHovered ? '#d9fff7' : '#6fd6c1';
      context.beginPath();
      context.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = 'rgba(11, 17, 19, 0.88)';
      context.lineWidth = 1.4;
      context.stroke();
      context.restore();

      state.destinationMarkers.push({
        country,
        feature,
        x: projected.x,
        y: projected.y,
        hitRadius: Math.max(10, radius + 5)
      });
    });
  }

  function drawGlobe() {
    resizeCanvas();
    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    context.clearRect(0, 0, state.width, state.height);

    const aura = context.createRadialGradient(
      state.centerX - state.radius * 0.28,
      state.centerY - state.radius * 0.32,
      state.radius * 0.1,
      state.centerX,
      state.centerY,
      state.radius * 1.18
    );
    aura.addColorStop(0, 'rgba(93, 176, 166, 0.26)');
    aura.addColorStop(0.64, 'rgba(25, 55, 58, 0.18)');
    aura.addColorStop(1, 'rgba(8, 14, 16, 0)');
    context.fillStyle = aura;
    context.beginPath();
    context.arc(state.centerX, state.centerY, state.radius * 1.18, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.7)';
    context.shadowBlur = 45;
    context.shadowOffsetY = 22;
    context.fillStyle = '#102a2f';
    context.beginPath();
    context.arc(state.centerX, state.centerY, state.radius, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.save();
    context.beginPath();
    context.arc(state.centerX, state.centerY, state.radius, 0, Math.PI * 2);
    context.clip();

    const ocean = context.createRadialGradient(
      state.centerX - state.radius * 0.38,
      state.centerY - state.radius * 0.42,
      state.radius * 0.05,
      state.centerX,
      state.centerY,
      state.radius
    );
    ocean.addColorStop(0, '#21484b');
    ocean.addColorStop(0.55, '#163337');
    ocean.addColorStop(1, '#0c2024');
    context.fillStyle = ocean;
    context.fillRect(
      state.centerX - state.radius,
      state.centerY - state.radius,
      state.radius * 2,
      state.radius * 2
    );

    drawGraticule();
    drawCountries();
    drawDestinationMarkers();

    const shade = context.createRadialGradient(
      state.centerX - state.radius * 0.4,
      state.centerY - state.radius * 0.45,
      state.radius * 0.15,
      state.centerX + state.radius * 0.1,
      state.centerY + state.radius * 0.05,
      state.radius * 1.05
    );
    shade.addColorStop(0, 'rgba(255,255,255,0.08)');
    shade.addColorStop(0.62, 'rgba(3,10,12,0)');
    shade.addColorStop(1, 'rgba(0,5,7,0.58)');
    context.fillStyle = shade;
    context.fillRect(
      state.centerX - state.radius,
      state.centerY - state.radius,
      state.radius * 2,
      state.radius * 2
    );
    context.restore();

    context.strokeStyle = 'rgba(196, 222, 216, 0.28)';
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(state.centerX, state.centerY, state.radius, 0, Math.PI * 2);
    context.stroke();

    state.needsDraw = false;
  }

  function requestDraw() {
    state.needsDraw = true;
  }

  function hitTest(x, y) {
    if (Math.hypot(x - state.centerX, y - state.centerY) > state.radius) return null;

    for (let index = state.destinationMarkers.length - 1; index >= 0; index -= 1) {
      const marker = state.destinationMarkers[index];
      if (Math.hypot(x - marker.x, y - marker.y) <= marker.hitRadius) return marker.feature;
    }

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    for (let index = state.featurePaths.length - 1; index >= 0; index -= 1) {
      const item = state.featurePaths[index];
      if (context.isPointInPath(item.path, x, y)) {
        context.restore();
        return item.feature;
      }
    }
    context.restore();
    return null;
  }

  function setSelection(feature) {
    if (!feature) {
      selection.classList.remove('is-available');
      selection.querySelector('strong').textContent = 'Select a country';
      selection.querySelector('small').textContent = 'Highlighted countries open galleries.';
      return;
    }

    const availableCountry = countryForFeature(feature);
    const name = availableCountry ? availableCountry.name : feature.properties.name;
    selection.querySelector('strong').textContent = name;
    selection.querySelector('small').textContent = availableCountry
      ? 'Open gallery'
      : 'No gallery';
    selection.classList.toggle('is-available', Boolean(availableCountry));
  }

  function updateActiveCountry(country) {
    Array.from(countryList.querySelectorAll('button')).forEach(button => {
      button.classList.toggle('is-active', Boolean(country) && button.dataset.code === country.code);
    });
  }

  function navigateToCountry(country) {
    if (!country) return;
    window.location.href = country.code.toLowerCase();
  }

  function onPointerDown(event) {
    state.pointerId = event.pointerId;
    state.pointerStartX = event.clientX;
    state.pointerStartY = event.clientY;
    state.startLon = state.rotationLon;
    state.startLat = state.rotationLat;
    state.moved = false;
    state.hasInteracted = true;
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    const rect = canvas.getBoundingClientRect();

    if (state.pointerId === event.pointerId) {
      const dx = event.clientX - state.pointerStartX;
      const dy = event.clientY - state.pointerStartY;
      if (Math.abs(dx) + Math.abs(dy) > 4) state.moved = true;
      state.rotationLon = state.startLon - dx * 0.32;
      state.rotationLat = Math.max(-72, Math.min(72, state.startLat + dy * 0.24));
      requestDraw();
      return;
    }

    const feature = hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (feature !== state.hoveredFeature) {
      state.hoveredFeature = feature;
      const available = countryForFeature(feature);
      canvas.style.cursor = available ? 'pointer' : 'grab';
      setSelection(feature);
      updateActiveCountry(available);
      requestDraw();
    }
  }

  function onPointerUp(event) {
    if (state.pointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    const feature = hitTest(event.clientX - rect.left, event.clientY - rect.top);
    const available = countryForFeature(feature);

    if (!state.moved && available) navigateToCountry(available);
    if (!state.moved && feature) setSelection(feature);

    state.pointerId = null;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function onPointerCancel(event) {
    if (state.pointerId !== event.pointerId) return;
    state.pointerId = null;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function onPointerLeave() {
    if (state.pointerId !== null) return;
    state.hoveredFeature = null;
    canvas.style.cursor = 'grab';
    setSelection(null);
    updateActiveCountry(null);
    requestDraw();
  }

  function onKeyDown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    state.hasInteracted = true;

    if (event.key === 'ArrowLeft') state.rotationLon -= 8;
    if (event.key === 'ArrowRight') state.rotationLon += 8;
    if (event.key === 'ArrowUp') state.rotationLat = Math.min(72, state.rotationLat + 6);
    if (event.key === 'ArrowDown') state.rotationLat = Math.max(-72, state.rotationLat - 6);
    if (event.key === 'Enter') navigateToCountry(countryForFeature(state.hoveredFeature));
    requestDraw();
  }

  function focusCountry(country) {
    const feature = featureForCountry(country);
    if (!feature) return;

    state.hoveredFeature = feature;
    setSelection(feature);
    updateActiveCountry(country);
    requestDraw();
  }

  function buildCountryList() {
    const sortedCountries = state.countries.slice().sort((a, b) => a.name.localeCompare(b.name));

    sortedCountries.forEach(country => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const code = document.createElement('span');
      const name = document.createElement('span');

      button.type = 'button';
      button.dataset.code = country.code;
      button.setAttribute('aria-label', `Open ${country.name} photo gallery`);
      code.className = 'country-code';
      code.textContent = country.code;
      name.className = 'country-name';
      name.textContent = country.name;
      button.appendChild(code);
      button.appendChild(name);
      item.appendChild(button);
      countryList.appendChild(item);

      button.addEventListener('mouseenter', () => focusCountry(country));
      button.addEventListener('focus', () => focusCountry(country));
      button.addEventListener('mouseleave', () => {
        if (document.activeElement !== button) onPointerLeave();
      });
      button.addEventListener('blur', onPointerLeave);
      button.addEventListener('click', () => navigateToCountry(country));
    });
  }

  function filterCountries() {
    const query = normalizedName(countrySearch.value);
    let visibleCount = 0;

    Array.from(countryList.children).forEach(item => {
      const button = item.querySelector('button');
      if (!button) return;
      const matches = normalizedName(button.textContent).includes(query);
      item.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    let empty = countryList.querySelector('.empty-result');
    if (!visibleCount && !empty) {
      empty = document.createElement('li');
      empty.className = 'empty-result';
      empty.textContent = 'No destination matches that search.';
      countryList.appendChild(empty);
    } else if (visibleCount && empty) {
      empty.remove();
    }
  }

  function resetGlobe() {
    state.rotationLon = 24;
    state.rotationLat = 18;
    state.hasInteracted = false;
    state.lastFrame = performance.now();
    state.hoveredFeature = null;
    setSelection(null);
    updateActiveCountry(null);
    requestDraw();
    canvas.focus();
  }

  function animate(now) {
    resizeCanvas();
    const elapsed = Math.min(40, now - state.lastFrame);
    const panelIsOpen = document.getElementById('world-map').classList.contains('active');

    if (panelIsOpen && !reducedMotion && !state.hasInteracted && state.pointerId === null) {
      state.rotationLon += elapsed * 0.0022;
      state.needsDraw = true;
    }

    if (state.needsDraw) drawGlobe();
    state.lastFrame = now;
    window.requestAnimationFrame(animate);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('keydown', onKeyDown);
  resetButton.addEventListener('click', resetGlobe);
  countrySearch.addEventListener('input', filterCountries);
  document.addEventListener('keydown', event => {
    const panel = document.getElementById('world-map');
    const activeElement = document.activeElement;
    const activePanel = activeElement && activeElement.closest('.panel');
    const isEditing = /input|textarea|select/i.test(activeElement && activeElement.tagName) &&
      (!activePanel || activePanel.classList.contains('active'));
    if (
      event.key === '/' &&
      panel.classList.contains('active') &&
      document.activeElement !== countrySearch &&
      !isEditing
    ) {
      event.preventDefault();
      countrySearch.focus();
    }
  });

  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      resizeCanvas();
      requestDraw();
    }).observe(canvas);
  } else {
    window.addEventListener('resize', () => {
      resizeCanvas();
      requestDraw();
    });
  }

  const panel = document.getElementById('world-map');
  let dataLoadStarted = false;

  function loadGlobeData() {
    if (dataLoadStarted) return;
    dataLoadStarted = true;

    Promise.all([
      fetch(explorer.dataset.geoUrl).then(response => {
        if (!response.ok) throw new Error('Could not load country geometry.');
        return response.json();
      }),
      fetch(explorer.dataset.countriesUrl).then(response => {
        if (!response.ok) throw new Error('Could not load destinations.');
        return response.json();
      })
    ]).then(([geojson, countries]) => {
      state.geojson = geojson;
      state.countries = countries;
      document.getElementById('globe-destination-count').textContent =
        `${countries.length} DESTINATIONS`;
      buildCountryList();
      requestDraw();
    }).catch(error => {
      selection.querySelector('strong').textContent = 'Could not load';
      selection.querySelector('small').textContent = 'Refresh and try again.';
      console.error(error);
    });
  }

  function loadGlobeDataWhenVisible() {
    if (panel.classList.contains('active')) loadGlobeData();
  }

  if ('MutationObserver' in window) {
    new MutationObserver(loadGlobeDataWhenVisible).observe(panel, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  loadGlobeDataWhenVisible();

  document.documentElement.style.scrollBehavior = 'smooth';
  resizeCanvas();
  window.requestAnimationFrame(animate);
})();
