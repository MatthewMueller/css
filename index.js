
'use strict';

let defaults = require('defaults');
let deps = require('file-deps');
let isUrl = require('is-url');
let isDataUri = require('is-datauri');
let Pack = require('duo-pack');
let path = require('path');
let resolve = require('browser-resolve');
let strip = require('strip-extension');
let without = require('array-without');

const mappings = new WeakMap();

// export the plugin fn as the primary export
exports = module.exports = plugin;

// add the images/fonts extensions lists as secondary exports
exports.images = [ 'bmp', 'gif', 'jpg', 'jpeg', 'png', 'svg' ];
exports.fonts = [ 'eot', 'otf', 'ttf', 'woff' ];

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
  let config = defaults(options, { root: process.cwd() });

  return function (mako) {
    mako.postread([ 'css', plugin.images, plugin.fonts ], relative);
    mako.dependencies('css', npm);
    mako.postdependencies('css', combine);
    mako.postdependencies([ plugin.images, plugin.fonts ], move);
    mako.prewrite('css', pack);
  };

  /**
   * Adds an id for each file that's the relative path from the root.
   *
   * @param {File} file  The current file being processed.
   */
  function relative(file) {
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
        let options = {
          filename: file.path,
          extensions: [ '.css' ],
          packageFilter: packageFilter
        };

        resolve(dep, options, function (err, res, pkg) {
          if (err) return reject(err);
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
  function combine(file, tree) {
    let mapping = getMapping(tree);
    let remove = !isRoot(file);

    // add this file to the mapping
    mapping[file.id] = prepare(file);

    // remove each dependant link
    file.dependants().forEach(function (dep) {
      tree.removeDependency(dep, file.path);
    });

    // unless this file is a root, remove it from the tree
    if (remove) tree.removeFile(file.path);
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
      deps: file.deps || {},
      type: file.type,
      src: file.contents,
      entry: file.isEntry()
    };
  }

  /**
   * Transform the actual file code via duo-pack.
   *
   * @param {File} file  The current file being processed.
   * @param {Tree} tree  The build tree.
   */
  function pack(file, tree) {
    let mapping = getMapping(tree);
    let pack = new Pack(mapping);
    let results = pack.pack(file.id);
    file.contents = results.code;
    // TODO: sourcemaps
  }
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

  let tree = file.tree;

  // if there are no dependants, this is assumed to be a root (this could
  // possibly be inferred from file.entry)
  let dependants = file.dependants();
  if (dependants.length === 0) return true;

  // if any of the dependants are not css, (ie: html) this is a root.
  // TODO: support other file types (eg: less, sass, styl)
  return dependants.some(function (dependant) {
    return tree.getFile(dependant).type !== 'css';
  });
}

/**
 * Helper for finding the available roots reachable from a dependency file.
 *
 * @param {File} file  The file to search from.
 * @return {Array}
 */
function findRoots(file) {
  let tree = file.tree;
  return file.dependants(true).filter(function (dep) {
    let file = tree.getFile(dep);
    return isRoot(file);
  });
}
