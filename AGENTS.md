# Working on this repository

A Jekyll photo album. Read this before changing anything; `README.md` is the
task-oriented guide, this is the contract.

## The one idea

**The photographs are the source of truth.** Which galleries exist, which
countries are lit on the globe, which provinces are lit on the China map, every
count, and most of a postcard are derived at build time from the file names in
`images/fulls`. There is no list of galleries, countries or airports to keep in
step, and adding one would be a regression.

If you are about to write a list of places, gallery pages, or counts into a
data file: stop. Derive it in `_plugins/atlas.rb` instead.

The same idea covers the two languages. The site is built once per locale from
the same photographs, so there is no second set of pages to keep in step --
only words. Interface text is in `_data/i18n/<locale>.yml`, place names in
`_reference/*.<locale>.csv`, and a story's language is in its file name.

## Invariants

Breaking any of these breaks the site quietly, which is worse than loudly.

1. **A photograph is `images/fulls/<prefix>-<timestamp>.<ext>`**, and the same
   name exists in `images/thumbs` and `images/small`. The prefix may contain
   hyphens; the last hyphen-separated part is always the timestamp.
2. **A gallery holds its own photographs and everything filed beneath it.**
   `/cn` contains `cn-*` and `cn-zj-*`; `/cn-zj` contains only `cn-zj-*`.
3. **Airports are a separate axis.** `pek-*` belongs to `/pek` alone, never to
   `/cn` or `/cn-bj`. This was an explicit decision, not an oversight.
4. **Nothing in `assets/` is written by hand** except the two geojson files.
   `main.min.css` and `site.min.js` are built; `atlas.json` and
   `postcards.json` are generated during the Jekyll build.
5. **Anything not served lives in a directory starting with an underscore.**
   That is the whole exclusion rule. Do not add an `exclude:` list to
   `_config.yml` -- setting the key would also discard Jekyll's own defaults.
   `_plugins/build.rb` appends the few top-level files that cannot move.
6. **`exclude` patterns match at every level.** `*.md` would swallow
   `_stories/*.md` and silently empty the journal. It has done exactly that
   once already.
7. **The site loads exactly two files**: `assets/css/main.min.css` and
   `assets/js/site.min.js`. Adding a `<link>` or `<script>` to a layout is
   almost always the wrong fix -- add the source to `_sass` or `_js` instead,
   and to the list in `_tools/bundle.js` if it is a new script.
8. **No English in a template, a script or a stylesheet.** Every word a reader
   sees comes from `_data/i18n/<locale>.yml`: templates read
   `site.data.i18n[locale]`, scripts read `window.SiteText`, and the one string
   in CSS arrives through `attr(data-print-notice)` on the body. A literal in
   the markup is a string that can never be translated.
9. **English is the default and lives at the root.** `/cn` is English and
   `/zh/cn` is Chinese, so every URL that is already published keeps working.
   Adding a prefix to the default locale would break all of them.

## Where things are

    _plugins/atlas.rb     galleries, index, stories, atlas.json, postcards.json
    _plugins/i18n.rb      the locales, the story pairing, the language switch
    _plugins/exif.rb      capture date and camera, parsed from the JPEG
    _plugins/minify.rb    HTML minification on the way out
    _plugins/build.rb     what stays out of the built site
    _reference/           country and airport tables (public domain, generated)
    _reference/*.zh.csv   the same places in Chinese, with pinyin for searching
    _data/i18n/           interface text, one file per locale, same keys
    _data/postcards.yml   the only hand-written list in the repository
    _js/                  site scripts + vendor; bundled into site.min.js
    _sass/                styles; built into main.min.css
    _tools/               images.js (sizes, ingest), bundle.js (scripts)
    assets/               only what is served
    images/               fulls 2048px, thumbs 1024px, small 640px, postcards

## After changing anything

```bash
npm run build          # required: the site serves only the built files
bundle exec jekyll build
```

The pre-commit hook does both and refuses the commit if the build fails. It is
installed by `npm install`. Do not commit around it with `--no-verify` unless
the failure is understood.

## Things that will bite you

- **Jekyll caches plugins per process.** `jekyll serve` loads `_plugins` once
  at startup; editing a plugin while the server runs has no effect and the
  watcher will keep overwriting `_site` with output from the old code. Restart
  the server after touching `_plugins`.
- **Kill stray servers.** On Windows `pkill` does not exist; stale
  `jekyll serve` processes race to rewrite `_site` and produce output that
  matches no version of the source. Use
  `Get-CimInstance Win32_Process -Filter "Name like '%ruby%'"` and
  `Stop-Process`.
- **`site.exclude`, not `site.config['exclude']`.** Jekyll reads the config key
  once at configure time; mutating the config hash afterwards does nothing.
- **The `hidden` attribute loses to `display`.** Several controls are
  `display: flex`, so `element.hidden = true` leaves them on screen unless the
  stylesheet also says `[hidden] { display: none }`.
- **Poptrox closes the lightbox on any click it receives.** Anything
  interactive added inside a popup must call `stopPropagation`.
- **`user-scalable=no` does not stop pinch-zoom.** iOS Safari has ignored it
  since iOS 10, and a trackpad pinch on Windows arrives as ctrl+wheel. See
  `_js/zoom.js` for what actually works.
- **Soft navigation replaces `#main` and nothing else.** Anything outside it
  that describes *this page* rather than the site has to be updated by hand in
  `retarget()` in `_js/navigate.js`. The language switch was pointing at
  whichever page the reader first arrived on for exactly this reason.
- **Liquid cannot filter inside `[ ]`.** `site.data.i18n[page.locale | default:
  x]` is a syntax error; assign the locale first, then index with it.
- **A brace inside a quoted string breaks `{{ ... }}`.** Liquid's output
  scanner looks for the closing braces and finds them early, so
  `replace: '{place}'` has to happen in an `assign` tag, not inline. Tags and
  outputs inside a `{% comment %}` block are still parsed, so a comment cannot
  contain example Liquid either.
- **A locale is a whole tree, not a flag.** Adding one means every gallery,
  the index, the journal and the JSON are generated again under its prefix.
  `_plugins/i18n.rb` does that from `LOCALES`; nothing else should branch on
  the current language.

## House style

Follow the surrounding code rather than a general preference.

- Comments explain **why**, and are worth writing where a reader would
  otherwise wonder. Do not narrate what the next line does.
- `_js/main.js` is the original template's code: jQuery, `var`, K&R braces.
  New modules (`globe.js`, `postcard.js`, `zoom.js`, `navigate.js`) are plain
  modern JavaScript in an IIFE exposing one global. Match the file you are in.
- Names are spelled out: `photographs`, not `imgs`.
- CSS is alphabetised within a rule, tab-indented, and grouped by component.
