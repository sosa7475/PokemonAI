/**
 * The operator dashboard, as one self-contained page.
 *
 * No build step and no framework on purpose: it's a page you open twice a day to see
 * whether anyone is still playing, and a toolchain for that would outlive its usefulness.
 * The admin key is held in sessionStorage, so it's gone when the tab closes.
 */
export function dashboardHtml(): string {
  return `<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
<title>CryptoBuds — players</title>
<style>
  :root{--bg:#11160e;--panel:#19210f;--edge:#2c3a20;--ink:#eaf3e0;--muted:#8fa383;--green:#7ed957;--orange:#ff9d4d}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;padding:24px}
  .wrap{max-width:1080px;margin:0 auto}
  h1{font-size:1.5rem;margin-bottom:.15rem}
  .sub{color:var(--muted);margin-bottom:1.5rem;font-size:.9rem}
  .gate{display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap}
  input{flex:1;min-width:220px;padding:.7rem .9rem;border-radius:10px;border:1px solid var(--edge);background:var(--panel);color:var(--ink);font:inherit}
  button{padding:.7rem 1.2rem;border-radius:10px;border:none;background:var(--green);color:#11160e;font:inherit;font-weight:700;cursor:pointer}
  button.ghost{background:transparent;border:1px solid var(--edge);color:var(--muted);font-weight:500;padding:.3rem .7rem;font-size:.8rem}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.8rem;margin-bottom:1.6rem}
  .card{background:var(--panel);border:1px solid var(--edge);border-radius:14px;padding:1rem}
  .card b{display:block;font-size:1.9rem;font-weight:800;line-height:1.1}
  .card span{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.06em}
  h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:1.8rem 0 .7rem}
  .panel{background:var(--panel);border:1px solid var(--edge);border-radius:14px;padding:1rem 1.2rem}
  .row{display:flex;align-items:center;gap:.8rem;padding:.4rem 0}
  .row .lbl{width:170px;flex:0 0 auto;font-size:.88rem}
  .row .bar{flex:1;height:9px;background:#0d1209;border-radius:99px;overflow:hidden}
  .row .bar i{display:block;height:100%;background:var(--green);border-radius:99px}
  .row .n{width:52px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
  .row .pc{width:52px;text-align:right;color:var(--muted);font-size:.8rem;font-variant-numeric:tabular-nums}
  .spark{display:flex;align-items:flex-end;gap:3px;height:70px}
  .spark div{flex:1;background:var(--green);border-radius:3px 3px 0 0;min-height:2px;position:relative}
  .spark div.z{background:#243018}
  .days{display:flex;gap:3px;color:var(--muted);font-size:.62rem;margin-top:.35rem}
  .days span{flex:1;text-align:center}
  .fb{border-top:1px solid var(--edge);padding:.8rem 0}
  .fb:first-child{border-top:none}
  .fb .meta{color:var(--muted);font-size:.76rem;display:flex;gap:.6rem;align-items:center;margin-bottom:.25rem;flex-wrap:wrap}
  .tag{padding:.1rem .5rem;border-radius:99px;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
  .tag.bug{background:#4a1f14;color:var(--orange)}
  .tag.idea{background:#1f3a17;color:var(--green)}
  .done{opacity:.42}
  .err{color:var(--orange);margin-bottom:1rem}
  .empty{color:var(--muted);font-style:italic;padding:.5rem 0}
</style>
<div class="wrap">
  <h1>CryptoBuds</h1>
  <div class="sub">Who's playing, how far they get, and what they're telling you.</div>
  <div class="gate">
    <input id="k" type="password" placeholder="admin key" autocomplete="off" />
    <button id="go">Show me</button>
    <button id="rf" class="ghost" style="display:none">Refresh</button>
  </div>
  <div id="err" class="err"></div>
  <div id="out"></div>
</div>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const pct = (n, d) => d ? Math.round(n / d * 100) : 0;

async function load() {
  const key = $("#k").value.trim() || sessionStorage.getItem("cbk") || "";
  if (!key) { $("#err").textContent = "Paste the admin key."; return; }
  $("#err").textContent = "";
  let s;
  try {
    const r = await fetch("/metrics/admin/stats", { headers: { Authorization: "Bearer " + key } });
    if (r.status === 401) { $("#err").textContent = "That key isn't right."; return; }
    if (!r.ok) { $("#err").textContent = "Couldn't load (" + r.status + ")."; return; }
    s = await r.json();
  } catch { $("#err").textContent = "Couldn't reach the server."; return; }
  sessionStorage.setItem("cbk", key);
  $("#k").value = ""; $("#k").placeholder = "key remembered for this tab";
  $("#rf").style.display = "";
  render(s);
}

function render(s) {
  const top = s.funnel[0]?.players || 0;
  const maxDay = Math.max(1, ...s.daily.map((d) => d.players));
  $("#out").innerHTML = \`
    <div class="cards">
      <div class="card"><b>\${s.players.total}</b><span>players ever</span></div>
      <div class="card"><b>\${s.players.today}</b><span>today</span></div>
      <div class="card"><b>\${s.players.week}</b><span>this week</span></div>
      <div class="card"><b>\${s.players.accounts}</b><span>accounts</span></div>
      <div class="card"><b>\${s.sessions.median_minutes}m</b><span>median session</span></div>
    </div>

    <h2>Did they come back</h2>
    <div class="panel">
      <div class="row"><div class="lbl">Next day</div><div class="bar"><i style="width:\${pct(s.retention.d1, s.retention.cohort)}%"></i></div><div class="n">\${s.retention.d1}</div><div class="pc">\${pct(s.retention.d1, s.retention.cohort)}%</div></div>
      <div class="row"><div class="lbl">A week later</div><div class="bar"><i style="width:\${pct(s.retention.d7, s.retention.cohort)}%"></i></div><div class="n">\${s.retention.d7}</div><div class="pc">\${pct(s.retention.d7, s.retention.cohort)}%</div></div>
      <div class="row"><div class="lbl">Played 10+ min</div><div class="bar"><i style="width:\${pct(s.sessions.over_10_min, s.players.total)}%"></i></div><div class="n">\${s.sessions.over_10_min}</div><div class="pc">\${pct(s.sessions.over_10_min, s.players.total)}%</div></div>
      <div class="row"><div class="lbl">Played 30+ min</div><div class="bar"><i style="width:\${pct(s.sessions.over_30_min, s.players.total)}%"></i></div><div class="n">\${s.sessions.over_30_min}</div><div class="pc">\${pct(s.sessions.over_30_min, s.players.total)}%</div></div>
      <div class="sub" style="margin:.6rem 0 0;font-size:.76rem">Out of \${s.retention.cohort} players who've had the chance to come back.</div>
    </div>

    <h2>How far they got</h2>
    <div class="panel">
      \${s.funnel.map((f) => \`<div class="row"><div class="lbl">\${esc(f.step)}</div><div class="bar"><i style="width:\${pct(f.players, top)}%"></i></div><div class="n">\${f.players}</div><div class="pc">\${pct(f.players, top)}%</div></div>\`).join("")}
    </div>

    <h2>Last two weeks</h2>
    <div class="panel">
      <div class="spark">\${s.daily.map((d) => \`<div class="\${d.players ? "" : "z"}" style="height:\${Math.max(2, d.players / maxDay * 100)}%" title="\${d.day}: \${d.players} players, \${d.signups} signups"></div>\`).join("")}</div>
      <div class="days">\${s.daily.map((d) => \`<span>\${d.day.slice(8)}</span>\`).join("")}</div>
    </div>

    \${s.signals.length ? \`<h2>Signals</h2><div class="panel">\${s.signals.map((g) => \`<div class="row"><div class="lbl">\${esc(g.name.replace(/_/g, " "))}</div><div class="bar"><i style="width:\${pct(g.n, Math.max(...s.signals.map((x) => x.n)))}%"></i></div><div class="n">\${g.n}</div><div class="pc"></div></div>\`).join("")}</div>\` : ""}

    <h2>What they said (\${s.feedback.length})</h2>
    <div class="panel" id="fb">
      \${s.feedback.length ? s.feedback.map((f) => \`
        <div class="fb \${f.status !== "new" ? "done" : ""}">
          <div class="meta">
            <span class="tag \${f.kind}">\${f.kind}</span>
            <span>\${esc(f.who || "signed out")}</span><span>\${esc(f.at)}</span>
            \${f.status === "new" ? \`<button class="ghost" data-done="\${f.id}">mark done</button>\` : \`<span>\${esc(f.status)}</span>\`}
          </div>
          <div>\${esc(f.message)}</div>
        </div>\`).join("") : '<div class="empty">Nothing yet.</div>'}
    </div>\`;

  document.querySelectorAll("[data-done]").forEach((b) => b.addEventListener("click", async () => {
    await fetch("/metrics/admin/feedback/" + b.dataset.done, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + sessionStorage.getItem("cbk") },
      body: JSON.stringify({ status: "done" }),
    });
    load();
  }));
}

$("#go").addEventListener("click", load);
$("#rf").addEventListener("click", load);
$("#k").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
if (sessionStorage.getItem("cbk")) load();
</script>`;
}
