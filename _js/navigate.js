/*
 * Soft navigation.
 *
 * Moving between galleries swaps the contents of #main instead of loading a
 * new document, so the header, the globe and the airport list stay exactly
 * where they are -- no flash, no reload, and the explorer keeps its data.
 *
 * Anything that cannot be handled this way -- an outside link, a failed
 * request, a browser without fetch -- falls back to an ordinary navigation.
 */
window.Navigation = (function () {
  'use strict';

  const baseUrl = document.documentElement.getAttribute('data-baseurl') || '/';
  const supported = 'fetch' in window && 'pushState' in window.history &&
    'DOMParser' in window;
  const pages = new Map();
  let token = 0;

  function main() {
    return document.getElementById('main');
  }

  function isInternal(url) {
    return url.origin === window.location.origin && url.pathname.startsWith(baseUrl);
  }

  /* Documents only: an image href belongs to the lightbox, not to us. */
  function isDocument(url) {
    const last = url.pathname.split('/').pop();
    return !last || !/\.[a-z0-9]+$/i.test(last) || /\.html?$/i.test(last);
  }

  /* The header stays where it is, which is the point of all this -- but two
     things in it are about the page rather than about the site, and would
     otherwise still describe wherever the reader first came in. The language
     switch is the one that shows: without this it sends someone reading /cn
     back to the home page in the other language instead of to /zh/cn. */
  function retarget(parsed) {
    document.querySelectorAll('[data-locale-switch]').forEach(link => {
      const incoming = parsed.querySelector(
        '[data-locale-switch="' + link.dataset.localeSwitch + '"]'
      );
      if (incoming) link.setAttribute('href', incoming.getAttribute('href'));
    });

    document.querySelectorAll('link[rel="alternate"][hreflang]').forEach(link => {
      const incoming = parsed.querySelector(
        'link[rel="alternate"][hreflang="' + link.getAttribute('hreflang') + '"]'
      );
      if (incoming) link.setAttribute('href', incoming.getAttribute('href'));
    });
  }

  function swap(html, url, push) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const incoming = parsed.getElementById('main');
    if (!incoming) throw new Error('The page has no #main.');

    main().innerHTML = incoming.innerHTML;
    document.body.className = parsed.body.className;
    document.title = parsed.title;
    retarget(parsed);

    if (push) window.history.pushState({ soft: true }, '', url.href);
    if (window.SiteContent) window.SiteContent.activate();
  }

  function render(html, url, push) {
    if (!document.startViewTransition) {
      swap(html, url, push);
      return;
    }

    document.startViewTransition(() => swap(html, url, push));
  }

  function fetchPage(href) {
    if (pages.has(href)) return pages.get(href);

    const request = fetch(href, { credentials: 'same-origin' }).then(response => {
      if (!response.ok) throw new Error('Could not load ' + href);
      return response.text();
    });

    pages.set(href, request);
    return request;
  }

  function go(href, push) {
    const url = new URL(href, window.location.href);

    if (!supported || !isInternal(url) || !isDocument(url)) {
      window.location.href = url.href;
      return;
    }

    const ticket = ++token;
    document.documentElement.classList.add('is-navigating');

    /* Whatever started the navigation, the explorer has done its job. */
    if (window.jQuery) window.jQuery('.panel.active').trigger('---hide');

    fetchPage(url.href).then(html => {
      if (ticket !== token) return;
      document.documentElement.classList.remove('is-navigating');
      render(html, url, push !== false);
    }).catch(error => {
      pages.delete(url.href);
      console.error(error);
      window.location.href = url.href;
    });
  }

  function onClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const link = event.target.closest('a[href]');
    if (!link) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;
    if (link.classList.contains('image')) return;
    if (link.closest('.poptrox-popup')) return;
    /* Changing language changes the whole document -- the header, the panels,
       the words the scripts speak -- and the ?lang= it carries has to be seen
       by the script in <head>. So it gets an ordinary navigation. */
    if (link.hasAttribute('data-locale-switch')) return;

    const href = link.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^[a-z]+:/i.test(href) && !/^https?:/i.test(href)) {
      return;
    }

    const url = new URL(href, window.location.href);
    if (!isInternal(url) || !isDocument(url)) return;

    event.preventDefault();
    if (url.href === window.location.href) return;

    go(url.href, true);
  }

  if (supported) {
    /* Capture: the panels stop clicks from reaching the document. */
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', () => go(window.location.href, false));
    /* The page we started on is already loaded. */
    window.history.replaceState({ soft: true }, '', window.location.href);
  }

  return { go, supported };
})();
