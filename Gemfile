# frozen_string_literal: true

# A sample Gemfile
source 'https://rubygems.org'

ruby '2.6.3'

require 'json'
require 'open-uri'
versions = JSON.parse(open('https://pages.github.com/versions.json').read)

gem 'github-pages', versions['github-pages']
gem 'jekyll'
gem 'jekyll-postcss'
gem 'jekyll-purgecss'
gem 'jekyll-responsive-image'
gem 'jekyll-seo-tag'
gem 'jemoji'
gem 'pry'
gem 'pygments.rb'
gem 'redcarpet'
