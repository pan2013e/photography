# Writing photo stories

Story files live in `_stories`. Jekyll publishes each file at
`/story-<filename>` and lists every published story at `/stories`. On GitHub
Pages those routes automatically sit below `/photography`; do not add
`/photography` to paths inside a story.

## 1. Create the story file

Use a short lowercase filename with hyphens:

```text
_stories/night-trains-in-japan.md
```

Start with front matter:

```yaml
---
title: Night Trains in Japan
eyebrow: Rail journal
description: A short summary shown on the stories index.
date: 2026-07-28
dates:
  - start: 2026-07-12
    end: 2026-07-14
  - label: Return journey, July 2026
    start: 2026-07-22
location: Tokyo to Sapporo, Japan
published: true
hero:
  file: jp-existing-photo.jpg
  alt: Sleeper train waiting beside a platform at night
  position: center 40%
  caption: The northbound train before departure.
---
```

Essential fields:

- `title` is the page title.
- `description` appears below the title and on the stories index.
- `date` controls the story’s order on the index. Keep one sortable date even
  when the photographs cover several dates.
- `dates` controls the dates displayed to readers. It can contain any number of
  single dates, ranges, or custom labels.
- `date_label` optionally replaces the detailed public date display with a
  compact label such as `November 2024`. The sortable `date` and any detailed
  `dates` can remain in the file.
- `location` is optional.
- `eyebrow` is the small label above the title. It defaults to “Field notes.”
- `published: false` removes a draft from normal builds and the public index.
  Preview drafts locally with Jekyll’s `--unpublished` option.
- `hero` supplies the introductory photograph and the stories-index thumbnail.

### Displaying dates

A single date:

```yaml
dates:
  - start: 2026-07-12
```

A date range:

```yaml
dates:
  - start: 2026-07-12
    end: 2026-07-14
```

Several visits or ranges:

```yaml
dates:
  - start: 2025-11-08
  - start: 2026-02-03
    end: 2026-02-09
```

Use `label` when an exact calendar date is not appropriate:

```yaml
dates:
  - label: Winter 2025
  - label: Spring return
```

If `dates` is omitted, the page displays the sortable `date` as a month and
year.

For a compact display while retaining detailed dates in the source:

```yaml
date: 2024-11-11
date_label: November 2024
dates:
  - start: 2024-11-08
  - start: 2024-11-10
    end: 2024-11-11
```

## 2. Reuse an existing gallery photo

Use `file` when the same filename already exists in both:

```text
images/fulls/
images/thumbs/
```

Example:

```yaml
hero:
  file: cn-1731263397669.jpg
  alt: Olympic Tower illuminated after sunset
  caption: Olympic Tower after sunset.
```

The existing full-size image, thumbnail, lightbox, and EXIF display are reused.
Do not duplicate the files.

## 3. Add a new photo used only by a story

Add the full image and an optimized thumbnail somewhere inside the repository,
then use `src` and `thumb`:

```yaml
hero:
  src: /images/stories/night-trains/hero.jpg
  thumb: /images/stories/night-trains/hero-thumb.jpg
  alt: Sleeper train beside a snowy platform
```

- Paths should begin with `/images/...`, never `/photography/images/...`.
- `thumb` is optional, but strongly recommended so the story does not download
  the full image before it is opened.
- Keep filenames unique.
- Store full-size and thumbnail files together in a clearly named story folder
  if they do not belong to an existing gallery.

## 4. Define photo strips

Photo strips are declared under `photo_sets` in the front matter:

```yaml
photo_sets:
  first_evening:
    eyebrow: Tokyo Station
    title: Before departure
    description: The platform changes as the last commuter trains leave.
    ratio: wide
    photos:
      - file: jp-existing-photo.jpg
        alt: Train conductor beside a carriage
        ratio: portrait
        caption: A final platform check.
      - src: /images/stories/night-trains/platform.jpg
        thumb: /images/stories/night-trains/platform-thumb.jpg
        alt: Empty platform under warm lights
        caption: The platform after the crowd.
        credit: Zhiyuan Pan
      - file: jp-second-photo.jpg
        alt: Carriage window reflecting station lights
        position: center 30%
      - type: video
        src: /videos/stories/night-trains/departure.mp4
        poster: /images/stories/night-trains/departure-poster.jpg
        mime_type: video/mp4
        ratio: landscape
        alt: Train leaving the platform at night
        caption: Departure.
```

Photo-set fields:

- `title` is the visible strip heading.
- `eyebrow` and `description` are optional.
- `ratio` can be `wide` (default), `square`, or `portrait`.
- `photos` is the ordered media list. Photographs join the strip’s zoom
  sequence; videos remain playable inline.

Photo fields:

- Use either `file` for an existing gallery photo or `src` for a new photo.
- `thumb` is the preview for a new photo.
- `alt` describes the photograph for screen readers and is strongly required.
- `caption` appears below the photograph.
- `credit` appears beside the caption.
- `ratio` can be `landscape`, `square`, or `portrait` for an individual photo.
  Orientation is detected automatically when this is omitted, but declaring it
  avoids a small layout adjustment while a portrait thumbnail loads.
- `position` controls thumbnail cropping with a CSS background-position value,
  such as `center 25%`, `left center`, or `70% 40%`. It does not crop the
  full-size zoomed image.

For a video inside a strip, set `type: video` and use the video fields described
below. Videos play inline with native controls. Photo lightbox navigation stays
photo-only and never opens or skips into a video player.

## 5. Place strips among the writing

Write ordinary Markdown below the front matter. Insert a strip wherever it
belongs in the narrative:

```liquid
The station became quieter as midnight approached.

{% include photo-strip.html id="first-evening" set=page.photo_sets.first_evening %}

Inside the carriage, the city lights gave way to darkness.
```

- The `id` must be unique on that story page.
- The name after `page.photo_sets.` must exactly match the key declared in the
  front matter.
- A story can contain any number of strips, and prose can appear before,
  between, or after them.
- Standard Markdown headings, paragraphs, emphasis, links, lists, and
  blockquotes can be used normally.

## 6. Photo-strip and zoom behavior

- Each strip is one independent zoom sequence. Previous and next navigation
  stays inside that strip.
- The hero image opens by itself and is not part of a strip.
- Landscape, square, and portrait photos can be mixed in one strip. Portrait
  cards become narrower so their full height remains visible.
- An overflowing strip moves gently on its own. Touching, dragging, scrolling,
  or using the keyboard stops the automatic motion so the reader has control.
- Reduced-motion preferences disable automatic movement.
- The visible green rail shows the strip’s current horizontal position.

Arrange photographs in the intended reading order. Avoid placing the same
image in several strips unless the repetition is deliberate.

## 7. Add videos

Videos are supported only on story pages. They are not added to the country,
airport, wildlife, or UNESCO galleries.

### Standalone video between paragraphs

Declare a named video in the front matter:

```yaml
videos:
  station_departure:
    src: /videos/stories/night-trains/departure.mp4
    poster: /images/stories/night-trains/departure-poster.jpg
    mime_type: video/mp4
    ratio: landscape
    alt: Sleeper train leaving a station at night
    caption: Northbound departure at 11:42 p.m.
```

Insert it anywhere in the Markdown:

```liquid
{% include story-video.html video=page.videos.station_departure %}
```

### Video inside a strip

Add a video item to the strip’s `photos` list:

```yaml
- type: video
  src: /videos/stories/night-trains/window-view.mp4
  poster: /images/stories/night-trains/window-view-poster.jpg
  mime_type: video/mp4
  ratio: portrait
  alt: Lights moving past a train window
  caption: Leaving the city.
```

### Multiple source formats

Use `sources` when both MP4 and WebM files are available:

```yaml
sources:
  - src: /videos/stories/night-trains/departure.webm
    type: video/webm
  - src: /videos/stories/night-trains/departure.mp4
    type: video/mp4
```

Video fields:

- `src` is the local video path. Use `sources` instead when providing several
  encodings.
- `mime_type` identifies a single `src`, usually `video/mp4` or `video/webm`.
- `poster` is strongly recommended and should be an optimized still image.
- `ratio` can be `landscape`, `square`, or `portrait`. It is detected from the
  video automatically when omitted.
- `alt` supplies the player’s accessible label.
- `caption` and `credit` work the same way as they do for photographs.
- `controls` defaults to `true`. Set `controls: false` only for a deliberately
  non-interactive background clip.
- `loop`, `muted`, and `autoplay` accept `true` or `false`. Autoplay is
  automatically muted for browser compatibility and should be used sparingly.
- `preload` defaults to `metadata`; use `none` when a page contains many large
  videos.

Store videos under a clear path such as `/videos/stories/<story-name>/`. Do not
put `/photography` in the path. MP4 encoded with H.264 has the broadest browser
support; WebM is useful as an additional source. The website does not transcode
video files, so prepare web-friendly files before adding them.

Playing a strip video stops that strip’s automatic movement. Videos remain
inline and are not included in the photo lightbox sequence.

## 8. Writing useful captions and alt text

- `alt` should describe what is visible without repeating “photo of.”
- `caption` can add place, sequence, or narrative context that is not obvious
  from the image.
- Keep captions concise; longer explanations belong in the surrounding prose.
- Do not use filenames as captions or alt text.

## 9. Preview before publishing

Run the local Jekyll preview:

```text
jekyll serve --unpublished
```

Then open:

```text
http://127.0.0.1:4000/photography/stories
```

Check that:

- the story appears in the intended order;
- every full image and thumbnail loads;
- every video loads, shows its poster, plays with sound/control behavior as
  intended, and has a web-compatible encoding;
- reused filenames exist in both gallery image folders;
- each strip appears at the correct point in the writing;
- previous and next navigation stays within the opened strip;
- portrait, square, and wide images crop as intended;
- dates, ranges, captions, alt text, and credits are correct;
- the page remains readable on a narrow screen.

Keep `published: false` while drafting and preview with `--unpublished`. Remove
it or change it to `true` when the story is ready.
