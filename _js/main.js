/*
 Multiverse by HTML5 UP
 html5up.net | @ajlkn
 Free for personal and commercial use under the CCA 3.0 license (html5up.net/license)

 Added EXIF data and enhanced for Jekyll by Ram Patra
 */

(function ($) {

    skel.breakpoints({
        xlarge: '(max-width: 1680px)',
        large: '(max-width: 1280px)',
        medium: '(max-width: 980px)',
        small: '(max-width: 736px)',
        xsmall: '(max-width: 480px)'
    });

    $(function () {

        var $window = $(window),
            $html = $('html'),
            $body = $('body'),
            $wrapper = $('#wrapper');

        // Hack: Enable IE workarounds.
        if (skel.vars.IEVersion < 12)
            $body.addClass('ie');

        // Touch?
        if (skel.vars.mobile)
            $body.addClass('touch');

        // Transitions supported?
        if (skel.canUse('transition')) {

            // Add (and later, on load, remove) "loading" class.
            $body.addClass('loading');

            $window.on('load', function () {
                window.setTimeout(function () {
                    $body.removeClass('loading');
                }, 100);
            });

            // Prevent transitions/animations on resize.
            var resizeTimeout;

            $window.on('resize', function () {

                window.clearTimeout(resizeTimeout);

                $body.addClass('resizing');

                resizeTimeout = window.setTimeout(function () {
                    $body.removeClass('resizing');
                }, 100);

            });

        }

        // Scroll back to top.
        $window.scrollTop(0);

        // Fix: Placeholder polyfill.
        $('form').placeholder();

        // Panels.
        var $panels = $('.panel'),
            lockedScrollY = 0,
            panelMemoryKey = 'photography:open-panel';

        function rememberPanel($panel) {
            if (!$panel.length)
                return;

            try {
                window.sessionStorage.setItem(panelMemoryKey, $panel.attr('id'));
            }
            catch (error) {
                // Private browsing can make storage unavailable.
            }
        }

        function restorePanel() {
            var panelId = null,
                panel;

            try {
                panelId = window.sessionStorage.getItem(panelMemoryKey);
                window.sessionStorage.removeItem(panelMemoryKey);
            }
            catch (error) {
                // The language still changes when storage is unavailable.
            }

            if (!panelId)
                return;

            panel = document.getElementById(panelId);
            if (panel && $(panel).hasClass('panel'))
                $(panel).trigger('---show');
        }

        function lockPageScroll() {
            if ($html.hasClass('content-active'))
                return;

            lockedScrollY = $window.scrollTop();
            $body.css('top', -lockedScrollY + 'px');
            $html.addClass('content-active');
            $body.addClass('content-active');
        }

        function unlockPageScroll() {
            if (!$html.hasClass('content-active'))
                return;

            $html.removeClass('content-active');
            $body.removeClass('content-active').css('top', '');
            $window.scrollTop(lockedScrollY);
        }

        $panels.each(function () {

            var $this = $(this),
                $toggles = $('[href="#' + $this.attr('id') + '"]'),
                $closer = $('<div class="closer" />').appendTo($this);

            // Closer.
            $closer
                .on('click', function (event) {
                    $this.trigger('---hide');
                });

            // Events.
            $this
                .on('click', function (event) {
                    event.stopPropagation();
                })
                .on('---toggle', function () {

                    if ($this.hasClass('active'))
                        $this.triggerHandler('---hide');
                    else
                        $this.triggerHandler('---show');

                })
                .on('---show', function () {

                    // Hide other content.
                    if ($body.hasClass('content-active'))
                        $panels.trigger('---hide');

                    // Activate content, toggles.
                    $this.find('.globe-explorer, .airport-scroll').scrollTop(0);
                    $this.addClass('active');
                    $toggles.addClass('active');

                    // Activate body.
                    lockPageScroll();

                })
                .on('---hide', function () {

                    // Deactivate content, toggles.
                    $this.removeClass('active');
                    $toggles.removeClass('active');

                    // Deactivate body when no other panel is open.
                    if (!$panels.filter('.active').length)
                        unlockPageScroll();

                });

            // Toggles.
            $toggles
                .removeAttr('href')
                .css('cursor', 'pointer')
                .on('click', function (event) {

                    event.preventDefault();
                    event.stopPropagation();

                    $this.trigger('---toggle');

                });

        });

        restorePanel();

        // Global events.
        $body
            .on('click', function (event) {

                if ($body.hasClass('content-active')) {

                    /* The language switch reloads the whole document because
                       the panels' words and data are locale-specific. Let its
                       link navigate, then reopen this panel in the new page. */
                    if ($(event.target).closest('[data-locale-switch]').length) {
                        rememberPanel($panels.filter('.active').first());
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    $panels.trigger('---hide');

                }

            });

        $window
            .on('keyup', function (event) {

                if (event.keyCode == 27
                    && $body.hasClass('content-active')) {

                    event.preventDefault();
                    event.stopPropagation();

                    $panels.trigger('---hide');

                }

            });

        // Main.
        var $main = $('#main'),
            exifDatas = {};

        // Fisher-Yates. Sorting on a random comparator is not an even shuffle.
        function shuffled(items) {
            var copy = items.slice(),
                index,
                pick,
                held;

            for (index = copy.length - 1; index > 0; index--) {
                pick = Math.floor(Math.random() * (index + 1));
                held = copy[index];
                copy[index] = copy[pick];
                copy[pick] = held;
            }

            return copy;
        }

        // Which pile a photograph belongs to: its prefix, so every frame from
        // one airport is one pile, and so is every photograph from one
        // province once they are filed that way.
        function thumbGroup(thumb) {
            var image = thumb.querySelector('img'),
                name = (image && image.getAttribute('data-name')) || '',
                parts = name.split('-');

            return parts.length > 1 ? parts.slice(0, -1).join('-') : 'other';
        }

        // Shuffle the grid, but keep each kind spread through it. An even
        // shuffle of sixteen airport frames among a hundred photographs still
        // drops several of them side by side, and scrolling then reads as a
        // run of aprons, then a run of mountains. So each pile is shuffled on
        // its own and they are dealt out largest-first, never twice running
        // from the same pile unless it is all that is left.
        //
        // Nothing stricter: holding a big pile back to space it further would
        // drain the small piles early and leave its remainder in one long run
        // at the end, which is the fault this is meant to fix.
        function shuffleThumbs() {
            var thumbs = $main.children('.thumb').get(),
                groups = {},
                piles,
                ordered = [],
                previous = null;

            if (thumbs.length < 3)
                return;

            thumbs.forEach(function (thumb) {
                var key = thumbGroup(thumb);
                (groups[key] || (groups[key] = [])).push(thumb);
            });

            piles = Object.keys(groups).map(function (key) {
                return { key: key, items: shuffled(groups[key]) };
            });

            while (piles.length) {
                piles.sort(function (first, second) {
                    return second.items.length - first.items.length;
                });

                var usable = piles.filter(function (pile) {
                        return pile.key !== previous;
                    });

                if (!usable.length)
                    usable = piles;

                // Among the piles with the most left, one at random, so the
                // order differs between visits.
                var most = usable[0].items.length,
                    candidates = usable.filter(function (pile) {
                        return pile.items.length === most;
                    }),
                    next = candidates[Math.floor(Math.random() * candidates.length)];

                ordered.push(next.items.pop());
                previous = next.key;

                if (!next.items.length)
                    piles.splice(piles.indexOf(next), 1);
            }

            ordered.forEach(function (thumb) {
                $main.append(thumb);
            });
        }

        function disableImageActions($elements) {
            $elements
                .attr('draggable', 'false')
                .on('contextmenu dragstart', function(event) {
                    event.preventDefault();
                });
        }

        $main.on('contextmenu dragstart',
            '.thumb, .thumb .image, .thumb img, .story-photo, .story-photo .image, .story-photo img',
            function(event) {
            event.preventDefault();
        });

        function applyStoryPhotoOrientation($image_img) {
            var img = $image_img[0],
                $photo = $image_img.closest('.story-photo'),
                $strip = $photo.closest('.story-photo-strip'),
                ratio,
                orientation;

            if (
                !$strip.length ||
                $photo.hasClass('has-explicit-ratio') ||
                !img.naturalWidth ||
                !img.naturalHeight
            )
                return;

            ratio = img.naturalWidth / img.naturalHeight;
            orientation = ratio < 0.9
                ? 'portrait'
                : (ratio <= 1.1 ? 'square' : 'landscape');

            $photo
                .removeClass('is-photo-portrait is-photo-square is-photo-landscape')
                .addClass('is-photo-' + orientation);

            $strip[0].dispatchEvent(new CustomEvent('storyorientationchange'));
        }

        function loadThumb($image, $image_img) {
            if ($image.data('loaded'))
                return;

            // Pick the size the screen can actually show: images/small on an
            // ordinary display, images/thumbs on a dense one. The <img> and
            // the background share the URL, so it is fetched once.
            var img = $image_img[0],
                dense = (window.devicePixelRatio || 1) > 1.5,
                src = $image_img.attr('src') ||
                    (dense && $image_img.data('src-2x')) ||
                    $image_img.data('src');

            if (!src)
                return;

            $image.data('loaded', true);
            $image.css('background-image', 'url(' + src + ')');

            if (!$image_img.attr('src')) {
                img.loading = 'eager';
                $image_img.attr('src', src);
            }

            if (img.complete && img.naturalWidth)
                applyStoryPhotoOrientation($image_img);
            else
                $image_img.one('load.storyOrientation', function () {
                    applyStoryPhotoOrientation($image_img);
                });
        }

        var lazyThumbs = [],
            thumbObserver = null;

        // Thumbs.
        function prepareThumbs() {
        lazyThumbs = [];
        $main.find('.thumb, .story-photo').each(function () {

            var $this = $(this),
                $image = $this.find('.image'), $image_img = $image.children('img'),
                x;

            // No image? Bail.
            if ($image.length == 0)
                return;

            // Image.
            // This sets the background of the "image" <span> to the image pointed to by its child
            // <img> (which is then hidden). Gives us way more flexibility.

            // Set background position.
            if (x = $image_img.data('position'))
                $image.css('background-position', x);

            // Hide original img.
            $image_img.hide();
            disableImageActions($image.add($image_img));

            lazyThumbs.push({
                image: $image,
                img: $image_img,
                element: $this[0]
            });

            // Hack: IE<11 doesn't support pointer-events, which means clicks to our image never
            // land as they're blocked by the thumbnail's caption overlay gradient. This just forces
            // the click through to the image.
            if (skel.vars.IEVersion < 11)
                $this
                    .css('cursor', 'pointer')
                    .on('click', function () {
                        $image.trigger('click');
                    });

        });

        if ('IntersectionObserver' in window) {
            if (thumbObserver)
                thumbObserver.disconnect();

            thumbObserver = new IntersectionObserver(function(entries) {
                entries.forEach(function(entry) {
                    if (!entry.isIntersecting)
                        return;

                    var $image = $(entry.target).find('.image'),
                        $image_img = $image.children('img');

                    loadThumb($image, $image_img);
                    thumbObserver.unobserve(entry.target);
                });
            }, { rootMargin: '800px' });

            lazyThumbs.forEach(function(thumb) {
                thumbObserver.observe(thumb.element);
            });
        }
        else {
            lazyThumbs.forEach(function(thumb) {
                loadThumb(thumb.image, thumb.img);
            });
        }
        }

        function applyStoryVideoOrientation(video) {
            var $video = $(video),
                $card = $video.closest('.story-video-card'),
                $block = $video.closest('.story-video-block'),
                $container = $card.length ? $card : $block,
                ratio,
                orientation;

            if (
                !$container.length ||
                $container.hasClass('has-explicit-ratio') ||
                !video.videoWidth ||
                !video.videoHeight
            )
                return;

            ratio = video.videoWidth / video.videoHeight;
            orientation = ratio < 0.9
                ? 'portrait'
                : (ratio <= 1.1 ? 'square' : 'landscape');

            if ($card.length) {
                $card
                    .removeClass('is-photo-portrait is-photo-square is-photo-landscape')
                    .addClass('is-photo-' + orientation);
                $card.closest('.story-photo-strip')[0]
                    .dispatchEvent(new CustomEvent('storyorientationchange'));
            }
            else {
                $block
                    .removeClass('is-video-portrait is-video-square is-video-landscape')
                    .addClass('is-video-' + orientation);
            }
        }

        function prepareStoryVideos() {
            $main.find('.story-video-player').each(function () {
                var video = this;

                if (video.readyState >= 1)
                    applyStoryVideoOrientation(video);
                else
                    video.addEventListener('loadedmetadata', function () {
                        applyStoryVideoOrientation(video);
                    }, { once: true });
            });
        }

        function exifCaptionMarkup(data) {
            return '<p class="exif-caption" aria-live="polite">' + (data || '') + '</p>';
        }

        function activePoptroxPopup() {
            return $('.poptrox-popup:visible').last();
        }

        function updateActiveExifCaption(image, data) {
            var $popup = $(image).closest('.poptrox-popup'),
                $activeImage = $popup.find('.pic img');

            if (!$popup.is(':visible') || $activeImage.length == 0 || $activeImage[0] !== image)
                return;

            $popup.find('.caption')
                .toggleClass('has-exif', Boolean(data))
                .trigger('update', [exifCaptionMarkup(data)]);
        }

        function lightboxCaption($a) {
            var $image_img = $a.children('img'),
                imageName = $image_img.data('name'),
                data = exifDatas[imageName],
                $popup = activePoptroxPopup();

            if (window.Postcards && $popup.length)
                Postcards.show($popup[0], imageName, $popup.find('.pic img')[0]);

            if (data === undefined) {
                var popupImage = $popup.find('.pic img')[0];

                if (popupImage) {
                    disableImageActions($(popupImage).add($popup.find('.pic')));
                    EXIF.getData(popupImage, function () {
                        data = exifDatas[imageName] = getExifDataMarkup(this);

                        // The caption callback is synchronous, while EXIF parsing is not.
                        // Update only if this image is still the active popup.
                        window.requestAnimationFrame(function () {
                            updateActiveExifCaption(popupImage, data);
                        });
                    });
                }
            }

            $popup.find('.caption').toggleClass('has-exif', Boolean(data));
            return exifCaptionMarkup(data);
        }

        var poptroxContainers = [];

        function initializeLightbox($container, selector, useNavigation, groupIndex) {
            if (!$container.length || !$container.find(selector).length)
                return;

            $container.poptrox({
                baseZIndex: 20000,
                caption: lightboxCaption,
                fadeSpeed: 300,
                onPopupClose: function () {
                    $body.removeClass('modal-active');
                },
                onPopupOpen: function () {
                    $panels.trigger('---hide');
                    unlockPageScroll();
                    $body.addClass('modal-active');
                    if (window.Postcards)
                        Postcards.prime();
                },
                overlayOpacity: 0,
                popupClass: 'poptrox-popup poptrox-group-' + groupIndex,
                popupCloserText: '',
                popupHeight: 150,
                popupLoaderText: '',
                popupNavNextSelector: useNavigation ? '.nav-next' : null,
                popupNavPreviousSelector: useNavigation ? '.nav-previous' : null,
                popupSpeed: 300,
                popupWidth: 150,
                selector: selector,
                usePopupCaption: true,
                usePopupCloser: true,
                usePopupDefaultStyling: false,
                usePopupForceClose: true,
                usePopupLoader: true,
                usePopupNav: useNavigation,
                windowMargin: 50
            });

            poptroxContainers.push($container[0]);

            $('.poptrox-group-' + groupIndex).each(function () {
                if (window.Postcards)
                    Postcards.attach(this);
                if (window.Zoom)
                    Zoom.attach(this);
            });
        }

        function prepareLightboxes() {
            // Soft navigation replaces the grid, so the popups poptrox built
            // for the previous page are torn down before rebinding.
            $('.poptrox-popup, .poptrox-overlay').remove();
            poptroxContainers = [];

            var $storyPage = $main.find('.story-page');

            if ($storyPage.length) {
                var $storyHero = $storyPage.find('.story-hero-photo');

                initializeLightbox($storyHero, 'a.image', false, 'hero');
                $storyPage.find('.story-photo-strip').each(function (index) {
                    var $strip = $(this),
                        selector = '.story-photo > a.image';
                    initializeLightbox(
                        $strip,
                        selector,
                        $strip.find(selector).length > 1,
                        'strip-' + index
                    );
                });
            }
            else {
                initializeLightbox($main, '.thumb > a.image', true, 'gallery');
            }

            $('.poptrox-popup').on('poptrox_switch poptrox_reset', function () {
                $(this).find('.caption').removeClass('has-exif');
                if (window.Postcards)
                    Postcards.reset(this);
                if (window.Zoom)
                    Zoom.reset(this);
            });
        }

        // Hack: Set margins to 0 when 'xsmall' activates.
        skel
            .on('-xsmall', function () {
                poptroxContainers.forEach(function (container) {
                    container._poptrox.windowMargin = 50;
                });
            })
            .on('+xsmall', function () {
                poptroxContainers.forEach(function (container) {
                    container._poptrox.windowMargin = 0;
                });
            });

        function initializeStoryStripMotion() {
            var motionIsReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            $main.find('.story-photo-strip').each(function () {
                var strip = this,
                    $strip = $(strip),
                    $shell = $strip.closest('.story-strip-shell'),
                    progressThumb = $shell.find('.story-strip-progress > span')[0],
                    autoScrolling = !motionIsReduced,
                    isVisible = true,
                    direction = 1,
                    lastTime = performance.now(),
                    holdUntil = lastTime + 1400,
                    frameId = null;

                function maximumScroll() {
                    return Math.max(0, strip.scrollWidth - strip.clientWidth);
                }

                function updateStripChrome() {
                    var maximum = maximumScroll(),
                        progress = maximum > 0 ? strip.scrollLeft / maximum : 0,
                        thumbRatio = strip.scrollWidth > 0 ? strip.clientWidth / strip.scrollWidth : 1,
                        thumbWidth = Math.max(8, Math.min(100, thumbRatio * 100)),
                        thumbLeft = Math.max(0, Math.min(100 - thumbWidth, progress * (100 - thumbWidth)));

                    $shell
                        .toggleClass('is-static', maximum <= 1)
                        .toggleClass('is-auto-scrolling', autoScrolling && maximum > 1)
                        .toggleClass('has-scrolled', strip.scrollLeft > 2)
                        .toggleClass('is-at-end', maximum <= 1 || strip.scrollLeft >= maximum - 2);

                    if (progressThumb) {
                        progressThumb.style.width = thumbWidth + '%';
                        progressThumb.style.left = thumbLeft + '%';
                    }
                }

                function stopAutomaticMotion() {
                    if (!autoScrolling)
                        return;

                    autoScrolling = false;
                    $shell.removeClass('is-auto-scrolling');
                    if (frameId !== null) {
                        window.cancelAnimationFrame(frameId);
                        frameId = null;
                    }
                }

                function scheduleAutomaticMotion() {
                    if (
                        autoScrolling &&
                        isVisible &&
                        !document.hidden &&
                        maximumScroll() > 1 &&
                        frameId === null
                    ) {
                        lastTime = performance.now();
                        frameId = window.requestAnimationFrame(animateStrip);
                    }
                }

                function handleVisibilityChange() {
                    if (document.hidden && frameId !== null) {
                        window.cancelAnimationFrame(frameId);
                        frameId = null;
                    }
                    else {
                        scheduleAutomaticMotion();
                    }
                }

                function animateStrip(now) {
                    var maximum = maximumScroll(),
                        elapsed = Math.min(40, now - lastTime);

                    frameId = null;

                    if (maximum > 1 && now >= holdUntil) {
                        strip.scrollLeft += direction * elapsed * 0.022;

                        if (strip.scrollLeft >= maximum - 1) {
                            strip.scrollLeft = maximum;
                            direction = -1;
                            holdUntil = now + 1100;
                        }
                        else if (strip.scrollLeft <= 1 && direction < 0) {
                            strip.scrollLeft = 0;
                            direction = 1;
                            holdUntil = now + 1100;
                        }
                    }

                    updateStripChrome();
                    lastTime = now;
                    scheduleAutomaticMotion();
                }

                ['pointerdown', 'touchstart', 'wheel'].forEach(function (eventName) {
                    strip.addEventListener(eventName, stopAutomaticMotion, { passive: true });
                });
                strip.addEventListener('keydown', stopAutomaticMotion);
                strip.addEventListener('scroll', updateStripChrome, { passive: true });
                $strip.find('.story-video-player').on('play', stopAutomaticMotion);

                // A mouse has no sideways scroll. Turn the wheel into one, but
                // only while there is somewhere left to go, so that reaching
                // either end hands the page back its scrolling.
                strip.addEventListener('wheel', function (event) {
                    var maximum = maximumScroll(),
                        step = Math.abs(event.deltaX) > Math.abs(event.deltaY)
                            ? event.deltaX
                            : event.deltaY;

                    if (maximum <= 1 || event.ctrlKey || step === 0)
                        return;

                    if ((step < 0 && strip.scrollLeft <= 0) ||
                        (step > 0 && strip.scrollLeft >= maximum - 1))
                        return;

                    event.preventDefault();
                    strip.scrollLeft += step;
                }, { passive: false });

                // Drag to pan, and swallow the click that would otherwise open
                // the lightbox at the end of a drag.
                var dragFrom = null,
                    dragScroll = 0,
                    dragged = false;

                strip.addEventListener('pointerdown', function (event) {
                    if (event.pointerType === 'touch' || event.button !== 0)
                        return;

                    dragFrom = event.clientX;
                    dragScroll = strip.scrollLeft;
                    dragged = false;
                });

                window.addEventListener('pointermove', function (event) {
                    if (dragFrom === null)
                        return;

                    var moved = event.clientX - dragFrom;

                    // Only once it is a drag rather than a click. Marking the
                    // shell on pointerdown took pointer events away from the
                    // photographs, and the click that opens the lightbox never
                    // landed.
                    if (!dragged && Math.abs(moved) > 4) {
                        dragged = true;
                        $shell.addClass('is-dragging');
                    }

                    if (dragged) {
                        strip.scrollLeft = dragScroll - moved;
                        event.preventDefault();
                    }
                });

                window.addEventListener('pointerup', function () {
                    if (dragFrom === null)
                        return;

                    dragFrom = null;
                    $shell.removeClass('is-dragging');

                    if (dragged) {
                        // Proximity snapping would pull a short drag straight
                        // back to the photograph it started on. Once someone
                        // has dragged with a mouse, let them pan freely.
                        $shell.addClass('has-dragged');
                        window.setTimeout(function () { dragged = false; }, 0);
                    }
                });

                strip.addEventListener('click', function (event) {
                    if (dragged) {
                        event.preventDefault();
                        event.stopPropagation();
                    }
                }, true);

                // And a pair of buttons, because neither of the above is
                // visible until you try it.
                $shell.find('.story-strip-step').each(function () {
                    var $button = $(this),
                        direction = $button.hasClass('is-next') ? 1 : -1;

                    $button.on('click', function (event) {
                        event.preventDefault();
                        stopAutomaticMotion();
                        strip.scrollBy({
                            left: direction * Math.max(240, strip.clientWidth * 0.8),
                            behavior: motionIsReduced ? 'auto' : 'smooth'
                        });
                    });
                });

                if ('IntersectionObserver' in window) {
                    new IntersectionObserver(function (entries) {
                        isVisible = entries[0].isIntersecting;
                        if (!isVisible && frameId !== null) {
                            window.cancelAnimationFrame(frameId);
                            frameId = null;
                        }
                        scheduleAutomaticMotion();
                    }, { threshold: 0.15 }).observe(strip);
                }

                function handleStripResize() {
                    updateStripChrome();
                    scheduleAutomaticMotion();
                }

                strip.addEventListener('storyorientationchange', handleStripResize);

                if ('ResizeObserver' in window)
                    new ResizeObserver(handleStripResize).observe(strip);
                else
                    $window.on('resize', handleStripResize);

                updateStripChrome();
                if (autoScrolling) {
                    document.addEventListener('visibilitychange', handleVisibilityChange);
                    scheduleAutomaticMotion();
                }
            });
        }

        // Back to the top. #main is the scroller, not the window, and the
        // navigation bar is fixed along the bottom, so the button sits above
        // it rather than in the usual corner.
        var $toTop = $('#to-top');

        function updateToTop() {
            var scrolled = $main.scrollTop(),
                far = scrolled > $main.height() * 0.9;

            $toTop.attr('hidden', far ? null : 'hidden');
        }

        if ($toTop.length) {
            $toTop.on('click', function (event) {
                event.preventDefault();
                event.stopPropagation();

                if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
                    $main.scrollTop(0);
                else
                    $main[0].scrollTo({ top: 0, behavior: 'smooth' });
            });

            $main.on('scroll', updateToTop);
        }

        // Everything that has to run again when soft navigation swaps #main.
        function activateContent(options) {
            $window.scrollTop(0);
            $main.scrollTop(0);
            if (!options || !options.preservePhotoOrder)
                shuffleThumbs();
            prepareThumbs();
            prepareStoryVideos();
            prepareLightboxes();
            initializeStoryStripMotion();
            updateToTop();
        }

        activateContent();
        window.SiteContent = { activate: activateContent };

        function cleanExifText(value) {
            return String(value == null ? '' : value)
                .replace(/\0/g, '')
                .trim();
        }

        function escapeExifText(value) {
            return cleanExifText(value).replace(/[&<>"']/g, function(character) {
                return {
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#39;'
                }[character];
            });
        }

        function positiveExifNumber(value) {
            if (Array.isArray(value))
                value = value[0];

            var number = Number(value);
            return Number.isFinite(number) && number > 0 ? number : null;
        }

        function conciseExifNumber(value, maximumDecimals) {
            return Number(value.toFixed(maximumDecimals)).toString();
        }

        function formatAperture(value) {
            var aperture = positiveExifNumber(value);
            if (aperture === null)
                return null;

            return 'f/' + conciseExifNumber(aperture, aperture < 1 ? 2 : 1);
        }

        function greatestCommonDivisor(first, second) {
            first = Math.abs(first);
            second = Math.abs(second);

            while (second) {
                var remainder = first % second;
                first = second;
                second = remainder;
            }

            return first;
        }

        function formatExposureTime(value) {
            var text = cleanExifText(value);
            var fraction = text.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
            var seconds;

            if (fraction) {
                var numerator = Number(fraction[1]);
                var denominator = Number(fraction[2]);
                if (!Number.isFinite(numerator) || !Number.isFinite(denominator) ||
                    numerator <= 0 || denominator <= 0)
                    return null;

                if (Number.isInteger(numerator) && Number.isInteger(denominator)) {
                    var divisor = greatestCommonDivisor(numerator, denominator);
                    var reducedNumerator = numerator / divisor;
                    var reducedDenominator = denominator / divisor;
                    if (reducedNumerator === 1 && reducedDenominator > 1)
                        return '1/' + reducedDenominator + ' s';
                }

                seconds = numerator / denominator;
            }
            else {
                seconds = positiveExifNumber(value);
            }

            if (seconds === null || !Number.isFinite(seconds) || seconds <= 0)
                return null;

            if (seconds >= 1)
                return conciseExifNumber(seconds, 2) + ' s';

            var reciprocal = 1 / seconds;
            var roundedReciprocal = Math.round(reciprocal);
            var reciprocalTolerance = Math.max(0.02, roundedReciprocal * 0.001);
            if (Math.abs(reciprocal - roundedReciprocal) <= reciprocalTolerance)
                return '1/' + roundedReciprocal + ' s';

            return conciseExifNumber(seconds, seconds < 0.01 ? 4 : 3) + ' s';
        }

        function formatExifValue(tag, value) {
            if (tag === 'FocalLengthIn35mmFilm') {
                var focalLength = positiveExifNumber(value);
                return focalLength === null ? null : conciseExifNumber(focalLength, 1) + ' mm';
            }

            if (tag === 'FNumber')
                return formatAperture(value);

            if (tag === 'ExposureTime')
                return formatExposureTime(value);

            if (tag === 'ISOSpeedRatings') {
                var iso = positiveExifNumber(value);
                return iso === null ? null : 'ISO ' + Math.round(iso);
            }

            var text = escapeExifText(value);
            return text || null;
        }

        function getExifDataMarkup(img) {
            var wanted = $main.data('exif') || [],
                items = [];

            wanted.forEach(function (entry) {
                var value = EXIF.getTag(img, entry.tag),
                    formatted,
                    icon;

                if (typeof value === 'undefined' || value === null)
                    return;

                formatted = formatExifValue(entry.tag, value);

                if (!formatted)
                    return;

                icon = entry.icon
                    ? '<i class="fa fa-' + entry.icon + '" aria-hidden="true"></i>'
                    : '';
                items.push('<span class="exif-item">' + icon + formatted + '</span>');
            });

            return items.join('');
        }

    });

})(jQuery);
