# mako-css

> A [mako][mako] plugin for working with CSS, using npm as a package manager. In addition to bundling the
> CSS together, it also handles rewriting asset URLs.

[![npm version][npm-badge]][npm]
[![build status][travis-badge]][travis]
[![coverage][coveralls-badge]][coveralls]
[![npm dependencies][david-badge]][david]
[![npm dev dependencies][david-dev-badge]][david-dev]
[![code style][standard-badge]][standard]

## Purpose

 - builds CSS files in a manner similar to [mako-js](https://github.com/makojs/js), allowing npm packages
   with CSS, images, fonts, and other assets to also be modularized
 - finds dependencies through simple `@import "...";` and `url(...)` declarations
 - rewrites URLs relative to the output files (for easy deployment)

## API

### css(options)

Create a new plugin instance, with the following `options` available:

 - `extensions` the list of extensions **in addition to** `.css` to resolve (eg: `.less`, `.sass`)
 - `resolveOptions` additional options to be passed to [resolve](https://www.npmjs.com/package/resolve)
 - `sourceMaps` specify `true` to enable source-maps (default: `false`)
 - `sourceRoot` specifies the path used as the source map root (default: `"mako://"`)

### css.images

An `Array` of extensions for image files that this plugin will interact with. You can add to this
array directly, but for core support of other types, please open an issue.

### css.fonts

An `Array` of extensions for font files that this plugin will interact with. You can add to this
array directly, but for core support of other types, please open an issue.


[mako]: https://github.com/makojs/core
[coveralls]: https://coveralls.io/github/makojs/css
[coveralls-badge]: https://img.shields.io/coveralls/makojs/css.svg
[david]: https://david-dm.org/makojs/css
[david-badge]: https://img.shields.io/david/makojs/css.svg
[david-dev]: https://david-dm.org/makojs/css#info=devDependencies
[david-dev-badge]: https://img.shields.io/david/dev/makojs/css.svg
[npm]: https://www.npmjs.com/package/mako-css
[npm-badge]: https://img.shields.io/npm/v/mako-css.svg
[standard]: http://standardjs.com/
[standard-badge]: https://img.shields.io/badge/code%20style-standard-brightgreen.svg
[travis]: https://travis-ci.org/makojs/css
[travis-badge]: https://img.shields.io/travis/makojs/css.svg
