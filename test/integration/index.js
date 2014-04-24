var backend = require('unpm-mem-backend')
  , unpm = require('../../index')
  , request = require('request')
  , semver = require('semver')
  , test = require('tape')
  , url = require('url')
  , fs = require('fs')

var fixture = JSON.parse(fs.readFileSync(__dirname + '/fixture.json'))

function start(unpm_service, port, on_server_listening) {
  unpm_service.server.listen(
      port
    , on_server_listening.bind(unpm_service)
  )
}

function nest(functions) {
  if(!functions.length) {
    return
  }

  functions.shift()(function() {
    nest(functions)
  })
}

var config = {}
  , unpm_service

config.host = {}
config.host.hostname = 'localhost'
config.host.protocol = 'http'
config.host.port = 8124
config.host.pathname = ''

config.check_auth = false

config.base_pathname = ''

config.crypto = {}
config.crypto.algorithm = 'sha512'
config.crypto.saltLength = 30
config.crypto.iterations = 10

config.verbose = false

config.backend = backend()

test('integration', function(t) {
  verify(config, t)
})

function verify(config, t) {
  var unpm_service = unpm(config)

  start(unpm_service, config.host.port, on_server_listening)

  function on_server_listening() {
    // Put a package in unpm, then get it and make sure it's what we put in
    // there in the first place.
    var fns = [
        put_package
      , try_putting_again
      , bump_version_and_put
      , get_latest
      , get_nonexistent_version
      , get_old_version
      , get_tarball
      , unpm_service.server.close.bind(unpm_service.server)
      , t.end.bind(t)
    ]

    nest(fns)
  }

  function put_package(done) {
    t.test('Can publish a package', function(t) {
      var req_options = {
          uri: url.format(config.host) + '/unpm'
        , body: JSON.stringify(fixture)
      }

      var req = request.put(req_options, onput)

      function onput(err, data) {
        t.plan(3)

        t.ok(!err, 'Put request does not error')
        t.ok(data, 'Has data')
        t.strictEqual(data.statusCode, 201, '201s')

        done()
      }
    })
  }

  function try_putting_again(done) {
    t.test('putting the same package/version twice 409s', function(t) {
      var req_options = {
          uri: url.format(config.host) + '/unpm'
        , body: JSON.stringify(fixture)
      }

      var req = request.put(req_options, onput)

      function onput(err, data) {
        t.plan(3)

        t.ok(!err, 'Request did not error')
        t.ok(data, 'Has data')
        t.strictEqual(data.statusCode, 409, 'Responds with 409')
        done()
      }
    })
  }

  function bump_version_and_put(done) {
    var latest = Object.keys(fixture.versions).sort(semver.lt)[0]

    var new_version = latest.split('.')

    new_version = (1 + +new_version[0]) + '.' + new_version.slice(1).join('.')

    fixture.versions[new_version] = JSON.parse(JSON.stringify(
        fixture.versions[latest]
    ))

    fixture.versions[new_version].version = new_version

    fixture['dist-tags'].latest = new_version

    fixture.versions[new_version].dist.tarball = url.format(config.host) +
       '/unpm/-/unpm-' + new_version + '.tgz'

    fixture._attachments[fixture.name + '-' + new_version + '.tgz'] =
      fixture._attachments[fixture.name + '-' + latest + '.tgz']

    t.test('Bumping version and publishing works', function(t) {
      var req_options = {
          uri: url.format(config.host) + '/unpm'
        , body: JSON.stringify(fixture)
      }

      var req = request.put(req_options, onput)

      function onput(err, data) {
        t.plan(3)
        t.ok(!err, 'No error')
        t.ok(data, 'Has data')

        t.strictEqual(data.statusCode, 201, 'Is a 201, for updated resource')

        done()
      }
    })
  }

  function get_latest(done) {
    t.test('GET package returns latest metadata', function(t) {
      var req_options = {
          uri: url.format(config.host) + '/unpm'
        , body: JSON.stringify(fixture)
      }

      var req = request.get(req_options, onget)

      function onget(err, data) {
        t.plan(6)
        t.ok(!err, 'Request did not error')
        t.ok(data, 'Has data')
        t.strictEqual(data.statusCode, 200, '200s')

        var body = JSON.parse(data.body)

        var expected_tarballs = []
          , result_tarballs = []

        for(var v in body.versions) {
          result_tarballs.push(body.versions[v].dist.tarball)
        }

        for(var v in fixture.versions) {
          expected_tarballs.push(
              url.format(config.host) + '/unpm/-/unpm-' + v + '.tgz'
          )
        }

        t.deepEqual(
            result_tarballs
          , expected_tarballs
          , 'Tarballs urls look right'
        )

        // The body has more keys than the fixture, which should be redundant
        // with the fixture.
        for(var key in body) {
          t.deepEqual(
              body[key]
            , fixture[key]
            , 'Key ' + key + ' matches between fixture and response body'
          )
        }

        done()
      }
    })
  }

  function get_nonexistent_version(done) {
    t.test('GET nonexistent version 404s', function(t) {
      var req_options = {
          uri: url.format(config.host) + '/unpm/0.0.1'
        , body: JSON.stringify(fixture)
      }

      var req = request.get(req_options, onget)

      function onget(err, data) {
        t.plan(5)
        t.ok(!err, 'Request did not error')
        t.ok(data, 'Has data')
        t.strictEqual(data.statusCode, 404, '404s')

        var body = JSON.parse(data.body)

        t.strictEqual(body.error, 'not_found', 'Has correct error')
        t.strictEqual(body.reason, 'Document not found.', 'Has correct reason')

        done()
      }
    })
  }

  function get_old_version(done) {
    t.test('GET old version works correctly', function(t) {
      var req_options = {
          uri: url.format(config.host) + '/unpm/0.0.9'
        , body: JSON.stringify(fixture)
      }

      var req = request.get(req_options, onget)

      function onget(err, data) {
        t.plan(4)
        t.ok(!err, 'Request did not error')
        t.ok(data, 'Has data')
        t.strictEqual(data.statusCode, 200, '200 status code')

        var body = JSON.parse(data.body)

        var expected = fixture.versions['0.0.9']

        t.deepEqual(
            expected
          , body
          , 'Has correct metadata for version requested'
        )
        done()
      }
    })
  }

  function get_tarball(done) {
    t.test('GET tarball does the right thing', function(t) {
      var req_options = {
          uri: url.format(config.host) + '/unpm/-/unpm-0.0.9.tgz'
        , body: JSON.stringify(fixture)
      }

      var req = request.get(req_options, onget)

      function onget(err, data) {
        t.plan(4)
        t.ok(!err, 'Request did not error')
        t.ok(data, 'Has data')
        t.strictEqual(data.statusCode, 200, '200 status code')

        var expected = Buffer(
            fixture._attachments['unpm-0.0.9.tgz'].data
          , 'base64'
        ).toString()

        t.strictEqual(
            data.body
          , expected
          , 'Got correct tarball'
        )
        done()
      }
    })
  }
}