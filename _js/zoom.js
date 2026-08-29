/*
 * How the photograph sits inside the lightbox: zooming, and panoramas.
 *
 * The page itself is pinned (user-scalable=no), because zooming a grid of
 * thumbnails is never what anyone wants and it makes the panels behave oddly.
 * The photograph on show is a different matter, so this recreates the gesture
 * where it belongs: pinch or double-tap on a phone, double-click or scroll
 * with a modifier on a desktop, drag to pan once magnified.
 *
 * A panorama is the one shape the lightbox cannot simply fit: a 13:1 frame
 * shown whole on a 16:9 screen is a ribbon an inch tall. Those get a second
 * way to be read -- the whole photograph, or its own pixels with the frame
 * scrolling sideways -- and a button to change between the two.
 *
 *   Zoom.attach(popup)   wire a lightbox popup
 *   Zoom.frame(popup)    the photograph has loaded: measure it and lay it out
 *   Zoom.reset(popup)    back to fit, on close or when the photograph changes
 */
window.Zoom = (function () {
  'use strict';

  const MAXIMUM = 5;

  /* Wider than this and fitting the photograph to the screen wastes it. A 21:9
     crop (2.33) is still a photograph you can look at whole. */
  const PANORAMA = 2.5;

  /* Written by the page, in the page's language. See _includes/header.html. */
  const text = window.SiteText || {};
  const views = [];
  let watchingResize = false;

  function say(key) {
    return text[key] || '';
  }

  function viewFor(popup) {
    return views.find(view => view.popup === popup) || null;
  }

  function picture(view) {
    return view.popup.querySelector('.pic img');
  }

  function frameOf(view) {
    return view.popup.querySelector('.pic');
  }

  function apply(view) {
    const image = picture(view);

    /* A turned panorama holds the transform, and this would take it away. */
    if (!image || view.rotated) return;

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

    /* A panorama does not zoom. Fitted, it is already showing everything it
       has and magnifying it would only enlarge the blur; at its own size it is
       magnified already and the frame scrolls instead. The button and the
       double-click are how it changes between the two. */
    if (!image || view.panorama) return;

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

  /* The box poptrox fits the photograph into, read back from the constraint it
     has just written on the image. Asking the window instead would mean
     knowing the margin poptrox uses at this breakpoint. */
  function measure(view) {
    const image = picture(view);
    if (!image) return null;

    const width = parseFloat(image.style.maxWidth);
    const height = parseFloat(image.style.maxHeight);

    return width && height ? { width, height } : null;
  }

  /* Hand the photograph back the way poptrox had it: no size of its own, and
     fitted to the frame. A popup reuses its images when you walk back through
     a gallery, and a width left behind would be measured as the real one.

     The fit has to be put back rather than simply dropped, because a click on
     the arrows while the popup is still moving reaches here even though
     poptrox refuses it -- and then nothing reloads to set the fit again. */
  function unstyle(view) {
    if (!view.styled) return;

    unturn(view, view.styled);
    view.styled.style.width = '';
    view.styled.style.height = '';
    view.styled.style.maxWidth = view.box ? view.box.width + 'px' : '';
    view.styled.style.maxHeight = view.box ? view.box.height + 'px' : '';
    view.styled = null;
  }

  /* Put the photograph back in the flow, the right way up. */
  function unturn(view, image) {
    if (view.space) view.space.hidden = true;

    image.style.position = '';
    image.style.left = '';
    image.style.top = '';
    image.style.transform = '';
    image.style.transformOrigin = '';
  }

  /* The button shows what you would get: the whole photograph, or its pixels. */
  function label(view) {
    if (!view.button) return;

    const words = say(view.actual ? 'panorama_fit' : 'panorama_actual');

    view.button.querySelector('i').className = view.actual
      ? 'fa fa-compress'
      : 'fa fa-arrows-h';
    view.button.setAttribute('title', words);
    view.button.setAttribute('aria-label', words);
    view.button.setAttribute('aria-pressed', view.actual ? 'true' : 'false');
  }

  function display(view) {
    const image = picture(view);
    const pic = frameOf(view);
    if (!image || !pic) return;

    const box = view.box || { width: image.clientWidth, height: image.clientHeight };

    /* A panorama opened on a screen taller than it is wide -- a phone held
       upright -- would be read a few percent at a time through a slot. Turned
       a quarter turn it runs down the long side of the screen instead, small
       enough for the whole of its short edge to fit across, and is read by
       scrolling the way everything else on a phone is read. */
    view.rotated = view.actual && Boolean(view.space) && box.height > box.width;

    /* The frame only scrolls once it is told to, and it is told in the
       stylesheet -- so the classes go on before anything is scrolled. */
    view.popup.classList.toggle('is-actual', view.actual);
    view.popup.classList.toggle('is-turned', view.rotated);

    if (view.rotated) {
      const scale = Math.min(1, box.width / image.naturalHeight);
      const across = Math.round(image.naturalHeight * scale);
      const along = Math.round(image.naturalWidth * scale);

      /* Turning moves what is painted and not what is laid out, and a frame
         scrolls by what is laid out -- so the photograph steps out of the flow
         and the spacer stands in its place, the shape it appears to be. */
      view.space.hidden = false;
      view.space.style.maxWidth = 'none';
      view.space.style.maxHeight = 'none';
      view.space.style.width = across + 'px';
      view.space.style.height = along + 'px';

      image.style.maxWidth = 'none';
      image.style.maxHeight = 'none';
      image.style.width = along + 'px';
      image.style.height = across + 'px';
      image.style.position = 'absolute';
      image.style.left = '0';
      image.style.top = '0';
      image.style.transformOrigin = '0 0';
      /* A quarter turn about the top left corner leaves the photograph off to
         the left; the shift brings it back over the spacer. */
      image.style.transform = 'rotate(90deg) translateY(-100%)';

      pic.style.width = across + 'px';
      pic.style.height = Math.min(box.height, along) + 'px';
      /* A panorama is read from its left edge, which is now the top. */
      pic.scrollLeft = 0;
      pic.scrollTop = 0;
    }
    else if (view.actual) {
      const width = image.naturalWidth;
      const height = image.naturalHeight;

      unturn(view, image);
      image.style.maxWidth = 'none';
      image.style.maxHeight = 'none';
      image.style.width = width + 'px';
      image.style.height = height + 'px';
      pic.style.width = Math.min(box.width, width) + 'px';
      pic.style.height = Math.min(box.height, height) + 'px';
      /* Open where the fitted view left off: on the middle of the photograph.
         A panorama taller than the frame scrolls both ways, but sideways is
         the one that matters. */
      pic.scrollLeft = (width - pic.clientWidth) / 2;
      pic.scrollTop = (height - pic.clientHeight) / 2;
    }
    else {
      unturn(view, image);
      image.style.width = '';
      image.style.height = '';
      image.style.maxWidth = box.width + 'px';
      image.style.maxHeight = box.height + 'px';
      pic.style.width = '';
      pic.style.height = '';
      pic.scrollLeft = 0;
    }

    view.styled = image;
    label(view);
  }

  /* Called once the photograph has loaded and poptrox has sized it. */
  function frame(popup) {
    const view = viewFor(popup);
    if (!view) return;

    const image = picture(view);
    if (!image || !image.naturalWidth) return;

    /* Until poptrox has fitted the photograph there is no frame to fit it to,
       and nothing here can be decided yet. */
    const box = measure(view);
    if (!box) return;

    view.box = box;

    /* Wide enough for fitting it to waste it, and with something left to see
       that the fitted view is not already showing. */
    view.panorama = image.naturalWidth > image.naturalHeight * PANORAMA &&
      (image.naturalWidth > box.width || image.naturalHeight > box.height);

    popup.classList.toggle('is-panorama', view.panorama);
    if (view.button) view.button.hidden = !view.panorama;
    if (!view.panorama) view.actual = false;

    display(view);
  }

  function toggle(popup) {
    const view = viewFor(popup);
    if (!view || !view.panorama) return;

    view.scale = 1;
    view.x = 0;
    view.y = 0;
    apply(view);

    view.actual = !view.actual;
    display(view);
  }

  function reset(popup) {
    const view = viewFor(popup);
    if (!view) return;

    view.scale = 1;
    view.x = 0;
    view.y = 0;
    view.pointers.clear();
    view.pinch = 0;
    view.actual = false;
    view.rotated = false;
    view.panorama = false;

    const pic = frameOf(view);
    if (pic) {
      pic.style.width = '';
      pic.style.height = '';
      pic.scrollLeft = 0;
    }

    unstyle(view);
    popup.classList.remove('is-panorama');
    popup.classList.remove('is-actual');
    popup.classList.remove('is-turned');
    if (view.button) view.button.hidden = true;
    label(view);
    apply(view);

    /* A refused switch leaves the same photograph on show, and nothing else
       will come along to measure it again. One that really did change has not
       loaded yet, and frame() waits for it. */
    frame(popup);
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

  /* The window changing size sends poptrox back over the image to refit it,
     which wipes whatever was laid out here. Bound on the first popup, so it
     arrives after poptrox's own handler and has the last word.

     `orientationchange` is the same two events poptrox listens for: turning
     the phone is exactly what decides whether a panorama is turned with it. */
  function watchResize() {
    if (watchingResize) return;
    watchingResize = true;

    const refit = () => {
      views.forEach(view => {
        if (!view.styled || view.popup.offsetParent === null) return;

        view.box = measure(view) || view.box;
        display(view);
      });
    };

    window.addEventListener('resize', refit);
    window.addEventListener('orientationchange', refit);
  }

  function attach(popup) {
    if (viewFor(popup)) return;

    const view = {
      popup: popup, scale: 1, x: 0, y: 0, pointers: new Map(), pinch: 0,
      moved: false, captured: false, dragged: false, pointerType: '',
      panorama: false, actual: false, rotated: false, box: null, styled: null,
      button: null, space: null
    };
    views.push(view);
    watchResize();

    /* Something for the frame to scroll while the photograph itself is turned
       and out of the flow. It lives alongside the photograph rather than
       around it, because poptrox takes the photograph in and out of the frame
       as you walk through a gallery and would not know to look inside a
       wrapper. */
    const pic = frameOf(view);

    if (pic) {
      view.space = document.createElement('div');
      view.space.className = 'pano-space';
      view.space.hidden = true;
      view.space.setAttribute('aria-hidden', 'true');
      pic.appendChild(view.space);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pano-toggle';
    button.hidden = true;
    button.innerHTML = '<i class="fa fa-arrows-h" aria-hidden="true"></i>';

    /* The popup closes on any click it receives, so the button keeps its own. */
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggle(popup);
    });

    popup.appendChild(button);
    view.button = button;
    label(view);

    popup.addEventListener('pointerdown', event => {
      /* Whatever the last gesture left waiting to be swallowed, this one ends:
         a drag by a finger is not followed by a click at all, and the flag
         would otherwise sit there and eat the next tap on a button. */
      view.dragged = false;

      if (!event.target.closest('.pic')) return;

      view.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      view.moved = false;
      view.pointerType = event.pointerType;

      if (view.pointers.size === 2) view.pinch = spreadOf(view.pointers);
    });

    /* Take the pointer once the gesture turns out to be a drag rather than a
       click. A drag that runs past the edge of the popup -- which is the whole
       point of dragging a photograph bigger than its frame -- would otherwise
       stop being delivered here and the picture would stick where it was.
       Taking it any earlier would re-address the clicks of a double-click to
       the popup, and the double-click would stop meaning anything. */
    function hold(event) {
      if (view.captured) return;

      try {
        popup.setPointerCapture(event.pointerId);
        view.captured = true;
      } catch (error) {
        /* Nothing to hold: the pointer has already gone. */
      }
    }

    popup.addEventListener('pointermove', event => {
      if (!view.pointers.has(event.pointerId)) return;

      const previous = view.pointers.get(event.pointerId);
      view.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      /* A panorama at its own size is dragged along rather than zoomed. */
      if (view.actual) {
        const pic = frameOf(view);
        if (view.pointers.size !== 1 || !pic) return;

        hold(event);
        pic.scrollLeft -= event.clientX - previous.x;
        pic.scrollTop -= event.clientY - previous.y;
        view.moved = true;
        event.preventDefault();
        return;
      }

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
        hold(event);
        view.x += event.clientX - previous.x;
        view.y += event.clientY - previous.y;
        view.moved = true;
        contain(view);
        apply(view);
        event.preventDefault();
      }
    });

    /* `pointerleave` is deliberately not in this list: with the pointer held
       it never means the drag is over, and reading it as the end was what
       stopped a drag the moment it crossed anything. */
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => {
      popup.addEventListener(name, event => {
        view.pointers.delete(event.pointerId);
        if (view.pointers.size < 2) view.pinch = 0;
        if (view.pointers.size === 0) view.captured = false;

        /* A drag or a pinch is not a click on the photograph, and the popup
           closes on a click. The click itself is what has to be swallowed --
           stopping the pointer event does not stop the click that follows. */
        if (view.moved && name === 'pointerup') {
          view.dragged = true;
          view.moved = false;
        }
      }, true);
    });

    popup.addEventListener('dblclick', event => {
      if (!event.target.closest('.pic')) return;

      event.preventDefault();
      event.stopPropagation();

      /* On a panorama the two views are the only two things a double-click
         could reasonably mean, so it changes between them. */
      if (view.panorama) {
        toggle(popup);
        return;
      }

      zoomAt(view, view.scale > 1.01 ? 1 : 2.5, event.clientX, event.clientY);
    });

    /* Anywhere inside the popup, not only over the photograph: a trackpad
       pinch a little off the edge should still zoom the picture rather than
       the browser.
     *
     * With a modifier the wheel zooms, as it always has. Without one it moves
     * the photograph, which is what a two-finger scroll means everywhere else,
     * and what a magnified photograph needs far more than another zoom. */
    popup.addEventListener('wheel', event => {
      const zooming = event.ctrlKey || event.metaKey;

      if (view.actual) {
        const pic = frameOf(view);
        if (zooming || !pic) return;

        /* Room to go up and down means the frame can do this itself. A mouse
           has no sideways scroll, so where there is only sideways to go, that
           is what the wheel is turned into. */
        if (pic.scrollHeight > pic.clientHeight) return;

        const step = Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
        if (!step) return;

        event.preventDefault();
        pic.scrollLeft += step;
        return;
      }

      /* Refused rather than ignored, so that a panorama the wheel cannot zoom
         does not hand the gesture back to the browser and zoom the page. */
      if (zooming) {
        event.preventDefault();
        zoomAt(view, view.scale * (event.deltaY < 0 ? 1.12 : 0.89), event.clientX, event.clientY);
        return;
      }

      if (view.scale > 1.01) {
        event.preventDefault();
        view.x -= event.deltaX;
        view.y -= event.deltaY;
        contain(view);
        apply(view);
      }
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

    /* Poptrox closes the popup on any click it receives, and it receives the
       first click of a double-click too -- which is why double-clicking a
       photograph shut the lightbox instead of magnifying it.
     *
     * The click at the end of a drag is part of the drag. And a click on the
     * photograph itself is the beginning of looking at it, so under a mouse it
     * is left to the double-click: there is a close button, an Escape key and
     * the whole surround to close with. A finger has none of those -- the
     * closer is hidden at that width -- so a tap still closes. */
    popup.addEventListener('click', event => {
      const exploring = view.pointerType === 'mouse' && event.target.closest('.pic');

      if (!view.dragged && !exploring) return;

      view.dragged = false;
      event.preventDefault();
      event.stopPropagation();
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

  return { attach: attach, frame: frame, reset: reset };
})();
