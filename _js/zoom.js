/*
 * Zooming, inside the lightbox only.
 *
 * The page itself is pinned (user-scalable=no), because zooming a grid of
 * thumbnails is never what anyone wants and it makes the panels behave oddly.
 * The photograph on show is a different matter, so this recreates the gesture
 * where it belongs: pinch or double-tap on a phone, double-click or scroll
 * with a modifier on a desktop, drag to pan once magnified.
 *
 *   Zoom.attach(popup)   wire a lightbox popup
 *   Zoom.reset(popup)    back to fit, on close or when the photograph changes
 */
window.Zoom = (function () {
  'use strict';

  const MAXIMUM = 5;
  const views = [];

  function viewFor(popup) {
    return views.find(view => view.popup === popup) || null;
  }

  function picture(view) {
    return view.popup.querySelector('.pic img');
  }

  function apply(view) {
    const image = picture(view);
    if (!image) return;

    const zoomed = view.scale > 1.01;

    image.style.transform = zoomed
      ? 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.scale + ')'
      : '';
    image.style.transformOrigin = 'center center';
    view.popup.classList.toggle('is-zoomed', zoomed);
  }

  /* Keep the photograph covering the frame, so it cannot be dragged into a
     corner and lost. */
  function contain(view) {
    const image = picture(view);
    if (!image) return;

    const width = image.clientWidth;
    const height = image.clientHeight;
    const slackX = Math.max(0, (width * view.scale - width) / 2);
    const slackY = Math.max(0, (height * view.scale - height) / 2);

    view.x = Math.max(-slackX, Math.min(slackX, view.x));
    view.y = Math.max(-slackY, Math.min(slackY, view.y));
  }

  function zoomAt(view, scale, pointX, pointY) {
    const image = picture(view);
    if (!image) return;

    const next = Math.max(1, Math.min(MAXIMUM, scale));
    const box = image.getBoundingClientRect();
    const centreX = box.left + box.width / 2;
    const centreY = box.top + box.height / 2;
    const ratio = next / view.scale;

    /* Hold the point under the fingers still. */
    view.x = (view.x - (pointX - centreX)) * ratio + (pointX - centreX);
    view.y = (view.y - (pointY - centreY)) * ratio + (pointY - centreY);
    view.scale = next;

    if (next === 1) {
      view.x = 0;
      view.y = 0;
    }

    contain(view);
    apply(view);
  }

  function reset(popup) {
    const view = viewFor(popup);
    if (!view) return;

    view.scale = 1;
    view.x = 0;
    view.y = 0;
    view.pointers.clear();
    view.pinch = 0;
    apply(view);
  }

  function centreOf(pointers) {
    let x = 0;
    let y = 0;
    pointers.forEach(point => {
      x += point.x;
      y += point.y;
    });
    return { x: x / pointers.size, y: y / pointers.size };
  }

  function spreadOf(pointers) {
    const points = Array.from(pointers.values());
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function attach(popup) {
    if (viewFor(popup)) return;

    const view = { popup, scale: 1, x: 0, y: 0, pointers: new Map(), pinch: 0, moved: false };
    views.push(view);

    popup.addEventListener('pointerdown', event => {
      if (!event.target.closest('.pic')) return;

      view.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      view.moved = false;

      if (view.pointers.size === 2) view.pinch = spreadOf(view.pointers);
    });

    popup.addEventListener('pointermove', event => {
      if (!view.pointers.has(event.pointerId)) return;

      const previous = view.pointers.get(event.pointerId);
      view.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (view.pointers.size === 2 && view.pinch > 0) {
        const spread = spreadOf(view.pointers);
        const middle = centreOf(view.pointers);
        view.moved = true;
        zoomAt(view, view.scale * (spread / view.pinch), middle.x, middle.y);
        view.pinch = spread;
        event.preventDefault();
        return;
      }

      if (view.pointers.size === 1 && view.scale > 1.01) {
        view.x += event.clientX - previous.x;
        view.y += event.clientY - previous.y;
        view.moved = true;
        contain(view);
        apply(view);
        event.preventDefault();
      }
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(name => {
      popup.addEventListener(name, event => {
        view.pointers.delete(event.pointerId);
        if (view.pointers.size < 2) view.pinch = 0;

        /* A drag or a pinch must not fall through to the popup's close. */
        if (view.moved && name === 'pointerup') {
          event.stopPropagation();
          view.moved = false;
        }
      }, true);
    });

    popup.addEventListener('dblclick', event => {
      if (!event.target.closest('.pic')) return;

      event.preventDefault();
      event.stopPropagation();
      zoomAt(view, view.scale > 1.01 ? 1 : 2.5, event.clientX, event.clientY);
    });

    /* Anywhere inside the popup, not only over the photograph: a trackpad
       pinch a little off the edge should still zoom the picture rather than
       the browser. */
    popup.addEventListener('wheel', event => {
      if (!event.ctrlKey && !event.metaKey && view.scale <= 1.01) return;

      event.preventDefault();
      zoomAt(view, view.scale * (event.deltaY < 0 ? 1.12 : 0.89), event.clientX, event.clientY);
    }, { passive: false });

    /* Safari's own pinch gesture, which arrives instead of pointer events. */
    let gestureScale = 1;

    popup.addEventListener('gesturestart', event => {
      event.preventDefault();
      gestureScale = view.scale;
    });

    popup.addEventListener('gesturechange', event => {
      event.preventDefault();
      zoomAt(view, gestureScale * event.scale, event.clientX, event.clientY);
    });

    popup.addEventListener('gestureend', event => event.preventDefault());

    /* Any click that lands while zoomed is panning, not closing. */
    popup.addEventListener('click', event => {
      if (view.scale > 1.01 && event.target.closest('.pic')) event.stopPropagation();
    }, true);
  }

  /* Keep the page itself at 1:1.
   *
   * `user-scalable=no` is not enough on its own -- iOS Safari has ignored it
   * since iOS 10 -- so the gesture is refused here as well. Inside a lightbox
   * popup the gesture is handled above instead, and the photograph zooms.
   * Browser zoom (ctrl and +, or the menu) is untouched: that is an
   * accessibility control, not a gesture, and blocking it would be hostile. */
  function insideLightbox(target) {
    return target && target.closest && target.closest('.poptrox-popup');
  }

  ['gesturestart', 'gesturechange', 'gestureend'].forEach(name => {
    document.addEventListener(name, event => {
      if (!insideLightbox(event.target)) event.preventDefault();
    }, { passive: false });
  });

  document.addEventListener('touchmove', event => {
    /* More than one finger down and no popup open is a pinch on the page. */
    if (event.touches.length > 1 && !insideLightbox(event.target)) event.preventDefault();
  }, { passive: false });

  /* A trackpad pinch on Windows and Linux arrives as ctrl + wheel, which is
     indistinguishable from a deliberate ctrl-scroll, and touch-action does not
     reach it because there is no touch. Refusing it here is the only way to
     stop the page zooming; ctrl-plus and the browser's own zoom menu still
     work, so nobody is locked out. */
  document.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  }, { passive: false });

  return { attach, reset };
})();
