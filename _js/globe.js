/*
 * The gallery explorer behind the globe icon.
 *
 * It has two views that share one canvas, one place list and one search box:
 *
 *   globe  an orthographic world, where the centre line picks out the country
 *          it passes through.
 *   map    a flat map of one country's subdivisions, entered by choosing a
 *          country that declares `subdivisions` in the atlas.
 *
 * A "place" is whatever the current view can be navigated into: a country in
 * the globe view, a region in the map view. Places come from the generated
 * JSON in /assets, so a place with no photographs is drawn but not clickable.
 */
(function () {
  'use strict';

  /* Every word on this panel is written by the page, in the page's language;
     see _includes/header.html and _data/i18n/<locale>.yml. */
  const text = window.SiteText || {};

  function say(key, values) {
    const template = text[key];
    if (template === undefined) return '';
    return values ? text.format(template, values) : template;
  }

  const explorer = document.querySelector('.globe-explorer');
  const canvas = document.getElementById('country-globe');
  if (!explorer || !canvas) return;

  const context = canvas.getContext('2d');
  const panel = document.getElementById('world-map');
  const stage = explorer.querySelector('.globe-stage');
  const selection = document.getElementById('globe-selection');
  const resetButton = document.getElementById('globe-reset');
  const backButton = document.getElementById('globe-back');
  const title = document.getElementById('globe-title');
  const eyebrow = document.getElementById('globe-destination-count');
  const pickerLabel = document.getElementById('country-picker-label');
  const parentLink = document.getElementById('globe-parent-link');
  const placeList = document.getElementById('country-list');
  const placeSearch = document.getElementById('country-search');
  const hud = explorer.querySelector('.globe-hud span');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const degrees = Math.PI / 180;

  const palette = {
    active: '#34a58e',
    activeBright: '#6fd6c1',
    idle: 'rgba(154, 179, 175, 0.23)',
    idleHighlight: 'rgba(169, 193, 188, 0.52)',
    idleLine: 'rgba(208, 225, 221, 0.22)',
    idleLineHighlight: 'rgba(222, 239, 235, 0.72)',
    activeLine: 'rgba(111, 214, 193, 0.78)',
    activeLineHighlight: 'rgba(217, 255, 247, 0.95)'
  };

  const state = {
    view: 'globe',
    places: [],
    geojson: null,
    subdivisions: {},
    names: {},
    parent: null,
    featurePaths: [],
    destinationMarkers: [],
    hoveredFeature: null,
    meridianFeature: null,
    rotationLon: 24,
    rotationLat: 18,
    radius: 0,
    centerX: 0,
    centerY: 0,
    width: 0,
    height: 0,
    dpr: 1,
    bounds: null,
    mapScale: 1,
    mapStretch: 1,
    mapOriginX: 0,
    mapOriginY: 0,
    insetFeaturePaths: [],
    insetMarkers: [],
    insetRect: null,
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

  /* Where the map's name for a country differs from the atlas's. Without an
     entry here the two never meet, so the country neither lights up when it
     has a gallery nor finds its translated name. */
  const featureAliases = {
    'Czech Republic': 'Czechia',
    'Gambia': 'The Gambia',
    'Hong Kong': 'Hong Kong, China',
    'Macao': 'Macao, China',
    'Macau': 'Macao, China',
    'Macedonia': 'North Macedonia',
    'Republic of Serbia': 'Serbia',
    'Swaziland': 'Eswatini',
    'United Republic of Tanzania': 'Tanzania',
    'United States of America': 'United States'
  };

  /* Hong Kong and Macao are legible in the source geometry but only a few
     pixels wide when all of China is fitted into the stage. The inset is a
     geographic viewport, not a second list of places: whatever regions the
     photographs and geometry provide inside these bounds are drawn. */
  const pearlRiverDeltaInset = {
    parent: 'cn',
    bounds: {
      minLon: 113.25,
      maxLon: 114.55,
      minLat: 21.95,
      maxLat: 22.75
    }
  };

  try {
    state.subdivisionGeo = JSON.parse(explorer.dataset.subdivisionGeo || '{}');
  } catch (error) {
    state.subdivisionGeo = {};
  }

  function isMap() {
    return state.view === 'map';
  }

  function openGallery(code) {
    const url = new URL(code, window.location.href).href;

    if (window.Navigation && window.Navigation.supported) window.Navigation.go(url, true);
    else window.location.href = url;
  }

  /* Keeps letters and digits of any script, so that a search typed in Chinese
     narrows the list instead of matching everything. */
  function normalizedName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  function photoCount(place) {
    return place && Number.isFinite(place.count) ? place.count : 0;
  }

  function isReachable(place) {
    return Boolean(place) && (photoCount(place) > 0 || Boolean(place.subdivisions));
  }

  function countLabel(place) {
    const count = photoCount(place);
    if (count === 0) return say('photographs_none');
    return say(count === 1 ? 'photographs_one' : 'photographs_many', { count });
  }

  /* -- places and features ------------------------------------------------ */

  function placeForFeature(feature) {
    if (!feature) return null;
    if (feature.__place) return feature.__place;
    if (!feature.properties) return null;

    if (isMap()) {
      const iso = feature.properties.iso;
      return state.places.find(place => place.iso === iso) || null;
    }

    /* The geometry is labelled in English whatever language the page is in, so
       every place carries an English name purely to pair the two up. */
    const english = featureAliases[feature.properties.name] || feature.properties.name;
    const normalized = normalizedName(english);
    return state.places.find(place => {
      return normalizedName(place.match || place.name) === normalized;
    }) || null;
  }

  /* What to call a country the centre line is crossing that holds no gallery.
     It is not in the atlas, so its only name is the English one on the map --
     `names` gives the reading in this page's language. */
  function featureName(feature) {
    const drawn = feature.properties.name;
    const english = featureAliases[drawn] || drawn;

    return state.names[normalizedName(english)] || drawn;
  }

  function featureForPlace(place) {
    if (!state.geojson) return null;
    return state.geojson.features.find(feature => {
      const match = placeForFeature(feature);
      return match && match.code === place.code;
    }) || {
      type: 'Feature',
      properties: { name: place.name },
      geometry: null,
      __place: place
    };
  }

  /* -- projection --------------------------------------------------------- */

  function project(lon, lat, mapProjection) {
    if (isMap()) {
      const projection = mapProjection || state;
      return {
        x: projection.mapOriginX + lon * projection.mapStretch * projection.mapScale,
        y: projection.mapOriginY - lat * projection.mapScale,
        z: 1,
        visible: true
      };
    }

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

  function measureBounds(geojson) {
    const bounds = { minLon: 180, maxLon: -180, minLat: 90, maxLat: -90 };

    geojson.features.forEach(feature => {
      ringsForGeometry(feature.geometry).forEach(ring => {
        ring.forEach(point => {
          bounds.minLon = Math.min(bounds.minLon, point[0]);
          bounds.maxLon = Math.max(bounds.maxLon, point[0]);
          bounds.minLat = Math.min(bounds.minLat, point[1]);
          bounds.maxLat = Math.max(bounds.maxLat, point[1]);
        });
      });
    });

    return bounds;
  }

  function measureFeatureBounds(feature) {
    const bounds = { minLon: 180, maxLon: -180, minLat: 90, maxLat: -90 };

    ringsForGeometry(feature.geometry).forEach(ring => {
      ring.forEach(point => {
        bounds.minLon = Math.min(bounds.minLon, point[0]);
        bounds.maxLon = Math.max(bounds.maxLon, point[0]);
        bounds.minLat = Math.min(bounds.minLat, point[1]);
        bounds.maxLat = Math.max(bounds.maxLat, point[1]);
      });
    });

    return bounds;
  }

  function projectionForBounds(bounds, frame, inset) {
    const midLon = (bounds.minLon + bounds.maxLon) / 2;
    const midLat = (bounds.minLat + bounds.maxLat) / 2;
    const mapStretch = Math.cos(midLat * degrees);
    const spanX = (bounds.maxLon - bounds.minLon) * mapStretch;
    const spanY = bounds.maxLat - bounds.minLat;
    const mapScale = Math.min(
      (frame.width * inset) / spanX,
      (frame.height * inset) / spanY
    );

    return {
      mapScale,
      mapStretch,
      mapOriginX: frame.x + frame.width / 2 - midLon * mapStretch * mapScale,
      mapOriginY: frame.y + frame.height / 2 + midLat * mapScale
    };
  }

  function fitMap() {
    if (!state.bounds) return;

    const bounds = state.bounds;
    /* Longitudes converge towards the poles, so the projection squeezes them
       by the middle latitude to keep the country's shape recognisable. */
    const projection = projectionForBounds(
      bounds,
      { x: 0, y: 0, width: state.width, height: state.height },
      0.9
    );

    state.mapScale = projection.mapScale;
    state.mapStretch = projection.mapStretch;
    state.mapOriginX = projection.mapOriginX;
    state.mapOriginY = projection.mapOriginY;
  }

  /* -- drawing ------------------------------------------------------------ */

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
    fitMap();
    state.needsDraw = true;
  }

  function drawProjectedLine(points, mapProjection) {
    let drawing = false;
    context.beginPath();

    points.forEach(point => {
      const projected = project(point[0], point[1], mapProjection);
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

  function drawMapGrid() {
    if (!state.bounds) return;

    const bounds = state.bounds;
    const step = 10;

    context.save();
    context.strokeStyle = 'rgba(199, 220, 218, 0.07)';
    context.lineWidth = 0.6;

    for (let lat = Math.ceil(bounds.minLat / step) * step; lat <= bounds.maxLat; lat += step) {
      drawProjectedLine([[bounds.minLon - 2, lat], [bounds.maxLon + 2, lat]]);
    }

    for (let lon = Math.ceil(bounds.minLon / step) * step; lon <= bounds.maxLon; lon += step) {
      drawProjectedLine([[lon, bounds.minLat - 2], [lon, bounds.maxLat + 2]]);
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

  function createFeaturePath(feature, mapProjection) {
    const path = new Path2D();
    let hasVisiblePoint = false;

    ringsForGeometry(feature.geometry).forEach(ring => {
      let drawing = false;
      let visibleInRing = false;

      ring.forEach(coordinate => {
        const projected = project(coordinate[0], coordinate[1], mapProjection);
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

  function findFeatureOnMeridian() {
    if (!state.featurePaths.length) return null;

    const step = Math.max(3, state.radius / 90);
    const maximumOffset = state.radius * 0.9;

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);

    for (let offset = 0; offset <= maximumOffset; offset += step) {
      const sampleYs = offset === 0
        ? [state.centerY]
        : [state.centerY - offset, state.centerY + offset];

      for (let sampleIndex = 0; sampleIndex < sampleYs.length; sampleIndex += 1) {
        for (let featureIndex = state.featurePaths.length - 1; featureIndex >= 0; featureIndex -= 1) {
          const item = state.featurePaths[featureIndex];
          if (
            item.place &&
            context.isPointInPath(item.path, state.centerX, sampleYs[sampleIndex])
          ) {
            context.restore();
            return item.feature;
          }
        }
      }
    }

    context.restore();
    return null;
  }

  function syncMeridianFeature(feature) {
    if (state.meridianFeature === feature) return;

    state.meridianFeature = feature;
    if (!state.hoveredFeature) {
      setSelection(feature, 'meridian');
      updateActivePlace(placeForFeature(feature));
    }
  }

  function featurePathsFor(features, mapProjection) {
    return features.reduce((paths, feature) => {
      const path = createFeaturePath(feature, mapProjection);
      if (!path) return paths;

      paths.push({
        feature,
        path,
        place: placeForFeature(feature)
      });
      return paths;
    }, []);
  }

  function paintFeaturePaths(paths) {
    paths.forEach(item => {
      const reachable = isReachable(item.place);
      const isHovered = state.hoveredFeature === item.feature;
      const isOnMeridian = !isMap() && state.meridianFeature === item.feature;
      const isHighlighted = isHovered || isOnMeridian;

      context.save();
      if (isOnMeridian) {
        context.shadowColor = reachable
          ? 'rgba(111, 214, 193, 0.72)'
          : 'rgba(169, 193, 188, 0.42)';
        context.shadowBlur = 14;
      }
      context.fillStyle = reachable
        ? (isHighlighted ? palette.activeBright : palette.active)
        : (isHighlighted ? palette.idleHighlight : palette.idle);
      context.strokeStyle = reachable
        ? (isHighlighted ? palette.activeLineHighlight : palette.activeLine)
        : (isHighlighted ? palette.idleLineHighlight : palette.idleLine);
      context.lineWidth = isHighlighted ? 1.45 : 0.65;
      context.fill(item.path);
      context.stroke(item.path);
      context.restore();
    });
  }

  function drawPlaces() {
    state.featurePaths = [];

    if (!state.geojson) {
      context.fillStyle = 'rgba(236, 226, 201, 0.15)';
      context.font = '12px sans-serif';
      context.textAlign = 'center';
      context.fillText(say('drawing'), state.centerX, state.centerY);
      return;
    }

    state.featurePaths = featurePathsFor(state.geojson.features);

    if (!isMap()) syncMeridianFeature(findFeatureOnMeridian());
    paintFeaturePaths(state.featurePaths);
  }

  function drawDestinationMarkers() {
    state.destinationMarkers = [];

    state.places.forEach(place => {
      if (!Number.isFinite(place.lon) || !Number.isFinite(place.lat)) return;
      if (!isReachable(place)) return;

      const projected = project(place.lon, place.lat);
      if (!projected.visible) return;

      const feature = featureForPlace(place);
      const activePlace = placeForFeature(state.hoveredFeature || state.meridianFeature);
      const isActive = activePlace && activePlace.code === place.code;
      const radius = isActive ? 5.5 : 3.25;

      context.save();
      context.shadowColor = palette.active;
      context.shadowBlur = isActive ? 18 : 9;
      context.fillStyle = isActive ? '#d9fff7' : palette.activeBright;
      context.beginPath();
      context.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = 'rgba(11, 17, 19, 0.88)';
      context.lineWidth = 1.4;
      context.stroke();
      context.restore();

      state.destinationMarkers.push({
        place,
        feature,
        x: projected.x,
        y: projected.y,
        hitRadius: Math.max(10, radius + 5)
      });
    });
  }

  function roundedRectanglePath(rect, radius) {
    const path = new Path2D();
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;

    path.moveTo(rect.x + radius, rect.y);
    path.lineTo(right - radius, rect.y);
    path.quadraticCurveTo(right, rect.y, right, rect.y + radius);
    path.lineTo(right, bottom - radius);
    path.quadraticCurveTo(right, bottom, right - radius, bottom);
    path.lineTo(rect.x + radius, bottom);
    path.quadraticCurveTo(rect.x, bottom, rect.x, bottom - radius);
    path.lineTo(rect.x, rect.y + radius);
    path.quadraticCurveTo(rect.x, rect.y, rect.x + radius, rect.y);
    path.closePath();
    return path;
  }

  function insetForCurrentMap() {
    if (!isMap() || !state.parent || state.parent.code !== pearlRiverDeltaInset.parent) {
      return null;
    }

    const compact = state.width < 520 || state.height < 340;
    const width = Math.min(
      compact ? 128 : 180,
      Math.max(96, state.width * (compact ? 0.3 : 0.24))
    );
    const height = width * (compact ? 0.68 : 0.66);
    const margin = compact ? 5 : 8;
    const rect = {
      x: state.width - width - margin,
      y: state.height - height - margin,
      width,
      height
    };
    const mapRect = {
      x: rect.x + 7,
      y: rect.y + 7,
      width: rect.width - 14,
      height: rect.height - 14
    };

    return {
      bounds: pearlRiverDeltaInset.bounds,
      compact,
      mapRect,
      projection: projectionForBounds(pearlRiverDeltaInset.bounds, mapRect, 0.9),
      rect
    };
  }

  function boundsOverlap(first, second) {
    return first.maxLon >= second.minLon && first.minLon <= second.maxLon &&
      first.maxLat >= second.minLat && first.minLat <= second.maxLat;
  }

  function drawInsetGrid(inset) {
    const bounds = inset.bounds;

    context.save();
    context.strokeStyle = 'rgba(199, 220, 218, 0.08)';
    context.lineWidth = 0.55;

    for (let lat = Math.ceil(bounds.minLat); lat <= bounds.maxLat; lat += 1) {
      drawProjectedLine([[bounds.minLon, lat], [bounds.maxLon, lat]], inset.projection);
    }
    for (let lon = Math.ceil(bounds.minLon); lon <= bounds.maxLon; lon += 1) {
      drawProjectedLine([[lon, bounds.minLat], [lon, bounds.maxLat]], inset.projection);
    }

    context.restore();
  }

  /* The shapes are enlarged by the inset, but the two smallest administrative
     areas still deserve generous pointer targets. Their labels and centres
     come from the generated place data, so a future gallery changes their
     colour and behaviour without another exception here. */
  function drawInsetMarkers(inset) {
    state.insetMarkers = [];

    state.insetFeaturePaths.forEach(item => {
      const bounds = measureFeatureBounds(item.feature);
      const span = Math.max(bounds.maxLon - bounds.minLon, bounds.maxLat - bounds.minLat);
      if (!item.place || span > 0.8) return;

      const projected = project(item.place.lon, item.place.lat, inset.projection);
      const reachable = isReachable(item.place);
      const isActive = state.hoveredFeature === item.feature;
      const radius = inset.compact ? 3.2 : 3.8;
      const code = item.place.iso ? item.place.iso.split('-').pop() : '';
      const labelOnLeft = projected.x < inset.mapRect.x + inset.mapRect.width / 2;

      context.save();
      context.shadowColor = reachable ? palette.active : 'rgba(169, 193, 188, 0.3)';
      context.shadowBlur = isActive ? 10 : 4;
      context.fillStyle = reachable
        ? (isActive ? '#d9fff7' : palette.activeBright)
        : (isActive ? 'rgba(222, 239, 235, 0.88)' : 'rgba(31, 45, 47, 0.92)');
      context.strokeStyle = reachable ? palette.activeLineHighlight : palette.idleLineHighlight;
      context.lineWidth = 1.15;
      context.beginPath();
      context.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      if (code) {
        context.fillStyle = isActive ? '#ffffff' : 'rgba(222, 239, 235, 0.76)';
        context.font = (inset.compact ? '600 8px' : '600 9px') + ' sans-serif';
        context.textAlign = labelOnLeft ? 'right' : 'left';
        context.textBaseline = 'middle';
        context.fillText(code, projected.x + (labelOnLeft ? -7 : 7), projected.y);
      }
      context.restore();

      state.insetMarkers.push({
        feature: item.feature,
        x: projected.x,
        y: projected.y,
        hitRadius: inset.compact ? 13 : 15
      });
    });
  }

  function drawMapInset() {
    const inset = insetForCurrentMap();

    state.insetFeaturePaths = [];
    state.insetMarkers = [];
    state.insetRect = inset ? inset.rect : null;
    if (!inset || !state.geojson) return;

    const card = roundedRectanglePath(inset.rect, inset.compact ? 7 : 9);
    const mapWindow = roundedRectanglePath(inset.mapRect, inset.compact ? 4 : 5);
    const features = state.geojson.features.filter(feature => {
      return boundsOverlap(measureFeatureBounds(feature), inset.bounds);
    });

    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.42)';
    context.shadowBlur = inset.compact ? 14 : 24;
    context.shadowOffsetY = inset.compact ? 5 : 9;
    context.fillStyle = 'rgba(10, 17, 19, 0.92)';
    context.fill(card);
    context.restore();

    context.save();
    context.clip(mapWindow);
    const sea = context.createLinearGradient(
      inset.mapRect.x,
      inset.mapRect.y,
      inset.mapRect.x,
      inset.mapRect.y + inset.mapRect.height
    );
    sea.addColorStop(0, 'rgba(27, 48, 51, 0.98)');
    sea.addColorStop(1, 'rgba(13, 28, 31, 0.98)');
    context.fillStyle = sea;
    context.fillRect(inset.mapRect.x, inset.mapRect.y, inset.mapRect.width, inset.mapRect.height);
    drawInsetGrid(inset);
    state.insetFeaturePaths = featurePathsFor(features, inset.projection);
    paintFeaturePaths(state.insetFeaturePaths);
    drawInsetMarkers(inset);
    context.restore();

    context.save();
    context.strokeStyle = state.hoveredFeature && state.insetFeaturePaths.some(item => {
      return item.feature === state.hoveredFeature;
    })
      ? 'rgba(111, 214, 193, 0.68)'
      : 'rgba(208, 231, 226, 0.25)';
    context.lineWidth = 0.8;
    context.stroke(card);
    context.restore();
  }

  function drawVirtualMeridian() {
    const meridian = [];
    for (let lat = -89; lat <= 89; lat += 2) {
      meridian.push([state.rotationLon, lat]);
    }

    context.save();
    context.setLineDash([2, 8]);
    context.lineCap = 'round';
    context.lineWidth = 0.65;
    context.strokeStyle = 'rgba(184, 255, 240, 0.24)';
    context.shadowColor = 'rgba(111, 214, 193, 0.28)';
    context.shadowBlur = 2;
    drawProjectedLine(meridian);
    context.restore();
  }

  function drawGlobeView() {
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
    drawPlaces();
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
    drawVirtualMeridian();
    context.restore();

    context.strokeStyle = 'rgba(196, 222, 216, 0.28)';
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(state.centerX, state.centerY, state.radius, 0, Math.PI * 2);
    context.stroke();
  }

  /* The national outline is taken from the same file the globe draws, so the
     silhouette on a regional map is the one you just turned away from. The
     province geometry comes from a different survey and disagrees with it by
     a kilometre here and there, so this goes down first as a base: any
     mismatch shows as a hairline of coastline rather than a gap. */
  function parentFeatures() {
    if (!state.worldGeojson || !state.parent) return [];

    /* World geometry is labelled in English, while the parent's displayed
       name follows the locale. `match` is the shared, locale-free key. */
    const wanted = new Set([normalizedName(state.parent.match || state.parent.name)]);
    state.places.forEach(place => wanted.add(normalizedName(place.name)));

    return state.worldGeojson.features.filter(feature => {
      const name = feature.properties && feature.properties.name;
      const alias = featureAliases[name] || name;
      return wanted.has(normalizedName(alias));
    });
  }

  function signedArea(points) {
    let total = 0;

    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      total += current.x * next.y - next.x * current.y;
    }

    return total / 2;
  }

  /* Every ring goes into one path, and canvas fills with the nonzero rule, so
     a ring wound against the others is punched out as a hole rather than added
     to the shape. Source data is not consistent about this -- Taiwan came in
     wound the opposite way to the mainland and vanished -- so each ring is
     turned the right way here: outer rings one way, holes the other. */
  function parentOutlinePath() {
    const features = parentFeatures();
    if (!features.length) return null;

    const outline = new Path2D();
    let drawn = false;

    features.forEach(feature => {
      const geometry = feature.geometry;
      if (!geometry) return;

      const polygons = geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);

      polygons.forEach(rings => {
        rings.forEach((ring, index) => {
          const points = ring
            .map(coordinate => project(coordinate[0], coordinate[1]))
            .filter(point => point.visible);

          if (points.length < 3) return;

          const isOuter = index === 0;
          const ordered = (signedArea(points) > 0) === isOuter
            ? points
            : points.slice().reverse();

          ordered.forEach((point, position) => {
            if (position === 0) outline.moveTo(point.x, point.y);
            else outline.lineTo(point.x, point.y);
          });
          outline.closePath();
          drawn = true;
        });
      });
    });

    return drawn ? outline : null;
  }

  /* The national border wins.
   *
   * The provinces and the globe's countries come from different surveys and
   * disagree by a kilometre or two along the Himalaya -- enough to show as a
   * double line at this scale. So the outline is filled first in the colour of
   * an unfilled region, the provinces are drawn clipped to it, and the border
   * is stroked last: a province reaching past the line is trimmed, one falling
   * short leaves ground the same colour as itself, and only one boundary is
   * ever visible. */
  function drawMapView() {
    drawMapGrid();

    const outline = parentOutlinePath();

    if (outline) {
      context.save();
      context.fillStyle = palette.idle;
      context.fill(outline);
      context.restore();
    }

    context.save();
    if (outline) context.clip(outline);
    drawPlaces();
    context.restore();

    if (outline) {
      context.save();
      context.lineJoin = 'round';
      context.lineWidth = 1.2;
      context.strokeStyle = 'rgba(208, 231, 226, 0.62)';
      context.stroke(outline);
      context.restore();
    }

    drawDestinationMarkers();
    drawMapInset();
  }

  function drawScene() {
    resizeCanvas();
    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    context.clearRect(0, 0, state.width, state.height);

    if (isMap()) drawMapView();
    else {
      state.insetFeaturePaths = [];
      state.insetMarkers = [];
      state.insetRect = null;
      drawGlobeView();
    }

    state.needsDraw = false;
  }

  function requestDraw() {
    state.needsDraw = true;
  }

  /* -- selection and lists ------------------------------------------------ */

  function hitTest(x, y) {
    if (!isMap() && Math.hypot(x - state.centerX, y - state.centerY) > state.radius) return null;

    if (
      isMap() &&
      state.insetRect &&
      x >= state.insetRect.x &&
      x <= state.insetRect.x + state.insetRect.width &&
      y >= state.insetRect.y &&
      y <= state.insetRect.y + state.insetRect.height
    ) {
      for (let index = state.insetMarkers.length - 1; index >= 0; index -= 1) {
        const marker = state.insetMarkers[index];
        if (Math.hypot(x - marker.x, y - marker.y) <= marker.hitRadius) return marker.feature;
      }

      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      for (let index = state.insetFeaturePaths.length - 1; index >= 0; index -= 1) {
        const item = state.insetFeaturePaths[index];
        if (context.isPointInPath(item.path, x, y)) {
          context.restore();
          return item.feature;
        }
      }
      context.restore();
      /* The card covers the main map; a click on its sea must not fall through
         to a province hidden beneath it. */
      return null;
    }

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

  function setSelection(feature, source) {
    const strong = selection.querySelector('strong');
    const small = selection.querySelector('small');

    if (!feature) {
      selection.classList.remove('is-available');
      selection.classList.toggle('is-meridian', source === 'meridian');
      strong.textContent = say(isMap() ? 'pick_title' : 'idle_title');
      small.textContent = say(isMap() ? 'pick_body' : 'idle_body');
      return;
    }

    const place = placeForFeature(feature);
    strong.textContent = place ? place.name : featureName(feature);

    if (place && place.subdivisions) {
      small.textContent = countLabel(place) + ' · ' + say('explore_regions');
    } else if (place) {
      small.textContent = countLabel(place);
    } else {
      small.textContent = say('none_here');
    }

    selection.classList.toggle('is-available', isReachable(place));
    selection.classList.toggle('is-meridian', source === 'meridian');
  }

  function updateActivePlace(place) {
    Array.from(placeList.querySelectorAll('button')).forEach(button => {
      button.classList.toggle('is-active', Boolean(place) && button.dataset.code === place.code);
    });
  }

  function focusPlace(place) {
    const feature = featureForPlace(place);
    if (!feature) return;

    state.hoveredFeature = feature;
    setSelection(feature, 'pointer');
    updateActivePlace(place);
    requestDraw();
  }

  function clearFocus() {
    if (state.pointerId !== null) return;
    state.hoveredFeature = null;
    canvas.style.cursor = isMap() ? 'default' : 'grab';
    setSelection(isMap() ? null : state.meridianFeature, 'meridian');
    updateActivePlace(isMap() ? null : placeForFeature(state.meridianFeature));
    requestDraw();
  }

  function openPlace(place) {
    if (!place) return;

    if (place.subdivisions && state.subdivisions[place.subdivisions]) {
      enterMap(place);
      return;
    }

    if (photoCount(place) === 0) return;
    openGallery(place.code);
  }

  function buildPlaceList() {
    placeList.textContent = '';

    /* Collated in the page's language, so that Chinese names fall in pinyin
       order rather than in whatever order the reader's browser prefers. */
    const collation = document.documentElement.lang || undefined;
    const sorted = state.places.slice().sort((first, second) => {
      const difference = photoCount(second) - photoCount(first);
      return difference !== 0 ? difference : first.name.localeCompare(second.name, collation);
    });

    sorted.forEach(place => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const code = document.createElement('span');
      const name = document.createElement('span');
      const count = document.createElement('span');
      const reachable = isReachable(place);

      button.type = 'button';
      button.dataset.code = place.code;
      button.classList.toggle('is-empty', !reachable);
      button.setAttribute(
        'aria-label',
        reachable
          ? say('view_place', { name: place.name, count: countLabel(place).toLowerCase() })
          : say('empty_place', { name: place.name })
      );
      /* What else this place answers to. The English name is here so that
         typing "China" still finds the gallery on a page that calls it
         something else, and the pinyin -- present only in a language whose
         names are not written in Latin letters -- so that "anhui", "ah" and
         "an hui" all find 安徽. Both are prepared at build time. */
      const aliases = [place.match, place.pinyin].filter(Boolean).join(' ');
      if (aliases) button.dataset.aliases = aliases;

      code.className = 'country-code';
      code.textContent = isMap() ? place.iso.split('-')[1] : place.code;
      name.className = 'country-name';
      name.textContent = place.name;
      count.className = 'country-count';
      count.textContent = place.subdivisions
        ? String(photoCount(place)) + ' ›'
        : String(photoCount(place) || '');

      button.appendChild(code);
      button.appendChild(name);
      button.appendChild(count);
      item.appendChild(button);
      placeList.appendChild(item);

      button.addEventListener('mouseenter', () => focusPlace(place));
      button.addEventListener('focus', () => focusPlace(place));
      button.addEventListener('mouseleave', () => {
        if (document.activeElement !== button) clearFocus();
      });
      button.addEventListener('blur', clearFocus);
      button.addEventListener('click', () => openPlace(place));
    });

    filterPlaces();
  }

  function filterPlaces() {
    const query = normalizedName(placeSearch.value);
    let visibleCount = 0;

    Array.from(placeList.children).forEach(item => {
      const button = item.querySelector('button');
      if (!button) return;
      const haystack = normalizedName(button.textContent + ' ' + (button.dataset.aliases || ''));
      const matches = haystack.includes(query);
      item.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    let empty = placeList.querySelector('.empty-result');
    if (!visibleCount && !empty) {
      empty = document.createElement('li');
      empty.className = 'empty-result';
      empty.textContent = say('no_match');
      placeList.appendChild(empty);
    } else if (visibleCount && empty) {
      empty.remove();
    }
  }

  /* -- switching views ---------------------------------------------------- */

  /* The slot is always there, empty or not, so that the world and a regional
     map are exactly the same height. */
  function showParentLink(visible, href, text) {
    parentLink.classList.toggle('is-empty', !visible);
    parentLink.setAttribute('aria-hidden', visible ? 'false' : 'true');
    parentLink.setAttribute('tabindex', visible ? '0' : '-1');
    parentLink.textContent = visible ? text : '';
    if (visible) parentLink.setAttribute('href', href);
    else parentLink.removeAttribute('href');
  }

  function applyView() {
    const mapping = isMap();
    const withPhotos = state.places.filter(place => photoCount(place) > 0).length;

    explorer.classList.toggle('is-map', mapping);
    canvas.style.cursor = mapping ? 'default' : 'grab';
    backButton.hidden = !mapping;
    resetButton.hidden = mapping;

    if (mapping) {
      const options = state.options || {};
      title.textContent = state.parent.name;
      /* `noun` arrives cased the way it should be printed -- Chinese has no
         capitals to shout in. */
      eyebrow.textContent = say('regions_count', {
        lit: withPhotos,
        total: state.places.length,
        noun: options.noun || ''
      });
      pickerLabel.textContent = say('region_picker');
      placeSearch.placeholder = options.search || say('region_search');
      placeList.setAttribute('aria-label', say('regions_of', { place: state.parent.name }));
      canvas.setAttribute(
        'aria-label',
        say('region_canvas', { place: state.parent.name }) +
          (insetForCurrentMap() ? ' ' + say('region_inset_canvas') : '')
      );
      showParentLink(
        photoCount(state.parent) > 0,
        state.parent.code,
        say('all_from', { count: photoCount(state.parent), place: state.parent.name })
      );
      if (hud) {
        hud.innerHTML = '<i class="fa fa-map-o"></i> ' + say('region_hud') +
          '<small>' + say('region_hud_note') + '</small>';
      }
    } else {
      title.textContent = say('countries_title');
      eyebrow.textContent = say(
        withPhotos === 1 ? 'destinations_one' : 'destinations_many',
        { count: withPhotos }
      );
      pickerLabel.textContent = say('gallery_picker');
      placeSearch.placeholder = say('country_search');
      placeList.setAttribute('aria-label', say('country_list'));
      canvas.setAttribute('aria-label', say('country_canvas'));
      showParentLink(false);
      if (hud) {
        hud.innerHTML = '<i class="fa fa-crosshairs"></i> ' + say('world_hud');
      }
    }

    state.hoveredFeature = null;
    state.meridianFeature = null;
    setSelection(null);
    buildPlaceList();
    fitMap();
    requestDraw();
  }

  /* Hide the canvas outright, draw the new view into it while it cannot be
     seen, then fade it in. Fading out first would mean the new view is painted
     at full opacity for a frame before the transition starts -- which reads as
     a flash of the destination, then an animation. */
  function showView(nextView) {
    if (state.view === nextView) return;

    state.view = nextView;
    stage.classList.add('is-entering');
    applyView();
    drawScene();

    /* Two frames, so the hidden state and the fresh canvas are both committed
       before the fade starts -- with a timer behind it, because a background
       tab gets no frames and must not be left with an invisible map. */
    const reveal = () => stage.classList.remove('is-entering');

    window.requestAnimationFrame(() => window.requestAnimationFrame(reveal));
    window.setTimeout(reveal, 150);
  }

  const geometryCache = {};

  function loadSubdivisionGeometry(key) {
    if (!geometryCache[key]) {
      geometryCache[key] = fetchJson(state.subdivisionGeo[key], say('region_geometry_error'));
    }

    return geometryCache[key];
  }

  function enterMap(place) {
    const options = state.subdivisions[place.subdivisions];
    if (!options || !state.subdivisionGeo[place.subdivisions]) return;

    explorer.classList.add('is-loading');

    loadSubdivisionGeometry(place.subdivisions).then(geojson => {
      explorer.classList.remove('is-loading');
      state.parent = place;
      state.options = options;
      state.worldGeojson = state.worldGeojson || state.geojson;
      state.worldPlaces = state.worldPlaces || state.places;
      state.geojson = geojson;
      state.places = options.places;
      state.bounds = measureBounds(geojson);
      showView('map');
    }).catch(error => {
      explorer.classList.remove('is-loading');
      selection.querySelector('strong').textContent = say('regions_unavailable');
      selection.querySelector('small').textContent = say('refresh');
      console.error(error);
    });
  }

  function leaveMap() {
    if (!isMap()) return;

    state.geojson = state.worldGeojson;
    state.places = state.worldPlaces;
    state.parent = null;
    state.bounds = null;
    showView('globe');
  }

  /* -- interaction -------------------------------------------------------- */

  function onPointerDown(event) {
    if (isMap()) return;

    state.pointerId = event.pointerId;
    state.pointerStartX = event.clientX;
    state.pointerStartY = event.clientY;
    state.startLon = state.rotationLon;
    state.startLat = state.rotationLat;
    state.moved = false;
    state.hasInteracted = true;
    state.hoveredFeature = null;
    setSelection(state.meridianFeature, 'meridian');
    updateActivePlace(placeForFeature(state.meridianFeature));
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
      canvas.style.cursor = isReachable(placeForFeature(feature))
        ? 'pointer'
        : (isMap() ? 'default' : 'grab');
      setSelection(feature, 'pointer');
      updateActivePlace(placeForFeature(feature));
      requestDraw();
    }
  }

  function onPointerUp(event) {
    const rect = canvas.getBoundingClientRect();
    const feature = hitTest(event.clientX - rect.left, event.clientY - rect.top);

    if (isMap()) {
      if (feature) setSelection(feature, 'pointer');
      openPlace(placeForFeature(feature));
      return;
    }

    if (state.pointerId !== event.pointerId) return;

    if (!state.moved && feature) {
      setSelection(feature, 'pointer');
      openPlace(placeForFeature(feature));
    }

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

  function stepThroughPlaces(offset) {
    const reachable = state.places.filter(isReachable);
    if (!reachable.length) return;

    const current = placeForFeature(state.hoveredFeature);
    const index = current ? reachable.findIndex(place => place.code === current.code) : -1;
    const next = (index + offset + reachable.length * 2) % reachable.length;
    focusPlace(reachable[next]);
  }

  function onKeyDown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    state.hasInteracted = true;

    if (isMap()) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') stepThroughPlaces(-1);
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') stepThroughPlaces(1);
      if (event.key === 'Enter') openPlace(placeForFeature(state.hoveredFeature));
      if (event.key === 'Escape') leaveMap();
      return;
    }

    if (event.key === 'ArrowLeft') state.rotationLon -= 8;
    if (event.key === 'ArrowRight') state.rotationLon += 8;
    if (event.key === 'ArrowUp') state.rotationLat = Math.min(72, state.rotationLat + 6);
    if (event.key === 'ArrowDown') state.rotationLat = Math.max(-72, state.rotationLat - 6);
    if (event.key === 'Enter') {
      openPlace(placeForFeature(state.hoveredFeature || state.meridianFeature));
    }
    requestDraw();
  }

  function resetGlobe() {
    state.rotationLon = 24;
    state.rotationLat = 18;
    state.hasInteracted = false;
    state.lastFrame = performance.now();
    state.hoveredFeature = null;
    state.meridianFeature = null;
    setSelection(null);
    updateActivePlace(null);
    requestDraw();
    canvas.focus();
  }

  function animate(now) {
    resizeCanvas();
    const elapsed = Math.min(40, now - state.lastFrame);
    const panelIsOpen = panel.classList.contains('active');

    if (
      !isMap() &&
      panelIsOpen &&
      !reducedMotion &&
      !state.hasInteracted &&
      state.pointerId === null
    ) {
      state.rotationLon += elapsed * 0.0022;
      state.needsDraw = true;
    }

    if (state.needsDraw) drawScene();
    state.lastFrame = now;
    window.requestAnimationFrame(animate);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', clearFocus);
  canvas.addEventListener('keydown', onKeyDown);
  resetButton.addEventListener('click', resetGlobe);
  backButton.addEventListener('click', leaveMap);
  placeSearch.addEventListener('input', filterPlaces);

  let swallowEscapeKeyup = false;

  document.addEventListener('keydown', event => {
    const activeElement = document.activeElement;
    const activePanel = activeElement && activeElement.closest('.panel');
    const isEditing = /input|textarea|select/i.test(activeElement && activeElement.tagName) &&
      (!activePanel || activePanel.classList.contains('active'));

    if (!panel.classList.contains('active')) return;

    if (event.key === '/' && document.activeElement !== placeSearch && !isEditing) {
      event.preventDefault();
      placeSearch.focus();
      return;
    }

    if (event.key === 'Escape' && isMap()) {
      event.preventDefault();
      event.stopPropagation();
      /* Escape steps back to the world rather than closing the whole panel,
         so the keyup that main.js closes panels on has to be swallowed too. */
      swallowEscapeKeyup = true;
      leaveMap();
    }
  }, true);

  document.addEventListener('keyup', event => {
    if (event.key !== 'Escape' || !swallowEscapeKeyup) return;
    swallowEscapeKeyup = false;
    event.stopPropagation();
  }, true);

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

  /* -- data --------------------------------------------------------------- */

  function fetchJson(url, message) {
    return fetch(url).then(response => {
      if (!response.ok) throw new Error(message);
      return response.json();
    });
  }

  let dataLoadStarted = false;
  let dataLoadVersion = 0;

  function loadWorldData() {
    if (dataLoadStarted) return;
    dataLoadStarted = true;
    const version = dataLoadVersion;

    Promise.all([
      fetchJson(explorer.dataset.geoUrl, say('country_geometry_error')),
      fetchJson(explorer.dataset.atlasUrl, say('destinations_error'))
    ]).then(([geojson, atlas]) => {
      if (version !== dataLoadVersion) return;
      state.geojson = geojson;
      state.places = atlas.countries;
      state.subdivisions = atlas.subdivisions || {};
      state.names = atlas.names || {};
      state.worldGeojson = geojson;
      state.worldPlaces = atlas.countries;
      applyView();
    }).catch(error => {
      if (version !== dataLoadVersion) return;
      selection.querySelector('strong').textContent = say('globe_unavailable');
      selection.querySelector('small').textContent = say('refresh');
      console.error(error);
    });
  }

  function setLocale(atlasUrl) {
    explorer.dataset.atlasUrl = atlasUrl;
    dataLoadVersion += 1;

    if (!dataLoadStarted) return;
    if (!state.worldGeojson) {
      dataLoadStarted = false;
      loadWorldData();
      return;
    }

    const version = dataLoadVersion;
    fetchJson(atlasUrl, say('destinations_error')).then(atlas => {
      if (version !== dataLoadVersion) return;

      const parentCode = isMap() && state.parent ? state.parent.code : null;
      state.subdivisions = atlas.subdivisions || {};
      state.names = atlas.names || {};
      state.worldPlaces = atlas.countries;

      if (parentCode) {
        const parent = atlas.countries.find(place => place.code === parentCode);
        const options = parent && state.subdivisions[parent.subdivisions];
        if (parent && options) {
          state.parent = parent;
          state.options = options;
          state.places = options.places;
        } else {
          state.view = 'globe';
          state.parent = null;
          state.options = null;
          state.geojson = state.worldGeojson;
          state.places = state.worldPlaces;
          state.bounds = null;
        }
      } else {
        state.places = state.worldPlaces;
      }

      applyView();
    }).catch(error => {
      if (version !== dataLoadVersion) return;
      selection.querySelector('strong').textContent = say('globe_unavailable');
      selection.querySelector('small').textContent = say('refresh');
      console.error(error);
    });
  }

  function loadWorldDataWhenVisible() {
    if (panel.classList.contains('active')) loadWorldData();
  }

  if ('MutationObserver' in window) {
    new MutationObserver(loadWorldDataWhenVisible).observe(panel, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  window.GlobeExplorer = { setLocale };

  loadWorldDataWhenVisible();

  document.documentElement.style.scrollBehavior = 'smooth';
  resizeCanvas();
  window.requestAnimationFrame(animate);
})();
