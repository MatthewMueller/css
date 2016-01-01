
'use strict';

let chai = require('chai');
let css = require('..');
let fs = require('fs');
let mako = require('mako');
let path = require('path');
let stat = require('mako-stat');
let text = require('mako-text');

chai.use(require('chai-as-promised'));
let assert = chai.assert;
let fixture = path.resolve.bind(path, __dirname, 'fixtures');

describe('css plugin', function () {
  it('should create a script that executes and returns the top-level export', function () {
    let entry = fixture('simple/index.css');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(file.contents.trim(), expected('simple'));
      });
  });

  it('should work with nested modules', function () {
    let entry = fixture('nested/index.css');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(file.contents.trim(), expected('nested'));
      });
  });

  it('should remove the dependencies from the tree', function () {
    let entry = fixture('nested/index.css');
    let nested = fixture('nested/lib/index.css');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        assert.isFalse(tree.hasFile(nested));
      });
  });

  it('should work with installed modules', function () {
    let entry = fixture('modules/index.css');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(file.contents.trim(), expected('modules'));
      });
  });

  it('should properly resolve css even when modules specify a main js', function () {
    let entry = fixture('modules-with-js/index.css');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(file.contents.trim(), expected('modules-with-js'));
      });
  });

  it('should find assets linked to the entry file', function () {
    let entry = fixture('assets/index.css');
    let asset = fixture('assets/texture.png');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        assert.isTrue(tree.hasFile(asset));
        assert.isTrue(tree.hasDependency(entry, asset));
      });
  });

  it('should move assets linked to dependencies to the entry file', function () {
    let entry = fixture('nested-assets/index.css');
    let asset = fixture('nested-assets/lib/texture.png');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        assert.isTrue(tree.hasFile(asset));
        assert.isTrue(tree.hasDependency(entry, asset));
      });
  });

  it('should ignore absoulte urls', function () {
    let entry = fixture('http/index.css');
    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(file.contents.trim(), expected('http'));
      });
  });

  it('should ignore data-uris', function () {
    let entry = fixture('datauri/index.css');
    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(file.contents.trim(), expected('datauri'));
      });
  });

  it('should build from entries that are not CSS', function () {
    let entry = fixture('subentries/index.txt');
    let css = fixture('subentries/index.css');

    return mako()
      .use(text([ 'txt' ]))
      .dependencies('txt', function parseText(file) {
        var filepath = path.resolve(path.dirname(file.path), file.contents.trim());
        file.addDependency(filepath);
      })
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(css);
        assert.strictEqual(file.contents.trim(), expected('subentries'));
      });
  });

  context('with options', function () {
    // TODO: .root

    context('.extensions', function () {
      it('should be able to resolve all the specified extensions', function () {
        let entry = fixture('extensions/index.css');
        return mako()
          .use([ stat('less'), text('less') ])
          .postread('less', file => file.type = 'css')
          .use(plugins({ extensions: [ '.less' ] }))
          .build(entry)
          .then(function (tree) {
            let file = tree.getFile(entry);
            assert.strictEqual(file.contents.trim(), expected('extensions'));
          });
      });

      it('should be able to flatten the specified list', function () {
        let entry = fixture('extensions/index.css');
        return mako()
          .use([ stat('less'), text('less') ])
          .postread('less', file => file.type = 'css')
          .use(plugins({ extensions: '.less' }))
          .build(entry)
          .then(function (tree) {
            let file = tree.getFile(entry);
            assert.strictEqual(file.contents.trim(), expected('extensions'));
          });
      });
    });

    context('.resolveOptions', function () {
      it('should set config for resolve', function () {
        let entry = fixture('modules-alt-dir/index.css');

        return mako()
          .use(plugins({ resolveOptions: { moduleDirectory: 'npm' } }))
          .build(entry)
          .then(function (tree) {
            let file = tree.getFile(entry);
            assert.strictEqual(file.contents.trim(), expected('modules-alt-dir'));
          });
      });
    });
  });
});

/**
 * Helper for getting plugins used during tests.
 *
 * @param {Object} [options]  Plugin configuration.
 * @return {Array}
 */
function plugins(options) {
  return [
    stat('css'),
    text('css'),
    css(options)
  ];
}

/**
 * Read fixture
 *
 * @param  {path} path file path
 * @return {String}
 */
function read(path) {
  return fs.readFileSync(path, 'utf8');
}

/**
 * Read the expected
 *
 * @param  {String} name fixture name
 * @return {String}
 */
function expected(name) {
  return read(fixture(name, 'expected.css')).trim();
}
