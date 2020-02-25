---
layout: post
title: "Deep dive into Minitest"
categories: [ruby]
---
<details><summary class="cursor-pointer outline-none">License (MIT)</summary>
{% source bash %}
(The MIT License)

Copyright © Ryan Davis, seattle.rb

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
{% endsource %}
</details>

Have you ever wondered what happens when you run a Minitest test suite? How does it work?

This article will demystify Minitest's magic by going deep into its source code. After reading
it, you'll no longer consider Minitest a magical black box and will understand how Minitest
discovers your tests methods and executes them.

## Reinvent the wheel

Although the standard programming wisdom
instructs us to avoid it,
reinventing the wheel is a great way to learn
the basic principles about the wheel.

So how does Minitest work?

<a name="original-test-method"></a>
Let's write a simplest code possible that demonstrates
how it's used:

```ruby
require "minitest/autorun"

class MathTest < Minitest::Test
  def test_two_plus_two
    assert 2 + 2 == 4
  end
end
```

When we run it, we get the following output:

```
Run options: --seed 22395

# Running:

.

Finished in 0.000802s, 1246.8827 runs/s, 1246.8827 assertions/s.

1 runs, 1 assertions, 0 failures, 0 errors, 0 skips
```

Let's try to figure out how it works by removing the require
line. If we run it without the `require`, we'll get the following error:

```
Traceback (most recent call last):
test.rb:3:in `<main>': uninitialized constant Minitest (NameError)
```

It looks like we're going to need to define that class, so let's do that:

{% highlight ruby cssclass=emphasized hl_lines="1 2 3" %}
module Minitest
  class Test; end
end

class MathTest < Minitest::Test
  def test_two_plus_two
    assert 2 + 2 == 4
  end
end
{% endhighlight %}

If we run it, absolutely nothing will happen, but at least
it will not blow up.

The next step is actually running the test. We need to do the following:

1. figure out which classes have inherited our test class
2. call instance methods that begin with `test_`

In order to do 1, we need to add some sort of descendant tracking
to our `Test` class. Let's add it:

{% highlight ruby cssclass=emphasized hl_lines="1 2 3 4 5 6 7 8 9 10 11 12" %}
module Minitest
  class Test
    def self.inherited(klass)
      @descendants ||= []
      @descendants << klass
    end

    def self.descendants
      @descendants || []
    end
  end
end

class MathTest < Minitest::Test
  def test_two_plus_two
    assert 2 + 2 == 4
  end
end
{% endhighlight %}

Now we're ready for 2, so let's call the methods that start with `test_`.
Since these methods are instance methods, it makes sense to instantiate
descendant classes we have tracked:

{% highlight ruby cssclass=emphasized hl_lines="20 21 22 23 24 25 26" %}
module Minitest
  class Test
    def self.inherited(klass)
      @descendants ||= []
      @descendants << klass
    end

    def self.descendants
      @descendants || []
    end
  end
end

class MathTest < Minitest::Test
  def test_two_plus_two
    assert 2 + 2 == 4
  end
end

Minitest::Test.descendants.each do |klass|
  klass.new.tap do |instance|
    instance.methods.grep(/^test_/).each do |method_name|
      instance.public_send(method_name)
    end
  end
end
{% endhighlight %}

If we run this we'll get another error:

```
Traceback (most recent call last):
        6: from test.rb:22:in `<main>'
        5: from test.rb:22:in `each'
        4: from test.rb:24:in `block in <main>'
        3: from test.rb:24:in `each'
        2: from test.rb:25:in `block (2 levels) in <main>'
        1: from test.rb:25:in `public_send'
test.rb:18:in `test_two_plus_two': undefined method `assert' for #<MathTest:0x00007f8eeb0f4ef8> (NoMethodError)
```

This is just what we've expected since we didn't define
the `assert` method yet. Let's add it:

{% highlight ruby cssclass=emphasized hl_lines="12 13 14" %}
module Minitest
  class Test
    def self.inherited(klass)
      @descendants ||= []
      @descendants << klass
    end

    def self.descendants
      @descendants || []
    end

    def assert(condition)
      print '.' if condition
    end
  end
end

class MathTest < Minitest::Test
  def test_two_plus_two
    assert 2 + 2 == 4
  end
end

Minitest::Test.descendants.each do |klass|
  klass.new.tap do |instance|
    instance.methods.grep(/^test_/).each do |method_name|
      instance.public_send(method_name)
    end
  end
end
{% endhighlight %}

Run it and witness the dot that is printed out in all its glory:

```
.
```

So far so good, but we need to report the number of runs, assertions and
failures, in addition to dots.

<a name="hack-from-the-beginning"></a>
Let's count the number of assertions:

{% highlight ruby cssclass=emphasized hl_lines="3 4 5 7 19" %}
module Minitest
  class Test
    def initialize
      @assertions_count = 0
    end

    attr_reader :assertions_count

    def self.inherited(klass)
      @descendants ||= []
      @descendants << klass
    end

    def self.descendants
      @descendants || []
    end

    def assert(condition)
      @assertions_count += 1
      print '.' if condition
    end
  end
end

class MathTest < Minitest::Test
  def test_two_plus_two
    assert 2 + 2 == 4
  end
end

Minitest::Test.descendants.each do |klass|
  klass.new.tap do |instance|
    instance.methods.grep(/^test_/).each do |method_name|
      instance.public_send(method_name)
    end
  end
end
{% endhighlight %}

Nice, we're now counting the assertions. The only problem now
is printing it. Let's start printing a simple report:

{% highlight ruby cssclass=emphasized hl_lines="31 37 38 39 40 41 42 43 44" %}
module Minitest
  class Test
    def initialize
      @assertions_count = 0
    end

    attr_reader :assertions_count

    def self.inherited(klass)
      @descendants ||= []
      @descendants << klass
    end

    def self.descendants
      @descendants || []
    end

    def assert(condition)
      @assertions_count += 1
      print '.' if condition
    end
  end
end

class MathTest < Minitest::Test
  def test_two_plus_two
    assert 2 + 2 == 4
  end
end

Minitest::Test.descendants.map do |klass|
  klass.new.tap do |instance|
    instance.methods.grep(/^test_/).each do |method_name|
      instance.public_send(method_name)
    end
  end
end.each_with_object(runs: 0, assertions: 0) do |instance, counter|
  counter[:assertions] += instance.assertions_count
  counter[:runs] += instance.methods.grep(/^test_/).count
end.tap do |counter|
  puts "\n\n#{counter[:runs]} runs, " \
       "#{counter[:assertions]} assertions, " \
       '0 failures, 0 errors, 0 skips'
end
{% endhighlight %}

Run this code, and you'll get the report printed out:

```
.

1 runs, 1 assertions, 0 failures, 0 errors, 0 skips
```

Great!

However, this is not precisely how Minitest works.  Minitest doesn't magically add code to the bottom
of our tests to print its report. Remember, we require
Minitest before our test code, so we need to keep our "test library"
code before our tests.

We need to print the report when everything else has finished
executing, and luckily Ruby comes with the [Kernel#at_exit](https://ruby-doc.org/core-2.6.3/Kernel.html#method-i-at_exit)
method we can use for this:

{% highlight ruby cssclass=emphasized hl_lines="25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43" %}
module Minitest
  class Test
    def initialize
      @assertions_count = 0
    end

    attr_reader :assertions_count

    def self.inherited(klass)
      @descendants ||= []
      @descendants << klass
    end

    def self.descendants
      @descendants || []
    end

    def assert(condition)
      @assertions_count += 1
      print '.' if condition
    end
  end
end

def do_the_wizardry
  Minitest::Test.descendants.map do |klass|
    klass.new.tap do |instance|
      instance.methods.grep(/^test_/).each do |method_name|
        instance.public_send(method_name)
      end
    end
  end.each_with_object(runs: 0, assertions: 0) do |instance, counter|
    counter[:assertions] += instance.assertions_count
    counter[:runs] += instance.methods.grep(/^test_/).count
  end.tap do |counter|
    puts "\n\n#{counter[:runs]} runs, " \
         "#{counter[:assertions]} assertions, " \
         '0 failures, 0 errors, 0 skips'
  end
end

at_exit { do_the_wizardry }

class MathTest < Minitest::Test
  def test_two_plus_two
    assert 2 + 2 == 4
  end
end
{% endhighlight %}

Excellent! Our library code is now above the test code, which
is also how Minitest works and does its magic.

## A peek under the hood

Since we're now total experts when it comes to test libraries,
we are no longer afraid to look under the hood of Minitest<sup>[[1](#apology)]</sup>.


```
git clone https://github.com/seattlerb/minitest.git
cd minitest
git checkout 1f2b132
```

Our assumption is that `at_exit` is used somewhere,
to print the report we get when running our test suite. 
Let's confirm it:

```
grep at_exit -nR .
```

This will bring us to:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L52-L66" cssclass=emphasized hl_lines="1 2 3 4 13 14 15" %}
def self.autorun
  at_exit {
    next if $! and not ($!.kind_of? SystemExit and $!.success?)

    exit_code = nil

    at_exit {
      @@after_run.reverse_each(&:call)
      exit exit_code || false
    }

    exit_code = Minitest.run ARGV
  } unless @@installed_at_exit
  @@installed_at_exit = true
end
{% endsource %}

Which uses `at_exit` to instruct Minitest to run after all the other code has been executed and the program is exiting. The first line skips invoking Minitest if
the exception is raised and it's not `SystemExit` with zero status. <sup>[[2](#exit-example)]</sup>

This hook is only set up if `@@installed_at_exit` has not been set, ensuring
the hook will only be set up once. This allows requiring `minitest/autorun` multiple
times and not having to worry about what will happen with the `at_exit` hook (imagine
multiple test files each requiring `minitest/autorun`).

This brings us to the inside of the block:


{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L52-L66" cssclass=emphasized hl_lines="5 6 7 8 9 10 11 12" %}
def self.autorun
  at_exit {
    next if $! and not ($!.kind_of? SystemExit and $!.success?)

    exit_code = nil

    at_exit {
      @@after_run.reverse_each(&:call)
      exit exit_code || false
    }

    exit_code = Minitest.run ARGV
  } unless @@installed_at_exit
  @@installed_at_exit = true
end
{% endsource %}

Notice the little trick with `exit_code` being set to `nil` first, before
assigning it to the result of `Minitest.run`. This is used to ensure that
the `at_exit` block runs regardless of the result of `Minitest.run`.<sup>[[3](#assign-nil-example)]</sup>

This second `at_exit` hook will be executed after Minitest finishes its execution,
so this is setting up the second layer of code that's going to be run
when the program is exiting.

In its block `@@after_run` is being called in reverse order. Where is it coming from?

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L10-L15" cssclass=emphasized hl_lines="6" %}
module Minitest
  VERSION = "5.11.3" # :nodoc:
  ENCS = "".respond_to? :encoding # :nodoc:

  @@installed_at_exit ||= false
  @@after_run = []
{% endsource %}

Ah, an ordinary array, but we're calling `.call` on its items. What does it store?


{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L68-L76" %}
##
# A simple hook allowing you to run a block of code after everything
# is done running. Eg:
#
#   Minitest.after_run { p $debugging_info }

def self.after_run &block
  @@after_run << block
end
{% endsource %}

Nice, so this is how Minitest keeps track of its `after_run` callbacks, it appends blocks
passed to `Minitest.after_run` to an ordinary array - nothing magical.

Now that we've demystified other parts of the `at_exit` hook that Minitest uses
to deploy its magic, let's take a look at the one thing that's left:
{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L52-L66" cssclass=emphasized hl_lines="12" %}
def self.autorun
  at_exit {
    next if $! and not ($!.kind_of? SystemExit and $!.success?)

    exit_code = nil

    at_exit {
      @@after_run.reverse_each(&:call)
      exit exit_code || false
    }

    exit_code = Minitest.run ARGV
  } unless @@installed_at_exit
  @@installed_at_exit = true
end
{% endsource %}

This is the most important line of that method since it actually runs the tests. Let's dig into it!

## Starting the engine

Searching for it, we discover these methods:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L103-L144" cssclass=emphasized hl_lines="1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 21 23 24 25 33 34 35 36 37 42" %}
##
# This is the top-level run method. Everything starts from here. It
# tells each Runnable sub-class to run, and each of those are
# responsible for doing whatever they do.
#
# The overall structure of a run looks like this:
#
#   Minitest.autorun
#     Minitest.run(args)
#       Minitest.__run(reporter, options)
#         Runnable.runnables.each
#           runnable.run(reporter, options)
#             self.runnable_methods.each
#               self.run_one_method(self, runnable_method, reporter)
#                 Minitest.run_one_method(klass, runnable_method)
#                   klass.new(runnable_method).run

def self.run args = []
  self.load_plugins unless args.delete("--no-plugins") || ENV["MT_NO_PLUGINS"]

  options = process_args args

  reporter = CompositeReporter.new
  reporter << SummaryReporter.new(options[:io], options)
  reporter << ProgressReporter.new(options[:io], options)

  self.reporter = reporter # this makes it available to plugins
  self.init_plugins options
  self.reporter = nil # runnables shouldn't depend on the reporter, ever

  self.parallel_executor.start if parallel_executor.respond_to?(:start)
  reporter.start
  begin
    __run reporter, options
  rescue Interrupt
    warn "Interrupted. Exiting..."
  end
  self.parallel_executor.shutdown
  reporter.report

  reporter.passed?
end
{% endsource %}

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L146-L161" %}
##
# Internal run method. Responsible for telling all Runnable
# sub-classes to run.

def self.__run reporter, options
  suites = Runnable.runnables.
                    reject { |s| s.runnable_methods.empty? }.
                    shuffle
  parallel, serial = suites.partition { |s| s.test_order == :parallel }

  serial.map { |suite| suite.run reporter, options } +
    parallel.map { |suite| suite.run reporter, options }
end
{% endsource %}

So far so good, but we're little confused now about this `Runnable.runnables` invocation.
It looks like it's an array, but where did it come from?

We track it down:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L373-L378" %}
##
# Returns all subclasses of Runnable.

def self.runnables
  @@runnables
end
{% endsource %}

This doesn't clear things up, so we keep searching and find this code:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L977-L982" %}
class Runnable # re-open
  def self.inherited klass # :nodoc:
    self.runnables << klass
    super
  end
end
{% endsource %}

Ah! It uses the [Class#inherited](https://ruby-doc.org/core-2.6.3/Class.html#method-i-inherited) to track all
the classes that have inherited `Runnable`. It's a bit weird to discover that `@@runnables` is being 
appended to, but not assigned to an array yet. Here's the missing piece:


{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L291-L295" %}
def self.reset # :nodoc:
  @@runnables = []
end

reset
{% endsource %}

This clears things up about `Runnable.runnables` being an array of classes that inherit
`Runnable`, but we still know nothing about the nature of those classes. 

Doing a quick grep for `< Runnable` gives us a suspect:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L496" %}
class Result < Runnable
{% endsource %}

Remember that we're still stuck at this line:
{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L146-L161" cssclass=emphasized hl_lines="6 7 8" %}
##
# Internal run method. Responsible for telling all Runnable
# sub-classes to run.

def self.__run reporter, options
  suites = Runnable.runnables.
                    reject { |s| s.runnable_methods.empty? }.
                    shuffle
  parallel, serial = suites.partition { |s| s.test_order == :parallel }

  serial.map { |suite| suite.run reporter, options } +
    parallel.map { |suite| suite.run reporter, options }
end
{% endsource %}

But we now know <sup>(or do we, cough, cough?)</sup> that `Runnable.runnables` is `[Result]`. Looks like
we're rejecting classes from that array that have
empty `runnable_methods`.

Tracking this method down leads us to the dead end:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L365-L371" %}
##
# Each subclass of Runnable is responsible for overriding this
# method to return all runnable methods. See #methods_matching.

def self.runnable_methods
  raise NotImplementedError, "subclass responsibility"
end
{% endsource %}

[What!?](https://www.youtube.com/watch?v=a1Y73sPHKxw)

Turns out, this nifty re-opening
of `Runnable` class has a purpose. The `Runnable.inherited` is defined
on line [977](https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L977),
while `Result < Runnable` happens on line [496](https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L496). Looks like the order is important here. Who knew!? 

{% source ruby %}
# This happens first
class Runnable
  def self.reset # :nodoc:
    @@runnables = []
  end

  reset

  def self.runnables
    @@runnables
  end
end

class Result < Runnable; end

# And then we re-open the class
class Runnable # re-open
  def self.inherited klass # :nodoc:
    self.runnables << klass
    super
  end
end

# > Runnable.runnables
# => []
{% endsource %}

Our suspect is free to go. We have found another one:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest/test.rb#L10" %}
  class Test < Runnable
{% endsource %}

Interesting. But where do we even require that class?

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L987" %}
require "minitest/test"
{% endsource %}

Ah! That's the last line of that file, so the `inherited` will kick in and catch this class. This suspect is now confirmed, and
we can happily declare that `Runnable.runnables` contains `[Test]`.

We now track down `Test.runnable_methods`:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest/test.rb#L60-L77"%}
##
# Returns all instance methods starting with "test_". Based on
# #test_order, the methods are either sorted, randomized
# (default), or run in parallel.

def self.runnable_methods
  methods = methods_matching(/^test_/)

  case self.test_order
  when :random, :parallel then
    max = methods.size
    methods.sort.sort_by { rand max }
  when :alpha, :sorted then
    methods.sort
  else
    raise "Unknown test_order: #{self.test_order.inspect}"
  end
end
{% endsource %}

This returns all the instance methods of this class, that start with `test_` by
using the `Runnable#methods_matching`:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L284-L289" %}
##
# Returns all instance methods matching the pattern +re+.

def self.methods_matching re
  public_instance_methods(true).grep(re).map(&:to_s)
end
{% endsource %}

We can now finally move a couple of lines:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L146-L161" cssclass=emphasized hl_lines="9 10 11 12" %}
##
# Internal run method. Responsible for telling all Runnable
# sub-classes to run.

def self.__run reporter, options
  suites = Runnable.runnables.
                    reject { |s| s.runnable_methods.empty? }.
                    shuffle
  parallel, serial = suites.partition { |s| s.test_order == :parallel }

  serial.map { |suite| suite.run reporter, options } +
    parallel.map { |suite| suite.run reporter, options }
end
{% endsource %}

It looks like some partitioning is happening, but we don't care because:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest/test.rb#L79-L85" %}
##
# Defines the order to run tests (:random by default). Override
# this or use a convenience method to change it for your tests.

def self.test_order
  :random
end
{% endsource %}

Which will put everything in `serial` (`parallel` will be empty array) and this leads us to:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L146-L161" cssclass=emphasized hl_lines="11" %}
##
# Internal run method. Responsible for telling all Runnable
# sub-classes to run.

def self.__run reporter, options
  suites = Runnable.runnables.
                    reject { |s| s.runnable_methods.empty? }.
                    shuffle
  parallel, serial = suites.partition { |s| s.test_order == :parallel }

  serial.map { |suite| suite.run reporter, options } +
    parallel.map { |suite| suite.run reporter, options }
end
{% endsource %}

Which finally calls `Test.run`, which `Test` inherits from `Runnable`:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L297-L324"
cssclass=emphasized hl_lines="1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 28" %}
##
# Responsible for running all runnable methods in a given class,
# each in its own instance. Each instance is passed to the
# reporter to record.

def self.run reporter, options = {}
  filter = options[:filter] || "/./"
  filter = Regexp.new $1 if filter =~ %r%/(.*)/%

  filtered_methods = self.runnable_methods.find_all { |m|
    filter === m || filter === "#{self}##{m}"
  }

  exclude = options[:exclude]
  exclude = Regexp.new $1 if exclude =~ %r%/(.*)/%

  filtered_methods.delete_if { |m|
    exclude === m || exclude === "#{self}##{m}"
  }

  return if filtered_methods.empty?

  with_info_handler reporter do
    filtered_methods.each do |method_name|
      run_one_method self, method_name, reporter
    end
  end
end

{% endsource %}

This filters methods by the `--name` and `--exclude` options
provided from the command line. Let's get to the juicy part:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L319-L323"
cssclass=emphasized hl_lines="23 24 25 26 27" %}
##
# Responsible for running all runnable methods in a given class,
# each in its own instance. Each instance is passed to the
# reporter to record.

def self.run reporter, options = {}
  filter = options[:filter] || "/./"
  filter = Regexp.new $1 if filter =~ %r%/(.*)/%

  filtered_methods = self.runnable_methods.find_all { |m|
    filter === m || filter === "#{self}##{m}"
  }

  exclude = options[:exclude]
  exclude = Regexp.new $1 if exclude =~ %r%/(.*)/%

  filtered_methods.delete_if { |m|
    exclude === m || exclude === "#{self}##{m}"
  }

  return if filtered_methods.empty?

  with_info_handler reporter do
    filtered_methods.each do |method_name|
      run_one_method self, method_name, reporter
    end
  end
end

{% endsource %}

Which brings us to `Runnable.run_one_method`:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L326-L335" %}
##
# Runs a single method and has the reporter record the result.
# This was considered internal API but is factored out of run so
# that subclasses can specialize the running of an individual
# test. See Minitest::ParallelTest::ClassMethods for an example.

def self.run_one_method klass, method_name, reporter
  reporter.prerecord klass, method_name
  reporter.record Minitest.run_one_method(klass, method_name)
end
{% endsource %}

Which passes the potato to `Minitest.run_one_method`:


{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L959-L963" %}
def self.run_one_method klass, method_name # :nodoc:
  result = klass.new(method_name).run
  raise "#{klass}#run _must_ return a Result" unless Result === result
  result
end
{% endsource %}

Remember that `klass` here is `Minitest::Test` and `method_name` is each 
method defined in that class that starts with `test_` and has survived
filtering.

Let's repeat this line since it's perhaps the most elegant line
in the entire project.

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L960"
cssclass=emphasized hl_lines="2" %}
def self.run_one_method klass, method_name # :nodoc:
  result = klass.new(method_name).run
  raise "#{klass}#run _must_ return a Result" unless Result === result
  result
end
{% endsource %}

This line creates a new instance of `Minitest::Test` class and passes the current method name as the first argument. `Minitest::Test` inherits initialize from `Minitest::Runnable` which looks like this:

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest.rb#L400-L404" %}
def initialize name # :nodoc:
  self.name       = name
  self.failures   = []
  self.assertions = 0
end
{% endsource %}

So every test method we've created in our original test file gets its own `Minitest::Test` instance, which stores the name, failures, and number of assertions. A much better approach, compared to [our hack from the beginning](#hack-from-the-beginning), but there are some similarities.

## The final layer

We still have one layer before we reach the end since we're calling
`run` on an instance of `Minitest::Test`.

Here is that final layer in its entirety:


{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest/test.rb#L89-L110" %}
##
# Runs a single test with setup/teardown hooks.

def run
  with_info_handler do
    time_it do
      capture_exceptions do
        before_setup; setup; after_setup

        self.send self.name
      end

      TEARDOWN_METHODS.each do |hook|
        capture_exceptions do
          self.send hook
        end
      end
    end
  end

  Result.from self # per contract
end
{% endsource %}

Let's highlight the most important line in that method.

{% source ruby location="https://github.com/seattlerb/minitest/blob/1f2b1328f286967926a381d7a34e0eadead0722d/lib/minitest/test.rb#L98"
cssclass=emphasized hl_lines="10" %}
##
# Runs a single test with setup/teardown hooks.

def run
  with_info_handler do
    time_it do
      capture_exceptions do
        before_setup; setup; after_setup

        self.send self.name
      end

      TEARDOWN_METHODS.each do |hook|
        capture_exceptions do
          self.send hook
        end
      end
    end
  end

  Result.from self # per contract
end
{% endsource %}

This calls our [original test method](#original-test-method) named `test_two_plus_two`. The name was stored in `Minitest::Runnable#initialize`, as explained earlier.

Other parts of this method are pretty self-explanatory, and I will not go into details. The goal of this article is achieved since we have tracked down and found out exactly what happens when we run our Minitest tests. 

Hooray!

---

### Notes and examples

1. <a name="apology"></a>
The commit [1f2b132](https://github.com/seattlerb/minitest/commit/1f2b1328f286967926a381d7a34e0eadead0722d) is no longer
the latest commit in the repository. The first draft of this article was written 8 weeks ago, and I apologize for not publishing
it sooner.

2. <a name="exit-example"></a>
This means it will
be skipped for any exceptions except `exit 0` which raises `SystemExit` with `success?`
set to true. You can test this with the following code:

    ```ruby
    require 'minitest/autorun'
    exit 0
    ```
  Which will result in the standard Minitest report being printed out. Try replacing
  the exit status like this:

    ```ruby
    require 'minitest/autorun'
    exit 1
    ```
  And notice that the Minitest report was not printed out. The same thing happens
  if you raise an exception.

3. <a name="assign-nil-example"></a> The simplest example to confirm this behavior is:

    ```ruby
    exit_code = nil

    at_exit do
      puts 'inside at_exit'
      exit exit_code
    end

    exit_code = raise
    ```

    Compare that with:

    ```ruby
    exit_code = raise

    at_exit do
      puts 'inside at_exit'
      exit exit_code
    end
    ```

