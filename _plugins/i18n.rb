# frozen_string_literal: true

# Two languages, one album.
#
# English is built at the root and Simplified Chinese under /zh, as two
# complete trees: every gallery, the index, the stories index and the JSON the
# explorer reads exist once per locale. Nothing is translated in the browser,
# so a page arrives already written in its language -- no flash of English, and
# no second request to fetch the words.
#
# What a locale is made of:
#
#   _data/i18n/<code>.yml       the interface text; every file has the same keys
#   _reference/*.<code>.csv     place names, where they differ from English
#   _stories/<code>/*.md        translated stories -- optional, see below
#
# A missing translation is never an error. An untranslated place keeps its
# English name, and a story with no translation is listed in every language
# with the text it has. The build says what is missing so it can be filled in.
#
# The browser chooses a locale in _includes/header.html, before the page
# paints; this file only decides what exists and where it lives.
module I18n
  # The first entry is the default, and it is the one served from the root, so
  # every English URL that is already out in the world keeps working.
  # `prefix` goes in front of a permalink, `asset_dir` in front of a file name
  # under assets/. Both are empty for the default locale, which is what keeps
  # the English URLs unchanged.
  LOCALES = [
    { 'code' => 'en', 'lang' => 'en', 'prefix' => '', 'asset_dir' => '',
      'label' => 'English', 'short' => 'EN' },
    { 'code' => 'zh', 'lang' => 'zh-Hans', 'prefix' => '/zh', 'asset_dir' => 'zh/',
      'label' => '简体中文', 'short' => '中文' }
  ].freeze

  DEFAULT = LOCALES.first['code']

  class << self
    def codes
      LOCALES.map { |locale| locale['code'] }
    end

    def find(code)
      LOCALES.find { |locale| locale['code'] == code } || LOCALES.first
    end

    def default?(code)
      code == DEFAULT
    end

    # "/cn" becomes "/zh/cn". The root keeps its trailing slash, because
    # "/zh" and "/zh/" are different pages to a static host.
    def path(code, permalink)
      prefix = find(code)['prefix']
      return permalink if prefix.empty?

      permalink == '/' ? "#{prefix}/" : "#{prefix}#{permalink}"
    end

    # "assets/atlas.json" becomes "assets/zh/atlas.json".
    def asset(code, path)
      return path if default?(code)

      File.join(File.dirname(path), code, File.basename(path))
    end

    # The same permalink in every language, for the language switch and for
    # the hreflang links.
    def alternates(permalink)
      codes.each_with_object({}) { |code, all| all[code] = path(code, permalink) }
    end

    def strings(site, code)
      (site.data['i18n'] || {})[code] || {}
    end

    def deep_merge(base, overlay)
      base.merge(overlay) do |_key, from_base, from_overlay|
        if from_base.is_a?(Hash) && from_overlay.is_a?(Hash)
          deep_merge(from_base, from_overlay)
        else
          from_overlay.nil? ? from_base : from_overlay
        end
      end
    end

    # One value per locale, written inline where a name is short enough that a
    # whole reference file would be silly:  { 'en' => 'Wildlife', ... }
    def pick(value, code)
      return value unless value.is_a?(Hash)

      value[code] || value[DEFAULT]
    end
  end
end

# Liquid needs the locale table too -- for the switch in the header, and for
# the hreflang links. `site.locales` is the same list as LOCALES above.
Jekyll::Hooks.register :site, :after_init do |site|
  site.config['locales'] = I18n::LOCALES
  site.config['default_locale'] = I18n::DEFAULT
end

# Every locale is laid over the default one, so that a key nobody has
# translated yet reads in English rather than reading as blank. Templates can
# then use site.data.i18n[locale].whatever without a fallback at every turn.
Jekyll::Hooks.register :site, :post_read do |site|
  data = site.data['i18n'] || {}
  base = data[I18n::DEFAULT] || {}

  I18n.codes.each do |code|
    next if code == I18n::DEFAULT

    data[code] = I18n.deep_merge(base, data[code] || {})
  end

  site.data['i18n'] = data
end

module Jekyll
  # A story's language is in its file name:
  #
  #   _stories/beijing-in-two-lights_en.md    the English telling
  #   _stories/beijing-in-two-lights_zh.md    the Chinese one
  #   _stories/a-walk-in-lisbon.md            no suffix: serves every language
  #
  # The part before the suffix pairs the tellings up. Nothing has to be
  # declared in the front matter.
  Hooks.register :documents, :post_init do |document|
    next unless document.collection&.label == 'stories'

    name = File.basename(document.relative_path, '.*')
    match = name.match(/\A(?<key>.+)_(?<code>#{I18n.codes.join('|')})\z/)
    key = match ? match[:key] : name

    document.data['translation_key'] ||= key
    # No suffix means the story stands for every language; it is written once
    # and the pages around it change.
    document.data['locale'] ||= match ? match[:code] : nil
    document.data['permalink'] ||= I18n.path(match ? match[:code] : I18n::DEFAULT,
                                             "/story-#{key}")
  end

  # A story told in one language is still a story in the others.
  #
  # Where a language has no telling of its own, the one that exists is
  # published again under that language's prefix, so /zh/story-x is a real page
  # with Chinese navigation around it rather than a dead link or a jump into
  # the English site. The words are the words that were written; only the
  # furniture changes.
  class StoryTranslations < Generator
    safe true
    priority :low

    def generate(site)
      documents = site.collections['stories']&.docs || []
      journal = I18n.codes.each_with_object({}) { |code, all| all[code] = [] }

      documents.group_by { |document| document.data['translation_key'] }.each do |key, tellings|
        told_in = tellings.each_with_object({}) do |telling, all|
          all[telling.data['locale']] = telling if telling.data['locale']
        end
        # What stands in where a language has no telling of its own: the
        # unsuffixed file if there is one, else the only telling there is, else
        # the default language's.
        generic = tellings.find { |telling| telling.data['locale'].nil? } ||
                  (tellings.length == 1 ? tellings.first : told_in[I18n::DEFAULT]) ||
                  tellings.first

        # Where each language's telling will be found. A mirror lands exactly
        # on the permalink the hook would have given it, so this holds before
        # the mirrors are made.
        urls = I18n.codes.each_with_object({}) do |code, all|
          all[code] = told_in[code] ? told_in[code].url : I18n.path(code, "/story-#{key}")
        end

        tellings.each { |telling| telling.data['alternates'] = urls }

        I18n.codes.each do |code|
          source = told_in[code]

          unless source
            source = generic
            # The unsuffixed file already occupies the default language's
            # permalink; every other language needs a page of its own.
            site.pages << mirrored(site, generic, code, key, urls) unless
              generic.data['locale'].nil? && I18n.default?(code)
          end

          journal[code] << entry(source, code, urls[code])
        end
      end

      site.data['journal'] = journal.transform_values do |entries|
        entries.reject { |item| item['published'] == false }
               .sort_by { |item| item['date'] || Time.at(0) }
               .reverse
      end
    end

    private

    def mirrored(site, source, code, key, urls)
      page = PageWithoutAFile.new(site, site.source, code, "#{key}.md")
      page.content = source.content
      page.data = source.data.merge(
        'locale' => code,
        'permalink' => I18n.path(code, "/story-#{key}"),
        'alternates' => urls,
        # A story written without a suffix belongs to every language, so it is
        # never marked as standing in for a missing translation.
        'told_in' => source.data['locale'] || code
      )
      page
    end

    # The journal index reads these rather than the documents, because a story
    # can appear in a language it was not written in and the listing has to
    # know both facts.
    def entry(source, code, url)
      told_in = source.data['locale'] || code

      source.data
            .slice('title', 'description', 'date', 'date_label', 'dates',
                   'location', 'hero', 'published')
            .merge('url' => url, 'locale' => code, 'told_in' => told_in)
    end
  end
end
