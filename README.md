# Photography

A Jekyll photo album published at <https://pan2013e.github.io/photography/>.

This file is the task guide: adding photographs, filing them, writing
postcards. [AGENTS.md](AGENTS.md) is the architecture contract -- read that
before changing code.

**Photographs are the only thing to maintain.** Gallery pages, the countries on
the globe, the provinces on the China map, the airport cards, the counts and
most of a postcard are all derived from the files in `images/fulls` at build
time by `_plugins/atlas.rb`. There is no list to keep in step.

## Filing a photograph

    images/fulls/<prefix>-<timestamp>.<ext>

The prefix decides where the photograph appears:

| Prefix    | Gallery      | Meaning |
| --------- | ------------ | ------- |
| `cn`      | `/cn`        | ISO 3166-1 alpha-2 country, lowercase |
| `cn-zj`   | `/cn-zj`     | ISO 3166-2:CN region, lowercase |
| `pek`     | `/pek`       | IATA airport code, lowercase |
| `wild`    | `/wildlife`  | a standalone gallery, listed in `EXTRAS` in the plugin |

A gallery holds its own photographs and everything filed beneath it, so
`cn-zj-1699195169374.jpg` appears in both `/cn` and `/cn-zj`. Airports stand on
their own: `pek-*` is in `/pek` only, never in `/cn` or `/cn-bj`.

Any prefix the plugin does not recognise is reported during the build:

    Atlas: photographs with an unknown prefix: xyz

### Adding photographs

```bash
npm run ingest
```

Drop the originals into `images_tmp` named `<prefix>-anything.jpg`, then run the
command above. Each one is renamed `<prefix>-<modified-time>.<ext>` and written
at three sizes -- `images/fulls` (2048 px), `images/thumbs` (1024 px) and
`images/small` (640 px). Commit; nothing else needs touching. `npm run images`
alone backfills missing sizes for photographs that are already in `images/fulls`.

**Only the prefix survives the rename.** The rest of the name -- whatever the
camera, the phone or you called the file -- is dropped, so nothing private ends
up in a published file name. A prefix is the run of short ASCII tags at the
front (`cn`, `cn-sh`, `pek`, `wild`); the first part that is not one of those
ends it. So `cn-sh-我的西藏之旅.jpg` and `cn-sh-DSC01234.JPG` both come out as
`cn-sh-<modified-time>.jpg`. A file with no tag at the front is skipped and
said so.

A panorama is not squeezed into 2048 px. Anything wider than 2:1 is given the
width that leaves it as tall as a 2:1 photograph would be, up to four times the
nominal width -- so a 13:1 frame lands at 8192x608 rather than 2048x152, which
is what the lightbox and the cropped grid cell both need. Photographs already
in `images/fulls` were sized by the old rule; re-ingest the original to get the
new one.

Needs ImageMagick 7 on the PATH.

### Filing a Chinese photograph by province

Insert the ISO 3166-2:CN letters, lowercase, after `cn`, in all three sizes:

```bash
Get-ChildItem images\fulls,images\thumbs,images\small -Filter cn-1731339471080.* | Rename-Item -NewName { $_.Name -replace '^cn-','cn-sh-' }
```

Keep the timestamp. Photographs left as plain `cn-*` still show in `/cn`; they
simply have no province, and the map shows that province unlit. The codes are
the `iso` values in `assets/china-regions.geo.json` -- `cn-bj` Beijing, `cn-sh`
Shanghai, `cn-zj` Zhejiang, `cn-xj` Xinjiang, and so on.

If a renamed photograph has a postcard, update the file name in
`_data/postcards.yml` to match.

## The explorer

The globe icon opens the world; a country with photographs is lit and can be
opened. China carries subdivisions, so choosing it swaps the globe for a flat
map of the 34 ISO 3166-2:CN regions. Escape, or the World button, goes back.
The plane icon lists airports.

Reference data, none of it hand-maintained:

- `_reference/countries.csv` -- ISO 3166-1 names and marker points, from
  [Natural Earth](https://www.naturalearthdata.com/) (public domain).
- `_reference/airports.csv` -- IATA to ICAO, name, country and city, from
  [OurAirports](https://ourairports.com/data/) (public domain).
- `assets/china-regions.geo.json` -- region outlines and marker points, from
  Natural Earth, simplified to about 2 km.

To add a country that has its own regional map, put its geometry in `assets`
and add it to `SUBDIVISIONS` in `_plugins/atlas.rb`.

## Two languages

The album is published twice from the same photographs: English at the root and
Simplified Chinese under `/zh`. So `/cn` is English and `/zh/cn` is Chinese,
and every English URL that is already published still works.

A reader who has never chosen is sent to the language their browser asks for,
before the page paints. Choosing one from the header remembers it and overrides
the browser from then on. An address that already names a language -- anything
under `/zh/` -- is left alone, so a link shared in Chinese stays in Chinese.

### Changing the words

| What | Where |
| ---- | ----- |
| Interface text | `_data/i18n/en.yml`, `_data/i18n/zh.yml` |
| Country names | `_reference/countries.zh.csv` |
| Province names | `_reference/regions.zh.csv` |
| Airport and city names | `_reference/airports.zh.csv` |
| Gallery names like Wildlife | `EXTRAS` in `_plugins/atlas.rb` |

Both locale files carry the same keys. A key missing from `zh.yml` falls back
to the English one, so a half-finished translation still renders -- it just
renders partly in English. Nothing is translated in the browser: each page
arrives already written in its language.

Place names work the same way. A country, province or airport with no row in
the `.zh.csv` table keeps its English name, and the build says which:

    Atlas: no zh name for: cdg, nrt (add a row to _reference/*.zh.csv)

For airports, <https://worldairport.cn/code> is a usable reference.

### Pinyin

The `pinyin` columns hold each name's syllables separated by spaces --
`bei jing`. The build turns that into every spelling a Chinese keyboard
produces, so `beijing`, `bj` and `bei jing` all find 北京. Syllables are written
per name rather than per character on purpose: 重庆 is `chong qing`, and 秘鲁 is
`bi lu`, which no character table gets right.

Pinyin exists only in the `.zh.csv` tables, so it never reaches the English
edition and cannot match there.

### Adding a language

Add it to `LOCALES` in `_plugins/i18n.rb`, copy `_data/i18n/en.yml` to its
code, and translate what you like. Everything else -- galleries, the index, the
journal, the JSON the explorer reads, the language switch, hreflang -- follows
from that.

## Postcards

A photograph listed in `_data/postcards.yml` gets an envelope mark on its
thumbnail and a flip button in the lightbox that turns it over. The file name
alone is enough:

```yaml
- cn-sh-1731339471080.jpg
```

The back is a postcard -- A6, 148 by 105 mm, laid out the way China Post lays
one out. Six red boxes for the recipient's postcode across the top, the stamp
at the right of them, the message and the drawing down the left of the divider,
the address down the right, and the sender's lines under a gap below it.

The card fills itself in: the place from where the photograph is filed, the
date from its EXIF, the drawing from `images/postcards/`, and the colour
swatches sampled from the photograph in the browser. Whatever cannot be worked
out is left off rather than printed blank. The one thing worth writing by hand
is `note:` -- a sentence printed on the message side. Every field is documented
at the top of `_data/postcards.yml`, at length, so that file can be handed to
someone (or something) with no other context.

### Drawings

A drawing is found by the photograph's own name: `images/postcards/` plus the
photograph's file name with a picture extension, so
`cn-sh-1731339471080.jpg` finds `cn-sh-1731339471080.png`. Nothing has to be
written down. `illustration:` names a different file, and `illustration: ""`
leaves the card without one.

Drawings are not resized by `npm run images`. Export them at about 1200 px on
the long edge, transparent PNG or SVG. The card is laid out around whatever
shape the drawing is -- it is never cropped or stretched -- so a squarer
drawing simply takes more of the column and leaves fewer lines to write on.

### Saving one to print

The card has a second button, which writes it out as a PDF at A6 and downloads
it. Everything happens in the reader's browser; there is no service behind it.

Printed text is written as outlines taken from the font's own glyphs, so the
card cannot be edited and does not depend on the printer having the face. The
postcode, the date, the address and the message are real form fields with the
same face embedded, so a card can be addressed on screen and then printed. The
date starts at today and is formatted through `postcard_date_format` in
`_data/i18n/<locale>.yml`, which is also the mask a reader such as Acrobat uses
to offer its date picker.

Chinese has no font small enough to embed, so a line the Latin face cannot set
is drawn by the browser at print resolution and placed as a picture. It is
still not text anyone can edit. Typing into the form fields is Latin only.

The card is set in EB Garamond (SIL Open Font License 1.1; the licence is in
`assets/fonts/`). The page loads the Latin cut as woff2; the `.ttf` beside it
is fetched only when someone asks for a PDF.

## Layout

    _data/postcards.yml   the only hand-written list
    _data/i18n/           interface text, one file per language
    _plugins/atlas.rb     galleries, index, stories, atlas.json, postcards.json
    _plugins/i18n.rb      the languages, and how a story finds its translation
    _plugins/exif.rb      capture date and camera, read from the JPEG
    _js/postcard.js       the postcard: one layout, drawn as SVG and as PDF
    _js/pdf.js            a PDF writer, and enough TrueType to draw with
    _plugins/minify.rb    HTML minification
    _plugins/build.rb     what stays out of the built site
    _reference/           country and airport tables, English and Chinese
    _includes/            header, footer, photo grid, story pieces
    _layouts/             default, gallery, story, stories
    _stories/             photo stories (see STORIES.md)
    _sass/                styles; build with npm run css
    _js/                  scripts; bundle with npm run js
    _tools/               images.js, bundle.js
    assets/               only what is served: main.min.css, site.min.js, data
    images/               fulls, thumbs, small, postcards

Anything not served lives in a directory starting with an underscore, which
Jekyll ignores; that is the whole exclusion rule, and it is why `_config.yml`
carries no list of files to keep out.

There is no `galleries/`, `index.html` or `stories.html`: those pages are
generated in memory during the build.

## Building

```bash
bundle install
npm install
npm run build          # assets/css/main.min.css and assets/js/site.min.js
bundle exec jekyll serve
```

The site loads exactly two built files, so `npm run build` has to run after any
change in `_sass` or `_js`. `npm run watch` rebuilds the CSS as you edit, and
the pre-commit hook rebuilds and stages both files for you, then refuses the
commit if the site does not build. `npm install` installs the hook
(`git config core.hooksPath .githooks`); `git commit --no-verify` skips it.

Set `minify: false` in `_config.yml` to read the generated HTML.

### Deployment

GitHub Actions builds and deploys on every push to `main`
(`.github/workflows/pages.yml`). This is not optional: the site uses Jekyll
plugins, and the GitHub Pages service does not run them, so a branch build
would publish a site with no galleries and no index.

The workflow sets that up itself -- `actions/configure-pages` switches the
Pages source to GitHub Actions -- so there is nothing to click. If the site
ever comes back empty, check Settings → Pages → Build and deployment → Source
still reads **GitHub Actions**.

## Copy protection

Printing produces a copyright notice rather than the photographs, images cannot
be dragged out or saved through the context menu, and page text is not
selectable (`_sass/components/_protect.scss`, plus the handlers in
`_js/main.js`).

Screenshots cannot be blocked. They are taken by the operating system, the page
never sees them, and there is no DRM for images on the web -- Encrypted Media
Extensions covers audio and video streams only.

## Zooming

The page itself is pinned (`user-scalable=no`), because pinching a grid of
thumbnails is never what anyone wants. The photograph in the lightbox has its
own zoom instead (`_js/zoom.js`): pinch or double-tap on a phone, double-click
or ctrl-scroll on a desktop, drag to pan. Once it is magnified a plain scroll
moves the photograph rather than zooming it further, and it is cropped by the
lightbox instead of spilling over the page.

Clicking or tapping the photograph does not close the lightbox -- it cannot,
or the first click of a double-click would shut it before the second arrived.
Close with the cross, which is on screen at every width for that reason, with
Escape, or by clicking the surround.

A finger gets the same gestures and one more: sideways across a photograph at
rest asks for the next one, the way the arrows do. The pair of taps is
recognised from the taps themselves rather than waited for as a `dblclick`,
because Safari has been known not to send one on a page that refuses to be
zoomed.

A sideways swipe on a trackpad is how you pan, and Chrome reads the same
gesture on a page that cannot scroll sideways as "go back". `html, body` in
`_sass/base/_page.scss` refuse the overscroll so the gesture stays where it was
aimed.

A photograph wider than 2.5:1 is read differently, because fitting one to the
screen leaves a ribbon an inch tall. It gets a button that changes between the
whole photograph and a close view of it; in the close view the frame scrolls,
by dragging or by the wheel, and a double-click changes between the two. The
button only appears when there is more to see than the fitted view is already
showing.

On a screen taller than it is wide -- a phone held upright -- both views turn
the panorama a quarter turn, so that it runs down the long side of the screen
rather than across the short one: whole, it is fitted to the height; close up,
its short edge fits across and its length is read by scrolling down. Turning
the phone turns it back. The rule is the two shapes and not the machine -- a
panorama turns when it comes out markedly bigger that way round.

A panorama does not zoom at all: fitted, it is showing everything it has, and
close up it is magnified already. Pinch and ctrl-scroll are still refused over
it, so the gesture does not fall through and zoom the page.

The popup's own buttons -- the postcard's, the panorama's and the one that
saves a card -- share a rail of two slots, so that one alone takes the first
and no two ever land on each other. Only two are ever on screen: the panorama's
button is put away while the card is showing, which is the only time the card's
own is there. Where the slots are is decided once, in
`_sass/components/_postcard.scss`: under the closer on a full-size photograph,
beside it on a phone, and in a row above the picture when the picture is a
ribbon with no room inside it. The card keeps clear of the rail rather than
sitting under it -- the face reserves the lane as padding, and the card is
fitted to what is left.

## The edges of the screen

The photographs reach them. `viewport-fit=cover` in `_includes/header.html`
takes the page out of the letterbox a notched phone would otherwise put it in
and lets it run under the browser's own floating address bar, which is what
gives that bar something to be glass over. `theme-color` is the colour of the
bar of icons, so the status bar above it is not a black stripe over a grey one.

Only the bar of icons keeps clear of the insets, in `_sass/layout/_header.scss`
-- `env(safe-area-inset-*)`, which is zero on every screen that has no notch,
no rounded corners and no home indicator, so nothing moves anywhere else.

A sideways swipe on a trackpad is how you pan a photograph, and Chrome reads
the same gesture on a page that cannot scroll sideways as "go back".
`overscroll-behavior-x: none` on `html, body` refuses the overscroll so the
gesture stays where it was aimed.
