---
layout: post
title: Deep dive into rackup
categories: ruby
---


<details><summary class="cursor-pointer outline-none">License (MIT)</summary>
{% source bash %}
The MIT License (MIT)

Copyright (C) 2007-2019 Leah Neukirchen <http://leahneukirchen.org/infopage.html>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
{% endsource %}
</details>

Rack is a bridge between web servers and web applications. Most of the
web frameworks in Ruby are based on Rack. In this article, I'd like
to explore and demystify how its `rackup` tool works. 

Diving deep into its source code revealed that some eval wizardry is
being used. Here's a sneak-peak of its beauty.

{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/builder.rb#L110-L118" %}
# Evaluate the given +builder_script+ string in the context of
# a Rack::Builder block, returning a Rack application.
def self.new_from_string(builder_script, file = "(rackup)")
  # We want to build a variant of TOPLEVEL_BINDING with self as a Rack::Builder instance.
  # We cannot use instance_eval(String) as that would resolve constants differently.
  binding, builder = 
    TOPLEVEL_BINDING.
      eval('Rack::Builder.new.instance_eval { [binding, self] }')
  eval builder_script, binding, file
  builder.to_app
end
{% endsource %}

I'll get to it later and explain how it works and why it's needed.


For now, let's get started with a "Hello World" example:

```ruby
# in config.ru

run(proc { [200, { 'Content-Type' => 'text/plain' }, ['Hello World']] })
```

Running this with `rackup` will start Webrick and serve our little "Hello World" app on port 9292. 

## Getting started

It looks like running the `rackup` command somehow started the server and provided the `run` method to the top-level context. Let's find where it's coming from.

Looking at [Rack's source code](https://github.com/rack/rack) we discover this file sitting in a `bin/` directory:


{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/bin/rackup" %}
#!/usr/bin/env ruby
# frozen_string_literal: true

require "rack"
Rack::Server.start
{% endsource %}

Looks like we're starting the server here. Let's dig into the source code to find out what happens.

{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/server.rb#L286-L328" cssclass=emphasized hl_lines="1 42 43" %}
def start(&block)
  if options[:warn]
    $-w = true
  end

  if includes = options[:include]
    $LOAD_PATH.unshift(*includes)
  end

  Array(options[:require]).each do |library|
    require library
  end

  if options[:debug]
    $DEBUG = true
    require 'pp'
    p options[:server]
    pp wrapped_app
    pp app
  end

  check_pid! if options[:pid]

  # Touch the wrapped app, so that the config.ru is loaded before
  # daemonization (i.e. before chdir, etc).
  handle_profiling(options[:heapfile], options[:profile_mode], options[:profile_file]) do
    wrapped_app
  end

  daemonize_app if options[:daemonize]

  write_pid if options[:pid]

  trap(:INT) do
    if server.respond_to?(:shutdown)
      server.shutdown
    else
      exit
    end
  end

  server.run(wrapped_app, **options, &block)
end
{% endsource %}

Let's ignore `server.run` <a name="server_run"></a> for a bit and dive deeper into the `wrapped_app` <a name="wrapped_app"></a>.

{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/server.rb#L421-L423"%}
def wrapped_app
  @wrapped_app ||= build_app app
end
{% endsource %}

Let's also ignore `build_app` and focus on the `app`.

{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/server.rb#L248-L250" %}
def app
  @app ||= options[:builder] ?
    build_app_from_string :
    build_app_and_options_from_config
end
{% endsource %}

We are not passing any options, so in our case we're interested in `build_app_and_options_from_config`.


{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/server.rb#L344-L352" cssclass=emphasized hl_lines="1 6 7 10" %}
def build_app_and_options_from_config
  if !::File.exist? options[:config]
    abort "configuration #{options[:config]} not found"
  end

  app, options = Rack::Builder.parse_file(self.options[:config],
                                          opt_parser)
  @options.merge!(options) { |key, old, new| old }
  app
end
{% endsource %}

This leads us to `Rack::Builder.parse_file` which explains it's purpose in the comments.

{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/builder.rb#L38-L72" cssclass=emphasized hl_lines="27 28 29 30 34 35" %}
# Parse the given config file to get a Rack application.
#
# If the config file ends in +.ru+, it is treated as a
# rackup file and the contents will be treated as if
# specified inside a Rack::Builder block, using the given
# options.
#
# If the config file does not end in +.ru+, it is
# required and Rack will use the basename of the file
# to guess which constant will be the Rack application to run.
# The options given will be ignored in this case.
#
# Examples:
#
#   Rack::Builder.parse_file('config.ru')
#   # Rack application built using Rack::Builder.new
#
#   Rack::Builder.parse_file('app.rb')
#   # requires app.rb, which can be anywhere in Ruby's
#   # load path. After requiring, assumes App constant
#   # contains Rack application
#
#   Rack::Builder.parse_file('./my_app.rb')
#   # requires ./my_app.rb, which should be in the
#   # process's current directory.  After requiring,
#   # assumes MyApp constant contains Rack application
def self.parse_file(config, opts = Server::Options.new)
  if config.end_with?('.ru')
    return self.load_file(config, opts)
  else
    require config
    app = Object.const_get(::File.basename(config, '.rb').split('_').map(&:capitalize).join(''))
    return app, {}
  end
end
{% endsource %}

Our file ends with `.ru`, so let's look at `Rack::Builder.load_file`.


{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/builder.rb#L74-L108" cssclass=emphasized hl_lines="20 23 32 35" %}
# Load the given file as a rackup file, treating the
# contents as if specified inside a Rack::Builder block.
#
# Treats the first comment at the beginning of a line
# that starts with a backslash as options similar to
# options passed on a rackup command line.
#
# Ignores content in the file after +__END__+, so that
# use of +__END__+ will not result in a syntax error.
#
# Example config.ru file:
#
#   $ cat config.ru
#
#   #\ -p 9393
#
#   use Rack::ContentLength
#   require './app.rb'
#   run App
def self.load_file(path, opts = Server::Options.new)
  options = {}

  cfgfile = ::File.read(path)
  cfgfile.slice!(/\A#{UTF_8_BOM}/) if cfgfile.encoding == Encoding::UTF_8

  if cfgfile[/^#\\(.*)/] && opts
    warn "Parsing options from the first comment line is deprecated!"
    options = opts.parse! $1.split(/\s+/)
  end

  cfgfile.sub!(/^__END__\n.*\Z/m, '')
  app = new_from_string cfgfile, path

  return app, options
end
{% endsource %}

Looks like `Builder.new_from_string` is the key for getting to bottom of this. Let's look it up.

{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/builder.rb#L110-L118" %}
# Evaluate the given +builder_script+ string in the context of
# a Rack::Builder block, returning a Rack application.
def self.new_from_string(builder_script, file = "(rackup)")
  # We want to build a variant of TOPLEVEL_BINDING with self as a Rack::Builder instance.
  # We cannot use instance_eval(String) as that would resolve constants differently.
  binding, builder = 
    TOPLEVEL_BINDING.
      eval('Rack::Builder.new.instance_eval { [binding, self] }')
  eval builder_script, binding, file
  builder.to_app
end
{% endsource %}

Wow, look at that! This is where the magic happens. Let's dive into it.

## Double eval magic

This code makes `Rack::Builder` instance a top level context and evaluates
our script within that context. This provides the `run` method to our `config.ru` script, which is 
actually defined in `Rack::Builder#run` <sup>[[1](#simplified)]</sup>.

`TOPLEVEL_BINDING` is, simply, a binding of the top-level context<sup>[[2](#binding)]</sup>.
Why do we need it here? Couldn't we simply write:

```ruby
def self.new_from_string(builder_script, file = "(rackup)")
  bind, builder = Rack::Builder.new.instance_eval { [binding, self] }
  eval builder_script, bind, file
  builder.to_app
end
```

I was confused by this, so I've asked the author, Benoit Daloze, to explain it and [he did](https://github.com/rack/rack/pull/1545#issuecomment-590522238). Not having
`TOPLEVEL_BINDING` would give the `Rack` namespace to constants defined in our `config.ru`:

```ruby
# config.ru

p Builder # would print out Rack::Builder
```

That's why we need to evaluate within `TOPLEVEL_BINDING`.

A simpler, and a previously used version of this magic is: 

```ruby
def self.new_from_string(builder_script, file = "(rackup)")
  eval "Rack::Builder.new {\n" + builder_script + "\n}.to_app",
    TOPLEVEL_BINDING, file, 0
end
```

However, this means that magic comments from `config.ru` would be ignored, since they are not present at the beginning of the `eval`-ed string. We would have to check for them and add them at the beginning of the string like this:

```ruby
def self.new_from_string(builder_script, file = "(rackup)")
  eval "# frozen_string_literal: true\nRack::Builder.new {\n" +
       builder_script + "\n}.to_app",
       TOPLEVEL_BINDING, file, 0
end
```

Benoit's solution to this is much more elegant.


## Going deeper

Calling `run` in our `config.ru` script, means that our journey continues to `Rack::Builder#run`:


{% source ruby loaction="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/builder.rb#L162-L178" %}

# Takes an argument that is an object that responds to #call and returns a Rack response.
# The simplest form of this is a lambda object:
#
#   run lambda { |env| [200, { "Content-Type" => "text/plain" }, ["OK"]] }
#
# However this could also be a class:
#
#   class Heartbeat
#     def self.call(env)
#      [200, { "Content-Type" => "text/plain" }, ["OK"]]
#     end
#   end
#
#   run Heartbeat
def run(app)
  @run = app
end

{% endsource %}

Since there are no other method calls to follow, it looks like we've come the end. Let's continue looking at branches that we've ignored previously.

The last thing we ignored was `build_app` in `wrapped_app`<sup>[[&nearr;](#wrapped_app)]</sup>:

{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/server.rb#L411-L419" %}

def build_app(app)
  middleware[options[:environment]].reverse_each do |middleware|
    middleware = middleware.call(self) if middleware.respond_to?(:call)
    next unless middleware
    klass, *args = middleware
    app = klass.new(app, *args)
  end
  app
end
{% endsource %}

Inspecting `middleware` further leads us to:

{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/server.rb#L259-L279"%}
def middleware
  default_middleware_by_environment
end

def default_middleware_by_environment
  m = Hash.new {|h, k| h[k] = []}
  m["deployment"] = [
    [Rack::ContentLength],
    logging_middleware,
    [Rack::TempfileReaper]
  ]
  m["development"] = [
    [Rack::ContentLength],
    logging_middleware,
    [Rack::ShowExceptions],
    [Rack::Lint],
    [Rack::TempfileReaper]
  ]

  m
end
{% endsource %}

This is going to build a chain of middleware that's going to look like this:

```
Rack::ContentLength ⟶
Rack::CommonLogger ⟶
Rack::ShowExceptions ⟶
Rack::Lint ⟶
Rack::TempfileReaper ⟶
our app
```

This is going to be the contents of `wrapped_app`.

The next thing we ignored is `server.run`<sup>[[&nearr;](#server_run)]</sup>.

{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/server.rb#L330-L341" %}

def server
  @_server ||= Rack::Handler.get(options[:server])

  unless @_server
    @_server = Rack::Handler.default

    # We already speak FastCGI
    @ignore_options = [:File, :Port] if @_server.to_s == 'Rack::Handler::FastCGI'
  end

  @_server
end

{% endsource %}
The default Rack handler is Webrick, so in our case, `server.run` is actually `Rack::Handler::Webrick.run`:

{% source ruby location="https://github.com/rack/rack/blob/2b22be07f189fd852fb66a601573c38439b1f7b4/lib/rack/handler/webrick.rb#L26-L42" %}
def self.run(app, **options)
  environment  = ENV['RACK_ENV'] || 'development'
  default_host = environment == 'development' ? 'localhost' : nil

  if !options[:BindAddress] || options[:Host]
    options[:BindAddress] = options.delete(:Host) || default_host
  end
  options[:Port] ||= 8080
  if options[:SSLEnable]
    require 'webrick/https'
  end

  @server = ::WEBrick::HTTPServer.new(options)
  @server.mount "/", Rack::Handler::WEBrick, app
  yield @server  if block_given?
  @server.start
end
{% endsource %}

This simply starts the Webrick server and passes our middleware to it as `app`.

And that's it! This article hopefully demystified what happens behind the curtain when you run `rackup` and you hopefully better understand how it works now.

---
### Notes and examples

1. <a name="simplified"></a>
    Here's the simplified version of what `Rack::Builder.new_from_string` is doing:

    ```ruby
    class Context
      def test
        puts "testing"
      end
    end

    bind = Context.new.instance_eval { binding }
    eval "test", bind
    ```

    The first argument for `eval` is our
    simplified `config.ru`. Running this will print out `"testing"`. 


2. <a name="binding"></a>
    I'm just kidding. It's not "simply". Let me explain what the hell I am talking about. [Ruby documentation](https://ruby-doc.org/core-2.7.0/Binding.html) says that `Binding` "encapsulates the execution context at some particular place in the code and retain this context for future use". `TOPLEVEL_BINDING` is simply `Binding` of the top level-context. Here's an example:

    ```ruby
    foo = 42

    def print_foo
      print foo # undefined local variable or method `foo' for main:Object
    end
    begin; print_foo; rescue => ex; puts ex.message; end

    def print_foo_with_top_level_binding
      print TOPLEVEL_BINDING.eval("foo") # 42
    end
    print_foo_with_top_level_binding
    ```
