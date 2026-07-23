'use strict'

const net = require('net')
const tls = require('tls')

// Cache en memoire (par processus npm) du mode d'authentification detecte
// pour chaque proxy, afin d'eviter une sonde a chaque connexion.
const detectionCache = new Map()

function readHeaders (socket) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk) => {
      buffer += chunk.toString('latin1')
      if (buffer.includes('\r\n\r\n')) {
        socket.removeListener('data', onData)
        socket.removeListener('error', onError)
        resolve(buffer)
      }
    }
    const onError = (err) => {
      socket.removeListener('data', onData)
      reject(err)
    }
    socket.on('data', onData)
    socket.once('error', onError)
  })
}

function sendConnect (socket, options, authHeader) {
  socket.write(
    `CONNECT ${options.host}:${options.port} HTTP/1.1\r\n` +
    `Host: ${options.host}:${options.port}\r\n` +
    (authHeader ? `Proxy-Authorization: ${authHeader}\r\n` : '') +
    `Proxy-Connection: Keep-Alive\r\n\r\n`
  )
}

module.exports = class KerberosProxyAgent {
  constructor (proxy, options = {}) {
    this.proxy = new URL(proxy)
    this.options = options
  }

  async connect (request, options) {
    const socket = net.connect({
      host: this.proxy.hostname,
      port: this.proxy.port || 80,
    })

    await new Promise((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })

    const cacheKey = this.proxy.host
    const known = detectionCache.get(cacheKey)

    if (known === 'negotiate') {
      return this._negotiate(socket, options, '')
    }
    if (known === 'basic') {
      return this._basic(socket, options)
    }
    if (known === 'none') {
      sendConnect(socket, options, null)
      const response = await readHeaders(socket)
      if (/^HTTP\/1\.[01] 200/.test(response)) {
        return this._finish(socket, options)
      }
      detectionCache.delete(cacheKey)
    }

    // --- Sonde initiale : pas d'en-tete d'authentification ---
    sendConnect(socket, options, null)
    const probe = await readHeaders(socket)

    if (/^HTTP\/1\.[01] 200/.test(probe)) {
      detectionCache.set(cacheKey, 'none')
      return this._finish(socket, options)
    }

    const headerPart = probe.split('\r\n\r\n')[0]

    if (/^Proxy-Authenticate:\s*Negotiate/im.test(headerPart)) {
      detectionCache.set(cacheKey, 'negotiate')
      return this._negotiate(socket, options, '')
    }

    if (this.proxy.username) {
      detectionCache.set(cacheKey, 'basic')
      return this._basic(socket, options)
    }

    socket.destroy()
    const statusLine = probe.split('\r\n')[0]
    throw new Error(
      `Proxy CONNECT failed (${statusLine}) - pas de Negotiate propose ` +
      `et aucun identifiant Basic dans l'URL du proxy.`
    )
  }

  async _negotiate (socket, options, initialChallenge) {
    const kerberos = require('kerberos')
    const spn = `HTTP/${this.proxy.hostname}`
    const client = await kerberos.initializeClient(spn, {
      mechOID: kerberos.GSS_MECH_OID_SPNEGO,
    })

    let challenge = initialChallenge
    let response

    for (let i = 0; i < 3; i++) {
      const token = await client.step(challenge)
      sendConnect(socket, options, `Negotiate ${token}`)
      response = await readHeaders(socket)

      if (/^HTTP\/1\.[01] 200/.test(response)) {
        return this._finish(socket, options)
      }

      const hp = response.split('\r\n\r\n')[0]
      const match = hp.match(/^Proxy-Authenticate:\s*Negotiate\s+([A-Za-z0-9+/=]{20,})\s*$/im)

      if (!match || i === 2) {
        socket.destroy()
        throw new Error(`Proxy CONNECT (Negotiate) failed (${response.split('\r\n')[0]})`)
      }
      challenge = match[1]
    }
  }

  async _basic (socket, options) {
    const creds = Buffer.from(
      `${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`
    ).toString('base64')

    sendConnect(socket, options, `Basic ${creds}`)
    const response = await readHeaders(socket)

    if (!/^HTTP\/1\.[01] 200/.test(response)) {
      socket.destroy()
      throw new Error(`Proxy CONNECT (Basic) failed (${response.split('\r\n')[0]})`)
    }
    return this._finish(socket, options)
  }

  _finish (socket, options) {
    if (options.secureEndpoint) {
      return tls.connect({ socket, servername: options.host, ...this.options })
    }
    return socket
  }
}
