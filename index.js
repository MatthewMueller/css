
'use strict'

let convert = require('convert-source-map')
let cssdeps = require('@dominicbarnes/cssdeps')
let customImport = require('rework-custom-import')
let debug = require('debug')('mako-css')
let flatten = require('array-flatten')
let isUrl = require('is-url')
let isDataUri = require('is-datauri')
let path = require('path')
let Promise = require('bluebird')
let resolve = require('browser-resolve')
let rework = require('rework')
let rewrite = require('rework-plugin-url')
let strip = require('strip-extension')
let without = require('array-without')
let url = require('url')
let utils = require('mako-utils')

// default plugin configuration
const defaults = {
  extensions: [],
  resolveOptions: null,
  sourceMaps: false,
  sourceRoot: 'file://mako',
  rewrite: rewriter
}

// memory-efficient way of tracking mappings per-build
const mappings = new WeakMap()

// export the plugin fn as the primary export
exports = module.exports = plugin

// add the images/fonts extensions lists as secondary exports
exports.images = [ 'bmp', 'gif', 'jpg', 'jpeg', 'png', 'svg' ]
exports.fonts = [ 'eot', 'otf', 'ttf', 'woff', 'woff2' ]

/**
 * Initialize the mako js plugin.
 *
 * Available options:
 *  - root {String}  The root directory (default: pwd)
 *
 * @param {Object} options  Configuration.
 * @return {Function}
 */
function plugin (options) {
  debug('initialize %j', options)
  let config = Object.assign({}, defaults, options)

  return function (mako) {
    mako.dependencies('css', npm)
    mako.postdependencies('css', pack)
    mako.postdependencies([ plugin.images, plugin.fonts ], move)
  }

  /**
   * Mako dependencies hook that parses a JS file for `require` statements,
   * resolving them to absolute paths and adding them as dependencies.
   *
   * @param {File} file    The current file being processed.
   * @param {Build} build  The mako builder instance.
   */
  function * npm (file, build) {
    file.deps = Object.create(null)
    var deps = cssdeps(file.contents.toString(), { source: file.relative })
    debug('%d dependencies found for %s:', deps.length, utils.relative(file.path))
    deps.forEach(dep => debug('> %s', dep))

    yield Promise.map(deps, function (dep) {
      if (!relativeRef(dep)) {
        file.deps[dep] = false
        return
      }

      return Promise.fromCallback(function (done) {
        let options = Object.assign({}, config.resolveOptions, {
          filename: file.path,
          extensions: flatten([ '.css', config.extensions ]),
          packageFilter: packageFilter,
          pathFilter: pathFilter
        })

        let parent = utils.relative(file.path)
        debug('resolving %s from %s', dep, parent)
        resolve(dep, options, function (err, res, pkg) {
          if (err) return done(err)
          debug('resolved %s -> %s from %s', dep, utils.relative(res), utils.relative(file.path))
          file.pkg = pkg
          let depFile = build.tree.findFile(res)
          if (!depFile) depFile = build.tree.addFile(res)
          file.deps[dep] = depFile.relative
          file.addDependency(depFile)
          done()
        })
      })
    })
  }

  /**
   * Mako prewrite hook that rolls up all the CSS files into the root files.
   * (also removes all dependencies from the build tree)
   *
   * @param {File} file    The current file being processed.
   * @param {Build} build  The current build.
   */
  function pack (file, build) {
    let mapping = getMapping(build.tree)
    let root = isRoot(file)

    // add this file to the mapping
    mapping[id(file)] = prepare(file)

    // remove each dependant link
    file.dependants().forEach(dep => build.tree.removeDependency(dep, file.id))

    if (!root) {
      // anything other than the root should be removed
      build.tree.removeFile(file)
    } else {
      debug('packing %s', utils.relative(file.path))
      doPack(file, build, mapping, config)
    }
  }

  /**
   * Mako prewrite hook that takes external assets that are linked to deps and
   * link them to entry files instead. (so they'll be written even after the
   * tree has been pruned for pack)
   *
   * @param {File} file    The current file being processed.
   * @param {Build} build  The current build.
   */
  function move (file, build) {
    let mapping = getMapping(build.tree)
    let roots = findRoots(file)

    // add this file to the mapping
    mapping[id(file)] = prepare(file)

    // attach this file to each possible root
    roots.forEach(root => root.addDependency(file))

    // remove the link from the original dependants
    without(file.dependants(), roots).forEach(dep => dep.removeDependency(file))
  }

  /**
   * Transforms the given `file` into an object that is recognized by duo-pack.
   *
   * @param {File} file      The current file being processed.
   * @return {Object}
   */
  function prepare (file) {
    return {
      id: id(file),
      source: file.contents ? file.contents.toString() : null,
      deps: file.deps || {},
      entry: isRoot(file)
    }
  }
}

/**
 * Filter out the "main" filed
 *
 * @param {Object} pkg package object
 * @return {Object}
 */
function packageFilter (pkg) {
  if (pkg.style) {
    pkg.main = pkg.style
  } else if (pkg.main) {
    pkg.main = strip(pkg.main)
  }
  return pkg
}

/**
 * Used to filter out import/urls that should not be handled.
 * (ie: absolute urls and data-uris)
 *
 * @param {String} ref  The reference to examine.
 * @return {Boolean}
 */
function relativeRef (ref) {
  return !isUrl(ref) && !isDataUri(ref)
}

/**
 * Retrieve the mapping for this build tree, create one if necessary.
 *
 * @param {Tree} tree  The build tree to use as the key.
 * @return {Object}
 */
function getMapping (tree) {
  if (!mappings.has(tree)) {
    mappings.set(tree, Object.create(null))
  }

  return mappings.get(tree)
}

/**
 * Determine if a CSS file is at the root of a dependency chain. (allows for
 * non-CSS dependants, such as HTML)
 *
 * @param {File} file  The file to examine.
 * @return {Boolean}
 */
function isRoot (file) {
  // if there are no dependants, this is assumed to be a root (this could
  // possibly be inferred from file.entry)
  let dependants = file.dependants()
  if (dependants.length === 0) return true

  // if any of the dependants are not css, (ie: html) this is a root.
  return dependants.some(file => file.type !== 'css')
}

/**
 * Helper for finding the available roots reachable from a dependency file.
 *
 * @param {File} file  The file to search from.
 * @return {Array}
 */
function findRoots (file) {
  return file.dependants({ recursive: true }).filter(isRoot)
}

/**
 * Packs the CSS file and returns the resulting code and source map.
 *
 * @param {File} file          The entry file to pack
 * @param {Object} mapping     The mapping to be used by custom-import
 * @param {Mixed} sourceMaps   The sourceMaps config option
 * @param {String} sourceRoot  The sourceRoot config option
 * @return {Object}
 */
function doPack (file, build, mapping, config) {
  let css = rework(file.contents.toString(), { source: id(file) })
    .use(customImport(mapping))
    .use(rewrite(function (url) {
      if (!relativeRef(url)) return url
      let dep = mapping[this.position.source].deps[url]
      let filedep = build.tree.findFile(path.resolve(file.base, dep))
      return config.rewrite(filedep, file)
    }))

  let results = css.toString({
    sourcemap: true,
    sourcemapAsObject: true
  })

  let map = convert.fromObject(results.map)
  map.setProperty('sourceRoot', config.sourceRoot)

  file.contents = new Buffer(results.code)
  file.sourceMap = config.sourceMaps ? map.toObject() : null
}

/**
 * Default rewrite function
 */

function rewriter (file, parent) {
  return path.relative(parent.dirname, path.resolve(parent.base, file.relative))
}

/**
 * Helper for generating a source ID that's human-friendly and compatible with
 * rework.
 *
 * @param {File} file  The file to get the "id" from.
 * @return {String}
 */
function id (file) {
  return path.relative(file.base, file.initialPath)
}

/**
 * Strip querystring and hash from path before attempting to resolve.
 * @see resolve documentation
 *
 * @param {Object} pkg  The package meta.
 * @param {String} abs  The absolute path being resolved.
 * @param {String} rel  The relative path being resolved.
 * @return {String}
 */
function pathFilter (pkg, abs, rel) {
  return url.parse(rel).pathname
}
