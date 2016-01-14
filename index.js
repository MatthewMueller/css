
'use strict';

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

const pwd = process.cwd();
const relative = abs => path.relative(pwd, abs);

// default plugin configuration
const defaults = {
  extensions: [],
  resolveOptions: null,
  root: pwd,
  sourceMaps: false
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
    mako.predependencies([ 'css', plugin.images, plugin.fonts ], id);
    mako.dependencies('css', npm);
    mako.postdependencies('css', pack);
    mako.postdependencies([ plugin.images, plugin.fonts ], move);
  };

  /**
   * Adds an id for each file that's the relative path from the root.
   *
   * @param {File} file  The current file being processed.
   */
  function id(file) {
    file.id = path.relative(config.root, file.path);
  }

  /**
   * Mako dependencies hook that parses a JS file for `require` statements,
   * resolving them to absolute paths and adding them as dependencies.
   *
   * @param {File} file     The current file being processed.
   * @param {Tree} tree     The build tree.
   * @param {Builder} mako  The mako builder instance.
   * @return {Promise}
   */
  function npm(file) {
    file.deps = Object.create(null);

    // find the list of refs, ignore any absolute urls or data-urls
    var dependencies = deps(file.contents, 'css').filter(relativeRef);

    return Promise.all(dependencies.map(function (dep) {
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
          let child = relative(res);
          debug('resolved %s -> %s from %s', dep, child, parent);
          file.deps[dep] = path.relative(config.root, res);
          file.pkg = pkg;
          file.addDependency(res);
          accept();
        });
      });
    }));
  }

  /**
   * Mako prewrite hook that rolls up all the CSS files into the root files.
   * (also removes all dependencies from the build tree)
   *
   * @param {File} file  The current file being processed.
   * @param {Tree} tree  The build tree.
   */
  function pack(file, tree) {
    let mapping = getMapping(tree);
    let root = isRoot(file);

    // add this file to the mapping
    mapping[file.id] = prepare(file);

    // remove each dependant link
    file.dependants().forEach(function (dep) {
      tree.removeDependency(dep, file.path);
    });

    if (!root) {
      // anything other than the root should be removed
      tree.removeFile(file.path);
    } else {
      debug('packing %s', relative(file.path));
      let css = rework(file.contents, { source: file.id })
        .use(customImport(mapping))
        .use(rewrite(function (url) {
          if (!relativeRef(url)) return url;
          let entry = path.dirname(file.id);
          let dep = mapping[this.position.source].deps[url];
          return path.relative(entry, dep);
        }));

      if (config.sourceMaps === true) {
        let results = css.toString({
          sourcemap: true,
          sourcemapAsObject: true
        });
        let map = file.addDependency(file.path + '.map');
        file.contents = results.code;
        map.contents = JSON.stringify(results.map);
      } else {
        file.contents = css.toString({
          sourcemap: config.sourceMaps === 'inline'
        });
      }
    }
  }

  /**
   * Mako prewrite hook that takes external assets that are linked to deps and
   * link them to entry files instead. (so they'll be written even after the
   * tree has been pruned for pack)
   *
   * @param {File} file  The current file being processed.
   * @param {Tree} tree  The build tree.
   */
  function move(file, tree) {
    let mapping = getMapping(tree);
    let roots = findRoots(file);

    // add this file to the mapping
    mapping[file.id] = prepare(file);

    // attach this file to each possible root
    roots.forEach(function (root) {
      tree.addDependency(root, file.path);
    });

    // remove the link from the original dependants
    without(file.dependants(), roots).forEach(function (dep) {
      tree.removeDependency(dep, file.path);
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
      id: file.id,
      source: file.contents,
      deps: file.deps || {},
      entry: file.isEntry()
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
  if (pkg.main) pkg.main = strip(pkg.main);
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
  // short-circuit, an entry file is automatically considered a root
  if (file.entry) return true;

  // if there are no dependants, this is assumed to be a root (this could
  // possibly be inferred from file.entry)
  let dependants = file.dependants({ objects: true });
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
  return file.dependants({ recursive: true, objects: true })
    .filter(file => isRoot(file))
    .map(file => file.path);
}
