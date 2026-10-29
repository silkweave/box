import type { BoxBrand } from '@silkweave/box-core'
import type { publicNotice } from './maintenance.js'

export type MaintenanceNotice = NonNullable<ReturnType<typeof publicNotice>>

/**
 * The page the supervisor serves while the Box is in maintenance (`notice` set) or while the app is
 * restarting (`notice` null). Self-contained: inline CSS and script, the logo from the supervisor's
 * own Builder assets (the current snapshot's versioned path, which every instance has), so it renders
 * with the app down. Live: it follows /api/box-status/events,
 * redraws the checklist and countdown, and reloads once the Box is back.
 */
export function maintenancePage(brand: Pick<BoxBrand, 'name' | 'logoUrl' | 'themeColor'>, notice: MaintenanceNotice | null, uiVersion: string | null = null): string {
  const logo = brand.logoUrl.startsWith('/builder-assets/') ? brand.logoUrl : `/builder-assets${uiVersion ? `/${uiVersion}` : ''}${brand.logoUrl}`
  const data = JSON.stringify({ name: brand.name, notice }).replace(/</g, '\\u003c')
  const accent = /^#[0-9a-f]{3,8}$/i.test(brand.themeColor) ? brand.themeColor : '#7b7ef5'
  const title = notice ? `${brand.name}: maintenance` : `${brand.name}: restarting`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
:root{--accent:${accent};--bg:#f7f7fb;--card:#ffffff;--text:#16161d;--muted:#6b6b7b;--line:#e6e6ef;--done:#1f9d63;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d14;--card:#15151f;--text:#ececf4;--muted:#9a9aae;--line:#262634;--done:#3ccf8e}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{background:var(--bg);color:var(--text);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100dvh;padding:24px}
body::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(60rem 30rem at 50% -10%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 70%)}
main{position:relative;width:100%;max-width:34rem}
.brand{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:28px;font-weight:600;letter-spacing:-.01em}
.brand img{width:36px;height:36px}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:32px;box-shadow:0 20px 60px -30px rgba(0,0,0,.35)}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.pulse{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}
h1{margin:12px 0 0;font-size:28px;line-height:1.2;letter-spacing:-.02em}
.status{margin:14px 0 0;color:var(--muted);white-space:pre-line}
.eta{margin-top:24px;display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.eta strong{font-size:18px}
.eta span{color:var(--muted);font-size:14px}
.bar{margin-top:12px;height:6px;border-radius:99px;background:var(--line);overflow:hidden}
.bar i{display:block;height:100%;width:0;border-radius:99px;background:var(--accent);transition:width .6s ease}
ol{list-style:none;margin:24px 0 0;padding:0;display:grid;gap:2px}
li{display:flex;align-items:flex-start;gap:12px;padding:9px 10px;border-radius:10px}
li.active{background:color-mix(in srgb,var(--accent) 10%,transparent);font-weight:600}
li.done span,li.skipped span{color:var(--muted)}
li.skipped span{text-decoration:line-through}
.icon{flex:none;width:20px;height:20px;margin-top:2px;border-radius:50%;display:grid;place-items:center}
li.pending .icon{border:2px solid var(--line)}
li.active .icon{border:2px solid color-mix(in srgb,var(--accent) 30%,transparent);border-top-color:var(--accent);animation:spin 1s linear infinite}
li.done .icon{background:var(--done)}
li.done .icon::after{content:"";width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:translateY(-1px) rotate(45deg)}
li.skipped .icon{border:2px solid var(--line)}
li.skipped .icon::after{content:"";width:8px;height:2px;background:var(--muted)}
@keyframes spin{to{transform:rotate(360deg)}}
footer{margin-top:20px;text-align:center;color:var(--muted);font-size:13px}
footer a{color:inherit}
@media (prefers-reduced-motion:reduce){.pulse,li.active .icon{animation:none}}
</style>
</head>
<body>
<main>
  <div class="brand"><img src="${escapeHtml(logo)}" alt=""><span id="name"></span></div>
  <section class="card" aria-live="polite">
    <div class="eyebrow"><span class="pulse"></span><span id="eyebrow"></span></div>
    <h1 id="headline"></h1>
    <p class="status" id="status"></p>
    <div id="progress" hidden>
      <div class="eta"><strong id="eta"></strong><span id="count"></span></div>
      <div class="bar"><i id="fill"></i></div>
    </div>
    <ol id="tasks"></ol>
  </section>
  <footer><span id="since"></span><span id="signin"> · <a href="/login">Admin sign-in</a></span></footer>
</main>
<noscript><p style="text-align:center">${escapeHtml(notice?.status || 'This Box is being updated. Please check back shortly.')}</p></noscript>
<script id="box-maintenance" type="application/json">${data}</script>
<script>
(() => {
  const initial = JSON.parse(document.getElementById('box-maintenance').textContent)
  let notice = initial.notice
  const $ = id => document.getElementById(id)
  $('name').textContent = initial.name
  const clock = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  function eta() {
    if (!notice || !notice.eta) return notice ? 'Back online soon' : 'Back in a moment'
    const minutes = Math.round((Date.parse(notice.eta) - Date.now()) / 60000)
    if (minutes > 90) return 'Back online around ' + clock(notice.eta)
    if (minutes > 1) return 'Back online in about ' + minutes + ' min'
    if (minutes >= 0) return 'Back online in a minute or so'
    return 'Taking a little longer than expected'
  }
  function render() {
    document.title = initial.name + (notice ? ': maintenance' : ': restarting')
    $('eyebrow').textContent = notice ? 'Maintenance' : 'Restarting'
    $('headline').textContent = notice ? 'A little work. A better Box.' : 'Back in a moment.'
    $('status').textContent = notice ? (notice.status || 'Your team is making an update. This page refreshes on its own.') : 'The Box is restarting. This page reloads by itself when it is ready.'
    const tasks = notice ? notice.tasks : []
    const finished = tasks.filter(t => t.state === 'done' || t.state === 'skipped').length
    $('progress').hidden = !notice
    $('eta').textContent = eta()
    $('count').textContent = tasks.length ? finished + ' of ' + tasks.length + ' done' : ''
    $('fill').style.width = tasks.length ? Math.round(finished / tasks.length * 100) + '%' : '0'
    const list = $('tasks')
    list.replaceChildren(...tasks.map(t => {
      const li = document.createElement('li')
      li.className = t.state
      const icon = document.createElement('i'); icon.className = 'icon'
      const label = document.createElement('span'); label.textContent = t.label
      li.append(icon, label)
      return li
    }))
    list.hidden = !tasks.length
    $('since').textContent = notice && notice.startedAt ? 'Started ' + clock(notice.startedAt) : initial.name
    $('signin').hidden = !!(notice && notice.lockAdmins)
  }
  // Back when the Box answers the page itself again (not this supervisor page).
  async function waitForBox() {
    for (;;) {
      try {
        const res = await fetch(location.href, { method: 'HEAD', cache: 'no-store' })
        if (res.status !== 503) { location.reload(); return }
      } catch {}
      await new Promise(done => setTimeout(done, 2500))
    }
  }
  render()
  setInterval(() => { $('eta').textContent = eta() }, 15000)
  if (!notice) { void waitForBox(); return }
  // The supervisor's status socket; each connection opens with the full state, so a reconnect needs no catch-up.
  const follow = () => {
    const events = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/box-status/events')
    let done = false
    events.onmessage = event => {
      try {
        const status = JSON.parse(event.data)
        if (status.maintenance === false) { done = true; events.close(); void waitForBox(); return }
        if (status.notice) { notice = status.notice; render() }
      } catch {}
    }
    events.onclose = () => { if (!done) setTimeout(follow, 3000) }
  }
  follow()
})()
</script>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
