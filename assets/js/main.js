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
            lockedScrollY = 0;

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
                    $this.find('.globe-explorer, .airport-explorer').scrollTop(0);
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

        // Global events.
        $body
            .on('click', function (event) {

                if ($body.hasClass('content-active')) {

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

        // Header.
        var $header = $('#header');

        // Links.
        $header.find('a').each(function () {

            var $this = $(this),
                href = $this.attr('href');

            // Internal link? Skip.
            if (!href
                || href.charAt(0) == '#')
                return;

            // Redirect on click.
            $this
                .removeAttr('href')
                .css('cursor', 'pointer')
                .on('click', function (event) {

                    event.preventDefault();
                    event.stopPropagation();

                    window.location.href = href;

                });

        });

        // Footer.
        var $footer = $('#footer');

        // Copyright.
        // This basically just moves the copyright line to the end of the *last* sibling of its current parent
        // when the "medium" breakpoint activates, and moves it back when it deactivates.
        $footer.find('.copyright').each(function () {

            var $this = $(this),
                $parent = $this.parent(),
                $lastParent = $parent.parent().children().last();

            skel
                .on('+medium', function () {
                    $this.appendTo($lastParent);
                })
                .on('-medium', function () {
                    $this.appendTo($parent);
                });

        });

        // Main.
        var $main = $('#main'),
            exifDatas = {};

        function disableImageActions($elements) {
            $elements
                .attr('draggable', 'false')
                .on('contextmenu dragstart', function(event) {
                    event.preventDefault();
                });
        }

        $main.on('contextmenu dragstart', '.thumb, .thumb .image, .thumb img', function(event) {
            event.preventDefault();
        });

        function loadThumb($image, $image_img) {
            if ($image.data('loaded'))
                return;

            var img = $image_img[0],
                src = $image_img.attr('src') || $image_img.data('src');

            if (!src)
                return;

            $image.data('loaded', true);
            $image.css('background-image', 'url(' + src + ')');

            if (!$image_img.attr('src')) {
                img.loading = 'eager';
                $image_img.attr('src', src);
            }
        }

        var lazyThumbs = [];

        // Thumbs.
        $main.children('.thumb').each(function () {

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
            var thumbObserver = new IntersectionObserver(function(entries) {
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

        function exifCaptionMarkup(data) {
            return '<p class="exif-caption" aria-live="polite">' + (data || '') + '</p>';
        }

        function updateActiveExifCaption(image, data) {
            var $activeImage = $('.poptrox-popup .pic img');

            if ($activeImage.length == 0 || $activeImage[0] !== image)
                return;

            $('.poptrox-popup .caption')
                .toggleClass('has-exif', Boolean(data))
                .trigger('update', [exifCaptionMarkup(data)]);
        }

        // Poptrox.
        $main.poptrox({
            baseZIndex: 20000,
            caption: function ($a) {
                var $image_img = $a.children('img');
                var imageName = $image_img.data('name');
                var data = exifDatas[imageName];

                if (data === undefined) {
                    var popupImage = $('.poptrox-popup .pic img')[0];

                    if (popupImage) {
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

                $('.poptrox-popup .caption')
                    .toggleClass('has-exif', Boolean(data));

                return exifCaptionMarkup(data);
            },
            fadeSpeed: 300,
            onPopupClose: function () {
                $body.removeClass('modal-active');
            },
            onPopupOpen: function () {
                $panels.trigger('---hide');
                unlockPageScroll();
                $body.addClass('modal-active');
                disableImageActions($('.poptrox-popup img, .poptrox-popup .pic'));
            },
            overlayOpacity: 0,
            popupCloserText: '',
            popupHeight: 150,
            popupLoaderText: '',
            popupSpeed: 300,
            popupWidth: 150,
            selector: '.thumb > a.image',
            usePopupCaption: true,
            usePopupCloser: true,
            usePopupDefaultStyling: false,
            usePopupForceClose: true,
            usePopupLoader: true,
            usePopupNav: true,
            windowMargin: 50
        });

        $('.poptrox-popup')
            .on('poptrox_switch poptrox_reset', function () {
                $(this).find('.caption').removeClass('has-exif');
            });

        // Hack: Set margins to 0 when 'xsmall' activates.
        skel
            .on('-xsmall', function () {
                $main[0]._poptrox.windowMargin = 50;
            })
            .on('+xsmall', function () {
                $main[0]._poptrox.windowMargin = 0;
            });

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
            var exif = $('#main').data('exif');
            var items = [];

            for (var current in exif) {
                var currentData = exif[current];
                var tag = currentData['tag'];
                var value = EXIF.getTag(img, tag);
                if (typeof value === 'undefined' || value === null)
                    continue;

                var formatted = formatExifValue(tag, value);
                if (!formatted)
                    continue;

                var icon = tag === 'Model'
                    ? '<i class="fa fa-' + currentData['icon'] + '" aria-hidden="true"></i>'
                    : '';
                items.push('<span class="exif-item">' + icon + formatted + '</span>');
            }

            return items.join('');
        }

    });

})(jQuery);
