# mako-css

> A mako plugin that bundles a collection of CSS files into a single output file,
while maintaining links to external assets like images and fonts.
(example: [duo](http://duojs.org/))

## Usage

```js
var mako = require('mako');
var stat = require('mako-stat');
var text = require('mako-text');
var css = require('mako-css');

mako()
  .use(stat([ 'css' /* other image/font extensions */ ]))
  .use(text([ 'css' /* other image/font extensions */ ]))
  .use(css())
  .build('./index.css')
  .then(function () {
    // done!
  });
```

## API

### css(options)

Create a new plugin instance, with the following `options` available:

 - `root` the root for the project, paths will be set relative to here (default: `pwd`)

## Dependencies

 - a read plugin for `css` extensions that has populated `file.contents` with a string

## Effects

During analyze, this will parse CSS files for `@import` statements and `url(...)` links that are used to resolve dependencies.

During build, each entry CSS file will be bundled into a single output file, all the CSS dependencies will be pruned from the build tree. Other linked assets, such as images and fonts, will be set as dependencies of each linked entry file. (so they will be handled during write)

## Use-Cases

This seeks to accomplish what build tools like Duo and Browserify do for front-end workflows.
