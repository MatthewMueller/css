
'use strict';

let defaults = require('defaults');
let deps = require('file-deps');
let Pack = require('duo-pack');
let path = require('path');
let resolve = require('browser-resolve');
let without = require('array-without');

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
    if (file.isEntry()) file.mapping = Object.create(null);

    return Promise.all(deps(file.contents, 'css').map(function (dep) {
      return new Promise(function (accept, reject) {
        let options = {
          filename: file.path,
          extensions: [ '.css' ]
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
   * Mako prewrite hook that packs all JS entry files into a single file. (also
   * removes all dependencies from the build tree)
   *
   * @param {File} file     The current file being processed.
   * @param {Tree} tree     The build tree.
   */
  function combine(file, tree) {
    // add to the mapping for any linked entry files
    tree.getEntries(file.path).forEach(function (entry) {
      tree.getFile(entry).mapping[file.id] = prepare(file);
    });

    // move these dependency links to the entry file
    file.dependants().forEach(function (parent) {
      tree.removeDependency(parent, file.path);
    });

    if (!file.isEntry()) tree.removeFile(file.path);
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
    let entries = tree.getEntries(file.path);

    // add to the mapping for any linked entry files
    entries.forEach(function (entry) {
      tree.getFile(entry).mapping[file.id] = prepare(file);
      tree.addDependency(entry, file.path);
    });

    // move these dependency links to the entry file
    without(file.dependants(), entries).forEach(function (parent) {
      tree.removeDependency(parent, file.path);
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
   */
  function pack(file) {
    let pack = new Pack(file.mapping);
    let results = pack.pack(file.id);
    file.contents = results.code;
    // TODO: sourcemaps
  }
}
