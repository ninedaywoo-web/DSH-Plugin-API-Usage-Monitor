window.__ModuleLoader__.load({ id: "dsh-plugin-api-usage-monitor", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;

/**
 * dsh-plugin-api-usage-monitor — browser half.
 *
 * 侧边栏血条:血条(红)= DeepSeek API 余额,架势条(金)= 今日消耗(满格 =
 * 余额的 1/10)。底部:血瓶(直达官方充值)、今日用量小字、峰谷胶囊按钮、
 * 圆形箭头重启按钮。
 *
 * 峰谷胶囊:峰段红("梁子 · 1:23:45")/ 谷段金("梁圣 · 2:05:11"),呼吸光晕、
 * 倒计时实时跳动,诱导点击。点击后从血条处向上展开一张正方形信息卡
 * (覆盖式,不推挤侧边栏):先渐显梁子/梁圣图标(原大小 64px),随后文字
 * 渐显 —— 名字、当前时间与时段、距下一段倒计时。再点胶囊或点卡外收起。
 * 重启按钮:圆形箭头,重启时旋转。
 * 余额下降时血条旁弹 "-¥X" 扣费动画;整卡可拖动、双击归位;颜色随主题。
 */
const name = "dsh-plugin-api-usage-monitor";
const BAR_ATTR = "data-dsh-balance-bar";
const ROOT_SELECTORS = ['[data-pane="sidebar"]', '[class*="sidebarCol"]'];
const SETTINGS_SELECTOR = '[class*="settingsArea"]';
const POLL_FALLBACK_MS = 60000;
const RECHARGE_URL = "https://platform.deepseek.com/top_up";
const POS_KEY = "dsh-balance-bar.pos.v1";

const PHASE_NAME = { peak: "梁子", offpeak: "梁圣" };
const PHASE_LABEL = { peak: "峰段", offpeak: "谷段" };

function fmtMoney(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "--";
  return v.toFixed(2);
}

function fmtTokens(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "--";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return String(Math.round(v));
}

function fmtCountdown(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h + ":" + pad(m) + ":" + pad(s);
}

/** 北京时间的 HH:MM(卡片上显示当前时刻)。 */
function beijingHM(tz) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
  } catch {
    return "--:--";
  }
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className !== void 0) node.className = className;
  return node;
}

/* 血瓶:矮胖圆肚 + 瓶内鲜红液体 + 金色瓶塞,第一眼就是"满血瓶"。 */
const SVG_FLASK =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path d="M7 0.6h2v1.1H7z" fill="#d9a441"/>' +
  '<path d="M6.4 1.7h3.2v2.9c2 .8 3.3 2.7 3.3 4.9a5 5 0 0 1-10 0c0-2.2 1.3-4.1 3.3-4.9z" fill="#5f0d0d" stroke="#d9a441" stroke-width="1"/>' +
  '<path d="M4.8 9.9a3.2 3.2 0 0 0 6.4 0c0-1-.5-1.7-1.2-2-.5 1.5-1.7 2.4-2 2.4s-1.5-.9-2-2.4c-.7.3-1.2 1-1.2 2z" fill="#e23d3d"/>' +
  '<path d="M6.1 10.3c.4.5 1 .7 1.9.7s1.5-.2 1.9-.7" fill="none" stroke="#ffb4a8" stroke-width=".7" stroke-linecap="round" opacity=".8"/>' +
  "</svg>";

/* 重启图标:圆形箭头,重启时旋转。 */
const SVG_RESTART =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path d="M13.2 8a5.2 5.2 0 1 1-1.55-3.68" fill="none" stroke="#d9a441" stroke-width="1.3" stroke-linecap="round"/>' +
  '<path d="M12.9 1.4v3H9.9" fill="none" stroke="#d9a441" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
  "</svg>";

function createBar() {
  const bar = el("div");
  bar.setAttribute(BAR_ATTR, "");
  bar.style.cssText = [
    "box-sizing:border-box",
    "margin:2px 4px 8px",
    "padding:7px 9px 6px",
    "border:1px solid var(--dsw-alias-border-l2, rgba(224,176,106,.3))",
    "border-radius:6px",
    "background:color-mix(in srgb, var(--dsw-specific-sidebar-fill, #1c1916) 82%, transparent)",
    "box-shadow:inset 0 1px 0 rgba(255,255,255,.04)",
    "position:relative",
    "font-size:12px",
    "line-height:1.45",
    "color:var(--dsw-alias-label-primary, #e8e3d8)",
    "user-select:none",
    "min-width:0"
  ].join(";");

  const hpRow = el("div", "bb-row");
  hpRow.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;gap:6px;";
  const hpLabel = el("span", "bb-label");
  hpLabel.textContent = "余额";
  const hpValue = el("span", "bb-value");
  hpValue.setAttribute(BAR_ATTR + "-balance", "");
  hpValue.style.cssText = "font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;";
  hpRow.append(hpLabel, hpValue);

  const hpTrack = el("div", "bb-track");
  hpTrack.style.cssText = "height:10px;border-radius:4px;margin:3px 0 1px;background:#160d0d;border:1px solid rgba(0,0,0,.65);overflow:hidden;";
  const hpFill = el("div", "bb-fill");
  hpFill.setAttribute(BAR_ATTR + "-hp", "");
  hpFill.style.cssText =
    "height:100%;width:0%;background:linear-gradient(180deg, #ff6a5e, #a01f1f 72%);" +
    "box-shadow:inset 0 1px 0 rgba(255,255,255,.28);border-radius:3px;transition:width .5s ease;";
  hpTrack.appendChild(hpFill);

  const poRow = el("div", "bb-row");
  poRow.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin-top:3px;";
  const poLabel = el("span", "bb-label");
  poLabel.textContent = "今日消耗";
  const poValue = el("span", "bb-value");
  poValue.setAttribute(BAR_ATTR + "-consumed", "");
  poValue.style.cssText = "font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;";
  poRow.append(poLabel, poValue);

  const poTrack = el("div", "bb-track");
  poTrack.style.cssText = "height:8px;border-radius:4px;margin:3px 0 2px;background:#191206;border:1px solid rgba(0,0,0,.65);overflow:hidden;";
  const poFill = el("div", "bb-fill");
  poFill.setAttribute(BAR_ATTR + "-posture", "");
  poFill.style.cssText =
    "height:100%;width:0%;background:linear-gradient(180deg, #ffe08a, #c8912a 74%);" +
    "box-shadow:inset 0 1px 0 rgba(255,255,255,.3);border-radius:3px;transition:width .5s ease;";
  poTrack.appendChild(poFill);

  const foot = el("div", "bb-foot");
  foot.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:4px;min-width:0;";

  const flask = el("button", "bb-flask");
  flask.type = "button";
  flask.setAttribute(BAR_ATTR + "-flask", "");
  flask.innerHTML = SVG_FLASK;
  flask.title = "";
  flask.style.cssText = "padding:1px;border:none;background:transparent;cursor:pointer;opacity:.92;display:inline-flex;flex:none;";

  const flaskMenu = el("div", "bb-flask-menu");
  flaskMenu.setAttribute(BAR_ATTR + "-flask-menu", "");
  flaskMenu.hidden = true;
  flaskMenu.style.cssText = [
    "position:absolute",
    "left:5px",
    "bottom:27px",
    "z-index:77",
    "display:flex",
    "flex-direction:column",
    "gap:2px",
    "min-width:146px",
    "padding:4px",
    "border:1px solid rgba(224,176,106,.42)",
    "border-radius:7px",
    "background:color-mix(in srgb, var(--dsw-specific-sidebar-fill, #1c1916) 97%, transparent)",
    "box-shadow:0 8px 22px rgba(0,0,0,.48)"
  ].join(";");
  const menuAction = (text, attr) => {
    const button = el("button", "bb-flask-action");
    button.type = "button";
    button.setAttribute(BAR_ATTR + attr, "");
    button.textContent = text;
    button.style.cssText = [
      "border:none",
      "border-radius:5px",
      "padding:5px 7px",
      "background:transparent",
      "color:var(--dsw-alias-label-primary, #e8e3d8)",
      "font-size:11px",
      "text-align:left",
      "white-space:nowrap",
      "cursor:pointer"
    ].join(";");
    return button;
  };
  const rechargeAction = menuAction("前往官方充值 ↗", "-go-recharge");
  const refreshAction = menuAction("已充值，刷新血条 ↻", "-refresh-balance");
  flaskMenu.append(rechargeAction, refreshAction);

  flask.addEventListener("click", (event) => {
    event.stopPropagation();
    flaskMenu.hidden = !flaskMenu.hidden;
  });
  rechargeAction.addEventListener("click", (event) => {
    event.stopPropagation();
    flaskMenu.hidden = true;
    try {
      window.open(RECHARGE_URL, "_blank", "noopener");
    } catch {}
  });
  refreshAction.addEventListener("click", (event) => {
    event.stopPropagation();
    flaskMenu.hidden = true;
    bar.dispatchEvent(new CustomEvent("bb-refresh-balance"));
  });

  const caption = el("span", "bb-caption");
  caption.setAttribute(BAR_ATTR + "-caption", "");
  caption.style.cssText =
    "flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-secondary, #b3a88f);" +
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

  const capsule = el("button", "bb-capsule");
  capsule.type = "button";
  capsule.setAttribute(BAR_ATTR + "-capsule", "");
  capsule.title = "";
  capsule.style.cssText =
    "padding:2px 9px;border-radius:999px;font-size:11px;font-variant-numeric:tabular-nums;" +
    "white-space:nowrap;cursor:pointer;flex:none;background:transparent;";

  const skill = el("button", "bb-skill");
  skill.type = "button";
  skill.setAttribute(BAR_ATTR + "-skill", "");
  skill.innerHTML = SVG_RESTART;
  skill.title = "";
  skill.style.cssText = "padding:1px;border:none;background:transparent;cursor:pointer;display:inline-flex;flex:none;opacity:.92;";
  skill.addEventListener("click", (event) => {
    event.stopPropagation();
    bar.dispatchEvent(new CustomEvent("bb-restart"));
  });

  foot.append(flask, caption, capsule, skill);
  bar.append(hpRow, hpTrack, poRow, poTrack, foot, flaskMenu);
  return bar;
}

/** 正方形信息卡:覆盖式、从血条处向上展开;图标先渐显、文字后渐显。 */
function createCard() {
  const card = el("div", "bb-card");
  card.style.cssText = [
    "position:absolute",
    "bottom:calc(100% + 8px)",
    "left:-1px",
    "width:200px",
    "z-index:75",
    "border-radius:12px",
    "padding:16px 12px 14px",
    "background:color-mix(in srgb, var(--dsw-specific-sidebar-fill, #1c1916) 94%, transparent)",
    "box-shadow:0 10px 30px rgba(0,0,0,.5)",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "gap:8px"
  ].join(";");

  const iconBox = el("div", "bb-card-icon");
  iconBox.style.cssText = "display:inline-flex;";
  const img = document.createElement("img");
  img.alt = "";
  img.style.cssText = "display:block;width:64px;height:64px;";
  iconBox.appendChild(img);

  const textBox = el("div", "bb-card-text");
  textBox.style.cssText =
    "display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center;";
  const cardName = el("div", "bb-card-name");
  cardName.style.cssText = "font-size:22px;font-weight:800;letter-spacing:3px;line-height:1.2;";
  const cardTime = el("div", "bb-card-time");
  cardTime.style.cssText = "font-size:12px;color:var(--dsw-alias-label-secondary, #b3a88f);";
  const cardCd = el("div", "bb-card-cd");
  cardCd.style.cssText = "font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;";
  textBox.append(cardName, cardTime, cardCd);

  // 详情区:余额 / 满格 / 今日消耗 / 三桶费用 / 刷新时间(悬浮时直接展示,点击时最后登场)
  const details = el("div", "bb-card-details");
  details.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "gap:2px",
    "font-size:11px",
    "color:var(--dsw-alias-label-secondary, #b3a88f)",
    "border-top:1px solid rgba(128,128,128,.28)",
    "padding-top:8px",
    "width:100%",
    "text-align:center"
  ].join(";");
  const dBalance = el("div", "bb-d-balance");
  dBalance.style.cssText = "font-weight:700;font-size:13px;color:var(--dsw-alias-label-primary, #e8e3d8);";
  const dCap = el("div", "bb-d-cap");
  const dConsumed = el("div", "bb-d-consumed");
  const dBuckets = el("div", "bb-d-buckets");
  const dRefresh = el("div", "bb-d-refresh");
  dRefresh.style.cssText = "opacity:.75;";
  details.append(dBalance, dCap, dConsumed, dBuckets, dRefresh);

  card.append(iconBox, textBox, details);
  return card;
}

/** 北京时间的墙钟时刻(仅用于时长差,时区无关)。 */
function wallClock(tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date());
  const g = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const d = new Date(0);
  d.setFullYear(g("year"), g("month") - 1, g("day"));
  d.setHours(g("hour"), g("minute"), g("second"), 0);
  return d;
}

/** 当前峰谷状态:所在时段、剩余毫秒。 */
function phaseState(windows, tz) {
  const now = wallClock(tz);
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
  const nowSec = h * 3600 + m * 60 + s;
  const bounds = [...new Set(windows.flat())].sort((a, b) => a - b);
  const starts = [0, ...bounds];
  const ends = [...bounds, 24];
  let inPeak = false;
  for (const [ws, we] of windows) {
    if (h >= ws && h < we) {
      inPeak = true;
      break;
    }
  }
  let segStart = 0;
  let segEnd = 24;
  for (let i = 0; i < starts.length; i++) {
    if (h >= starts[i] && h < ends[i]) {
      segStart = starts[i];
      segEnd = ends[i];
      break;
    }
  }
  const totalSec = (segEnd - segStart) * 3600;
  const remainingSec = Math.max(0, segEnd * 3600 - nowSec);
  return { inPeak, remainingMs: remainingSec * 1000 };
}

function mount(ctx) {
  if (typeof document === "undefined") return () => {};
  if (document.querySelector("[" + BAR_ATTR + "]") !== null) return () => {};

  const bar = createBar();
  const card = createCard();
  const style = document.createElement("style");
  style.textContent = [
    '[class*="collapsed"] [' + BAR_ATTR + ']:not(.bb-detached) .bb-label,',
    '[class*="collapsed"] [' + BAR_ATTR + ']:not(.bb-detached) .bb-caption,',
    '[class*="collapsed"] [' + BAR_ATTR + ']:not(.bb-detached) .bb-foot { display: none; }',
    '[' + BAR_ATTR + '][data-posture-full] [' + BAR_ATTR + '-posture] { animation: bb-posture-pulse 1.2s ease-in-out infinite; }',
    "@keyframes bb-posture-pulse { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.55); } }",
    '.bb-dmg { position:absolute; right:6px; top:0; font-size:13px; font-weight:700; color:#ff4d4d;' +
      ' text-shadow:0 1px 2px rgba(0,0,0,.8), 0 0 6px rgba(255,60,60,.55); pointer-events:none; z-index:5;' +
      ' font-variant-numeric:tabular-nums; animation:bb-dmg-float 1.2s ease-out forwards; }',
    "@keyframes bb-dmg-float { 0% { opacity:0; transform:translateY(5px) scale(.9); } 15% { opacity:1; } 100% { opacity:0; transform:translateY(-14px) scale(1.06); } }",
    '.bb-heal { position:absolute; right:6px; top:0; font-size:13px; font-weight:700; color:#4ade80;' +
      ' text-shadow:0 1px 2px rgba(0,0,0,.8), 0 0 6px rgba(74,222,128,.55); pointer-events:none; z-index:5;' +
      ' font-variant-numeric:tabular-nums; animation:bb-dmg-float 1.2s ease-out forwards; }',
    '[' + BAR_ATTR + '-hp].bb-hit { animation: bb-hit-flash .28s ease-out; }',
    "@keyframes bb-hit-flash { 0% { filter: brightness(2.1); } 100% { filter: brightness(1); } }",
    '[' + BAR_ATTR + '].bb-detached { cursor: grab; box-shadow: 0 6px 22px rgba(0,0,0,.45); margin: 0; }',
    '[' + BAR_ATTR + '].bb-detached:active { cursor: grabbing; }',
    // 数值颜色:深色主题用亮色,浅色主题用深色系(保证对比度)
    '[' + BAR_ATTR + '] [' + BAR_ATTR + '-balance] { color:#ffb4a8; }',
    '[' + BAR_ATTR + '] [' + BAR_ATTR + '-consumed] { color:#f0d58a; }',
    '[' + BAR_ATTR + '][data-theme="light"] [' + BAR_ATTR + '-balance] { color:#b91c1c; }',
    '[' + BAR_ATTR + '][data-theme="light"] [' + BAR_ATTR + '-consumed] { color:#92400e; }',
    // 胶囊:峰红谷金 + 呼吸(含浅色主题)
    '[' + BAR_ATTR + '][data-phase="peak"] .bb-capsule { color:#f87171; border:1px solid rgba(239,68,68,.5); background:rgba(239,68,68,.12); animation: bb-capsule-breathe 2s ease-in-out infinite; }',
    '[' + BAR_ATTR + '][data-phase="offpeak"] .bb-capsule { color:#fbbf24; border:1px solid rgba(251,191,36,.55); background:rgba(251,191,36,.12); animation: bb-capsule-breathe 2.4s ease-in-out infinite; }',
    '[' + BAR_ATTR + '][data-theme="light"][data-phase="peak"] .bb-capsule { color:#b91c1c; border-color:rgba(185,28,28,.45); background:rgba(185,28,28,.08); }',
    '[' + BAR_ATTR + '][data-theme="light"][data-phase="offpeak"] .bb-capsule { color:#92400e; border-color:rgba(146,64,14,.45); background:rgba(146,64,14,.08); }',
    "@keyframes bb-capsule-breathe { 0%,100% { opacity:.85; } 50% { opacity:1; } }",
    // 卡片:基础态在样式表(避免被内联样式压住),展开/收起 + 图标先行、文字后随
    '.bb-card { opacity:0; transform:translateY(10px) scale(.97); pointer-events:none; transition:opacity .22s ease, transform .22s ease; }',
    '.bb-card .bb-card-icon { opacity:0; transition:opacity .3s ease; }',
    '.bb-card .bb-card-text { opacity:0; transition:opacity .35s ease; }',
    '.bb-card .bb-card-details { opacity:0; transition:opacity .35s ease; }',
    // 悬浮:快速依次亮相
    '.bb-card.bb-open { opacity:1; transform:none; pointer-events:auto; }',
    '.bb-card.bb-open .bb-card-icon { opacity:1; transition-delay:.05s; }',
    '.bb-card.bb-open .bb-card-text { opacity:1; transition-delay:.15s; }',
    '.bb-card.bb-open .bb-card-details { opacity:1; transition-delay:.3s; }',
    // 点击:节奏拉开 —— 图标先、峰谷文字后、详情最后登场
    '.bb-card.bb-open.bb-staged .bb-card-icon { transition-delay:.05s; }',
    '.bb-card.bb-open.bb-staged .bb-card-text { transition-delay:.45s; }',
    '.bb-card.bb-open.bb-staged .bb-card-details { transition-delay:.9s; }',
    '[' + BAR_ATTR + '][data-phase="peak"] .bb-card { border:1px solid rgba(239,68,68,.55); }',
    '[' + BAR_ATTR + '][data-phase="offpeak"] .bb-card { border:1px solid rgba(251,191,36,.55); }',
    '[' + BAR_ATTR + '][data-phase="peak"] .bb-card-name { color:#f87171; text-shadow:0 0 10px rgba(239,68,68,.5); }',
    '[' + BAR_ATTR + '][data-phase="offpeak"] .bb-card-name { color:#fbbf24; text-shadow:0 0 10px rgba(251,191,36,.5); }',
    '[' + BAR_ATTR + '][data-phase="peak"] .bb-card-cd { color:#fca5a5; }',
    '[' + BAR_ATTR + '][data-phase="offpeak"] .bb-card-cd { color:#fde68a; }',
    '[' + BAR_ATTR + '][data-theme="light"][data-phase="peak"] .bb-card-name { color:#b91c1c; text-shadow:none; }',
    '[' + BAR_ATTR + '][data-theme="light"][data-phase="offpeak"] .bb-card-name { color:#92400e; text-shadow:none; }',
    '[' + BAR_ATTR + '][data-theme="light"][data-phase="peak"] .bb-card-cd { color:#b91c1c; }',
    '[' + BAR_ATTR + '][data-theme="light"][data-phase="offpeak"] .bb-card-cd { color:#92400e; }',
    "[" + BAR_ATTR + "-flask-menu][hidden] { display:none !important; }",
    ".bb-flask-action:hover { background:rgba(224,176,106,.13) !important; }",
    // 重启旋转
    '.bb-skill.bb-spinning svg { animation: bb-spin 1s linear infinite; }',
    "@keyframes bb-spin { to { transform: rotate(360deg); } }"
  ].join("\n");
  document.head.appendChild(style);

  // 主题适配:读取 <html> 上的 color-scheme(主题系统会设置),浅色模式换深色系文字
  const syncTheme = () => {
    let cs = "";
    try {
      cs = getComputedStyle(document.documentElement).colorScheme;
    } catch {}
    if (cs !== "dark" && cs !== "light") {
      cs = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    bar.setAttribute("data-theme", cs);
  };
  syncTheme();
  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });

  let rootEl;
  let placed = false;
  let rootObserver;
  let waitObserver;
  let timer;
  let refreshGeneration = 0;
  let manualRefreshBusy = false;
  let restartPending = false;
  let restartProbeTimer = null;
  let lastInstanceId = null;
  let pollMs = POLL_FALLBACK_MS;
  let phaseWindows = [[9, 12], [14, 18]];
  let phaseTz = "Asia/Shanghai";
  let lastPhaseKind;
  let lastBalance = null;
  let detached = false;
  let drag = null;
  let hoverOpen = false;
  let clickOpen = false;
  let capsuleHover = false;
  let errorState = false;

  const findRoot = () => {
    for (const selector of ROOT_SELECTORS) {
      const node = document.querySelector(selector);
      if (node !== null) return node;
    }
    return void 0;
  };

  const place = () => {
    if (detached) return;
    if (rootEl !== void 0 && !rootEl.isConnected) {
      if (rootObserver !== void 0) rootObserver.disconnect();
      rootObserver = void 0;
      rootEl = void 0;
      placed = false;
    }
    if (placed) {
      if (document.body.contains(bar)) return;
      placed = false;
    }
    rootEl = rootEl !== void 0 ? rootEl : findRoot();
    if (rootEl === void 0) return;
    const anchor = rootEl.querySelector(SETTINGS_SELECTOR);
    if (anchor === null || anchor === bar || !rootEl.contains(anchor)) return;
    const host = anchor.parentElement;
    if (host === null) return;
    host.insertBefore(bar, anchor);
    placed = true;
    if (rootObserver === void 0) {
      rootObserver = new MutationObserver(() => {
        if (detached) return;
        if (rootEl === void 0 || !rootEl.isConnected) {
          placed = false;
          place();
          return;
        }
        if (!document.body.contains(bar)) {
          placed = false;
          place();
          return;
        }
        const anchorNow = rootEl.querySelector(SETTINGS_SELECTOR);
        if (anchorNow === null || anchorNow === bar) return;
        const hostNow = anchorNow.parentElement;
        if (hostNow === null) return;
        if (bar.parentElement !== hostNow || bar.nextElementSibling !== anchorNow) {
          hostNow.insertBefore(bar, anchorNow);
        }
      });
    }
    rootObserver.observe(rootEl, { childList: true, subtree: true });
  };

  /** 同步峰谷状态:胶囊文字 + 卡片内容。错误态下胶囊是"重试"按钮,不覆盖。 */
  const renderPhase = () => {
    if (errorState) return;
    const state = phaseState(phaseWindows, phaseTz);
    const phaseKind = state.inPeak ? "peak" : "offpeak";
    bar.setAttribute("data-phase", phaseKind);
    const cdText = fmtCountdown(state.remainingMs);
    const phaseName = PHASE_NAME[phaseKind];
    const iconSrc = phaseKind === "peak"
      ? "/api/balance-bar/icons/liangzi"
      : "/api/balance-bar/icons/liangshen";

    const capsule = bar.querySelector("[" + BAR_ATTR + "-capsule]");
    if (capsule !== null) {
      const text = phaseName + " · " + cdText;
      if (capsule.textContent !== text) capsule.textContent = text;
    }

    const cardImg = card.querySelector(".bb-card-icon img");
    const cardName = card.querySelector(".bb-card-name");
    const cardTime = card.querySelector(".bb-card-time");
    const cardCd = card.querySelector(".bb-card-cd");
    if (cardImg !== null && cardImg.getAttribute("src") !== iconSrc) cardImg.setAttribute("src", iconSrc);
    if (cardName !== null && cardName.textContent !== phaseName) cardName.textContent = phaseName;
    if (cardTime !== null) {
      const line = beijingHM(phaseTz) + " · " + PHASE_LABEL[phaseKind];
      if (cardTime.textContent !== line) cardTime.textContent = line;
    }
    if (cardCd !== null) {
      const line = (phaseKind === "peak" ? "距谷段 " : "距峰段 ") + cdText;
      if (cardCd.textContent !== line) cardCd.textContent = line;
    }
  };

  const setText = (attr, text) => {
    const node = bar.querySelector("[" + attr + "]");
    if (node !== null) node.textContent = text;
  };

  const setWidth = (attr, fraction) => {
    const node = bar.querySelector("[" + attr + "]");
    if (node !== null) {
      node.style.width = (fraction === null || fraction === void 0 ? 0 : Math.round(Math.min(1, Math.max(0, fraction)) * 100)) + "%";
    }
  };

  /** 在血条右上弹出一个上浮渐隐的 "-¥X" 扣费数字,并给血条一次受击闪光。 */
  const spawnDmg = (amount) => {
    const node = el("div", "bb-dmg");
    node.textContent = "-¥" + fmtMoney(amount);
    bar.appendChild(node);
    const hp = bar.querySelector("[" + BAR_ATTR + "-hp]");
    if (hp !== null) {
      hp.classList.remove("bb-hit");
      void hp.offsetWidth;
      hp.classList.add("bb-hit");
      window.setTimeout(() => {
        hp.classList.remove("bb-hit");
      }, 320);
    }
    window.setTimeout(() => {
      node.remove();
    }, 1300);
  };

  /** 充值回血:绿色 "+¥X" 上浮 + 血条闪光。 */
  const spawnHeal = (amount) => {
    const node = el("div", "bb-heal");
    node.textContent = "+¥" + fmtMoney(amount);
    bar.appendChild(node);
    const hp = bar.querySelector("[" + BAR_ATTR + "-hp]");
    if (hp !== null) {
      hp.classList.remove("bb-hit");
      void hp.offsetWidth;
      hp.classList.add("bb-hit");
      window.setTimeout(() => {
        hp.classList.remove("bb-hit");
      }, 320);
    }
    window.setTimeout(() => {
      node.remove();
    }, 1300);
  };

  /** 填卡片详情区(悬浮展示的内容)。 */
  const fillDetails = (balanceLine, capLine, consumedLine, bucketsLine, refreshLine) => {
    const set = (cls, text) => {
      const node = card.querySelector("." + cls);
      if (node !== null && node.textContent !== text) node.textContent = text;
    };
    set("bb-d-balance", balanceLine);
    set("bb-d-cap", capLine);
    set("bb-d-consumed", consumedLine);
    set("bb-d-buckets", bucketsLine);
    set("bb-d-refresh", refreshLine);
  };

  const update = (barEl, data) => {
    if (data !== null && data !== void 0 && typeof data.instanceId === "string" && data.instanceId !== "") {
      lastInstanceId = data.instanceId;
    }
    if (data === void 0 || data === null || data.ok !== true) {
      const message = data !== null && data !== void 0 && typeof data.message === "string"
        ? data.message
        : "余额接口不可用";
      errorState = true;
      setText(BAR_ATTR + "-caption", message);
      // 短暂网络错误时保留最后一次可信状态，避免两根条看起来突然被清空。
      if (lastBalance === null) {
        setText(BAR_ATTR + "-balance", "¥--");
        setText(BAR_ATTR + "-consumed", "--");
        setWidth(BAR_ATTR + "-hp", 0);
        setWidth(BAR_ATTR + "-posture", 0);
      }
      const capsuleEl = bar.querySelector("[" + BAR_ATTR + "-capsule]");
      if (capsuleEl !== null) {
        capsuleEl.textContent = "重试";
        capsuleEl.title = "余额获取失败,点击重试";
      }
      fillDetails(message, "", "", "", "");
      return;
    }
    errorState = false;
    if (Array.isArray(data.peakWindows)) phaseWindows = data.peakWindows;
    if (typeof data.timezone === "string" && data.timezone !== "") phaseTz = data.timezone;

    const srcMark = data.todayConsumedSource === "official" ? "" : "≈";
    setText(BAR_ATTR + "-balance", "¥" + fmtMoney(data.totalBalance));
    setText(BAR_ATTR + "-consumed", srcMark + "¥" + fmtMoney(data.todayConsumed));
    setText(BAR_ATTR + "-caption", "今日 " + fmtTokens(data.todayTokens));
    // 兼容新旧宿主:新字段 hpFraction 优先,旧字段 balanceFraction 兜底
    const hpValue = typeof data.hpFraction === "number"
      ? data.hpFraction
      : (typeof data.balanceFraction === "number" ? data.balanceFraction : null);
    setWidth(BAR_ATTR + "-hp", hpValue);
    setWidth(BAR_ATTR + "-posture", data.postureFraction);
    // 余额变化动画:下降弹红 "-¥X",上升(充值/赠送)弹绿 "+¥X"。
    // 宿主判定到的充值事件优先(服务关机期间充的钱重启后也能补弹动画)。
    const hostRecharged = data.recharged === true
      && typeof data.rechargedAmount === "number"
      && data.rechargedAmount > 0;
    if (typeof data.totalBalance === "number" && Number.isFinite(data.totalBalance)) {
      if (hostRecharged) {
        spawnHeal(data.rechargedAmount);
      } else if (lastBalance !== null && lastBalance - data.totalBalance >= 0.001) {
        spawnDmg(lastBalance - data.totalBalance);
      } else if (lastBalance !== null && data.totalBalance - lastBalance >= 0.001) {
        spawnHeal(data.totalBalance - lastBalance);
      }
      lastBalance = data.totalBalance;
    }
    if (typeof data.postureFraction === "number" && data.postureFraction >= 0.999) {
      barEl.setAttribute("data-posture-full", "");
    } else {
      barEl.removeAttribute("data-posture-full");
    }

    const b = data.todayBuckets ?? {};
    const sourceLabel = data.todayConsumedSource === "official" ? "官方数据" : "余额差值估算";
    const cur = typeof data.currency === "string" && data.currency !== "" ? data.currency : "CNY";
    const grant = typeof data.grantedBalance === "number" && data.grantedBalance > 0
      ? "（赠送 ¥" + fmtMoney(data.grantedBalance) + "）"
      : "";
    const capLine = typeof data.baseline === "number"
      ? "本管满格 ¥" + fmtMoney(data.baseline) + "（充值后回满）"
      : "血条满格 = ¥" + fmtMoney(data.capCny);
    fillDetails(
      "余额 ¥" + fmtMoney(data.totalBalance) + " " + cur + grant,
      capLine,
      "今日消耗 ¥" + fmtMoney(data.todayConsumed) + "（" + sourceLabel + "）",
      "输入 ¥" + fmtMoney(b.input?.cost) + " · 缓存命中 ¥" + fmtMoney(b.cacheRead?.cost) + " · 输出 ¥" + fmtMoney(b.output?.cost),
      "刷新于 " + new Date().toLocaleTimeString()
    );

    renderPhase();
  };

  const refresh = (options = {}) => {
    const resetBaseline = options.resetBaseline === true;
    if (restartPending) return Promise.resolve(null);
    if (manualRefreshBusy) return Promise.resolve(null);
    const generation = ++refreshGeneration;
    const refreshButton = bar.querySelector("[" + BAR_ATTR + "-refresh-balance]");
    const captionNode = bar.querySelector("[" + BAR_ATTR + "-caption]");
    if (resetBaseline) {
      manualRefreshBusy = true;
      if (refreshButton !== null) refreshButton.disabled = true;
      if (captionNode !== null) captionNode.textContent = "正在刷新血条…";
    }
    return fetch("/api/balance-bar", {
      method: resetBaseline ? "POST" : "GET",
      cache: "no-store"
    })
      .then((res) => res.json())
      .then((data) => {
        if (generation !== refreshGeneration) return data;
        if (document.querySelector("[" + BAR_ATTR + "]") !== null) update(bar, data);
        if (resetBaseline && data !== null && data !== void 0 && data.ok === true && captionNode !== null) {
          captionNode.textContent = "血条已按当前余额刷新";
        }
        if (data !== null && data !== void 0 && Number.isFinite(Number(data.refreshSeconds))) {
          const next = Math.max(10, Number(data.refreshSeconds)) * 1000;
          if (next !== pollMs) {
            pollMs = next;
            if (timer !== void 0) clearInterval(timer);
            timer = setInterval(refresh, pollMs);
          }
        }
        return data;
      })
      .catch(() => {
        if (generation !== refreshGeneration) return null;
        if (document.querySelector("[" + BAR_ATTR + "]") !== null) {
          update(bar, { ok: false, message: "无法连接本地余额接口" });
        }
        return null;
      })
      .finally(() => {
        if (resetBaseline) {
          manualRefreshBusy = false;
          if (refreshButton !== null) refreshButton.disabled = false;
        }
      });
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") refresh();
  };

  // ---- 卡片开关:悬浮直接展示详情,点击先播图标/峰谷、详情最后登场 -------

  const syncCard = () => {
    // 防御:卡片必须始终挂在血条上(拖动/归位过程理论上不会丢,兜底)
    if (card.parentElement !== bar) bar.appendChild(card);
    const visible = hoverOpen || clickOpen || capsuleHover;
    if (visible) {
      // 上方空间不够时向下展开,防止卡片飞出屏幕
      const rect = bar.getBoundingClientRect();
      const cardHeight = card.offsetHeight > 0 ? card.offsetHeight : 300;
      const flip = rect.top < cardHeight + 16 && window.innerHeight - rect.bottom >= rect.top;
      if (flip) {
        card.style.bottom = "auto";
        card.style.top = "calc(100% + 8px)";
      } else {
        card.style.bottom = "calc(100% + 8px)";
        card.style.top = "auto";
      }
      card.classList.add("bb-open");
      if (clickOpen || capsuleHover) {
        card.classList.add("bb-staged");
      } else {
        card.classList.remove("bb-staged");
      }
    } else {
      card.classList.remove("bb-open", "bb-staged");
    }
  };

  /** 把卡片状态机硬复位到干净初态(拖动结束、双击归位时调用)。 */
  const resetCardState = () => {
    if (hoverTimer !== null) {
      window.clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    hoverOpen = false;
    clickOpen = false;
    capsuleHover = false;
    syncCard();
  };

  let hoverTimer = null;
  bar.addEventListener("mouseover", (event) => {
    if (event.target.closest("button")) {
      // 指针在血瓶/重启上:不弹悬浮卡,收起已开的卡(胶囊自己处理悬停)
      if (hoverTimer !== null) {
        window.clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (hoverOpen) {
        hoverOpen = false;
        syncCard();
      }
      return;
    }
    if (hoverOpen || hoverTimer !== null) return;
    hoverTimer = window.setTimeout(() => {
      hoverTimer = null;
      if (!hoverOpen) {
        hoverOpen = true;
        syncCard();
      }
    }, 800);
  });
  bar.addEventListener("mouseout", (event) => {
    if (bar.contains(event.relatedTarget)) return;
    if (hoverTimer !== null) {
      window.clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    hoverOpen = false;
    capsuleHover = false;
    syncCard();
  });

  // 胶囊:悬停 = 点击,直接出两段式信息卡;移出胶囊进卡片则保持,离开整个血条收起
  const capsuleButton = bar.querySelector("[" + BAR_ATTR + "-capsule]");
  if (capsuleButton !== null) {
    capsuleButton.addEventListener("mouseenter", () => {
      const wasVisible = hoverOpen || clickOpen || capsuleHover;
      capsuleHover = true;
      // 只在卡片本来没开时才重播两段式动画,避免在胶囊与卡片间来回晃时反复闪
      if (!wasVisible) {
        card.classList.remove("bb-open", "bb-staged");
        void card.offsetWidth;
      }
      syncCard();
    });
    capsuleButton.addEventListener("mouseleave", (event) => {
      if (card.contains(event.relatedTarget)) return;
      capsuleHover = false;
      syncCard();
    });
  }

  // 血瓶/重启的自定义小提示条:与信息卡同风格,位置在原说明文字处(按钮下方)
  const makeTip = (text, side) => {
    const tip = el("div", "bb-tip");
    tip.textContent = text;
    tip.style.cssText = [
      "position:absolute",
      "top:calc(100% + 6px)",
      side === "left" ? "left:0;" : "right:0;",
      "z-index:76",
      "padding:5px 8px",
      "border-radius:8px",
      "border:1px solid rgba(224,176,106,.45)",
      "background:color-mix(in srgb, var(--dsw-specific-sidebar-fill, #1c1916) 95%, transparent)",
      "box-shadow:0 6px 18px rgba(0,0,0,.4)",
      "font-size:11px",
      "color:var(--dsw-alias-label-primary, #e8e3d8)",
      "white-space:nowrap",
      "opacity:0",
      "transition:opacity .18s ease",
      "pointer-events:none"
    ].join(";");
    return tip;
  };
  const flaskTip = makeTip("充值 / 刷新血条", "left");
  const skillTip = makeTip("一键重启 DeepSeek Harness", "right");
  bar.appendChild(flaskTip);
  bar.appendChild(skillTip);
  let tipTimer = null;
  const bindTip = (button, tip) => {
    button.addEventListener("mouseenter", () => {
      if (tipTimer !== null) window.clearTimeout(tipTimer);
      tipTimer = window.setTimeout(() => {
        tip.style.opacity = "1";
      }, 180);
    });
    button.addEventListener("mouseleave", () => {
      if (tipTimer !== null) window.clearTimeout(tipTimer);
      tipTimer = null;
      tip.style.opacity = "0";
    });
  };
  const flaskButton = bar.querySelector("[" + BAR_ATTR + "-flask]");
  const skillButton = bar.querySelector("[" + BAR_ATTR + "-skill]");
  if (flaskButton !== null) bindTip(flaskButton, flaskTip);
  if (skillButton !== null) bindTip(skillButton, skillTip);
  const onRefreshBalance = () => {
    void refresh({ resetBaseline: true });
  };
  bar.addEventListener("bb-refresh-balance", onRefreshBalance);

  const setRestartUi = (busy, text) => {
    if (skillButton !== null) {
      skillButton.dataset.busy = busy ? "1" : "0";
      skillButton.disabled = busy;
      skillButton.style.opacity = busy ? ".45" : "";
      skillButton.classList.toggle("bb-spinning", busy);
    }
    const captionNode = bar.querySelector("[" + BAR_ATTR + "-caption]");
    if (captionNode !== null) captionNode.textContent = text;
  };

  const clearRestartProbe = () => {
    if (restartProbeTimer !== null) {
      window.clearTimeout(restartProbeTimer);
      restartProbeTimer = null;
    }
  };

  const failRestart = (message) => {
    clearRestartProbe();
    restartPending = false;
    setRestartUi(false, message);
  };

  const probeNewInstance = (previousInstanceId) => {
    const deadline = Date.now() + 90000;
    const schedule = () => {
      if (!restartPending) return;
      if (Date.now() >= deadline) {
        failRestart("重启超时,请查看终端");
        return;
      }
      restartProbeTimer = window.setTimeout(probe, 750);
    };
    const probe = () => {
      restartProbeTimer = null;
      fetch("/api/balance-bar", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (
            data !== null
            && data !== void 0
            && typeof data.instanceId === "string"
            && data.instanceId !== previousInstanceId
          ) {
            try {
              window.location.reload();
            } catch {}
            return;
          }
          schedule();
        })
        .catch(schedule);
    };
    schedule();
  };

  const onRestart = () => {
    if (restartPending) return;
    restartPending = true;
    refreshGeneration += 1;
    setRestartUi(true, "正在重启…");
    let previousInstanceId = lastInstanceId;
    fetch("/api/balance-bar/restart", { method: "POST", cache: "no-store" })
      .then(async (res) => {
        let data = null;
        try {
          data = await res.json();
        } catch {}
        if (!res.ok || data === null || data.ok !== true) {
          const message = data !== null && typeof data.message === "string"
            ? data.message
            : "重启请求被拒绝";
          failRestart(message);
          return;
        }
        if (previousInstanceId === null && typeof data.instanceId === "string") {
          previousInstanceId = data.instanceId;
        }
        setRestartUi(true, "已受理,等待重连…");
        probeNewInstance(previousInstanceId);
      })
      .catch(() => {
        // 服务可能在响应完整送达前就退出；只要已知旧实例，就继续等新实例。
        if (previousInstanceId !== null) {
          setRestartUi(true, "正在重连…");
          probeNewInstance(previousInstanceId);
          return;
        }
        failRestart("连接中断,请查看终端");
      });
  };
  bar.addEventListener("bb-restart", onRestart);

  // 胶囊点击:错误态下是"重试";正常态下固定/取消固定信息卡(悬停已能开,点击负责"钉住")
  if (capsuleButton !== null) {
    capsuleButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (errorState) {
        refresh();
        return;
      }
      clickOpen = !clickOpen;
      if (clickOpen) {
        // 重放两段式动画:先摘掉再重新挂上,强制重排
        card.classList.remove("bb-open", "bb-staged");
        void card.offsetWidth;
      }
      syncCard();
    });
  }
  const onDocumentClick = (event) => {
    const flaskMenu = bar.querySelector("[" + BAR_ATTR + "-flask-menu]");
    if (flaskMenu !== null && !flaskMenu.hidden && !flaskMenu.contains(event.target) && !flaskButton?.contains(event.target)) {
      flaskMenu.hidden = true;
    }
    if (!clickOpen) return;
    if (card.contains(event.target) || capsuleButton?.contains(event.target)) return;
    clickOpen = false;
    syncCard();
  };
  document.addEventListener("click", onDocumentClick);

  // ---- 拖动 / 归位 ---------------------------------------------------------

  const detachAt = (rect) => {
    detached = true;
    bar.classList.add("bb-detached");
    bar.style.position = "fixed";
    bar.style.zIndex = "70";
    bar.style.width = Math.round(rect.width) + "px";
    bar.style.margin = "0";
    document.body.appendChild(bar);
    moveTo(rect.left, rect.top);
  };

  const moveTo = (x, y) => {
    const left = Math.max(4, Math.min(window.innerWidth - bar.offsetWidth - 4, x));
    const top = Math.max(4, Math.min(window.innerHeight - bar.offsetHeight - 4, y));
    bar.style.bottom = "";
    bar.style.left = left + "px";
    bar.style.top = top + "px";
  };

  const savePos = () => {
    try {
      const left = parseFloat(bar.style.left);
      const top = parseFloat(bar.style.top);
      if (Number.isFinite(left) && Number.isFinite(top)) {
        window.localStorage.setItem(POS_KEY, JSON.stringify({ x: left, y: top }));
      }
    } catch {}
  };

  const goHome = () => {
    detached = false;
    bar.classList.remove("bb-detached");
    // createBar() 的原始定位上下文是 relative；归位时必须恢复它，
    // 否则绝对定位的峰谷详情卡会改以页面为参照并飞出屏幕。
    bar.style.position = "relative";
    bar.style.zIndex = "";
    bar.style.width = "";
    bar.style.left = "";
    bar.style.top = "";
    bar.style.margin = "";
    placed = false;
    try {
      window.localStorage.removeItem(POS_KEY);
    } catch {}
    place();
    // 关键修复:归位后硬复位卡片状态机,否则悬浮/点击会永久失灵
    resetCardState();
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest("button")) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rect: bar.getBoundingClientRect(),
      moved: false
    };
    try {
      bar.setPointerCapture(event.pointerId);
    } catch {}
  };

  const onPointerMove = (event) => {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    if (!detached) detachAt(drag.rect);
    moveTo(drag.rect.left + dx, drag.rect.top + dy);
  };

  const onPointerUp = (event) => {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    drag = null;
    if (moved) {
      savePos();
      // 拖动会搅乱悬浮状态机,放下后复位,保证之后悬浮/点击正常
      resetCardState();
    }
  };

  const onDblClick = (event) => {
    if (event.target.closest("button")) return;
    goHome();
  };

  const onResize = () => {
    if (!detached) return;
    const left = parseFloat(bar.style.left);
    const top = parseFloat(bar.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) moveTo(left, top);
  };

  bar.addEventListener("pointerdown", onPointerDown);
  bar.addEventListener("pointermove", onPointerMove);
  bar.addEventListener("pointerup", onPointerUp);
  bar.addEventListener("pointercancel", onPointerUp);
  bar.addEventListener("dblclick", onDblClick);
  window.addEventListener("resize", onResize);

  // ---- 挂载 ----------------------------------------------------------------

  bar.appendChild(card);

  waitObserver = new MutationObserver(() => {
    if (!placed && !detached) place();
  });
  waitObserver.observe(document.body, { childList: true, subtree: true });

  let saved = null;
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (raw !== null) saved = JSON.parse(raw);
  } catch {}
  if (saved !== null && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) {
    detachAt({
      left: Number(saved.x),
      top: Number(saved.y),
      width: 216
    });
    bar.getBoundingClientRect();
    moveTo(Number(saved.x), Number(saved.y));
  } else {
    place();
  }

  // 降级:6 秒后仍未挂进侧边栏(挂载点类名变动等),转为悬浮模式并提示
  const fallbackTimer = window.setTimeout(() => {
    if (!placed && !detached) {
      bar.classList.add("bb-detached");
      bar.style.position = "fixed";
      bar.style.left = "12px";
      bar.style.bottom = "12px";
      bar.style.zIndex = "70";
      bar.style.width = "216px";
      bar.style.margin = "0";
      document.body.appendChild(bar);
      detached = true;
      const warn = "未找到侧边栏挂载点,已降级为悬浮模式(可能是 DSH 升级所致,欢迎反馈)";
      bar.title = warn;
      try {
        window.console.warn("[dsh-balance-bar] " + warn);
      } catch {}
    }
  }, 6000);

  refresh();
  timer = setInterval(refresh, pollMs);
  const ticker = setInterval(renderPhase, 1000);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    if (timer !== void 0) clearInterval(timer);
    clearInterval(ticker);
    window.clearTimeout(fallbackTimer);
    document.removeEventListener("visibilitychange", onVisible);
    document.removeEventListener("click", onDocumentClick);
    window.removeEventListener("resize", onResize);
    if (hoverTimer !== null) window.clearTimeout(hoverTimer);
    if (tipTimer !== null) window.clearTimeout(tipTimer);
    clearRestartProbe();
    bar.removeEventListener("bb-refresh-balance", onRefreshBalance);
    bar.removeEventListener("bb-restart", onRestart);
    bar.removeEventListener("pointerdown", onPointerDown);
    bar.removeEventListener("pointermove", onPointerMove);
    bar.removeEventListener("pointerup", onPointerUp);
    bar.removeEventListener("pointercancel", onPointerUp);
    bar.removeEventListener("dblclick", onDblClick);
    if (waitObserver !== void 0) waitObserver.disconnect();
    if (rootObserver !== void 0) rootObserver.disconnect();
    themeObserver.disconnect();
    style.remove();
    bar.remove();
  };
}

function apply(ctx) {
  ctx.effect(() => mount(ctx), "dsh-plugin-api-usage-monitor: sidebar bar");
}

exports.name = name;
exports.apply = apply;
return module.exports;
}});
