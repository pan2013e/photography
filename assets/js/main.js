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
        var $panels = $('.panel');

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
                    $this.addClass('active');
                    $toggles.addClass('active');

                    // Activate body.
                    $body.addClass('content-active');

                })
                .on('---hide', function () {

                    // Deactivate content, toggles.
                    $this.removeClass('active');
                    $toggles.removeClass('active');

                    // Deactivate body.
                    $body.removeClass('content-active');

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

            $image_img.one("load", function() {
                EXIF.getData(img, function () {
                    exifDatas[$image_img.data('name')] = getExifDataMarkup(this);
                });
            });

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

        // Poptrox.
        $main.poptrox({
            baseZIndex: 20000,
            caption: function ($a) {
                var $image_img = $a.children('img');
                var data = exifDatas[$image_img.data('name')];
                if (data === undefined) {
                    // EXIF data					
                    EXIF.getData($image_img[0], function () {
                        data = exifDatas[$image_img.data('name')] = getExifDataMarkup(this);
                    });
                }
                return data !== undefined ? '<p>' + data + '</p>' : ' ';
            },
            fadeSpeed: 300,
            onPopupClose: function () {
                $body.removeClass('modal-active');
            },
            onPopupOpen: function () {
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

        // Hack: Set margins to 0 when 'xsmall' activates.
        skel
            .on('-xsmall', function () {
                $main[0]._poptrox.windowMargin = 50;
            })
            .on('+xsmall', function () {
                $main[0]._poptrox.windowMargin = 0;
            });

        function getExifDataMarkup(img) {
            var exif = $('#main').data('exif');
            var template = '';
            for (var current in exif) {
                var current_data = exif[current];
                var exif_data = EXIF.getTag(img, current_data['tag']);
                if (typeof exif_data !== "undefined") {
                    if (current_data['tag'] === 'FocalLengthIn35mmFilm') {
                        template += exif_data + ' mm';
                    }
                    else if (current_data['tag'] === 'FNumber') {
                        template += 'f/' + exif_data;
                    }
                    else if (current_data['tag'] === 'ExposureTime') {
                        if (exif_data.endsWith('/1')) {
                            exif_data = exif_data.substring(0, exif_data.length - 2);
                        }
                        template += exif_data + ' s';
                    }
                    else if (current_data['tag'] === 'ISOSpeedRatings') {
                        template += 'ISO ' + exif_data;
                    }
                    else {
                        template += '<i class="fa fa-' + current_data['icon'] + '" aria-hidden="true"></i> ' + exif_data;
                    }
                    template += '&nbsp;&nbsp;&nbsp;';
                }
            }
            return template;
        }

    });

})(jQuery);
