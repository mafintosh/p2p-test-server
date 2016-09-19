#!/usr/bin/env node

var dgram = require('dgram')
var level = require('level')
var http = require('http')
var pump = require('pump')
var through = require('through2')
var ipinfo = require('get-ipinfo')
var corsify = require('corsify')

var db = level('p2p-test-server.db', {valueEncoding: 'json'})
var socket = dgram.createSocket('udp4')
var buffers = [[], []]

socket.on('message', function (message, from) {
  var token = message.slice(0, 32).toString('hex')
  var msg = message.slice(33).toString()
  var num = message[32]

  if (num > 2) return

  buffers[num].push({token: token, port: from.port, host: from.address})
  if (buffers[num].length > 128) buffers[num].shift()

  var other = num ? 0 : 1
  var found = null

  for (var i = 0; i < buffers[other].length; i++) {
    if (buffers[other][i].token === token) {
      found = buffers[other][i]
      break
    }
  }

  if (!found) return

  var a = {port: from.port, host: from.address}
  var b = {port: found.port, host: found.host}

  if (num) {
    var tmp = b
    b = a
    a = tmp
  }

  var doc = {
    time: new Date().toISOString(),
    description: msg,
    holePunchable: a.port === b.port && a.host === b.host,
    pings: [a, b]
  }

  console.log('Network reported:', doc)

  db.put(token, doc)

  var reply = new Buffer(JSON.stringify(doc))
  socket.send(reply, 0, reply.length, from.port, from.address)
})

socket.bind(10000)

var server = http.createServer(corsify(function (req, res) {
  if (req.url === '/') return ondigest(req, res)
  if (req.url === '/data') return ondata(req, res)
  res.statusCode = 404
  res.end()
}))

server.listen(process.env.PORT || 8080, function () {
  console.log('Server is listening on port ' + server.address().port)
})

function ondigest (req, res) {
  var result = {holePunchable: 0, holePunchablePercentage: 0, total: 0}

  db.createValueStream()
    .on('data', function (data) {
      result.total++
      if (data.holePunchable) result.holePunchable++
      result.holePunchablePercentage = Math.floor(1000 * result.holePunchable / result.total) / 10
    })
    .on('end', function () {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(result, null, 2) + '\n')
    })
}

function ondata (req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.write('[')

  var prev = false
  var transform = through.obj(write, flush)

  pump(db.createReadStream(), transform, res)

  function getInfo (data, enc, cb) {
    ipinfo(data.value.pings[0].host, function (err, info) {
      if (err) return write(data, enc, cb)
      data.value.ipinfo = info
      db.put(data.key, data.value, function () {
        write(data, enc, cb)
      })
    })
  }

  function write (data, enc, cb) {
    if (!data.value.ipinfo) return getInfo(data, enc, cb)
    transform.push((prev ? ', ' : '') + JSON.stringify(data.value, null, 2))
    prev = true
    cb(null)
  }

  function flush (cb) {
    transform.push(']\n')
    cb(null)
  }
}
