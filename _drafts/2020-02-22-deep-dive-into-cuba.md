---
layout: post
title: Deep dive into Cuba
categories: random
---

Sorry to dissapoint you, but this is not a post about great diving spots in Cuba.
Instead of that, this article is going to explore how Cuba, an interesting Ruby
microframework, works behind the curtain.

It's similar to Sinatra, but even more micro than it: it has only 326 source lines of code, compared to Sinatra's 1915.

## Getting started

Let's dive right into it. Here's the "Hello World" example:

```ruby
# in config.ru
require "cuba"

Cuba.define do
  on get do
    on root do
      res.write "Hello world!"
    end
  end
end

run Cuba
```

Running this with `rackup`<sup>[[1](#rackup)]</sup> will start Puma and serve our app on port 9292.


---

### Notes and examples

1. <a name="rackup"></a>
If you want to know what happens when you run `rackup`, check out the deep dive post about it.
