# frozen_string_literal: true

# Just enough EXIF to fill in a postcard: the capture date and the camera.
#
# Reading the JPEG directly keeps the build free of gems, and means a card can
# be listed by file name alone -- the photograph already knows when it was
# taken.
module Atlas
  module Exif
    DATE_TAKEN = 0x9003        # DateTimeOriginal
    DATE_DIGITIZED = 0x9004    # DateTimeDigitized
    DATE_CHANGED = 0x0132      # DateTime
    MAKE = 0x010F
    MODEL = 0x0110
    EXIF_POINTER = 0x8769

    TYPE_SIZES = { 1 => 1, 2 => 1, 3 => 2, 4 => 4, 5 => 8, 7 => 1, 9 => 4, 10 => 8 }.freeze

    class << self
      def read(path)
        @cache ||= {}
        @cache[path] ||= parse(path)
      end

      # The photograph knows the day; only the site knows how to write it. So
      # `read` hands back [year, month, day] and the wording happens here, once
      # per locale, from the `date.postcard` format in _data/i18n/<code>.yml.
      # Ruby's strftime carries its own English month names, so the output does
      # not depend on the machine doing the build.
      def date_text(parts, site, locale)
        return nil unless parts.is_a?(Array) && parts.length == 3

        formats = I18n.strings(site, locale)['date'] || {}
        Time.new(*parts).strftime(formats['postcard'] || '%-d %B %Y')
      end

      private

      def parse(path)
        return {} unless File.exist?(path)

        tags = File.open(path, 'rb') { |file| tags_from(file) }
        return {} if tags.empty?

        camera = [tags[MAKE], tags[MODEL]].compact.map(&:strip).reject(&:empty?)
        camera = camera.last&.start_with?(camera.first.to_s) ? [camera.last] : camera

        {
          'date' => readable_date(tags[DATE_TAKEN] || tags[DATE_DIGITIZED] || tags[DATE_CHANGED]),
          'camera' => camera.join(' ')
        }.compact
      rescue StandardError => error
        Jekyll.logger.warn 'Atlas:', "could not read EXIF from #{File.basename(path)}: #{error}"
        {}
      end

      # Walk the JPEG segments to the APP1 block that starts with "Exif\0\0".
      def tags_from(file)
        return {} unless file.read(2) == "\xFF\xD8".b

        while (marker = file.read(2))
          return {} unless marker.getbyte(0) == 0xFF

          kind = marker.getbyte(1)
          return {} if [0xD8, 0xD9, 0xDA].include?(kind)

          length = file.read(2).unpack1('n')
          return {} if length.nil? || length < 2

          payload = file.read(length - 2)
          next unless kind == 0xE1 && payload.to_s.start_with?("Exif\0\0")

          return read_ifds(payload[6..] || '')
        end

        {}
      end

      def read_ifds(block)
        byte_order = block[0, 2]
        return {} unless %w[II MM].include?(byte_order)

        little = byte_order == 'II'
        return {} unless read_short(block, 2, little) == 42

        tags = {}
        offset = read_long(block, 4, little)
        read_entries(block, offset, little, tags)
        read_entries(block, tags.delete(EXIF_POINTER), little, tags) if tags[EXIF_POINTER]
        tags
      end

      def read_entries(block, offset, little, tags)
        return if offset.nil? || offset <= 0 || offset + 2 > block.bytesize

        count = read_short(block, offset, little)
        count.times do |index|
          entry = offset + 2 + index * 12
          break if entry + 12 > block.bytesize

          tag = read_short(block, entry, little)
          type = read_short(block, entry + 2, little)
          length = read_long(block, entry + 4, little)
          size = (TYPE_SIZES[type] || 0) * length
          next if size.zero?

          value_at = size > 4 ? read_long(block, entry + 8, little) : entry + 8
          next if value_at.nil? || value_at + size > block.bytesize

          tags[tag] = case type
                      when 2 then block[value_at, size].to_s.split("\0").first
                      when 3 then read_short(block, value_at, little)
                      when 4 then read_long(block, value_at, little)
                      end
        end
      end

      def read_short(block, offset, little)
        block[offset, 2]&.unpack1(little ? 'v' : 'n')
      end

      def read_long(block, offset, little)
        block[offset, 4]&.unpack1(little ? 'V' : 'N')
      end

      # EXIF writes "2024:11:11 23:37:01". Left as [year, month, day] so that
      # each locale can word it its own way -- see date_text above.
      def readable_date(value)
        match = value.to_s.match(/\A(\d{4}):(\d{2}):(\d{2})/)
        return nil unless match

        year, month, day = match.captures.map(&:to_i)
        return nil unless month.between?(1, 12) && day.between?(1, 31)

        [year, month, day]
      end
    end
  end
end
