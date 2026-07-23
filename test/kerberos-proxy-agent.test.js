'use strict'

const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')

// Petit serveur TCP local qui joue le role du proxy d'entreprise :
// on lui donne un scenario (liste de reponses HTTP a renvoyer pour
// chaque CONNECT recu), il rejoue exactement ce que ferait un vrai
// proxy Skyhigh/Blue Coat/Squid.
function startFakeProxy (responses) {
  return new Promise((resolve) => {
    let call = 0
    const server = net.createServer((socket) => {
      socket.on('data', () => {
        const response = responses[Math.min(call, responses.length - 1)]
        call += 1
        socket.write(response)
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, port, callCount: () => call })
    })
  })
}

function closeServer (server) {
  return new Promise((resolve) => server.close(resolve))
}

const OPTS = { host: 'registry.npmjs.org', port: 443, secureEndpoint: false }

test('proxy sans authentification (200 direct) -> pas de negociation', async (t) => {
  const { server, port, callCount } = await startFakeProxy([
    'HTTP/1.1 200 Connection Established\r\n\r\n',
  ])
  t.after(() => closeServer(server))

  delete require.cache[require.resolve('../src/kerberos-proxy-agent.js')]
  const KerberosProxyAgent = require('../src/kerberos-proxy-agent.js')

  const agent = new KerberosProxyAgent(`http://127.0.0.1:${port}`)
  const socket = await agent.connect({}, OPTS)

  assert.equal(callCount(), 1, 'une seule tentative CONNECT, sans en-tete Proxy-Authorization')
  socket.end()
})

test('proxy Negotiate -> negociation SPNEGO complete (kerberos mocke)', async (t) => {
  const { server, port } = await startFakeProxy([
    'HTTP/1.1 407 authenticationrequired\r\nProxy-Authenticate: Negotiate\r\n\r\n',
    'HTTP/1.1 200 Connection Established\r\n\r\n',
  ])
  t.after(() => closeServer(server))

  mock.module('kerberos', {
    namedExports: {
      GSS_MECH_OID_SPNEGO: 6,
      initializeClient: async (spn) => {
        assert.match(spn, /^HTTP\//, 'le SPN doit utiliser le format Windows natif (slash, pas @)')
        return {
          step: async (challenge) => 'FAKE_BASE64_TOKEN==',
        }
      },
    },
  })

  delete require.cache[require.resolve('../src/kerberos-proxy-agent.js')]
  const KerberosProxyAgent = require('../src/kerberos-proxy-agent.js')

  const agent = new KerberosProxyAgent(`http://127.0.0.1:${port}`)
  const socket = await agent.connect({}, OPTS)
  assert.ok(socket)
  socket.end()

  mock.reset()
})

test('REGRESSION: challenge Negotiate vide suivi d\'un corps HTML -> erreur propre, pas de crash', async (t) => {
  // Reproduit exactement la reponse d'un Skyhigh Secure Web Gateway observee
  // en conditions reelles : "Proxy-Authenticate: Negotiate" sans token,
  // suivi d'une page HTML d'erreur. Avant le correctif, la regex capturait
  // "<!DOCTYPE" comme s'il s'agissait d'un challenge de continuation.
  const htmlBody =
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">\n<html><body>Authentication Required</body></html>'
  const { server, port } = await startFakeProxy([
    `HTTP/1.1 407 authenticationrequired\r\nProxy-Authenticate: Negotiate\r\nContent-Length: ${htmlBody.length}\r\n\r\n${htmlBody}`,
  ])
  t.after(() => closeServer(server))

  mock.module('kerberos', {
    namedExports: {
      GSS_MECH_OID_SPNEGO: 6,
      initializeClient: async () => ({
        step: async () => 'FAKE_BASE64_TOKEN==',
      }),
    },
  })

  delete require.cache[require.resolve('../src/kerberos-proxy-agent.js')]
  const KerberosProxyAgent = require('../src/kerberos-proxy-agent.js')

  const agent = new KerberosProxyAgent(`http://127.0.0.1:${port}`)

  await assert.rejects(
    () => agent.connect({}, OPTS),
    (err) => {
      assert.match(err.message, /Proxy CONNECT \(Negotiate\) failed/)
      assert.doesNotMatch(err.message, /DOCTYPE/, 'ne doit jamais tenter de decoder le corps HTML comme un token')
      return true
    }
  )

  mock.reset()
})

test('proxy Basic avec identifiants dans l\'URL -> authentification Basic', async (t) => {
  const { server, port } = await startFakeProxy([
    'HTTP/1.1 407 authenticationrequired\r\nProxy-Authenticate: Basic realm="proxy"\r\n\r\n',
    'HTTP/1.1 200 Connection Established\r\n\r\n',
  ])
  t.after(() => closeServer(server))

  delete require.cache[require.resolve('../src/kerberos-proxy-agent.js')]
  const KerberosProxyAgent = require('../src/kerberos-proxy-agent.js')

  const agent = new KerberosProxyAgent(`http://alice:s3cret@127.0.0.1:${port}`)
  const socket = await agent.connect({}, OPTS)
  assert.ok(socket)
  socket.end()
})

test('proxy Basic exige, mais aucun identifiant dans l\'URL -> erreur claire', async (t) => {
  const { server, port } = await startFakeProxy([
    'HTTP/1.1 407 authenticationrequired\r\nProxy-Authenticate: Basic realm="proxy"\r\n\r\n',
  ])
  t.after(() => closeServer(server))

  delete require.cache[require.resolve('../src/kerberos-proxy-agent.js')]
  const KerberosProxyAgent = require('../src/kerberos-proxy-agent.js')

  const agent = new KerberosProxyAgent(`http://127.0.0.1:${port}`)

  await assert.rejects(
    () => agent.connect({}, OPTS),
    /pas de Negotiate propose/
  )
})

test('cache de detection : un 2e connect() vers le meme proxy ne re-sonde pas si "none"', async (t) => {
  const { server, port, callCount } = await startFakeProxy([
    'HTTP/1.1 200 Connection Established\r\n\r\n',
    'HTTP/1.1 200 Connection Established\r\n\r\n',
  ])
  t.after(() => closeServer(server))

  delete require.cache[require.resolve('../src/kerberos-proxy-agent.js')]
  const KerberosProxyAgent = require('../src/kerberos-proxy-agent.js')

  const agent = new KerberosProxyAgent(`http://127.0.0.1:${port}`)
  const s1 = await agent.connect({}, OPTS)
  s1.end()
  const s2 = await agent.connect({}, OPTS)
  s2.end()

  assert.equal(callCount(), 2, 'toujours 1 CONNECT par connexion, mais sans sonde supplementaire ni double aller-retour')
})
