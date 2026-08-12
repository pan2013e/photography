# frozen_string_literal: true

# What ships.
#
# The rule is: anything that is not part of the published site lives in a
# directory whose name starts with an underscore, which Jekyll already ignores.
# Sources are in _sass and _js, build scripts in _tools. So `exclude` in
# _config.yml would only ever have listed the handful of files that must sit at
# the top of the repository, and keeping such a list in step by hand is exactly
# the kind of chore this site does not need.
#
# Setting `exclude` in _config.yml would also throw away Jekyll's own defaults
# (Gemfile, node_modules, vendor and so on). Adding to it here keeps them.
Jekyll::Hooks.register :site, :after_init do |site|
  # Site#exclude is read from the config once, at configure time, so the list
  # on the site itself is the one that counts.
  site.exclude |= [
    'LICENSE',
    'package.json',
    'package-lock.json',
    'images_tmp'   # the ingest inbox
  ]

  # Documentation, whatever it ends up being called. Listed by name rather
  # than as *.md, because an exclude pattern is matched against every entry
  # Jekyll reads, at every level: *.md would also swallow the stories in
  # _stories and empty the journal.
  site.exclude |= Dir.glob(File.join(site.source, '*.md')).map { |path| File.basename(path) }
end
