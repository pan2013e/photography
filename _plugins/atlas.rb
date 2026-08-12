# frozen_string_literal: true

# The atlas.
#
# Everything about which galleries exist is derived from the photographs in
# images/fulls. A file is named <prefix>-<timestamp>.<ext>, and the prefix says
# where it belongs:
#
#   cn-1699195169374.jpg      country     ISO 3166-1 alpha-2
#   cn-zj-1699195169374.jpg   region      ISO 3166-2:CN
#   pek-1730996960312.jpg     airport     IATA
#   wild-1700047778991.jpg    standalone  see EXTRAS
#
# Names, codes and marker points come from the reference tables in _reference
# and from assets/china-regions.geo.json. Nothing here is hand-maintained: add
# a photograph, and its gallery, its place on the globe and its counts appear.
#
# All of it is built once per locale (see _plugins/i18n.rb), so this generator
# produces, in memory:
#
#   /cn, /cn-zj, /pek, /wildlife ...  one gallery page per prefix with photos
#   /zh/cn, /zh/cn-zj ...             the same, in Simplified Chinese
#   /assets/atlas.json                places and counts, read by the explorer
#   /assets/zh/atlas.json             the same, with the names translated
#   /assets/postcards.json            postcards, with defaults filled in
#   /assets/zh/postcards.json
#
# A place with no translation keeps its English name, and the build says which
# ones those are.
#
module Atlas
  ROOT = File.expand_path('..', __dir__)
  REFERENCE = File.join(ROOT, '_reference')
  REGIONS_GEOJSON = File.join(ROOT, 'assets', 'china-regions.geo.json')

  # Prefixes that are not a place. Their names are written here rather than in
  # a reference table because there is one of them.
  EXTRAS = [
    {
      'code' => 'wild',
      'permalink' => '/wildlife',
      'name' => { 'en' => 'Wildlife', 'zh' => '野生动物' }
    }
  ].freeze

  # The globe draws a few places that are not ISO countries, so they have no
  # row in the reference tables and can never hold a gallery. They still need a
  # name when the centre line passes over them.
  UNLISTED = {
    'French Guiana' => { 'zh' => '法属圭亚那' },
    'Northern Cyprus' => { 'zh' => '北塞浦路斯' },
    'Somaliland' => { 'zh' => '索马里兰' },
    'West Bank' => { 'zh' => '约旦河西岸' }
  }.freeze

  # Countries whose photographs can be filed by subdivision. `noun` is printed
  # as given -- Chinese has no upper case to shout in.
  SUBDIVISIONS = {
    'cn' => {
      'key' => 'cn',
      'noun' => { 'en' => 'REGIONS', 'zh' => '省级行政区' },
      'search' => { 'en' => 'Find a province', 'zh' => '搜索省级行政区' }
    }
  }.freeze

  class << self
    def photographs(site)
      site.static_files.select { |file| file.relative_path.include?('/images/fulls/') }
    end

    # "cn-zj-1699195169374.jpg" -> "cn-zj"
    def prefix_of(name)
      parts = name.split('-')
      return nil if parts.length < 2

      parts[0..-2].join('-').downcase
    end

    def counts(site)
      tally = Hash.new(0)
      photographs(site).each do |file|
        prefix = prefix_of(File.basename(file.name))
        tally[prefix] += 1 if prefix
      end
      tally
    end

    # A gallery holds its own photographs and everything filed beneath it, so
    # /cn covers cn-zj-*. Airports stand alone.
    def total_for(tally, code)
      tally.sum { |prefix, count| prefix == code || prefix.start_with?("#{code}-") ? count : 0 }
    end

    def read_csv(name)
      path = File.join(REFERENCE, name)
      return [] unless File.exist?(path)

      require 'csv'
      # `#` starts a comment, so a table can explain itself to whoever edits it.
      CSV.read(path, headers: true, skip_lines: /\A#/).map(&:to_h)
    end

    # _reference/countries.zh.csv and friends. The default locale is the tables
    # themselves, so it has nothing to overlay.
    def overlay(kind, locale)
      @overlay ||= {}
      @overlay[[kind, locale]] ||=
        if I18n.default?(locale)
          {}
        else
          key = kind == 'regions' ? 'iso' : (kind == 'airports' ? 'iata' : 'code')
          read_csv("#{kind}.#{locale}.csv").each_with_object({}) do |row, all|
            all[row[key].to_s.downcase] = row
          end
        end
    end

    def base_countries
      @base_countries ||= read_csv('countries.csv').each_with_object({}) do |row, all|
        all[row['code'].downcase] = {
          'name' => row['name'],
          'lat' => row['lat'].to_f,
          'lon' => row['lon'].to_f
        }
      end
    end

    def base_airports
      @base_airports ||= read_csv('airports.csv').each_with_object({}) do |row, all|
        all[row['iata'].downcase] = {
          'iata' => row['iata'],
          'icao' => row['icao'],
          'name' => row['name'],
          'country' => row['country'].downcase,
          'municipality' => row['municipality'],
          'lat' => row['lat'].to_f,
          'lon' => row['lon'].to_f,
          'elevation' => row['elevation'].to_i
        }
      end
    end

    def base_regions
      @base_regions ||= begin
        require 'json'
        if File.exist?(REGIONS_GEOJSON)
          JSON.parse(File.read(REGIONS_GEOJSON))['features'].each_with_object({}) do |feature, all|
            properties = feature['properties']
            all[properties['iso'].downcase] = {
              'iso' => properties['iso'],
              'name' => properties['name'],
              'type' => properties['type'],
              'lat' => properties['lat'],
              'lon' => properties['lon']
            }
          end
        else
          {}
        end
      end
    end

    def countries(locale = I18n::DEFAULT)
      translated('countries', locale, base_countries) do |row, translation|
        row.merge('name' => translation['name'],
                  'pinyin' => pinyin_terms(translation['pinyin']))
      end
    end

    def airports(locale = I18n::DEFAULT)
      translated('airports', locale, base_airports) do |row, translation|
        row.merge(
          'name' => translation['name'] || row['name'],
          'municipality' => translation['municipality'] || row['municipality'],
          'pinyin' => pinyin_terms(translation['pinyin'], translation['city_pinyin'])
        )
      end
    end

    def regions(locale = I18n::DEFAULT)
      translated('regions', locale, base_regions) do |row, translation|
        row.merge('name' => translation['name'],
                  'pinyin' => pinyin_terms(translation['pinyin']))
      end
    end

    # Must agree with normalizedName in _js/globe.js: that is what turns a name
    # on the map into a key in the table below.
    def normalized_name(name)
      name.to_s.downcase.gsub('&', 'and').gsub(/[^[:alnum:]]+/, ' ').strip
    end

    # Every country the globe can draw, by its English name, translated.
    #
    # Only the countries that hold a gallery are places you can open, and they
    # carry their own translated name. But the centre line passes over all of
    # them, and reading "India" on a Chinese page is the sort of seam this
    # whole arrangement exists to avoid.
    def map_names(locale)
      return {} if I18n.default?(locale)

      names = base_countries.each_with_object({}) do |(code, row), all|
        translated = countries(locale)[code]['name']
        all[normalized_name(row['name'])] = translated unless translated == row['name']
      end

      UNLISTED.each_with_object(names) do |(english, telling), all|
        name = I18n.pick(telling, locale)
        all[normalized_name(english)] = name if name && name != english
      end
    end

    # A name typed on a Chinese keyboard arrives in one of three shapes, so all
    # three go into the haystack:
    #
    #   "an hui"  ->  "anhui ah an hui"
    #
    # the run-together spelling, the initials, and the syllables as written.
    def pinyin_terms(*spellings)
      terms = spellings.compact.flat_map do |spelling|
        syllables = spelling.to_s.split
        next [] if syllables.empty?

        [syllables.join, syllables.map { |syllable| syllable[0] }.join, syllables.join(' ')]
      end

      terms.uniq.join(' ') unless terms.empty?
    end

    def translated(kind, locale, base)
      @translated ||= {}
      @translated[[kind, locale]] ||= begin
        names = overlay(kind, locale)
        base.each_with_object({}) do |(code, row), all|
          translation = names[code]
          all[code] = translation ? yield(row, translation) : row
        end
      end
    end

    def extra_for(code)
      EXTRAS.find { |extra| extra['code'] == code }
    end

    # OurAirports writes the borough in brackets: "Manila (Pasay)".
    def city_name(municipality)
      return nil if municipality.nil? || municipality.empty?

      municipality.sub(/\s*\(.*\)\s*\z/, '').strip
    end

    # Where a prefix belongs, and what to call it in this language.
    def describe(code, locale = I18n::DEFAULT)
      if (extra = extra_for(code))
        { 'kind' => 'extra', 'name' => I18n.pick(extra['name'], locale),
          'permalink' => extra['permalink'] }
      elsif (region = regions(locale)[code])
        { 'kind' => 'region', 'name' => region['name'], 'iso' => region['iso'],
          'type' => region['type'], 'permalink' => "/#{code}",
          'parent' => countries(locale)[code.split('-').first] }
      elsif (airport = airports(locale)[code])
        { 'kind' => 'airport', 'name' => airport['name'], 'permalink' => "/#{code}",
          'country' => airport['country'], 'municipality' => airport['municipality'] }
      elsif (country = countries(locale)[code])
        { 'kind' => 'country', 'name' => country['name'], 'permalink' => "/#{code}" }
      end
    end

    # Every gallery that should exist: a prefix with photographs, plus the
    # parent of any region (cn-zj implies cn).
    def galleries(site, locale = I18n::DEFAULT)
      tally = counts(site)
      codes = tally.keys.to_set

      tally.each_key do |code|
        parts = code.split('-')
        codes << parts.first if parts.length > 1 && base_regions.key?(code)
      end

      codes.filter_map do |code|
        described = describe(code, locale)
        next unless described

        described.merge('code' => code, 'count' => total_for(tally, code))
      end.sort_by { |gallery| [-gallery['count'], gallery['code']] }
    end

    def unknown_prefixes(site)
      counts(site).keys.reject { |code| describe(code) }
    end

    # Galleries whose name is still the English one, so the build can say so.
    def untranslated(site, locale)
      return [] if I18n.default?(locale)

      english = galleries(site).each_with_object({}) { |g, all| all[g['code']] = g['name'] }
      galleries(site, locale).select { |gallery| gallery['name'] == english[gallery['code']] }
                             .map { |gallery| gallery['code'] }
    end
  end
end

require 'set'

module Jekyll
  class GalleryPage < PageWithoutAFile
    def initialize(site, gallery, locale)
      super(site, site.source, I18n.find(locale)['prefix'].delete_prefix('/'),
            "#{gallery['code']}.html")

      self.content = ''
      self.data = {
        'layout' => 'gallery',
        'permalink' => I18n.path(locale, gallery['permalink']),
        'locale' => locale,
        'alternates' => I18n.alternates(gallery['permalink']),
        'prefix' => gallery['code'],
        'gallery' => gallery,
        'title' => gallery['name']
      }
    end
  end

  class AtlasGenerator < Generator
    safe true
    priority :normal

    def generate(site)
      I18n.codes.each { |locale| generate_locale(site, locale) }

      warn_about_strays(site)
    end

    private

    def generate_locale(site, locale)
      galleries = Atlas.galleries(site, locale)
      cards = postcards(site, locale)

      galleries.each { |gallery| site.pages << GalleryPage.new(site, gallery, locale) }
      site.pages << home_page(site, locale)
      site.pages << stories_page(site, locale)
      site.pages << json_page(site, I18n.asset(locale, 'assets/atlas.json'),
                              atlas(site, galleries, locale))
      site.pages << json_page(site, I18n.asset(locale, 'assets/postcards.json'), cards)

      # Templates read these; they are about which photographs exist, which is
      # the same question in every language.
      if I18n.default?(locale)
        site.data['galleries'] = galleries
        site.data['postcard_photos'] = cards.keys
      end

      report_untranslated(site, locale)
    end

    # Every photograph, newest first.
    def home_page(site, locale)
      page = locale_page(site, locale, 'index.html')
      page.data = page.data.merge('layout' => 'gallery', 'prefix' => '', 'reversed' => true)
      page
    end

    def stories_page(site, locale)
      strings = I18n.strings(site, locale)['stories'] || {}

      page = locale_page(site, locale, 'stories.html')
      page.data = page.data.merge(
        'layout' => 'stories',
        'title' => strings['title'],
        'description' => strings['description']
      )
      page
    end

    # index.html and stories.html exist once per locale, so they need distinct
    # source paths as well as distinct permalinks.
    def locale_page(site, locale, name)
      permalink = name == 'index.html' ? '/' : "/#{File.basename(name, '.*')}"
      page = PageWithoutAFile.new(site, site.source,
                                  I18n.find(locale)['prefix'].delete_prefix('/'), name)
      page.content = ''
      page.data = {
        'permalink' => I18n.path(locale, permalink),
        'locale' => locale,
        'alternates' => I18n.alternates(permalink)
      }
      page
    end

    def json_page(site, path, payload)
      require 'json'

      page = PageWithoutAFile.new(site, site.source, File.dirname(path), File.basename(path))
      page.content = site.config['minify'] == false ? JSON.pretty_generate(payload) : JSON.generate(payload)
      page.data['layout'] = nil
      page.data['sitemap'] = false
      page
    end

    def atlas(site, galleries, locale)
      by_code = galleries.each_with_object({}) { |gallery, all| all[gallery['code']] = gallery }

      countries = galleries.select { |gallery| gallery['kind'] == 'country' }.map do |gallery|
        reference = Atlas.countries(locale)[gallery['code']]
        entry = {
          'code' => gallery['code'],
          'name' => gallery['name'],
          # The country outlines are labelled in English, and so is anyone
          # typing "China" into a Chinese page. `match` is how both find their
          # way to a place whose name has been translated.
          'match' => Atlas.countries(I18n::DEFAULT)[gallery['code']]['name'],
          'lat' => reference['lat'],
          'lon' => reference['lon'],
          'count' => gallery['count']
        }
        # Only a language whose reference table supplies pinyin gets it, so
        # the English atlas is exactly what it always was.
        entry['pinyin'] = reference['pinyin'] if reference['pinyin']
        subdivision = Atlas::SUBDIVISIONS[gallery['code']]
        entry['subdivisions'] = subdivision['key'] if subdivision
        entry
      end

      airports = galleries.select { |gallery| gallery['kind'] == 'airport' }.map do |gallery|
        reference = Atlas.airports(locale)[gallery['code']]
        english = Atlas.airports(I18n::DEFAULT)[gallery['code']]
        country = Atlas.countries(locale)[reference['country']]
        {
          'code' => gallery['code'],
          'iata' => reference['iata'],
          'icao' => reference['icao'],
          'name' => reference['name'],
          'match' => english['name'],
          'city' => Atlas.city_name(reference['municipality']),
          'country' => reference['country'],
          'countryName' => country ? country['name'] : reference['country'].upcase,
          'lat' => reference['lat'],
          'lon' => reference['lon'],
          'elevation' => reference['elevation'],
          'count' => gallery['count']
        }.tap { |entry| entry['pinyin'] = reference['pinyin'] if reference['pinyin'] }
      end

      subdivisions = {}
      Atlas::SUBDIVISIONS.each do |country_code, options|
        next unless by_code.key?(country_code)

        places = Atlas.regions(locale).map do |code, region|
          next unless code.start_with?("#{country_code}-")

          {
            'code' => code,
            'iso' => region['iso'],
            'name' => region['name'],
            'type' => region['type'],
            'lat' => region['lat'],
            'lon' => region['lon'],
            'count' => by_code[code] ? by_code[code]['count'] : 0
          }.tap { |place| place['pinyin'] = region['pinyin'] if region['pinyin'] }
        end.compact

        subdivisions[options['key']] = {
          'key' => options['key'],
          'noun' => I18n.pick(options['noun'], locale),
          'search' => I18n.pick(options['search'], locale),
          'places' => places
        }
      end

      payload = { 'countries' => countries, 'airports' => airports,
                  'subdivisions' => subdivisions }

      names = Atlas.map_names(locale)
      payload['names'] = names unless names.empty?
      payload
    end

    def postcards(site, locale)
      entries = site.data['postcards'] || []
      galleries = Atlas.galleries(site, locale).each_with_object({}) { |g, all| all[g['code']] = g }
      kind_default = (I18n.strings(site, locale)['postcard'] || {})['kind']

      entries.each_with_index.each_with_object({}) do |(entry, index), cards|
        entry = { 'photo' => entry } if entry.is_a?(String)
        photo = entry['photo']
        next unless photo

        card = { 'number' => entry['number'] || index + 1 }
        card['kind'] = entry['kind'] || kind_default

        exif = Atlas::Exif.read(File.join(Atlas::ROOT, 'images', 'fulls', photo))
        place = place_for(photo, galleries, locale)

        title = entry['title'] || place['title']
        card['title'] = title if title && !title.empty?

        location = entry.key?('location') ? entry['location'] : place['location']
        card['location'] = location if location && !location.to_s.empty? && location != title

        date = if entry.key?('date')
                 format_date(entry['date'], site, locale)
               else
                 Atlas::Exif.date_text(exif['date'], site, locale)
               end
        card['date'] = date if date && !date.to_s.empty?

        camera = entry['camera'] || exif['camera']
        card['camera'] = camera if camera && !camera.empty?

        card['note'] = entry['note'] if entry['note']
        card['swatches'] = entry['swatches'] if entry['swatches']
        if entry['illustration']
          card['illustration'] = "#{site.baseurl}/images/postcards/#{entry['illustration']}"
        end

        cards[photo] = card
      end
    end

    # Where a photograph was taken, from where it is filed: the headline is the
    # closest named place, the line under it is the country it sits in.
    #
    #   cn-sh-*  Shanghai / China        pek-*  Beijing / China
    #   cn-*     China / -
    def place_for(photo, galleries, locale)
      code = Atlas.prefix_of(photo)
      gallery = code && galleries[code]
      return { 'title' => nil, 'location' => nil } unless gallery

      case gallery['kind']
      when 'region'
        { 'title' => gallery['name'], 'location' => gallery.dig('parent', 'name') }
      when 'airport'
        { 'title' => Atlas.city_name(gallery['municipality']) || gallery['name'],
          'location' => Atlas.countries(locale).dig(gallery['country'], 'name') }
      when 'country'
        { 'title' => gallery['name'], 'location' => nil }
      else
        { 'title' => gallery['name'], 'location' => nil }
      end
    end

    def format_date(value, site, locale)
      return nil if value.nil?
      return value.to_s unless value.respond_to?(:strftime)

      formats = I18n.strings(site, locale)['date'] || {}
      value.strftime(formats['postcard'] || '%-d %B %Y')
    end

    def warn_about_strays(site)
      strays = Atlas.unknown_prefixes(site)
      return if strays.empty?

      Jekyll.logger.warn 'Atlas:', "photographs with an unknown prefix: #{strays.sort.join(', ')}"
      Jekyll.logger.warn 'Atlas:', 'expected a country code, an ISO 3166-2:CN region, ' \
                                   'an IATA code, or an entry in EXTRAS.'
    end

    # Not a warning: an English name in the Chinese site is a gap to fill when
    # convenient, not a broken build.
    def report_untranslated(site, locale)
      missing = Atlas.untranslated(site, locale)
      return if missing.empty?

      Jekyll.logger.info 'Atlas:', "no #{locale} name for: #{missing.sort.join(', ')} " \
                                   "(add a row to _reference/*.#{locale}.csv)"
    end
  end
end
