# frozen_string_literal: true

# Squeezes the HTML on the way out.
#
# Deliberately conservative: runs of whitespace become a single space, and only
# the whitespace hugging a block-level tag is dropped altogether, because the
# space between two inline elements is content. <pre>, <textarea>, <script> and
# <style> are lifted out first and put back untouched.
#
# Set `minify: false` in _config.yml to read the output while debugging.
module Jekyll
  module Minify
    PROTECTED = %r{<(pre|textarea|script|style)\b[^>]*>.*?</\1>}mi.freeze
    COMMENT = /<!--(?!\[if\b)(?:(?!-->).)*-->/m.freeze
    BLOCK = 'html|head|body|meta|link|title|div|section|article|aside|nav|header|' \
            'footer|main|ul|ol|li|dl|dt|dd|p|h[1-6]|figure|figcaption|form|' \
            'fieldset|table|thead|tbody|tr|td|th|hr|br|canvas|video|source|option'
    AROUND_BLOCK = %r{\s+(</?(?:#{BLOCK})\b)}i.freeze
    AFTER_BLOCK = %r{(</?(?:#{BLOCK})\b[^>]*>)\s+}i.freeze

    # A private-use character: a placeholder can never collide with content.
    MARK = ""
    PLACEHOLDER = /(\d+)/.freeze

    def self.squeeze(html)
      keep = []

      body = html.gsub(PROTECTED) do |match|
        keep << match
        "#{MARK}#{keep.length - 1}#{MARK}"
      end

      body = body.gsub(COMMENT, '')
                 .gsub(/\s+/, ' ')
                 .gsub(AROUND_BLOCK, '\1')
                 .gsub(AFTER_BLOCK, '\1')
                 .strip

      body.gsub(PLACEHOLDER) { keep[Regexp.last_match(1).to_i] }
    end
  end
end

Jekyll::Hooks.register([:pages, :documents], :post_render) do |item|
  next if item.site.config['minify'] == false
  next unless item.output_ext == '.html'

  item.output = Jekyll::Minify.squeeze(item.output)
end
