#!/usr/bin/env node

const minimist = require('minimist')
const Hyperswarm = require('hyperswarm')
const Hypercore = require('hypercore')
const DHT = require('@hyperswarm/dht')

const args = minimist(process.argv, { alias: { s: 'secret-key' } })
const node = new DHT()

const keyPair = DHT.keyPair(args.s ? Buffer.from(args.s, 'hex') : null)
const core = new Hypercore('./samples')

console.log('Using secret-key: ' + keyPair.secretKey.toString('hex').slice(0, 64))

const swarm = new Hyperswarm()

swarm.on('connection', socket => core.replicate(socket))

const server = node.createServer(function (socket) {
  console.log('Incoming sample...')

  socket.once('data', function (data) {
    let sample = null

    try {
      sample = JSON.parse(data.toString())
    } catch {
      return
    }

    core.append(JSON.stringify(sample)).then(function (seq) {
      console.log('Added sample, seq:', seq)
    })
  })

  socket.on('error', function (err) {
    console.log('Socket failed', err)
  })

  socket.on('end', function () {
    socket.end()
  })
})

server.listen(keyPair)

core.ready().then(function () {
  swarm.join(core.discoveryKey, { server: true, client: false })

  console.log('Server running on public key: ' + keyPair.publicKey.toString('hex'))
  console.log('Sample core key:', core.key.toString('hex'))
})
