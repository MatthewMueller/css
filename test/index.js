
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

let plugins = [
  stat('css'),
  text('css'),
  css()
];

describe('css plugin', function () {
  it('should create a script that executes and returns the top-level export', function () {
    let entry = fixture('simple/index.css');

    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(file.contents, expected('simple'));
      });
  });

  it('should work with nested modules', function () {
    let entry = fixture('nested/index.css');

    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(file.contents, expected('nested'));
      });
  });

  it('should remove the dependencies from the tree', function () {
    let entry = fixture('nested/index.css');
    let nested = fixture('nested/lib/index.css');

    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        assert.isFalse(tree.hasFile(nested));
      });
  });

  it('should work with installed modules', function () {
    let entry = fixture('modules/index.css');

    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(file.contents, expected('modules'));
      });
  });

  it('should properly resolve css even when modules specify a main js', function () {
    let entry = fixture('modules-with-js/index.css');

    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(file.contents, expected('modules-with-js'));
      });
  });

  it('should find assets linked to the entry file', function () {
    let entry = fixture('assets/index.css');
    let asset = fixture('assets/texture.png');

    return mako()
      .use(plugins)
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
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        assert.isTrue(tree.hasFile(asset));
        assert.isTrue(tree.hasDependency(entry, asset));
      });
  });

  it('url(http://...) should work', function () {
    let entry = fixture('http/index.css');
    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(file.contents, expected('http'));
      });
  });

  it('url(data:...) should work', function () {
    let entry = fixture('datauri/index.css');
    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(file.contents, expected('datauri'));
      });
  });
});

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
  return read(fixture(name, 'expected.css'));
}
