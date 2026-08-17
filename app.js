/* Paper blotter — every figure is polled or aged. */
(function () {
  "use strict";

  const TZ = "America/New_York";
  const DESK_MS = 3000;
  const SPOT_MS = 20000;
  const GOLD_API = "https://api.gold-api.com/price/XAU";

  const ET_SHORT = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const ET_FULL = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

  const state = {
    events: [],
    book: null,
    spot: null,
    spotAt: null,
    lastSpot: null,
    eventsAt: null,
    bookAt: null,
    stale: { spot: false, events: false, book: false },
    hadTick: false,
  };

  const $ = (id) => document.getElementById(id);

  function parseTs(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }
  function fmtET(ts) {
    const d = parseTs(ts);
    return d ? ET_SHORT.format(d) + " ET" : "—";
  }
  function num(n, d) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString("en-US", {
      minimumFractionDigits: d ?? 2,
      maximumFractionDigits: d ?? 2,
    });
  }
  function px(n) {
    if (n == null || n === "") return "—";
    return Number(n).toFixed(2);
  }
  function payload(e) { return (e && e.payload) || {}; }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function clsPnl(n) {
    if (n == null) return "";
    return Number(n) >= 0 ? "up" : "dn";
  }
  function ageSec(ts) {
    if (!ts) return null;
    return Math.max(0, Math.round((Date.now() - ts) / 1000));
  }
  function ageLabel(ts, stale, liveWord) {
    const s = ageSec(ts);
    if (s == null) return stale ? "STALE · no print yet" : "waiting";
    const unit = s === 1 ? "1s old" : s + "s old";
    if (stale) return "STALE · last good " + unit;
    return (liveWord || "LIVE") + " · " + unit;
  }

  function latestCard() {
    const evs = state.events.slice().reverse();
    return evs.find((e) => (e.action || "").toLowerCase() === "card")
      || evs.find((e) => (e.action || "").toLowerCase() === "watch")
      || evs.find((e) => {
        const p = payload(e);
        return p.status || p.card;
      }) || null;
  }

  function pickGap(obj) {
    if (!obj || typeof obj !== "object") return null;
    const high = obj.gap_high != null ? obj.gap_high
      : (obj.fvg_high != null ? obj.fvg_high : obj.high);
    const low = obj.gap_low != null ? obj.gap_low
      : (obj.fvg_low != null ? obj.fvg_low : obj.low);
    if (high == null && low == null) return null;
    const mid = obj.gap_mid != null ? obj.gap_mid
      : (obj.fvg_mid != null ? obj.fvg_mid : obj.mid);
    return { high, low, mid };
  }

  function collectFVG() {
    let found = null;
    for (const e of state.events) {
      const p = payload(e);
      const nested = p.fvg && typeof p.fvg === "object" ? pickGap(p.fvg) : null;
      const root = pickGap(p);
      const g = nested || root;
      if (!g) continue;
      found = {
        high: g.high, mid: g.mid, low: g.low,
        late: !!(p.late_chase || (p.fvg && p.fvg.late_chase)),
        note: p.note || p.reason,
        tf: (p.fvg && p.fvg.tf) || e.tf || "D1",
      };
    }
    if (found && found.mid == null && found.high != null && found.low != null) {
      found.mid = (Number(found.high) + Number(found.low)) / 2;
    }
    return found;
  }

  function collectBoxes() {
    const boxes = [];
    const seen = new Set();
    const push = (tf, distal, proximal, mid, unused, label) => {
      if (distal == null || proximal == null) return;
      const key = [tf, Number(distal).toFixed(1), Number(proximal).toFixed(1)].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      boxes.push({ tf, distal, proximal, mid, unused, label });
    };
    for (const e of state.events) {
      const p = payload(e);
      if ((e.action || "").toLowerCase() === "box" && p.distal != null) {
        push(e.tf, p.distal, p.proximal, p.mid_50 || p.mid,
          p.freshness === "unused" || p.unused === true, p.label);
      }
      if (p.box && p.box.distal != null) {
        push(e.tf || "M30", p.box.distal, p.box.proximal, p.box.mid_50 || p.box.mid, true);
      }
      if (p.htf_box && p.htf_box.distal != null) {
        const b = p.htf_box;
        push(b.tf || e.tf, b.distal, b.proximal, b.mid_50 || b.mid, b.unused !== false);
      }
      if (p.unused_d1 && p.unused_d1.distal != null) {
        const b = p.unused_d1;
        push("D1", b.distal, b.proximal, b.mid_50, true, b.label || "4224–4304");
      }
    }
    const m30 = boxes.filter((b) => b.tf === "M30");
    const d1 = boxes.filter((b) => {
      if (b.tf !== "D1") return false;
      const pr = Number(b.proximal);
      return b.unused && pr > 4200 && pr < 4400;
    });
    return [m30[0], d1[0]].filter(Boolean);
  }

  function lottery() {
    const open = (state.book && state.book.open) || [];
    return open.find((r) => String(r.ticket) === "102034139") || open[0] || null;
  }

  function oneLine(e) {
    const p = payload(e);
    const a = (e.action || "").toLowerCase();
    if (p.reason && (a === "card" || a === "watch" || a === "scan")) {
      return (p.status || p.card || a).toString().toUpperCase() + " — " + p.reason;
    }
    if (a === "box") {
      return [p.label || p.side || "box", p.freshness,
        p.distal != null ? px(p.distal) + "–" + px(p.proximal) : "",
        p.note || p.refuse].filter(Boolean).join(" · ");
    }
    if (a === "runner") {
      return "ticket " + (p.ticket || "") + " " + (p.type || "buy") + " " +
        p.lots + " @ " + px(p.open_price) + " SL " + px(p.sl);
    }
    if (a === "find" || a === "send") {
      const g = pickGap(p);
      return (g ? "FVG " + px(g.low) + "–" + px(g.high) : "FVG") +
        (p.not_a_buy || p.late_chase ? " · profit area, not a buy" : "");
    }
    if (p.skip_reason) return p.skip_reason;
    if (p.note) return p.note;
    if (p.reason) return p.reason;
    return a || "event";
  }

  function bookSpot() {
    const b = state.book || {};
    if (b.bid != null) return Number(b.bid);
    return null;
  }

  function renderCard() {
    const ev = latestCard();
    const p = payload(ev);
    $("card-status").textContent = ev
      ? (p.status || p.card || "WAIT").toString().toUpperCase()
      : "—";
    $("card-reason").textContent = ev
      ? (p.skip_reason || p.reason || "")
      : "";
    const el = $("card-age");
    el.textContent = ageLabel(state.eventsAt, state.stale.events, "desk");
    el.className = "age" + (state.stale.events ? " stale" : " live");
  }

  function renderFigures() {
    const b = state.book || {};
    const live = !state.stale.spot && state.spot != null;
    const spot = live ? state.spot : (state.spot != null ? state.spot : bookSpot());
    const flt = b.floating_pl;
    const spotClass = live ? "live" : "stale";
    const spotWord = live ? "Live XAU spot" : "XAU spot";
    const spotAge = ageLabel(state.spotAt, state.stale.spot || !live, live ? "LIVE" : "STALE");
    const bookAge = ageLabel(state.bookAt, state.stale.book, "book");
    const tick = state.hadTick ? " tick" : "";
    $("figures").innerHTML = `
      <div class="fig spot ${spotClass}${tick}">
        <div class="k"><span class="live-dot"></span>${spotWord}</div>
        <div class="v">${num(spot)}</div>
        <div class="s"><span id="spot-age">${esc(spotAge)}</span><br>indicative mid · not Coinexx · not OANDA</div>
      </div>
      <div class="fig">
        <div class="k">Balance</div>
        <div class="v">${num(b.balance)}</div>
        <div class="s"><span data-age="book">${esc(bookAge)}</span><br>size new fills off this</div>
      </div>
      <div class="fig">
        <div class="k">Equity</div>
        <div class="v">${num(b.equity)}</div>
        <div class="s"><span data-age="book">${esc(bookAge)}</span></div>
      </div>
      <div class="fig">
        <div class="k">Floating</div>
        <div class="v ${clsPnl(flt)}">${flt == null ? "—" : (Number(flt) >= 0 ? "+" : "") + num(flt)}</div>
        <div class="s"><span data-age="book">${esc(bookAge)}</span><br>open runner mark</div>
      </div>`;
    if (state.hadTick) {
      state.hadTick = false;
      const el = $("figures").querySelector(".fig.spot");
      setTimeout(() => { if (el) el.classList.remove("tick"); }, 800);
    }
  }

  function renderTicket() {
    const t = lottery();
    const age = ageLabel(state.bookAt, state.stale.book, "book");
    if (!t) {
      $("ticket").innerHTML = `<h3>Lottery ticket</h3><p class="age ${state.stale.book ? "stale" : ""}">${esc(age)}</p>`;
      return;
    }
    $("ticket").innerHTML = `
      <h3>Lottery ticket</h3>
      <p class="age ${state.stale.book ? "stale" : "live"}" data-age="book">${esc(age)}</p>
      <div class="line">#${esc(t.ticket)} · ${esc((t.side || "buy").toLowerCase())} ${esc(t.lots)} @ ${px(t.entry)}</div>
      <div class="meta">SL ${px(t.sl)}${t.started_lots != null ? " · leftover of " + t.started_lots : ""}${t.half_taken ? " · half taken" : ""}</div>
      <p class="warn">Do not flatten. Do not move the stop. Next half only if leftover doubles → 0.025, leave SL 4050.</p>`;
  }

  function renderZones() {
    const boxes = collectBoxes();
    const age = ageLabel(state.eventsAt, state.stale.events, "desk");
    let body = boxes.map((z) => {
      const range = px(z.distal) + "–" + px(z.proximal);
      const mid = z.mid != null ? "  /  50%  " + px(z.mid) : "";
      const unused = z.unused ? "unused" : "";
      const lab = z.label && z.tf === "D1" ? " · " + z.label : "";
      return `<div class="box">
        <div class="name">${esc(z.tf)}${esc(lab)}</div>
        <div class="range">${esc(range)}${esc(mid)}</div>
        <div class="note">${esc(unused)}</div>
      </div>`;
    }).join("");
    if (!body) body = `<p class="age">waiting on desk boxes</p>`;
    $("zones").innerHTML = `<h3>Boxes</h3><p class="age ${state.stale.events ? "stale" : "live"}" data-age="desk">${esc(age)}</p>` + body;
  }

  function renderFVG() {
    const f = collectFVG();
    const age = ageLabel(state.eventsAt, state.stale.events, "desk");
    if (!f) {
      $("fvg").innerHTML = `<h3>FVG</h3><p class="age ${state.stale.events ? "stale" : ""}" data-age="desk">${esc(age)}</p>`;
      return;
    }
    $("fvg").innerHTML = `
      <h3>FVG · ${esc(f.tf || "D1")}</h3>
      <p class="age ${state.stale.events ? "stale" : "live"}" data-age="desk">${esc(age)}</p>
      <p class="role">Profit area — not a buy${f.late ? " · late chase" : ""}</p>
      <div class="ln"><span>HIGH</span><span>${px(f.high)}</span></div>
      <div class="ln"><span>MID</span><span>${px(f.mid)}</span></div>
      <div class="ln"><span>LOW</span><span>${px(f.low)}</span></div>
      <p class="aside">${esc(f.note || "Unused D1 gap. Do not chase. Wait for a return to unused 50%.")}</p>`;
  }

  function renderPicture() {
    const ev = state.events.find((e) => {
      const p = payload(e);
      return p.picture && String(p.picture).includes("xauusd-wait-2026-08-16");
    });
    const p = payload(ev);
    const cap = ev
      ? [(p.card || p.status || "WAIT").toString().toUpperCase(), eAgent(ev), fmtET(ev.ts), p.reason].filter(Boolean).join(" · ")
      : "WAIT card";
    $("picture").innerHTML = `
      <img src="images/xauusd-wait-2026-08-16.png" alt="${esc(cap)}">
      <figcaption>${esc(cap)}</figcaption>`;
  }
  function eAgent(e) { return (e && e.agent) ? String(e.agent).toUpperCase() : ""; }

  function renderFeed() {
    const evs = state.events.slice().sort((a, b) => {
      const da = parseTs(a.ts)?.getTime() || 0;
      const db = parseTs(b.ts)?.getTime() || 0;
      return db - da;
    }).slice(0, 8);
    const age = ageLabel(state.eventsAt, state.stale.events, "desk");
    const el = $("feed-age");
    el.textContent = age;
    el.className = "age" + (state.stale.events ? " stale" : " live");
    $("feed").innerHTML = evs.map((e) =>
      `<li>
        <span class="t">${esc(fmtET(e.ts))}</span>
        <span class="ag">${esc((e.agent || "").toUpperCase())}</span>
        <span class="one">${esc(oneLine(e))}</span>
      </li>`
    ).join("");
  }

  function renderAsof() {
    const b = state.book || {};
    const parts = [];
    parts.push("Analysis = TradingView OANDA/FXCM. Entries = Coinexx MT4.");
    if (b.mt4_asof) parts.push("Statement " + ET_FULL.format(new Date(b.mt4_asof)) + " ET.");
    parts.push("Spot " + ageLabel(state.spotAt, state.stale.spot, "LIVE") + ".");
    parts.push("Desk " + ageLabel(state.eventsAt, state.stale.events, "LIVE") + ".");
    parts.push("Poll events/book 3s · XAU 20s. Silence is a state.");
    $("asof").textContent = parts.join(" ");
  }

  function renderAll() {
    renderCard();
    renderFigures();
    renderTicket();
    renderZones();
    renderFVG();
    renderPicture();
    renderFeed();
    renderAsof();
  }

  function paintAge(el, ts, stale, word) {
    if (!el) return;
    el.textContent = ageLabel(ts, stale, word);
    el.classList.toggle("stale", !!stale);
    el.classList.toggle("live", !stale);
  }

  function renderAges() {
    paintAge($("card-age"), state.eventsAt, state.stale.events, "desk");
    paintAge($("feed-age"), state.eventsAt, state.stale.events, "desk");
    paintAge($("spot-age"), state.spotAt, state.stale.spot || state.spot == null, state.stale.spot ? "STALE" : "LIVE");
    document.querySelectorAll("[data-age=book]").forEach((el) => {
      paintAge(el, state.bookAt, state.stale.book, "book");
    });
    document.querySelectorAll("[data-age=desk]").forEach((el) => {
      paintAge(el, state.eventsAt, state.stale.events, "desk");
    });
    renderAsof();
  }

  async function loadJSON(url) {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  async function pollDesk() {
    try {
      const evs = await loadJSON("events.json");
      if (Array.isArray(evs)) {
        state.events = evs;
        state.eventsAt = Date.now();
        state.stale.events = false;
      }
    } catch (err) {
      if (state.eventsAt) state.stale.events = true;
    }
    try {
      const book = await loadJSON("book.json");
      if (book && typeof book === "object") {
        state.book = book;
        state.bookAt = Date.now();
        state.stale.book = false;
      }
    } catch (err) {
      if (state.bookAt) state.stale.book = true;
    }
    renderAll();
  }

  async function pollSpot() {
    try {
      const r = await fetch(GOLD_API, { cache: "no-store" });
      if (!r.ok) throw new Error("gold-api " + r.status);
      const j = await r.json();
      const price = Number(j.price);
      if (Number.isNaN(price)) throw new Error("no price");
      if (state.spot != null && state.spot !== price) state.hadTick = true;
      state.lastSpot = state.spot;
      state.spot = price;
      const apiAt = parseTs(j.updatedAt);
      state.spotAt = apiAt ? apiAt.getTime() : Date.now();
      state.stale.spot = false;
    } catch (err) {
      if (state.spot == null) {
        const bid = bookSpot();
        if (bid != null) {
          state.spot = bid;
          state.spotAt = state.bookAt;
        }
      }
      state.stale.spot = true;
    }
    renderFigures();
    renderAsof();
  }

  async function boot() {
    renderAll();
    await pollDesk();
    await pollSpot();
    setInterval(pollDesk, DESK_MS);
    setInterval(pollSpot, SPOT_MS);
    setInterval(renderAges, 1000);
  }

  boot();
})();
