---
layout: post
title: Deep dive into Did You Mean
categories: [ruby]
---

<details><summary class="cursor-pointer outline-none">License (MIT)</summary>
{% source bash %}
(The MIT License)
Copyright (c) 2014-2016 Yuki Nishijima

MIT License

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
{% endsource %}
</details>

Since version 2.3.0, Ruby comes bundled
with [did\_you\_mean](https://github.com/ruby/did_you_mean),
a handy gem for detecting typos.

Running this snippet of code:

```ruby
def greet
  "hello!"
end

greeet
```

Will produce the following error message:

```
Traceback (most recent call last):
fun.rb:5:in `<main>': undefined local variable or method
                      `greeet' for main:Object (NameError)
Did you mean?  greet
```

The bottom part of that error message was produced by
Did You Mean.

Let's re-implement the functionality provided by the
gem in order to figure out how it works.

## Reinvent the wheel

The error message produced contains the standard `NameError`
message, with an additional question for the typo. Let's try
to do the same thing for the `ZeroDivisionError`.

This snippet of code:

```ruby
1 / 0
```

Will produce the following error message:

```
Traceback (most recent call last):
        1: from fun.rb:1:in `<main>'
fun.rb:1:in `/': divided by 0 (ZeroDivisionError)
```

Overriding the `to_s` instance method of the error class,
enables error message customizations. Let's customize
the `ZeroDivisionError` message to include custom
text:

```ruby
class ZeroDivisionError
  def to_s
    "#{super}\nOops, this looks like infinity to me."
  end
end

1 / 0
```

Running this will produce:

```
Traceback (most recent call last):
        1: from fun.rb:7:in `<main>'
fun.rb:7:in `/': divided by 0 (ZeroDivisionError)
Oops, this looks like infinity to me.
```

This is a very simplified version of what Did You Mean
does under the hood, so let's dive right in.

## Look under the hood

Let's look into the internals
of this gem:

```
git clone git@github.com:ruby/did_you_mean.git
cd did_you_mean
git checkout 8175f6e
```

Let's confirm our hunch that `to_s` is being overriden
somewhere:

```
grep "def to_s" -nR lib
```

Which leads us to the following:

{% source ruby location="https://github.com/ruby/did_you_mean/blob/8175f6eefb9c55a8906fc8bce2dd3b7c03de3e59/lib/did_you_mean/core_ext/name_error.rb" cssclass=emphasized hl_lines="7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23" %}
module DidYouMean
  module Correctable
    def original_message
      method(:to_s).super_method.call
    end

    def to_s
      msg = super.dup
      suggestion = DidYouMean.formatter.message_for(corrections)

      msg << suggestion if !msg.end_with?(suggestion)
      msg
    rescue
      super
    end

    def corrections
      @corrections ||= spell_checker.corrections
    end

    def spell_checker
      SPELL_CHECKERS[self.class.to_s].new(self)
    end
  end
end
{% endsource %}

Looks like we're fetching a spell checker for this type of error:

{% source ruby location="https://github.com/ruby/did_you_mean/blob/8175f6eefb9c55a8906fc8bce2dd3b7c03de3e59/lib/did_you_mean/core_ext/name_error.rb" cssclass=emphasized hl_lines="21 22 23" %}
module DidYouMean
  module Correctable
    def original_message
      method(:to_s).super_method.call
    end

    def to_s
      msg = super.dup
      suggestion = DidYouMean.formatter.message_for(corrections)

      msg << suggestion if !msg.end_with?(suggestion)
      msg
    rescue
      super
    end

    def corrections
      @corrections ||= spell_checker.corrections
    end

    def spell_checker
      SPELL_CHECKERS[self.class.to_s].new(self)
    end
  end
end
{% endsource %}

Spell checkers are being set in the entry file:

{% source ruby location="https://github.com/ruby/did_you_mean/blob/8175f6eefb9c55a8906fc8bce2dd3b7c03de3e59/lib/did_you_mean.rb#L85-L110" cssclass=emphasized hl_lines="2 3 4 5 6 7 8 9 10 11 12 13 14 15" %}
module DidYouMean
  # Map of error types and spell checker objects.
  SPELL_CHECKERS = Hash.new(NullChecker)

  # Adds +DidYouMean+ functionality to an error using a given spell checker
  def self.correct_error(error_class, spell_checker)
    SPELL_CHECKERS[error_class.name] = spell_checker
    error_class.prepend(Correctable) unless error_class < Correctable
  end

  correct_error NameError, NameErrorCheckers
  correct_error KeyError, KeyErrorChecker
  correct_error NoMethodError, MethodNameChecker

  # Returns the currenctly set formatter. By default, it is set to +DidYouMean::Formatter+.
  def self.formatter
    @@formatter
  end

  # Updates the primary formatter used to format the suggestions.
  def self.formatter=(formatter)
    @@formatter = formatter
  end

  self.formatter = PlainFormatter.new
end
{% endsource %}

This is a pretty elegant piece of code. 

The class method `DidYouMean.correct_error` not only
populates the `SPELL_CHECKERS` hash with the spell checker for each error class,
but also prepends `Correctable`. Since we've got here by investigating what is `SPELL_CHECKERS`,
we now know this:

```ruby
SPELL_CHECKERS = {
  "NameError" => NameErrorCheckers,
  "KeyError" => KeyErrorCheckers,
  "NoMethodError" => MethodNameChecker
}
```

Since Did You Mean is doing different things for these error
classes, let's assume that we have spelled a method name wrong
and `NoMethodError` was raised. Did You Mean is going to
use `MethodNameChecker` for this.

Since `Correctable` is retrieving corrections from spell checker:

{% source ruby location="https://github.com/ruby/did_you_mean/blob/8175f6eefb9c55a8906fc8bce2dd3b7c03de3e59/lib/did_you_mean/core_ext/name_error.rb" cssclass=emphasized hl_lines="9 17 18 19" %}
module DidYouMean
  module Correctable
    def original_message
      method(:to_s).super_method.call
    end

    def to_s
      msg = super.dup
      suggestion = DidYouMean.formatter.message_for(corrections)

      msg << suggestion if !msg.end_with?(suggestion)
      msg
    rescue
      super
    end

    def corrections
      @corrections ||= spell_checker.corrections
    end

    def spell_checker
      SPELL_CHECKERS[self.class.to_s].new(self)
    end
  end
end
{% endsource %}

Let's dive into `MethodNameChecker#corrections`:

{% source ruby location="https://github.com/ruby/did_you_mean/blob/8175f6eefb9c55a8906fc8bce2dd3b7c03de3e59/lib/did_you_mean/spell_checkers/method_name_checker.rb" cssclass=emphasized hl_lines="45 46 47" %}
require_relative "../spell_checker"

module DidYouMean
  class MethodNameChecker
    attr_reader :method_name, :receiver

    NAMES_TO_EXCLUDE = { NilClass => nil.methods }
    NAMES_TO_EXCLUDE.default = []

    # +MethodNameChecker::RB_RESERVED_WORDS+ is the list of reserved words in
    # Ruby that take an argument. Unlike
    # +VariableNameChecker::RB_RESERVED_WORDS+, these reserved words require
    # an argument, and a +NoMethodError+ is raised due to the presence of the
    # argument.
    #
    # The +MethodNameChecker+ will use this list to suggest a reversed word if
    # a +NoMethodError+ is raised and found closest matches.
    #
    # Also see +VariableNameChecker::RB_RESERVED_WORDS+.
    RB_RESERVED_WORDS = %i(
      alias
      case
      def
      defined?
      elsif
      end
      ensure
      for
      rescue
      super
      undef
      unless
      until
      when
      while
      yield
    )

    def initialize(exception)
      @method_name  = exception.name
      @receiver     = exception.receiver
      @private_call = exception.respond_to?(:private_call?) ? exception.private_call? : false
    end

    def corrections
      @corrections ||= SpellChecker.new(dictionary: RB_RESERVED_WORDS + method_names).correct(method_name) - NAMES_TO_EXCLUDE[@receiver.class]
    end

    def method_names
      method_names = receiver.methods + receiver.singleton_methods
      method_names += receiver.private_methods if @private_call
      method_names.uniq!
      method_names
    end
  end
end
{% endsource %}

For our case, this checker is initialized with an instance of `NoMethodError`. Method names
are collected elegantly by combining `Object#methods` and `Object#signleton_methods` on
[NameError#receiver](https://ruby-doc.org/core-2.7.0.preview3/NameError.html#method-i-receiver):

{% source ruby location="https://github.com/ruby/did_you_mean/blob/8175f6eefb9c55a8906fc8bce2dd3b7c03de3e59/lib/did_you_mean/spell_checkers/method_name_checker.rb" cssclass=emphasized hl_lines="39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54" %}
require_relative "../spell_checker"

module DidYouMean
  class MethodNameChecker
    attr_reader :method_name, :receiver

    NAMES_TO_EXCLUDE = { NilClass => nil.methods }
    NAMES_TO_EXCLUDE.default = []

    # +MethodNameChecker::RB_RESERVED_WORDS+ is the list of reserved words in
    # Ruby that take an argument. Unlike
    # +VariableNameChecker::RB_RESERVED_WORDS+, these reserved words require
    # an argument, and a +NoMethodError+ is raised due to the presence of the
    # argument.
    #
    # The +MethodNameChecker+ will use this list to suggest a reversed word if
    # a +NoMethodError+ is raised and found closest matches.
    #
    # Also see +VariableNameChecker::RB_RESERVED_WORDS+.
    RB_RESERVED_WORDS = %i(
      alias
      case
      def
      defined?
      elsif
      end
      ensure
      for
      rescue
      super
      undef
      unless
      until
      when
      while
      yield
    )

    def initialize(exception)
      @method_name  = exception.name
      @receiver     = exception.receiver
      @private_call = exception.respond_to?(:private_call?) ? exception.private_call? : false
    end

    def corrections
      @corrections ||= SpellChecker.new(dictionary: RB_RESERVED_WORDS + method_names).correct(method_name) - NAMES_TO_EXCLUDE[@receiver.class]
    end

    def method_names
      method_names = receiver.methods + receiver.singleton_methods
      method_names += receiver.private_methods if @private_call
      method_names.uniq!
      method_names
    end
  end
end
{% endsource %}

`SpellChecker` is initialized with a dictionary that contains Ruby's reserved
words and all of the methods from the receiver, or the object that raised the exception.

Let's dive into the internals of `SpellChecker`:

{% source ruby location="https://github.com/yuki24/did_you_mean/blob/8175f6eefb9c55a8906fc8bce2dd3b7c03de3e59/lib/did_you_mean/spell_checker.rb" %}
require_relative "levenshtein"
require_relative "jaro_winkler"

module DidYouMean
  class SpellChecker
    def initialize(dictionary:)
      @dictionary = dictionary
    end

    def correct(input)
      input     = normalize(input)
      threshold = input.length > 3 ? 0.834 : 0.77

      words = @dictionary.select do |word|
        JaroWinkler.distance(normalize(word), input) >= threshold
      end
      words.reject! { |word| input == word.to_s }
      words.sort_by! { |word| JaroWinkler.distance(word.to_s, input) }
      words.reverse!

      # Correct mistypes
      threshold   = (input.length * 0.25).ceil
      corrections = words.select do |c|
        Levenshtein.distance(normalize(c), input) <= threshold
      end

      # Correct misspells
      if corrections.empty?
        corrections = words.select do |word|
          word   = normalize(word)
          length = if input.length < word.length 
                     input.length 
                   else
                     word.length
                   end

          Levenshtein.distance(word, input) < length
        end.first(1)
      end

      corrections
    end

    private

    def normalize(str_or_symbol) #:nodoc:
      str = str_or_symbol.to_s.downcase
      str.tr!("@", "")
      str
    end
  end
end

{% endsource %}

Spell checker calculates two distances for detecting word similarities:

* Jaro-Winkler distance - metric measuring an edit distance between two words
* Levenshtein distance - metric measuring the difference between two words

## Jaro-Winkler distance

This metric gives us a number called edit distance representing the similarity between two words:

* 0 means no similarity
* 1 means that they are identical

Edit distance is calculated by counting the minimum number of operations required to transform one string into the other.

Original algorithm is called "Jaro Similarity" and "Jaro-Winkler" is an improvement of that,
giving more favorable rating to the similarity of the beginning of compared words.

I will not go into too much detail about how this algorithm works, but here's an example for using it
to suggest correct band names:

```ruby
DICTIONARY = [
  "the beatles",
  "iron maiden",
  "the clash",
  "ramones",
  "madness",
  "the rolling stones"
]

def spell_check(term, treshold = 0.83)
  DICTIONARY.select do |word|
    DidYouMean::JaroWinkler.distance(word, term) >= treshold 
  end.sort_by do |word|
    DidYouMean::JaroWinkler.distance(word, term) 
  end.reverse
end

# Since beginnings are similar,
# we get useful suggestions.

spell_check("the beles")          # ["the beatles", "the clash"]
spell_check("sadness")            # ["madness"]
spell_check("the rolling santas") # ["the rolling stones"]
spell_check("ironman")            # ["iron maiden"]
spell_check("romans")             # ["ramones"]

# Since only endings are similar,
# we don't get useful suggestions.

spell_check("polite maiden")      # []
spell_check("car clash")          # []
spell_check("bowling stones")     # []
spell_check("los beatles")        # []
```

## Levenshtein distance

This metric gives us the number of edits needed to convert one word into another.

* 0 means no edits are needed - words are identical

Here are a couple of examples:

* Levenshtein distance between `foo` and `bar` is `3` since we had to change 3 characters
* Levenshtein distance between `ruby` and `rugby` is `1` since we had to change 1 character

I will not go into too much detail about how this algorithm works, but let's use
it on our previous example for spell checking band names:

```ruby
DICTIONARY = [
  "the beatles",
  "iron maiden",
  "the clash",
  "ramones",
  "madness",
  "the rolling stones"
]

def spell_check(term, threshold = 0.83)
  threshold  = (term.length * 0.25).ceil

  DICTIONARY.select do |word|
    DidYouMean::Levenshtein.distance(word, term) <= threshold 
  end.sort_by do |word|
    DidYouMean::Levenshtein.distance(word, term)
  end
end

# We no longer compare beginnings,
# so we get different results.

spell_check("the beles")          # ["the beatles"] <- changed
spell_check("sadness")            # ["madness"]
spell_check("the rolling santas") # ["the rolling stones"]
spell_check("ironman")            # [] <- changed
spell_check("romans")             # [] <- changed

# Since only endings are similar,
# we don't get useful suggestions.

spell_check("polite maiden")  # []
spell_check("car clash")      # ["the clash"] <- changed
spell_check("bowling stones") # []
spell_check("los beatles")    # ["the beatles"] <- changed
```

Notice the threshold set to 25%. This means that we are 
not going to consider two words similar if we have to change
more than 25% of the misspelled word to get to the valid word.

## Combining the algorithms

Did You Mean uses a combination of these two algorithms in order
to improve its accuracy:

```ruby
DICTIONARY = [
  "the beatles",
  "iron maiden",
  "the clash",
  "ramones",
  "madness",
  "the rolling stones"
]

def spell_check(term, threshold = 0.83)
  first_pass = DICTIONARY.select do |word|
    DidYouMean::JaroWinkler.distance(word, term) >= threshold 
  end.sort_by do |word|
    DidYouMean::JaroWinkler.distance(word, term) 
  end.reverse

  threshold  = (term.length * 0.25).ceil
  corrections = first_pass.select do |word|
    DidYouMean::Levenshtein.distance(word, term) <= threshold 
  end.sort_by do |word|
    DidYouMean::Levenshtein.distance(word, term)
  end
end

# Since beginnings are similar,
# we get useful suggestions.

spell_check("the beles")          # ["the beatles"]
spell_check("sadness")            # ["madness"]
spell_check("the rolling santas") # ["the rolling stones"]
spell_check("ironman")            # []
spell_check("romans")             # []

# Since only endings are similar,
# we don't get useful suggestions.

spell_check("polite maiden")  # []
spell_check("car clash")      # [] <- changed
spell_check("bowling stones") # []
spell_check("los beatles")    # [] <- changed
```

## Back to formatter

Now that we know how corrections get generated, we can go back to the original line inside `Correctable`:

{% source ruby location="https://github.com/ruby/did_you_mean/blob/8175f6eefb9c55a8906fc8bce2dd3b7c03de3e59/lib/did_you_mean/core_ext/name_error.rb#L9" cssclass=emphasized hl_lines="9" %}
module DidYouMean
  module Correctable
    def original_message
      method(:to_s).super_method.call
    end

    def to_s
      msg = super.dup
      suggestion = DidYouMean.formatter.message_for(corrections)

      msg << suggestion if !msg.end_with?(suggestion)
      msg
    rescue
      super
    end

    def corrections
      @corrections ||= spell_checker.corrections
    end

    def spell_checker
      SPELL_CHECKERS[self.class.to_s].new(self)
    end
  end
end
{% endsource %}

The formatter is set to `PlainFormatter` here:


{% source ruby location="https://github.com/ruby/did_you_mean/blob/8175f6eefb9c55a8906fc8bce2dd3b7c03de3e59/lib/did_you_mean.rb#L85-L110" cssclass=emphasized hl_lines="20 21 22 23 24 25" %}
module DidYouMean
  # Map of error types and spell checker objects.
  SPELL_CHECKERS = Hash.new(NullChecker)

  # Adds +DidYouMean+ functionality to an error using a given spell checker
  def self.correct_error(error_class, spell_checker)
    SPELL_CHECKERS[error_class.name] = spell_checker
    error_class.prepend(Correctable) unless error_class < Correctable
  end

  correct_error NameError, NameErrorCheckers
  correct_error KeyError, KeyErrorChecker
  correct_error NoMethodError, MethodNameChecker

  # Returns the currenctly set formatter. By default, it is set to +DidYouMean::Formatter+.
  def self.formatter
    @@formatter
  end

  # Updates the primary formatter used to format the suggestions.
  def self.formatter=(formatter)
    @@formatter = formatter
  end

  self.formatter = PlainFormatter.new
end
{% endsource %}

`PlainFormatter` simply appends the suggestion message to the end of exception message:


{% source ruby location="https://github.com/yuki24/did_you_mean/blob/8175f6eefb9c55a8906fc8bce2dd3b7c03de3e59/lib/did_you_mean/formatters/plain_formatter.rb" %}
# frozen-string-literal: true

module DidYouMean
  # The +DidYouMean::PlainFormatter+ is the basic, default formatter for the
  # gem. The formatter responds to the +message_for+ method and it returns a
  # human readable string.
  class PlainFormatter

    # Returns a human readable string that contains +corrections+. This
    # formatter is designed to be less verbose to not take too much screen
    # space while being helpful enough to the user.
    #
    # @example
    #
    #   formatter = DidYouMean::PlainFormatter.new
    #
    #   # displays suggestions in two lines with the leading empty line
    #   puts formatter.message_for(["methods", "method"])
    #
    #   Did you mean?  methods
    #                   method
    #   # => nil
    #
    #   # displays an empty line
    #   puts formatter.message_for([])
    #
    #   # => nil
    #
    def message_for(corrections)
      corrections.empty? ? "" :
        "\nDid you mean?  #{corrections.join("\n               ")}"
    end
  end
end

{% endsource %}

And that's it, we now know how Did You Mean appends its corrections
to the error messages.

## Bonus

As a reward for completing this article, I'd like to introduce a gem
that autofixes the suggestions from DidYouMean. It's called [I Did Mean](https://github.com/shime/i_did_mean)
and it comes with Rails integration.

Try it out and let me know what you think!
