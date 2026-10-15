// 使い方: node /tmp/dsh-rpc.mjs <namespace/method> '<request JSON>'
// journal の最新の起動 URL からトークンを取り、Cookie を得て unary RPC を 1 回呼ぶ。トークンは表示しない。
import { execFileSync } from 'node:child_process'
const [endpoint, requestJson] = process.argv.slice(2)
const journal = execFileSync('journalctl', ['--user', '-u', 'deepseek-harness', '--no-pager', '-o', 'cat'], { encoding: 'utf8', maxBuffer: 1 << 28 })
const urls = [...journal.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:3080\/\?token=[\w-]+)/g)]
if (urls.length === 0) throw new Error('起動 URL が journal にありません')
const base = 'http://127.0.0.1:3080'
const auth = await fetch(urls.at(-1)[1], { redirect: 'manual' })
const cookie = (auth.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
if (!cookie) throw new Error(`Cookie を取得できません (status ${auth.status})`)
const body = { type: 'client-request', rpcId: `cs-${Date.now()}`, method: endpoint, payload: { args: { request: JSON.parse(requestJson) } } }
const res = await fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
console.log(res.status, await res.text())
