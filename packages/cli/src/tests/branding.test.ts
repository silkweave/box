import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultBoxJson, readBoxJsonFile } from '@silkweave/box-core/box-json'
import { initBoxJson } from '../box-json.ts'

// Exercise the real Vite hooks without opening the Box or requiring a browser.
test('branding safely renders HTML, bakes the brand into a virtual module, serves the same manifest in dev/build, and rejects missing artwork', () => {
  execFileSync(process.execPath, ['--import', '@swc-node/register/esm-register', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { brandingPlugin, readBrand } from './apps/web/branding.ts';
    const name = 'North <Studio> & "Friends"';
    const plugin = brandingPlugin({ ...readBrand(), name, shortName: 'North', icon512: '/custom.png' });
    const html = plugin.transformIndexHtml('<title>__BOX_BRAND_NAME__</title><link href="__BOX_BRAND_ICON__">');
    assert.equal(html, '<title>North &lt;Studio&gt; &amp; &quot;Friends&quot;</title><link href="/custom.png">');
    // The React tree's copy: a module the bundle imports, resolved and loaded by this plugin alone.
    assert.equal(plugin.resolveId('virtual:box-brand'), '\\0virtual:box-brand');
    assert.equal(plugin.resolveId('./something-else'), undefined);
    const source = plugin.load('\\0virtual:box-brand');
    assert.match(source, /^export default \\{/);
    const baked = JSON.parse(source.slice('export default '.length));
    assert.equal(baked.name, name);
    assert.equal(baked.icon512, '/custom.png');
    assert.equal(plugin.load('other'), undefined);
    let emitted;
    plugin.generateBundle.call({ emitFile: asset => { emitted = asset; } });
    const manifest = JSON.parse(emitted.source);
    assert.equal(manifest.name, name);
    assert.equal(manifest.short_name, 'North');
    assert.equal(manifest.icons[1].src, '/custom.png');
    let served;
    plugin.configureServer({ middlewares: { use(path, handle) {
      assert.equal(path, '/manifest.webmanifest');
      handle({}, { setHeader(key, value) { assert.equal(value, 'application/manifest+json'); }, end(body) { served = body; } });
    } } });
    assert.equal(served, emitted.source);
    assert.throws(() => plugin.configResolved({ publicDir: 'apps/web/public' }), /Missing brand artwork/);
    assert.throws(() => brandingPlugin({ ...readBrand(), logoUrl: '/../secret.svg' }).configResolved({ publicDir: 'apps/web/public' }), /origin-relative/);
    // The default brand (this checkout's box.json, or core's defaults without one) ships its artwork.
    brandingPlugin().configResolved({ publicDir: 'apps/web/public' });
  `], { cwd: process.cwd(), stdio: 'pipe' })
})

test('box:json writes the defaults on a fresh checkout only, and the written file reads back as the defaults', () => {
  const root = mkdtempSync(join(tmpdir(), 'box-json-init-'))
  try {
    const first = initBoxJson(root)
    assert.equal(first.outcome, 'written')
    assert.deepEqual(readBoxJsonFile(first.file), defaultBoxJson())
    assert.equal(initBoxJson(root).outcome, 'present')
    rmSync(first.file)
    mkdirSync(join(root, 'data'), { recursive: true })
    writeFileSync(join(root, 'data', 'data.db'), 'an existing warehouse')
    const deferred = initBoxJson(root)
    assert.equal(deferred.outcome, 'deferred')
    assert.match(deferred.why, /data\/data\.db/)
    assert.equal(existsSync(deferred.file), false) // the identity is the boot's to move or refuse, never prepare's to choose
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
