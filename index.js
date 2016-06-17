
'use strict';

let convert = require('convert-source-map');
let customImport = require('rework-custom-import');
let debug = require('debug')('mako-css');
let deps = require('file-deps');
let flatten = require('array-flatten');
let isUrl = require('is-url');
let isDataUri = require('is-datauri');
let path = require('path');
let resolve = require('browser-resolve');
let rework = require('rework');
let rewrite = require('rework-plugin-url');
let strip = require('strip-extension');
let without = require('array-without');
let relative = require('relative');

// default plugin configuration
const defaults = {
  extensions: [],
  resolveOptions: null,
  sourceMaps: false,
  sourceRoot: 'file://mako'
};

// memory-efficient way of tracking mappings per-build
const mappings = new WeakMap();

// export the plugin fn as the primary export
exports = module.exports = plugin;

// add the images/fonts extensions lists as secondary exports
exports.images = [ 'bmp', 'gif', 'jpg', 'jpeg', 'png', 'svg' ];
exports.fonts = [ 'eot', 'otf', 'ttf', 'woff', 'woff2' ];

/**
 * Initialize the mako js plugin.
 *
 * Available options:
 *  - root {String}  The root directory (default: pwd)
 *
 * @param {Object} options  Configuration.
 * @return {Function}
 */
function plugin(options) {
  debug('initialize %j', options);
  let config = extend(defaults, options);

  return function (mako) {
    mako.dependencies('css', npm);
    mako.postdependencies('css', pack);
    mako.postdependencies([ plugin.images, plugin.fonts ], move);
  };

  /**
   * Mako dependencies hook that parses a JS file for `require` statements,
   * resolving them to absolute paths and adding them as dependencies.
   *
   * @param {File} file    The current file being processed.
   * @param {Build} build  The mako builder instance.
   */
  function* npm(file, build) {
    let timer = build.time('css:resolve');

    file.deps = Object.create(null);

    // find the list of refs, ignore any absolute urls or data-urls
    var dependencies = deps(file.contents.toString(), 'css').filter(relativeRef);

    yield Promise.all(dependencies.map(function (dep) {
      return new Promise(function (accept, reject) {
        let options = extend(config.resolveOptions, {
          filename: file.path,
          extensions: flatten([ '.css', config.extensions ]),
          packageFilter: packageFilter
        });

        let parent = relative(file.path);
        debug('resolving %s from %s', dep, parent);
        resolve(dep, options, function (err, res, pkg) {
          if (err) return reject(err);
          debug('resolved %s -> %s from %s', dep, relative(res), relative(file.path));
          file.pkg = pkg;
          let depFile = build.tree.findFile(res);
          if (!depFile) depFile = build.tree.addFile(res);
          file.deps[dep] = depFile.relative;
          file.addDependency(depFile);
          accept();
        });
      });
    }));

    timer();
  }

  /**
   * Mako prewrite hook that rolls up all the CSS files into the root files.
   * (also removes all dependencies from the build tree)
   *
   * @param {File} file    The current file being processed.
   * @param {Build} build  The current build.
   */
  function pack(file, build) {
    let timer = build.time('css:pack');

    let mapping = getMapping(build.tree);
    let root = isRoot(file);

    // add this file to the mapping
    mapping[id(file)] = prepare(file);

    // remove each dependant link
    file.dependants().forEach(function (dep) {
      build.tree.removeDependency(dep, file.id);
    });

    if (!root) {
      // anything other than the root should be removed
      build.tree.removeFile(file);
    } else {
      debug('packing %s', relative(file.path));

      let results = doPack(file, mapping, config.sourceMaps, config.sourceRoot);
      file.contents = new Buffer(results.code);
      file.sourceMap = results.map;

      timer();
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
  function move(file, build) {
    let mapping = getMapping(build.tree);
    let roots = findRoots(file);

    // add this file to the mapping
    mapping[id(file)] = prepare(file);

    // attach this file to each possible root
    roots.forEach(function (root) {
      root.addDependency(file);
    });

    // remove the link from the original dependants
    without(file.dependants(), roots).forEach(function (dep) {
      dep.removeDependency(file);
    });
  }

  /**
   * Transforms the given `file` into an object that is recognized by duo-pack.
   *
   * @param {File} file      The current file being processed.
   * @return {Object}
   */
  function prepare(file) {
    return {
      id: id(file),
      source: file.contents ? file.contents.toString() : null,
      deps: file.deps || {},
      entry: isRoot(file)
    };
  }
}

/**
 * Helper for generating objects. The returned value is always a fresh object
 * with all arguments assigned as sources.
 *
 * @return {Object}
 */
function extend() {
  var sources = [].slice.call(arguments);
  var args = [ Object.create(null) ].concat(sources);
  return Object.assign.apply(null, args);
}

/**
 * Filter out the "main" filed
 *
 * @param {Object} pkg package object
 * @return {Object}
 */
function packageFilter(pkg) {
  if (pkg.style) {
    pkg.main = pkg.style;
  } else if (pkg.main) {
    pkg.main = strip(pkg.main);
  }
  return pkg;
}

/**
 * Used to filter out import/urls that should not be handled.
 * (ie: absolute urls and data-uris)
 *
 * @param {String} ref  The reference to examine.
 * @return {Boolean}
 */
function relativeRef(ref) {
  return !isUrl(ref) && !isDataUri(ref);
}

/**
 * Retrieve the mapping for this build tree, create one if necessary.
 *
 * @param {Tree} tree  The build tree to use as the key.
 * @return {Object}
 */
function getMapping(tree) {
  if (!mappings.has(tree)) {
    mappings.set(tree, Object.create(null));
  }

  return mappings.get(tree);
}

/**
 * Determine if a CSS file is at the root of a dependency chain. (allows for
 * non-CSS dependants, such as HTML)
 *
 * @param {File} file  The file to examine.
 * @return {Boolean}
 */
function isRoot(file) {
  // if there are no dependants, this is assumed to be a root (this could
  // possibly be inferred from file.entry)
  let dependants = file.dependants();
  if (dependants.length === 0) return true;

  // if any of the dependants are not css, (ie: html) this is a root.
  return dependants.some(file => file.type !== 'css');
}

/**
 * Helper for finding the available roots reachable from a dependency file.
 *
 * @param {File} file  The file to search from.
 * @return {Array}
 */
function findRoots(file) {
  return file.dependants({ recursive: true }).filter(isRoot);
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
function doPack(file, mapping, sourceMaps, sourceRoot) {
  // console.log(mapping);
  let css = rework(file.contents.toString(), { source: id(file) })
    .use(customImport(mapping))
    .use(rewrite(function (url) {
      if (!relativeRef(url)) return url;
      let urlpath = url.split(/[?#]/)[0];
      let dep = mapping[this.position.source].deps[urlpath];
      return path.relative(file.dirname, dep);
    }));

  let results = css.toString({
    sourcemap: true,
    sourcemapAsObject: true
  });

  let map = convert.fromObject(results.map);
  map.setProperty('sourceRoot', sourceRoot);

  return {
    code: results.code,
    map: sourceMaps ? map.toObject() : null
  };
}

/**
 * Helper for generating a source ID that's human-friendly and compatible with
 * rework.
 *
 * @param {File} file  The file to get the "id" from.
 * @return {String}
 */
function id(file) {
  return path.relative(file.base, file.initialPath);
}
