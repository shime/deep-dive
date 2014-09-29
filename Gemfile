# frozen_string_literal: true

# A sample Gemfile
source 'https://rubygems.org'

ruby '2.5.1'

require 'json'
require 'open-uri'
versions = JSON.parse(open('https://pages.github.com/versions.json').read)

gem 'github-pages', versions['github-pages']
gem 'jekyll'
gem 'jekyll-responsive-image'
gem 'jekyll-seo-tag'
gem 'jemoji'
gem 'redcarpet'
gem 'pygments.rb'
gem 'pry'
