import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { expect, it } from 'vitest'

it('upgrades promptly in Bun after ordinary HTTP has warmed the connection pool', async () => {
  const server = createServer((_req, res) => res.end('ready'))
  const sockets = new Set<import('node:net').Socket>()
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  const ws = new WebSocketServer({ server })
  ws.on('connection', socket => socket.send('connected'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as import('node:net').AddressInfo
  const helper = fileURLToPath(new URL('./application-upgrade.ts', import.meta.url))
  const script = `
    import { get, request, createServer } from 'node:http';
    import { applicationUpgrade } from ${JSON.stringify(helper)};
    const target = 'http://127.0.0.1:${address.port}/';
    const middle = createServer((req, res) => {
      get(target, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res) });
    });
    middle.on('upgrade', (req, socket, head) => {
      const upstream = request(target, { headers: req.headers, agent: false });
      upstream.on('upgrade', (res, peer, extra) => {
        socket.write('HTTP/1.1 101 Switching Protocols\\r\\n' + Object.entries(res.headers).map(([k,v]) => k + ': ' + v).join('\\r\\n') + '\\r\\n\\r\\n');
        if (extra.length) socket.write(extra);
        if (head.length) peer.write(head);
        socket.on('close', () => peer.destroy());
        peer.on('error', () => socket.destroy());
        socket.on('error', () => peer.destroy());
        peer.pipe(socket).pipe(peer);
      });
      upstream.on('error', () => socket.destroy());
      upstream.end();
    });
    await new Promise(resolve => middle.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + middle.address().port + '/';
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve, reject) => get(url, res => { res.resume(); res.on('end', resolve) }).on('error', reject));
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('upgrade stalled after HTTP warm-up')), 1000);
        const req = applicationUpgrade(url, {
          connection: 'Upgrade', upgrade: 'websocket',
          'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='
        });
        req.on('error', reject);
        req.on('upgrade', (res, socket, head) => {
          clearTimeout(timeout);
          if (res.statusCode !== 101) reject(new Error('unexpected status'));
          socket.destroy(); resolve();
        });
        req.end();
      });
    }
    console.log('five upgrades completed');
    process.exit(0);
  `
  try {
    const result = await promisify(execFile)('bun', ['--no-env-file', '-e', script], { timeout: 8000 })
    expect(result.stdout).toContain('five upgrades completed')
  } finally {
    for (const socket of sockets) socket.destroy()
    ws.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}, 10000)
