import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const moduleURL = new URL('../src/serverURL.ts', import.meta.url).href

function load(origin, nodeEnv = 'production') {
  const env = { ...process.env, NODE_ENV: nodeEnv }
  if (origin === undefined) delete env.SERVER_URL
  else env.SERVER_URL = origin
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    `const config = await import(${JSON.stringify(moduleURL)}); console.log(JSON.stringify(config))`,
  ], { env, encoding: 'utf8' })
}

test('HTTPS enables Secure cookies and normalizes the application origin', () => {
  const result = load('https://libdesk.example/')
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), { secureCookies: true, serverURL: 'https://libdesk.example' })
})

test('local production checks can still use HTTP', () => {
  const result = load('http://127.0.0.1:3100')
  assert.equal(result.status, 0)
  assert.equal(JSON.parse(result.stdout).secureCookies, false)
})

test('production requires an explicit application origin', () => {
  assert.notEqual(load(undefined).status, 0)
})

test('development retains the localhost default', () => {
  assert.equal(JSON.parse(load(undefined, 'development').stdout).serverURL, 'http://localhost:3000')
})

test('external HTTP, credentials, paths and query strings are rejected', () => {
  for (const origin of ['http://libdesk.example', 'https://user:pass@libdesk.example', 'https://libdesk.example/admin', 'https://libdesk.example?x=1', 'https://libdesk.example#x']) {
    assert.notEqual(load(origin).status, 0, origin)
  }
})
