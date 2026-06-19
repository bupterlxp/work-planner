/* Work Planner — vanilla JS, no dependencies. Data lives in localStorage.
   Features: board/list/week/ability views, AI summary & ability attribution
   (local rule engine by default, optional OpenAI via the official SDK). */
(function () {
  "use strict";

  // ---------------- Constants ----------------
  var STORAGE_KEY = "work-planner.v2";
  var SCHEMA_VERSION = 4;
  var STATUSES = [
    { id: "todo", name: "待办", color: "#8a919f" },
    { id: "doing", name: "进行中", color: "#3370ff" },
    { id: "done", name: "已完成", color: "#18b566" },
  ];
  var PRIORITIES = { high: { name: "高", rank: 0 }, mid: { name: "中", rank: 1 }, low: { name: "低", rank: 2 } };
  var PROJECT_STATUS = {
    active: { name: "进行中", color: "var(--accent)", rank: 0 },
    paused: { name: "搁置", color: "var(--p-mid)", rank: 1 },
    done: { name: "已完成", color: "var(--done)", rank: 2 },
  };
  var DEFAULT_COLORS = ["#3370ff", "#f53f3f", "#ff9a2e", "#18b566", "#a259ff", "#13c2c2", "#eb2f96", "#fa8c16"];
  var WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  var DEFAULT_ABILITIES = [
    { id: "planning", name: "规划力", icon: "🧭", color: "#3370ff", points: 0 },
    { id: "execution", name: "执行力", icon: "⚡", color: "#f53f3f", points: 0 },
    { id: "expertise", name: "专业深度", icon: "🎯", color: "#a259ff", points: 0 },
    { id: "collaboration", name: "协作沟通", icon: "🤝", color: "#ff9a2e", points: 0 },
    { id: "learning", name: "学习成长", icon: "📚", color: "#18b566", points: 0 },
    { id: "innovation", name: "创新力", icon: "💡", color: "#13c2c2", points: 0 },
  ];
  var KEYWORDS = {
    planning: ["规划", "计划", "方案", "策略", "排期", "里程碑", "需求", "梳理", "目标", "roadmap", "okr", "plan"],
    execution: ["完成", "上线", "交付", "发布", "修复", "解决", "部署", "实现", "搞定", "落地", "跑通", "ship", "fix", "deliver"],
    expertise: ["开发", "编码", "架构", "算法", "优化", "调试", "重构", "技术", "建模", "数据", "code", "debug"],
    collaboration: ["沟通", "对齐", "会议", "评审", "协作", "汇报", "分享", "跟进", "反馈", "demo", "review", "meeting"],
    learning: ["学习", "阅读", "研究", "调研", "复盘", "总结", "培训", "课程", "笔记", "learn", "study", "research"],
    innovation: ["创意", "创新", "原型", "设计", "实验", "探索", "点子", "prototype", "idea", "design"],
  };

  // ---------------- State ----------------
  var state = loadState();
  var ui = { view: state.settings.lastView || "board", search: "", project: "all", priority: "all", hideDone: false };
  var modalSubtasks = [];
  var lastDeleted = null;
  var toastTimer = null;
  var aiRange = "today";
  var aiBusy = false;
  var levelupQueue = [];
  var levelupTimer = null;

  // ---------------- Storage ----------------
  function defaultState() {
    return {
      version: SCHEMA_VERSION,
      tasks: [],
      projects: [],
      abilities: DEFAULT_ABILITIES.map(function (a) { return Object.assign({}, a); }),
      xpLog: [],
      settings: { theme: "system", lastView: "board", ai: { engine: "local", apiKey: "", model: "gpt-4o" } },
    };
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        var old = localStorage.getItem("work-planner.items.v1");
        if (old) return migrateV1(JSON.parse(old));
        return defaultState();
      }
      return normalize(JSON.parse(raw));
    } catch (e) {
      console.warn("load failed", e);
      return defaultState();
    }
  }
  function normalize(s) {
    var d = defaultState();
    s = s || {};
    d.tasks = Array.isArray(s.tasks) ? s.tasks.map(normalizeTask) : [];
    d.projects = Array.isArray(s.projects) ? s.projects.map(normalizeProject) : [];
    d.abilities = (Array.isArray(s.abilities) && s.abilities.length)
      ? s.abilities.map(function (a) { return { id: a.id, name: a.name, icon: a.icon || "⭐", color: a.color || "#3370ff", points: a.points || 0 }; })
      : DEFAULT_ABILITIES.map(function (a) { return Object.assign({}, a); });
    d.xpLog = Array.isArray(s.xpLog) ? s.xpLog : [];
    d.settings = Object.assign(d.settings, s.settings || {});
    d.settings.ai = Object.assign({ engine: "local", apiKey: "", model: "gpt-4o" }, (s.settings && s.settings.ai) || {});
    // migrate legacy Claude config → OpenAI
    if (d.settings.ai.engine === "claude") d.settings.ai.engine = "openai";
    if (/^claude/.test(d.settings.ai.model || "")) d.settings.ai.model = "gpt-4o";
    return d;
  }
  function normalizeTask(t) {
    return {
      id: t.id || uid(),
      title: String(t.title || "(无标题)"),
      notes: t.notes || t.desc || "",
      projectId: t.projectId || null,
      priority: PRIORITIES[t.priority] ? t.priority : "mid",
      status: /^(todo|doing|done)$/.test(t.status) ? t.status : "todo",
      due: t.due || "",
      subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(function (s) {
        return { id: s.id || uid(), title: String(s.title || ""), done: !!s.done };
      }) : [],
      order: typeof t.order === "number" ? t.order : 0,
      createdAt: t.createdAt || Date.now(),
      updatedAt: t.updatedAt || Date.now(),
      completedAt: t.completedAt || null,
      xp: t.xp || null,
      xpApplied: !!t.xpApplied,
      xpLogId: t.xpLogId || null,
    };
  }
  function normalizeProject(p) {
    p = p || {};
    return {
      id: p.id || uid(),
      name: String(p.name || "未命名项目"),
      color: p.color || "#3370ff",
      goal: p.goal || "",
      status: PROJECT_STATUS[p.status] ? p.status : "active",
      due: p.due || "",
      milestones: Array.isArray(p.milestones) ? p.milestones.map(function (m) {
        return { id: m.id || uid(), title: String(m.title || ""), done: !!m.done };
      }) : [],
      createdAt: p.createdAt || Date.now(),
    };
  }
  function newProject(name, color) {
    return normalizeProject({ name: name, color: color || DEFAULT_COLORS[state.projects.length % DEFAULT_COLORS.length] });
  }
  function migrateV1(arr) {
    var d = defaultState();
    var projMap = {};
    (arr || []).forEach(function (it, i) {
      var pid = null;
      if (it.category) {
        if (!projMap[it.category]) {
          var np = normalizeProject({ name: it.category, color: DEFAULT_COLORS[d.projects.length % DEFAULT_COLORS.length] });
          pid = np.id; projMap[it.category] = pid; d.projects.push(np);
        } else pid = projMap[it.category];
      }
      d.tasks.push(normalizeTask({ title: it.title, notes: it.desc, projectId: pid, priority: it.priority, status: it.status, due: it.due, order: i }));
    });
    return d;
  }
  function save() {
    state.version = SCHEMA_VERSION;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast("保存失败：存储空间可能已满", null, null, 4000); }
  }
  function persistAndRender() { save(); render(); }

  // ---------------- Helpers ----------------
  function uid() { return "t" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function todayStr() { return ymd(new Date()); }
  function ymd(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }
  function parseYmd(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
  function project(id) { for (var i = 0; i < state.projects.length; i++) if (state.projects[i].id === id) return state.projects[i]; return null; }
  function task(id) { for (var i = 0; i < state.tasks.length; i++) if (state.tasks[i].id === id) return state.tasks[i]; return null; }
  function ability(id) { for (var i = 0; i < state.abilities.length; i++) if (state.abilities[i].id === id) return state.abilities[i]; return null; }

  function dueLabel(due) {
    if (!due) return "";
    var diff = daysBetween(todayStr(), due);
    if (diff === 0) return "今天";
    if (diff === 1) return "明天";
    if (diff === -1) return "昨天";
    if (diff < 0) return "逾期" + (-diff) + "天";
    if (diff < 7) return diff + "天后";
    return due.slice(5);
  }
  function dueClass(due, status) {
    if (!due || status === "done") return "";
    var diff = daysBetween(todayStr(), due);
    if (diff < 0) return "over";
    if (diff <= 1) return "soon";
    return "";
  }

  // ---------------- Quick-add parser ----------------
  function parseQuickAdd(text) {
    var res = { title: "", projectName: null, priority: "mid", due: "" };
    var tokens = text.split(/\s+/);
    var titleParts = [];
    var wdMap = { "周日": 0, "周天": 0, "周一": 1, "周二": 2, "周三": 3, "周四": 4, "周五": 5, "周六": 6,
                  "礼拜日": 0, "礼拜一": 1, "礼拜二": 2, "礼拜三": 3, "礼拜四": 4, "礼拜五": 5, "礼拜六": 6 };
    tokens.forEach(function (tok) {
      if (/^#.+/.test(tok)) { res.projectName = tok.slice(1); }
      else if (/^!/.test(tok)) {
        var v = tok.slice(1).toLowerCase();
        if (v === "高" || v === "h" || v === "high") res.priority = "high";
        else if (v === "中" || v === "m" || v === "mid") res.priority = "mid";
        else if (v === "低" || v === "l" || v === "low") res.priority = "low";
        else titleParts.push(tok);
      }
      else if (/^@.+/.test(tok)) {
        var v2 = tok.slice(1), d = new Date();
        if (v2 === "今天" || v2 === "today") res.due = ymd(d);
        else if (v2 === "明天" || v2 === "tomorrow") { d.setDate(d.getDate() + 1); res.due = ymd(d); }
        else if (v2 === "后天") { d.setDate(d.getDate() + 2); res.due = ymd(d); }
        else if (wdMap.hasOwnProperty(v2)) {
          var add = (wdMap[v2] - d.getDay() + 7) % 7; if (add === 0) add = 7;
          d.setDate(d.getDate() + add); res.due = ymd(d);
        }
        else if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v2)) res.due = v2;
        else titleParts.push(tok);
      }
      else titleParts.push(tok);
    });
    res.title = titleParts.join(" ").trim();
    return res;
  }
  function ensureProject(name) {
    if (!name) return null;
    for (var i = 0; i < state.projects.length; i++) if (state.projects[i].name === name) return state.projects[i].id;
    var p = newProject(name);
    state.projects.push(p);
    return p.id;
  }

  // ---------------- CRUD ----------------
  function addTask(data) {
    var maxOrder = state.tasks.reduce(function (m, t) { return t.status === data.status ? Math.max(m, t.order) : m; }, 0);
    var t = normalizeTask(Object.assign({ order: maxOrder + 1 }, data));
    t.id = uid(); t.createdAt = t.updatedAt = Date.now();
    state.tasks.push(t);
    if (t.status === "done") { t.completedAt = Date.now(); awardXp(t, true); }
    return t;
  }
  function updateTask(id, data) {
    var t = task(id); if (!t) return;
    var prev = t.status;
    Object.assign(t, data); t.updatedAt = Date.now();
    if (t.status === "done" && prev !== "done") { t.completedAt = Date.now(); awardXp(t, true); }
    else if (prev === "done" && t.status !== "done") { unawardXp(t); }
  }
  function deleteTask(id) {
    var idx = -1;
    for (var i = 0; i < state.tasks.length; i++) if (state.tasks[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    var t = state.tasks[idx];
    if (t.xpApplied) unawardXp(t);
    lastDeleted = { task: t, index: idx };
    state.tasks.splice(idx, 1);
  }
  function setStatus(t, ns) {
    var prev = t.status;
    if (prev === ns) return;
    t.status = ns; t.updatedAt = Date.now();
    if (ns === "done" && prev !== "done") { t.completedAt = Date.now(); awardXp(t, true); }
    else if (prev === "done" && ns !== "done") { unawardXp(t); }
    persistAndRender();
  }

  // ---------------- XP / abilities ----------------
  function levelOf(points) {
    points = Math.max(0, points || 0);
    var lv = 0;
    while (5 * (lv + 1) * (lv + 2) <= points) lv++;
    var base = 5 * lv * (lv + 1), next = 5 * (lv + 1) * (lv + 2);
    return { level: lv, base: base, next: next, into: points - base, span: next - base, pct: Math.round((points - base) / (next - base) * 100) };
  }
  function analyzeLocal(t) {
    var p = project(t.projectId);
    var text = (t.title + " " + (t.notes || "") + " " + (p ? p.name : "")).toLowerCase();
    var gains = {};
    Object.keys(KEYWORDS).forEach(function (id) {
      if (!ability(id)) return;
      var hits = KEYWORDS[id].filter(function (k) { return text.indexOf(k) >= 0; }).length;
      if (hits > 0) gains[id] = Math.min(2, hits);
    });
    if (ability("execution")) gains.execution = (gains.execution || 0) + 1 + (t.priority === "high" ? 1 : 0) + ((t.subtasks && t.subtasks.length >= 3) ? 1 : 0);
    if (Object.keys(gains).length === 0) { var f = state.abilities[0]; if (f) gains[f.id] = 1; }
    var names = Object.keys(gains).map(function (id) { var a = ability(id); return a ? a.name + " +" + gains[id] : null; }).filter(Boolean);
    return { gains: gains, reason: "关键词分析：锻炼了 " + names.join("、"), by: "local" };
  }
  function awardXp(t, celebrate) {
    if (t.xpApplied) return;
    if (!t.completedAt) t.completedAt = Date.now();
    var fresh = !t.xp;
    if (!t.xp) t.xp = analyzeLocal(t);
    addGains(t, celebrate && fresh);
    if (fresh && state.settings.ai.engine === "openai" && state.settings.ai.apiKey) {
      analyzeOpenAI(t).then(function (res) {
        if (!res || !t.xpApplied) return;
        removeGains(t);
        t.xp = res;
        addGains(t, false);
        persistAndRender();
      }).catch(function (e) { console.warn("openai attribution failed", e); });
    }
  }
  function unawardXp(t) {
    if (!t.xpApplied) return;
    removeGains(t);
    t.completedAt = null;
  }
  function addGains(t, celebrate) {
    var g = t.xp ? t.xp.gains : {};
    Object.keys(g).forEach(function (id) {
      var a = ability(id); if (!a) return;
      var before = levelOf(a.points).level;
      a.points += g[id];
      var after = levelOf(a.points).level;
      if (celebrate && after > before) levelupQueue.push({ ab: a, level: after });
    });
    var logId = uid();
    t.xpLogId = logId;
    state.xpLog.unshift({ id: logId, taskId: t.id, title: t.title, at: t.completedAt || Date.now(), gains: g, reason: t.xp ? t.xp.reason : "", by: t.xp ? t.xp.by : "local" });
    if (state.xpLog.length > 300) state.xpLog.length = 300;
    t.xpApplied = true;
    if (celebrate) { drainLevelups(); var tot = Object.keys(g).reduce(function (s, k) { return s + g[k]; }, 0); toast("能力 +" + tot + " ✨"); }
  }
  function removeGains(t) {
    var g = t.xp ? t.xp.gains : {};
    Object.keys(g).forEach(function (id) { var a = ability(id); if (a) a.points = Math.max(0, a.points - g[id]); });
    state.xpLog = state.xpLog.filter(function (e) { return e.id !== t.xpLogId; });
    t.xpLogId = null;
    t.xpApplied = false;
  }
  function drainLevelups() {
    if (levelupTimer || !levelupQueue.length) return;
    var item = levelupQueue.shift();
    var box = el("levelup");
    el("luTitle").textContent = item.ab.icon + " " + item.ab.name + " 升到 Lv." + item.level + "！";
    el("luSub").textContent = "持续精进，再接再厉";
    box.hidden = false;
    levelupTimer = setTimeout(function () {
      box.hidden = true; levelupTimer = null;
      if (levelupQueue.length) drainLevelups();
    }, 1800);
  }

  // ---------------- Filtering / sorting ----------------
  function visibleTasks() {
    var q = ui.search.trim().toLowerCase();
    return state.tasks.filter(function (t) {
      if (ui.hideDone && t.status === "done") return false;
      if (ui.project !== "all" && t.projectId !== (ui.project === "none" ? null : ui.project)) return false;
      if (ui.priority !== "all" && t.priority !== ui.priority) return false;
      if (q) {
        var p = project(t.projectId);
        var hay = (t.title + " " + t.notes + " " + (p ? p.name : "") + " " + t.subtasks.map(function (s) { return s.title; }).join(" ")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function sortTasks(arr) {
    return arr.slice().sort(function (a, b) {
      if (a.status === "done" && b.status !== "done") return 1;
      if (b.status === "done" && a.status !== "done") return -1;
      var pr = PRIORITIES[a.priority].rank - PRIORITIES[b.priority].rank;
      if (pr) return pr;
      var ad = a.due || "9999-99-99", bd = b.due || "9999-99-99";
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.order - b.order;
    });
  }
  function sortByOrder(arr) { return arr.slice().sort(function (a, b) { return a.order - b.order; }); }

  // ---------------- Render: stats ----------------
  function renderStats() {
    var t = state.tasks, today = todayStr();
    var total = t.length;
    var done = t.filter(function (x) { return x.status === "done"; }).length;
    var doing = t.filter(function (x) { return x.status === "doing"; }).length;
    var todo = t.filter(function (x) { return x.status === "todo"; }).length;
    var overdue = t.filter(function (x) { return x.due && x.due < today && x.status !== "done"; }).length;
    var pct = total ? Math.round(done / total * 100) : 0;
    el("stats").innerHTML =
      stat(total, "全部") + stat(todo, "待办", "var(--p-mid)") + stat(doing, "进行中", "var(--accent)") +
      stat(overdue, "逾期", "var(--p-high)") +
      ('<div class="stat"><div class="num" style="color:var(--done)">' + pct + '%</div><div class="lbl">完成度 (' + done + "/" + total + ')</div><div class="bar"><i style="width:' + pct + '%"></i></div></div>');
  }
  function stat(num, lbl, color) {
    return '<div class="stat"><div class="num"' + (color ? ' style="color:' + color + '"' : "") + ">" + num + '</div><div class="lbl">' + lbl + "</div></div>";
  }

  // ---------------- Render: card ----------------
  function cardHtml(t) {
    var p = project(t.projectId);
    var dl = dueLabel(t.due), dc = dueClass(t.due, t.status);
    var subDone = t.subtasks.filter(function (s) { return s.done; }).length;
    var hasSub = t.subtasks.length > 0;
    var subPct = hasSub ? Math.round(subDone / t.subtasks.length * 100) : 0;
    return '<div class="card p-' + t.priority + (t.status === "done" ? " is-done" : "") + '" draggable="true" data-id="' + t.id + '">' +
      '<div class="card-top">' +
        '<div class="card-check' + (t.status === "done" ? " on" : "") + '" data-act="toggle" title="完成/取消">' + (t.status === "done" ? "✓" : "") + "</div>" +
        '<div class="card-title">' + esc(t.title) + "</div>" +
      "</div>" +
      (t.notes ? '<div class="card-notes">' + esc(t.notes) + "</div>" : "") +
      '<div class="card-meta">' +
        (p ? '<span class="pill proj" style="background:' + esc(p.color) + '">' + esc(p.name) + "</span>" : "") +
        (dl ? '<span class="pill due ' + dc + '">📅 ' + esc(dl) + "</span>" : "") +
        (hasSub ? '<span class="pill subs">☑ ' + subDone + "/" + t.subtasks.length + "</span>" : "") +
      "</div>" +
      (hasSub ? '<div class="card-progress"><i style="width:' + subPct + '%"></i></div>' : "") +
      "</div>";
  }

  // ---------------- Render: board ----------------
  function renderBoard(root) {
    var tasks = visibleTasks();
    var html = '<div class="board">';
    STATUSES.forEach(function (st) {
      var inCol = sortByOrder(tasks.filter(function (t) { return t.status === st.id; }));
      html += '<div class="column" data-status="' + st.id + '">' +
        '<div class="column-head"><span class="ct-dot" style="background:' + st.color + '"></span>' +
        '<span class="ct-name">' + st.name + '</span><span class="ct-count">' + inCol.length + "</span></div>" +
        '<div class="column-body" data-status="' + st.id + '">' +
        (inCol.length ? inCol.map(cardHtml).join("") : '<div class="col-empty">拖动卡片到这里</div>') +
        "</div></div>";
    });
    root.innerHTML = html + "</div>";
    enableBoardDnd(root);
  }

  // ---------------- Render: list ----------------
  function renderList(root) {
    var tasks = sortTasks(visibleTasks());
    if (!tasks.length) { root.innerHTML = emptyHtml(); return; }
    var groups = {}, order = [];
    tasks.forEach(function (t) { var key = t.projectId || "__none"; if (!groups[key]) { groups[key] = []; order.push(key); } groups[key].push(t); });
    var html = "";
    order.forEach(function (key) {
      var p = key === "__none" ? null : project(key);
      var name = p ? p.name : "未分类", color = p ? p.color : "var(--muted)";
      html += '<div class="list-group"><h3><span class="ct-dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + esc(color) + '"></span>' +
        esc(name) + '<span class="gcount">' + groups[key].length + "</span></h3><div class=\"list\">";
      groups[key].forEach(function (t) {
        var dl = dueLabel(t.due), dc = dueClass(t.due, t.status);
        var subDone = t.subtasks.filter(function (s) { return s.done; }).length;
        html += '<div class="row p-' + t.priority + (t.status === "done" ? " is-done" : "") + '" data-id="' + t.id + '">' +
          '<div class="card-check' + (t.status === "done" ? " on" : "") + '" data-act="toggle">' + (t.status === "done" ? "✓" : "") + "</div>" +
          '<div class="row-main" data-act="edit"><div class="row-title">' + esc(t.title) + "</div>" +
          '<div class="row-sub">' +
            '<span class="pill" style="background:var(--bg);border:1px solid var(--border);color:var(--text-2)">' + prioDot(t.priority) + PRIORITIES[t.priority].name + "</span>" +
            (dl ? '<span class="pill due ' + dc + '">📅 ' + esc(dl) + "</span>" : "") +
            (t.subtasks.length ? '<span class="pill subs">☑ ' + subDone + "/" + t.subtasks.length + "</span>" : "") +
          "</div></div>" +
          '<select class="mini-sel" data-act="status">' +
            STATUSES.map(function (s) { return '<option value="' + s.id + '"' + (t.status === s.id ? " selected" : "") + ">" + s.name + "</option>"; }).join("") +
          "</select>" +
          '<div class="row-actions"><button class="icon-btn" data-act="edit" title="编辑">✏️</button>' +
          '<button class="icon-btn" data-act="del" title="删除">🗑️</button></div></div>';
      });
      html += "</div></div>";
    });
    root.innerHTML = html;
  }
  function prioDot(p) {
    var c = p === "high" ? "var(--p-high)" : p === "low" ? "var(--p-low)" : "var(--p-mid)";
    return '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + c + ';margin-right:4px"></span>';
  }

  // ---------------- Render: week ----------------
  function renderWeek(root) {
    var tasks = visibleTasks(), start = new Date(), byDay = {};
    tasks.forEach(function (t) { if (t.due) { (byDay[t.due] = byDay[t.due] || []).push(t); } });
    var html = '<div class="week">';
    for (var i = 0; i < 7; i++) {
      var d = new Date(start); d.setDate(start.getDate() + i);
      var key = ymd(d), isToday = i === 0;
      var label = i === 0 ? "今天" : i === 1 ? "明天" : WEEKDAYS[d.getDay()];
      var dayTasks = sortTasks(byDay[key] || []);
      html += '<div class="day' + (isToday ? " today" : "") + '" data-due="' + key + '">' +
        '<div class="day-head"><span class="day-name">' + label + '<span class="wd">' + (i > 1 ? "" : WEEKDAYS[d.getDay()]) + '</span></span>' +
        '<span class="day-date">' + (d.getMonth() + 1) + "/" + d.getDate() + "</span></div>" +
        '<div class="day-body" data-due="' + key + '">' +
        (dayTasks.length ? dayTasks.map(cardHtml).join("") : '<div class="col-empty">—</div>') + "</div></div>";
    }
    var today = todayStr();
    var backlog = sortTasks(tasks.filter(function (t) {
      return t.status !== "done" && (!t.due || t.due < today || daysBetween(today, t.due) > 6);
    }));
    html += '<div class="day backlog" data-due=""><div class="day-head"><span class="day-name">📥 待安排 / 无日期</span>' +
      '<span class="day-date">' + backlog.length + " 项</span></div>" +
      '<div class="day-body" data-due="">' +
      (backlog.length ? backlog.map(cardHtml).join("") : '<div class="col-empty">把卡片拖到某一天来安排，或拖到这里清除日期</div>') + "</div></div>";
    root.innerHTML = html + "</div>";
    enableWeekDnd(root);
  }

  // ---------------- Render: ability ----------------
  function renderAbility(root) {
    var abs = state.abilities;
    var totalPts = abs.reduce(function (s, a) { return s + a.points; }, 0);
    var maxPts = Math.max.apply(null, abs.map(function (a) { return a.points; }).concat([10]));
    var scale = Math.ceil(maxPts / 10) * 10;
    var doneCount = state.tasks.filter(function (t) { return t.status === "done"; }).length;

    var html = '<div class="ability-wrap">';
    // left: radar + summary
    html += '<div class="panel"><h3>🧬 能力雷达 <span class="sub">累计 ' + totalPts + ' 分 · ' + doneCount + ' 项已完成</span></h3>' +
      '<div class="radar-box">' + radarSvg(abs, scale) + "</div>" +
      '<div class="ability-actions">' +
        '<button class="btn" id="abAnalyze">🤖 用 AI 重新分析全部已完成</button>' +
        '<button class="btn danger-ghost" id="abReset">重置分数</button>' +
      "</div></div>";
    // right: bars + log
    html += '<div style="display:flex;flex-direction:column;gap:18px">';
    html += '<div class="panel"><h3>📈 能力等级</h3><div class="ability-list">';
    abs.forEach(function (a) {
      var lv = levelOf(a.points);
      html += '<div class="ab"><div class="ab-top"><div class="ab-ic" style="background:' + esc(a.color) + '">' + a.icon + "</div>" +
        '<div class="ab-name">' + esc(a.name) + '</div><div class="ab-lv">Lv.' + lv.level + "</div></div>" +
        '<div class="ab-meta"><span>' + a.points + ' 分</span><span>距 Lv.' + (lv.level + 1) + " 还差 " + (lv.next - a.points) + " 分</span></div>" +
        '<div class="ab-bar"><i style="width:' + lv.pct + "%;background:" + esc(a.color) + '"></i></div></div>';
    });
    html += "</div></div>";
    // 项目能力：按项目拆解能力贡献
    html += projectAbilityPanelHtml();
    // log
    html += '<div class="panel"><h3>🕑 成长记录 <span class="sub">' + state.xpLog.length + " 条</span></h3>";
    if (!state.xpLog.length) html += '<div class="ai-empty">完成工作项后，这里会记录每一次能力成长。</div>';
    else {
      html += '<div class="xp-log">';
      state.xpLog.slice(0, 60).forEach(function (e) {
        var chips = Object.keys(e.gains).map(function (id) { var a = ability(id); return a ? '<span class="xp-chip" style="background:' + esc(a.color) + '">' + a.icon + " +" + e.gains[id] + "</span>" : ""; }).join("");
        html += '<div class="xp-item"><span class="xp-when">' + relTime(e.at) + '</span><div class="xp-body">' +
          '<div class="xp-title">' + esc(e.title) + (e.by === "openai" ? ' <span style="color:var(--accent-text);font-size:11px">· AI</span>' : "") + "</div>" +
          (e.reason ? '<div class="xp-reason">' + esc(e.reason) + "</div>" : "") +
          '<div class="xp-gains">' + chips + "</div></div></div>";
      });
      html += "</div>";
    }
    html += "</div></div></div>";
    root.innerHTML = html;
    el("abAnalyze").addEventListener("click", reanalyzeAll);
    el("abReset").addEventListener("click", resetAbilities);
  }
  function projectAbilityPanelHtml() {
    var rows = [];
    function rowFor(name, color, ab) {
      var ids = Object.keys(ab).sort(function (a, b) { return ab[b] - ab[a]; });
      if (!ids.length) return;
      var total = ids.reduce(function (s, id) { return s + ab[id]; }, 0);
      var chips = ids.slice(0, 5).map(function (id) {
        var a = ability(id);
        return a ? '<span class="xp-chip" style="background:' + esc(a.color) + '">' + a.icon + " " + esc(a.name) + " " + ab[id] + "</span>" : "";
      }).join("");
      rows.push({ name: name, color: color, total: total, chips: chips });
    }
    state.projects.forEach(function (p) { rowFor(p.name, p.color, projectStats(p.id).abilities); });
    rowFor("未分类任务", "var(--muted)", projectStats(null).abilities);
    rows.sort(function (a, b) { return b.total - a.total; });

    var html = '<div class="panel"><h3>📊 项目能力 <span class="sub">各项目分别练了你哪些能力</span></h3>';
    if (!rows.length) {
      html += '<div class="ai-empty">完成归属于某个项目的工作项后，这里会按项目拆解你的能力成长。</div>';
    } else {
      html += '<div class="proj-ab-list">';
      rows.forEach(function (r) {
        html += '<div class="proj-ab-row"><div class="proj-ab-head"><span class="pdot" style="background:' + esc(r.color) + '"></span>' +
          '<span class="proj-ab-name">' + esc(r.name) + '</span><span class="proj-ab-total">' + r.total + ' 分</span></div>' +
          '<div class="xp-gains">' + r.chips + "</div></div>";
      });
      html += "</div>";
    }
    html += "</div>";
    return html;
  }
  function radarSvg(abs, scale) {
    var n = abs.length, cx = 160, cy = 145, R = 105;
    function pt(i, r) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    }
    var svg = '<svg class="radar" viewBox="0 0 320 300" preserveAspectRatio="xMidYMid meet">';
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var pts = [];
      for (var i = 0; i < n; i++) { var q = pt(i, R * f); pts.push(q[0].toFixed(1) + "," + q[1].toFixed(1)); }
      svg += '<polygon class="grid" points="' + pts.join(" ") + '" />';
    });
    for (var i = 0; i < n; i++) { var o = pt(i, R); svg += '<line class="axis" x1="' + cx + '" y1="' + cy + '" x2="' + o[0].toFixed(1) + '" y2="' + o[1].toFixed(1) + '" />'; }
    var dpts = [];
    for (var j = 0; j < n; j++) { var r = R * Math.min(1, abs[j].points / scale); var dp = pt(j, r); dpts.push(dp[0].toFixed(1) + "," + dp[1].toFixed(1)); }
    svg += '<polygon class="area" points="' + dpts.join(" ") + '" />';
    for (var k = 0; k < n; k++) { var dp2 = pt(k, R * Math.min(1, abs[k].points / scale)); svg += '<circle class="dot" cx="' + dp2[0].toFixed(1) + '" cy="' + dp2[1].toFixed(1) + '" r="2.5" />'; }
    for (var m = 0; m < n; m++) {
      var lp = pt(m, R + 22), a = abs[m];
      var anchor = Math.abs(lp[0] - cx) < 10 ? "middle" : (lp[0] > cx ? "start" : "end");
      svg += '<text class="lbl" x="' + lp[0].toFixed(1) + '" y="' + lp[1].toFixed(1) + '" text-anchor="' + anchor + '" dominant-baseline="middle">' +
        '<tspan class="ic">' + a.icon + '</tspan> ' + esc(a.name) + " " + a.points + "</text>";
    }
    return svg + "</svg>";
  }
  function relTime(ts) {
    var diff = Date.now() - ts, m = Math.floor(diff / 60000);
    if (m < 1) return "刚刚";
    if (m < 60) return m + " 分钟前";
    var h = Math.floor(m / 60); if (h < 24) return h + " 小时前";
    var d = Math.floor(h / 24); if (d < 30) return d + " 天前";
    return new Date(ts).toISOString().slice(5, 10);
  }
  function reanalyzeAll() {
    var doneTasks = state.tasks.filter(function (t) { return t.status === "done"; });
    if (!doneTasks.length) { toast("还没有已完成的工作项"); return; }
    if (state.settings.ai.engine === "openai" && state.settings.ai.apiKey) {
      if (!confirm("将用 OpenAI 重新分析 " + doneTasks.length + " 个已完成项的能力归因，确定？")) return;
      toast("AI 分析中…");
      var chain = Promise.resolve();
      doneTasks.forEach(function (t) {
        chain = chain.then(function () {
          return analyzeOpenAI(t).then(function (res) {
            if (!res) return; removeGains(t); t.xp = res; addGains(t, false); save(); render();
          }).catch(function () {});
        });
      });
      chain.then(function () { toast("AI 重新分析完成"); persistAndRender(); });
    } else {
      doneTasks.forEach(function (t) { removeGains(t); t.xp = analyzeLocal(t); addGains(t, false); });
      persistAndRender();
      toast("已用本地引擎重新分析（接入 OpenAI 可更精准）");
    }
  }
  function resetAbilities() {
    if (!confirm("重置全部能力分数与成长记录？工作项不受影响。")) return;
    state.abilities.forEach(function (a) { a.points = 0; });
    state.xpLog = [];
    state.tasks.forEach(function (t) { t.xpApplied = false; t.xpLogId = null; });
    persistAndRender();
    toast("能力分数已重置");
  }

  // ---------------- Render: projects (long-term) ----------------
  function projectStats(pid) {
    var ts = state.tasks.filter(function (t) { return t.projectId === pid; });
    var done = ts.filter(function (t) { return t.status === "done"; });
    var today = todayStr();
    var overdue = ts.filter(function (t) { return t.due && t.due < today && t.status !== "done"; }).length;
    var open = ts.filter(function (t) { return t.status !== "done"; });
    var nextDue = open.filter(function (t) { return t.due; }).sort(function (a, b) { return a.due < b.due ? -1 : 1; })[0];
    var ab = {};
    done.forEach(function (t) { if (t.xpApplied && t.xp) Object.keys(t.xp.gains).forEach(function (id) { ab[id] = (ab[id] || 0) + t.xp.gains[id]; }); });
    return { total: ts.length, doneCount: done.length, open: open.length, overdue: overdue, nextDue: nextDue, pct: ts.length ? Math.round(done.length / ts.length * 100) : 0, abilities: ab, tasks: ts };
  }
  function renderProjects(root) {
    var sorted = state.projects.slice().sort(function (a, b) {
      var r = PROJECT_STATUS[a.status].rank - PROJECT_STATUS[b.status].rank;
      if (r) return r;
      var ad = a.due || "9999-99-99", bd = b.due || "9999-99-99";
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.createdAt - b.createdAt;
    });
    var html = '<div class="proj-grid">';
    sorted.forEach(function (p) { html += projectCardHtml(p); });
    // 未分类 pseudo-card
    var unfiled = projectStats(null);
    if (unfiled.total) {
      html += '<div class="proj-card" data-pid="__none"><div class="proj-card-head"><span class="pdot" style="background:var(--muted)"></span>' +
        '<span class="pname">未分类任务</span><span class="pcount">' + unfiled.total + " 项</span></div>" +
        '<div class="pbar"><i style="width:' + unfiled.pct + '%;background:var(--muted)"></i></div>' +
        '<div class="pmeta">完成 ' + unfiled.doneCount + "/" + unfiled.total + " · 点击查看</div></div>";
    }
    html += '<button class="proj-card proj-add-card" data-pid="__new">＋ 新建长期项目</button>';
    html += "</div>";
    root.innerHTML = html;
  }
  function projectCardHtml(p) {
    var s = projectStats(p.id);
    var st = PROJECT_STATUS[p.status];
    var dueOver = p.due && p.due < todayStr() && p.status !== "done";
    var msDone = p.milestones.filter(function (m) { return m.done; }).length;
    return '<div class="proj-card' + (p.status === "done" ? " is-done" : "") + '" data-pid="' + p.id + '" style="--pc:' + esc(p.color) + '">' +
      '<div class="proj-card-head"><span class="pdot" style="background:' + esc(p.color) + '"></span>' +
        '<span class="pname">' + esc(p.name) + '</span>' +
        '<span class="pstatus" style="color:' + st.color + ';border-color:' + st.color + '">' + st.name + "</span></div>" +
      (p.goal ? '<div class="pgoal">' + esc(p.goal) + "</div>" : "") +
      '<div class="pbar"><i style="width:' + s.pct + "%;background:" + esc(p.color) + '"></i></div>' +
      '<div class="pmeta"><span>进度 ' + s.doneCount + "/" + s.total + "（" + s.pct + "%）</span>" +
        (p.milestones.length ? '<span>🚩 里程碑 ' + msDone + "/" + p.milestones.length + "</span>" : "") + "</div>" +
      '<div class="pmeta2">' +
        (p.due ? '<span class="' + (dueOver ? "pdue-over" : "") + '">📅 ' + p.due + (dueOver ? " 逾期" : "") + "</span>" : '<span class="muted2">无截止日</span>') +
        (s.overdue ? '<span class="pdue-over">⚠️ ' + s.overdue + " 项逾期</span>" : "") +
      "</div>" +
      "</div>";
  }
  el("viewRoot").addEventListener("click", function (e) {
    var pcard = e.target.closest("[data-pid]");
    if (!pcard || ui.view !== "project") return;
    var pid = pcard.dataset.pid;
    if (pid === "__new") openProjectDetail(null);
    else if (pid === "__none") { ui.view = "list"; ui.project = "none"; renderFilters(); el("projectFilter").value = "none"; render(); }
    else openProjectDetail(pid);
  });

  // ---------------- Project detail modal ----------------
  var modalMilestones = [];
  var pdCurrentId = null;
  function openProjectDetail(pid) {
    var p = pid ? project(pid) : null;
    pdCurrentId = pid;
    el("pdTitle").textContent = p ? "编辑项目" : "新建长期项目";
    el("pdName").value = p ? p.name : ""; el("pdName").classList.remove("err");
    el("pdGoal").value = p ? p.goal : "";
    el("pdColor").value = p ? p.color : DEFAULT_COLORS[state.projects.length % DEFAULT_COLORS.length];
    el("pdStatus").value = p ? p.status : "active";
    el("pdDue").value = p ? p.due : "";
    modalMilestones = p ? p.milestones.map(function (m) { return { id: m.id, title: m.title, done: m.done }; }) : [];
    el("pdDelete").hidden = !p;
    renderPdBody();
    showOverlay("projDetailOverlay");
    setTimeout(function () { el("pdName").focus(); }, 60);
  }
  function renderPdBody() {
    // milestones
    el("pdMsList").innerHTML = modalMilestones.map(function (m, i) {
      return '<li class="' + (m.done ? "done" : "") + '" data-i="' + i + '">' +
        '<input type="checkbox" ' + (m.done ? "checked" : "") + ' data-ma="toggle" />' +
        '<span>' + esc(m.title) + "</span><button data-ma=\"del\" title=\"删除\">✕</button></li>";
    }).join("");
    // task list of this project (only when editing an existing project)
    var box = el("pdTasks");
    if (!pdCurrentId) { box.innerHTML = '<div class="muted2" style="padding:8px 2px">保存项目后，可在这里管理它下面的任务。</div>'; return; }
    var s = projectStats(pdCurrentId);
    var open = sortTasks(s.tasks.filter(function (t) { return t.status !== "done"; }));
    var done = s.tasks.filter(function (t) { return t.status === "done"; });
    var html = '<div class="pd-stat">进度 ' + s.doneCount + "/" + s.total + "（" + s.pct + "%）" + (s.overdue ? ' · <span class="pdue-over">' + s.overdue + " 项逾期</span>" : "") + "</div>";
    html += '<div class="pd-tasklist">';
    if (!s.total) html += '<div class="muted2" style="padding:6px 2px">还没有任务。</div>';
    open.concat(done).forEach(function (t) {
      var dl = dueLabel(t.due), dc = dueClass(t.due, t.status);
      html += '<div class="pd-task' + (t.status === "done" ? " is-done" : "") + '" data-id="' + t.id + '">' +
        '<div class="card-check' + (t.status === "done" ? " on" : "") + '" data-pa="toggle">' + (t.status === "done" ? "✓" : "") + "</div>" +
        '<div class="pd-task-title" data-pa="edit">' + esc(t.title) + (dl ? ' <span class="pill due ' + dc + '" style="font-size:11px">' + esc(dl) + "</span>" : "") + "</div></div>";
    });
    html += "</div>";
    html += '<button class="btn" id="pdAddTask" style="margin-top:10px">＋ 在此项目下新建任务</button>';
    box.innerHTML = html;
    var addBtn = el("pdAddTask");
    if (addBtn) addBtn.addEventListener("click", function () { hideOverlay("projDetailOverlay"); openTaskModal(null); setTimeout(function () { el("fProject").value = pdCurrentId; }, 70); });
  }
  el("pdMsList").addEventListener("click", function (e) {
    var li = e.target.closest("li"); if (!li) return;
    var i = +li.dataset.i;
    if (e.target.dataset.ma === "del") { modalMilestones.splice(i, 1); renderPdBody(); }
  });
  el("pdMsList").addEventListener("change", function (e) {
    var li = e.target.closest("li"); if (!li || e.target.dataset.ma !== "toggle") return;
    modalMilestones[+li.dataset.i].done = e.target.checked; renderPdBody();
  });
  el("pdMsInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); var v = e.target.value.trim(); if (v) { modalMilestones.push({ id: uid(), title: v, done: false }); e.target.value = ""; renderPdBody(); } }
  });
  el("pdTasks").addEventListener("click", function (e) {
    var row = e.target.closest(".pd-task"); if (!row) return;
    var t = task(row.dataset.id); if (!t) return;
    if (e.target.dataset.pa === "toggle") {
      var ns = t.status === "done" ? "todo" : "done", prev = t.status;
      t.status = ns; t.updatedAt = Date.now();
      if (ns === "done" && prev !== "done") { t.completedAt = Date.now(); awardXp(t, true); }
      else if (prev === "done" && ns !== "done") { unawardXp(t); }
      save(); renderPdBody(); // refresh modal; main view re-renders on close
    } else if (e.target.dataset.pa === "edit") {
      hideOverlay("projDetailOverlay"); openTaskModal(t);
    }
  });
  function saveProjectDetail() {
    var name = el("pdName").value.trim();
    if (!name) { el("pdName").classList.add("err"); el("pdName").focus(); return; }
    var data = { name: name, goal: el("pdGoal").value.trim(), color: el("pdColor").value, status: el("pdStatus").value, due: el("pdDue").value, milestones: modalMilestones };
    if (pdCurrentId) { var p = project(pdCurrentId); if (p) Object.assign(p, data); }
    else { state.projects.push(normalizeProject(data)); }
    hideOverlay("projDetailOverlay");
    persistAndRender();
    toast(pdCurrentId ? "项目已保存" : "项目已创建");
  }
  function deleteProjectDetail() {
    var p = project(pdCurrentId); if (!p) return;
    var n = state.tasks.filter(function (t) { return t.projectId === p.id; }).length;
    if (!confirm("删除项目「" + p.name + "」？" + (n ? "其下 " + n + " 个任务将变为未分类（任务不会被删除）。" : ""))) return;
    state.tasks.forEach(function (t) { if (t.projectId === p.id) t.projectId = null; });
    state.projects = state.projects.filter(function (x) { return x.id !== p.id; });
    hideOverlay("projDetailOverlay");
    persistAndRender();
    toast("项目已删除");
  }
  el("pdClose").addEventListener("click", function () { hideOverlay("projDetailOverlay"); });
  el("pdCancel").addEventListener("click", function () { hideOverlay("projDetailOverlay"); });
  el("pdSave").addEventListener("click", saveProjectDetail);
  el("pdDelete").addEventListener("click", deleteProjectDetail);

  function emptyHtml() {
    var any = state.tasks.length > 0;
    return '<div class="empty"><div class="big">🗂️</div>' + (any ? "没有符合筛选条件的工作项" : "还没有工作项") +
      '<div class="hint">' + (any ? "试试调整搜索或筛选" : "在顶部输入框快速添加，或按 <kbd>N</kbd> 新建") + "</div></div>";
  }

  // ---------------- Render dispatch ----------------
  function render() {
    renderStats();
    renderFilters();
    document.querySelectorAll(".view-tab").forEach(function (b) { b.classList.toggle("active", b.dataset.view === ui.view); });
    var controls = document.querySelector(".controls .control-right");
    if (controls) controls.style.visibility = (ui.view === "ability" || ui.view === "project") ? "hidden" : "visible";
    var root = el("viewRoot");
    if (ui.view === "board") renderBoard(root);
    else if (ui.view === "list") renderList(root);
    else if (ui.view === "week") renderWeek(root);
    else if (ui.view === "project") renderProjects(root);
    else renderAbility(root);
  }
  function renderFilters() {
    var sel = el("projectFilter"), cur = ui.project;
    var opts = '<option value="all">全部项目</option><option value="none">未分类</option>';
    state.projects.forEach(function (p) { opts += '<option value="' + p.id + '">' + esc(p.name) + "</option>"; });
    opts += '<option value="__manage" style="color:var(--accent)">⚙️ 管理项目…</option>';
    sel.innerHTML = opts;
    sel.value = (cur === "all" || cur === "none" || project(cur)) ? cur : "all";
  }

  // ---------------- Drag & drop ----------------
  var dragId = null;
  function enableBoardDnd(root) {
    root.querySelectorAll(".card").forEach(function (c) {
      c.addEventListener("dragstart", function (e) { dragId = c.dataset.id; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
      c.addEventListener("dragend", function () { c.classList.remove("dragging"); dragId = null; root.querySelectorAll(".drag-over").forEach(function (x) { x.classList.remove("drag-over"); }); });
    });
    root.querySelectorAll(".column").forEach(function (col) {
      var body = col.querySelector(".column-body");
      col.addEventListener("dragover", function (e) { e.preventDefault(); col.classList.add("drag-over"); });
      col.addEventListener("dragleave", function (e) { if (!col.contains(e.relatedTarget)) col.classList.remove("drag-over"); });
      col.addEventListener("drop", function (e) {
        e.preventDefault(); col.classList.remove("drag-over");
        if (!dragId) return;
        var t = task(dragId); if (!t) return;
        var newStatus = col.dataset.status, prev = t.status;
        reorderInto(t, newStatus, getDragAfter(body, e.clientY));
        if (newStatus === "done" && prev !== "done") { t.completedAt = Date.now(); awardXp(t, true); }
        else if (prev === "done" && newStatus !== "done") { unawardXp(t); }
        persistAndRender();
      });
    });
  }
  function getDragAfter(container, y) {
    var cards = Array.prototype.slice.call(container.querySelectorAll(".card:not(.dragging)"));
    var closest = { offset: -Infinity, el: null };
    cards.forEach(function (c) {
      var box = c.getBoundingClientRect(), offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset: offset, el: c };
    });
    return closest.el;
  }
  function reorderInto(t, status, afterEl) {
    t.status = status; t.updatedAt = Date.now();
    var colTasks = state.tasks.filter(function (x) { return x.status === status && x.id !== t.id; }).sort(function (a, b) { return a.order - b.order; });
    var insertIdx = colTasks.length;
    if (afterEl) { var aid = afterEl.dataset.id; for (var i = 0; i < colTasks.length; i++) if (colTasks[i].id === aid) { insertIdx = i; break; } }
    colTasks.splice(insertIdx, 0, t);
    colTasks.forEach(function (x, i) { x.order = i; });
  }
  function enableWeekDnd(root) {
    root.querySelectorAll(".card").forEach(function (c) {
      c.addEventListener("dragstart", function (e) { dragId = c.dataset.id; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
      c.addEventListener("dragend", function () { c.classList.remove("dragging"); dragId = null; root.querySelectorAll(".drag-over").forEach(function (x) { x.classList.remove("drag-over"); }); });
    });
    root.querySelectorAll(".day").forEach(function (day) {
      day.addEventListener("dragover", function (e) { e.preventDefault(); day.classList.add("drag-over"); });
      day.addEventListener("dragleave", function (e) { if (!day.contains(e.relatedTarget)) day.classList.remove("drag-over"); });
      day.addEventListener("drop", function (e) {
        e.preventDefault(); day.classList.remove("drag-over");
        if (!dragId) return;
        var t = task(dragId); if (!t) return;
        t.due = day.dataset.due || ""; t.updatedAt = Date.now();
        persistAndRender();
      });
    });
  }

  // ---------------- View root events ----------------
  el("viewRoot").addEventListener("click", function (e) {
    var act = e.target.dataset.act;
    var holder = e.target.closest("[data-id]");
    if (!holder) return;
    var t = task(holder.dataset.id); if (!t) return;
    if (!act) { if (holder.classList.contains("card")) openTaskModal(t); return; }
    if (act === "toggle") { setStatus(t, t.status === "done" ? "todo" : "done"); }
    else if (act === "edit") { openTaskModal(t); }
    else if (act === "del") { deleteTask(t.id); save(); render(); toast("已删除「" + truncate(t.title, 14) + "」", "撤销", undoDelete); }
  });
  el("viewRoot").addEventListener("change", function (e) {
    if (e.target.dataset.act !== "status") return;
    var holder = e.target.closest("[data-id]"), t = task(holder.dataset.id);
    if (t) setStatus(t, e.target.value);
  });
  function truncate(s, n) { return s.length > n ? s.slice(0, n) + "…" : s; }
  function undoDelete() {
    if (!lastDeleted) return;
    var t = lastDeleted.task;
    state.tasks.splice(Math.min(lastDeleted.index, state.tasks.length), 0, t);
    if (t.status === "done" && !t.xpApplied) awardXp(t, false);
    lastDeleted = null;
    persistAndRender();
  }

  // ---------------- Task modal ----------------
  function openTaskModal(t) {
    el("modalTitle").textContent = t ? "编辑工作项" : "新建工作项";
    el("fId").value = t ? t.id : "";
    el("fTitle").value = t ? t.title : ""; el("fTitle").classList.remove("err");
    el("fNotes").value = t ? t.notes : "";
    el("fPriority").value = t ? t.priority : "mid";
    el("fStatus").value = t ? t.status : "todo";
    el("fDue").value = t ? t.due : "";
    modalSubtasks = t ? t.subtasks.map(function (s) { return { id: s.id, title: s.title, done: s.done }; }) : [];
    fillProjectSelect(t ? t.projectId : null);
    renderSubtasks();
    el("deleteBtn").hidden = !t;
    showOverlay("overlay");
    setTimeout(function () { el("fTitle").focus(); }, 60);
  }
  function fillProjectSelect(selected) {
    var opts = '<option value="">（无项目）</option>';
    state.projects.forEach(function (p) { opts += '<option value="' + p.id + '"' + (p.id === selected ? " selected" : "") + ">" + esc(p.name) + "</option>"; });
    el("fProject").innerHTML = opts;
  }
  function renderSubtasks() {
    el("subList").innerHTML = modalSubtasks.map(function (s, i) {
      return '<li class="' + (s.done ? "done" : "") + '" data-i="' + i + '">' +
        '<input type="checkbox" ' + (s.done ? "checked" : "") + ' data-sa="toggle" />' +
        '<span>' + esc(s.title) + "</span>" +
        '<button data-sa="del" title="删除">✕</button></li>';
    }).join("");
  }
  el("subList").addEventListener("click", function (e) {
    var li = e.target.closest("li"); if (!li) return;
    var i = +li.dataset.i;
    if (e.target.dataset.sa === "del") { modalSubtasks.splice(i, 1); renderSubtasks(); }
  });
  el("subList").addEventListener("change", function (e) {
    var li = e.target.closest("li"); if (!li || e.target.dataset.sa !== "toggle") return;
    modalSubtasks[+li.dataset.i].done = e.target.checked; renderSubtasks();
  });
  el("subInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); var v = e.target.value.trim(); if (v) { modalSubtasks.push({ id: uid(), title: v, done: false }); e.target.value = ""; renderSubtasks(); } }
  });
  function saveTaskModal() {
    var title = el("fTitle").value.trim();
    if (!title) { el("fTitle").classList.add("err"); el("fTitle").focus(); return; }
    var data = { title: title, notes: el("fNotes").value.trim(), projectId: el("fProject").value || null, priority: el("fPriority").value, status: el("fStatus").value, due: el("fDue").value, subtasks: modalSubtasks };
    var id = el("fId").value;
    if (id) updateTask(id, data); else addTask(data);
    hideOverlay("overlay");
    persistAndRender();
  }

  // ---------------- Projects manager ----------------
  function openProjectManager() { renderProjList(); showOverlay("projOverlay"); }
  function renderProjList() {
    var counts = {};
    state.tasks.forEach(function (t) { if (t.projectId) counts[t.projectId] = (counts[t.projectId] || 0) + 1; });
    if (!state.projects.length) el("projList").innerHTML = '<li style="border:none;color:var(--muted);justify-content:center">还没有项目，下方添加</li>';
    else el("projList").innerHTML = state.projects.map(function (p) {
      return '<li data-id="' + p.id + '">' +
        '<input type="color" class="swatch" value="' + esc(p.color) + '" data-pa="color" style="border:none;padding:0;width:16px;height:16px;background:none" />' +
        '<input class="pname" value="' + esc(p.name) + '" data-pa="rename" style="border:none;background:transparent;color:var(--text);flex:1" />' +
        '<span class="pcount">' + (counts[p.id] || 0) + " 项</span>" +
        '<button class="icon-btn" data-pa="del" title="删除项目">🗑️</button></li>';
    }).join("");
  }
  el("projList").addEventListener("input", function (e) {
    var li = e.target.closest("li"); if (!li) return;
    var p = project(li.dataset.id); if (!p) return;
    if (e.target.dataset.pa === "color") p.color = e.target.value;
    else if (e.target.dataset.pa === "rename") p.name = e.target.value.trim() || p.name;
    save();
  });
  el("projList").addEventListener("click", function (e) {
    if (e.target.dataset.pa !== "del") return;
    var li = e.target.closest("li"), p = project(li.dataset.id); if (!p) return;
    var n = state.tasks.filter(function (t) { return t.projectId === p.id; }).length;
    if (!confirm("删除项目「" + p.name + "」？" + (n ? "其下 " + n + " 个工作项将变为未分类。" : ""))) return;
    state.tasks.forEach(function (t) { if (t.projectId === p.id) t.projectId = null; });
    state.projects = state.projects.filter(function (x) { return x.id !== p.id; });
    save(); renderProjList(); render();
  });
  el("projAddForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = el("projName").value.trim(); if (!name) return;
    state.projects.push(normalizeProject({ name: name, color: el("projColor").value }));
    el("projName").value = ""; save(); renderProjList(); render();
  });

  // ---------------- Overlays ----------------
  function showOverlay(id) { el(id).hidden = false; document.body.style.overflow = "hidden"; }
  function hideOverlay(id) { el(id).hidden = true; if (!anyOverlayOpen()) document.body.style.overflow = ""; }
  function anyOverlayOpen() { return Array.prototype.some.call(document.querySelectorAll(".overlay"), function (o) { return !o.hidden; }); }
  function closeAllOverlays() { document.querySelectorAll(".overlay").forEach(function (o) { o.hidden = true; }); document.body.style.overflow = ""; }
  document.querySelectorAll(".overlay").forEach(function (ov) {
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) { ov.hidden = true; document.body.style.overflow = anyOverlayOpen() ? "hidden" : ""; } });
  });

  // ---------------- Toast ----------------
  function toast(msg, actionLabel, actionFn, dur) {
    var t = el("toast"), btn = el("toastAction");
    el("toastMsg").textContent = msg;
    if (actionLabel) { btn.hidden = false; btn.textContent = actionLabel; btn.onclick = function () { t.hidden = true; clearTimeout(toastTimer); if (actionFn) actionFn(); }; }
    else btn.hidden = true;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, dur || 5000);
  }

  // ---------------- Theme ----------------
  function applyTheme() {
    var mode = state.settings.theme;
    var dark = mode === "dark" || (mode === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#16171a" : "#3370ff");
  }
  function cycleTheme() {
    var order = ["system", "light", "dark"], i = order.indexOf(state.settings.theme);
    state.settings.theme = order[(i + 1) % order.length];
    applyTheme(); save();
    toast("主题：" + ({ system: "跟随系统", light: "浅色", dark: "深色" }[state.settings.theme]));
  }
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (state.settings.theme === "system") applyTheme(); });

  // ---------------- Export / Import ----------------
  function exportData() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "work-plan-" + todayStr() + ".json"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("已导出备份");
  }
  function importData(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var data = JSON.parse(r.result);
        var incoming = Array.isArray(data) ? migrateV1(data) : normalize(data);
        if (!confirm("导入将替换当前全部数据（" + state.tasks.length + " 项 → " + incoming.tasks.length + " 项），确定继续？")) return;
        state = incoming; save(); applyTheme(); render();
        toast("导入成功：" + state.tasks.length + " 项");
      } catch (e) { toast("导入失败：文件格式不正确", null, null, 4000); }
    };
    r.readAsText(file);
  }
  function loadSample() {
    if (state.tasks.length && !confirm("载入示例会追加一批演示数据，继续？")) return;
    var today = new Date();
    function rel(n) { var d = new Date(today); d.setDate(d.getDate() + n); return ymd(d); }
    var pids = {};
    [
      { name: "产品", color: "#3370ff", goal: "把新版产品打磨上线", status: "active", due: rel(30),
        ms: [{ t: "需求评审通过", d: true }, { t: "完成核心开发", d: false }, { t: "灰度发布", d: false }] },
      { name: "运营", color: "#ff9a2e", goal: "提升月活与用户留存", status: "active", due: rel(14),
        ms: [{ t: "建立周报机制", d: true }, { t: "完成一次增长实验", d: false }] },
      { name: "个人成长", color: "#18b566", goal: "持续学习，构建知识体系", status: "active", due: "",
        ms: [{ t: "读完 3 本专业书", d: false }] },
    ].forEach(function (a) {
      var p = normalizeProject({ name: a.name, color: a.color, goal: a.goal, status: a.status, due: a.due,
        milestones: a.ms.map(function (m) { return { id: uid(), title: m.t, done: m.d }; }) });
      pids[a.name] = p.id; state.projects.push(p);
    });
    var samples = [
      { title: "撰写 Q3 产品规划文档", notes: "包含目标、里程碑与资源评估", projectId: pids["产品"], priority: "high", status: "doing", due: rel(2),
        subtasks: [{ id: uid(), title: "收集各方需求", done: true }, { id: uid(), title: "排定里程碑", done: false }, { id: uid(), title: "评审会过审", done: false }] },
      { title: "回顾上周用户反馈并对齐", projectId: pids["运营"], priority: "mid", status: "todo", due: rel(0) },
      { title: "竞品功能调研", projectId: pids["产品"], priority: "mid", status: "todo", due: rel(4) },
      { title: "整理本月数据周报", projectId: pids["运营"], priority: "high", status: "todo", due: rel(-1) },
      { title: "学习并读完《用户体验要素》", projectId: pids["个人成长"], priority: "low", status: "doing", due: "" },
      { title: "重构并优化登录模块代码", projectId: pids["产品"], priority: "mid", status: "done", due: rel(-1) },
      { title: "设计新版导航交互原型", projectId: pids["产品"], priority: "high", status: "done", due: rel(-2) },
    ];
    samples.forEach(function (s, i) { addTask(Object.assign({ order: i }, s)); });
    persistAndRender();
    toast("已载入示例数据");
  }
  function clearAll() {
    if (!confirm("确定清空全部工作项、项目与能力？此操作不可撤销（建议先导出备份）。")) return;
    var ai = state.settings.ai;
    state = defaultState(); state.settings.ai = ai;
    save(); render(); toast("已清空");
  }

  // ============================================================
  //  AI engine — local rules + optional OpenAI (official SDK, browser)
  // ============================================================
  // Official OpenAI SDK, loaded lazily from a CDN (with fallbacks) only when
  // OpenAI mode is actually used — the local engine stays fully offline.
  var OPENAI_SDKS = [
    "https://esm.sh/openai@4?bundle",
    "https://cdn.jsdelivr.net/npm/openai@4/+esm",
    "https://esm.run/openai@4",
  ];
  var _openaiMod = null;
  function loadOpenAISDK() {
    if (_openaiMod) return Promise.resolve(_openaiMod);
    var i = 0;
    function attempt() {
      if (i >= OPENAI_SDKS.length) return Promise.reject(new Error("无法加载 OpenAI SDK（网络受限？）"));
      return import(OPENAI_SDKS[i++]).then(function (m) { _openaiMod = m; return m; }, function () { return attempt(); });
    }
    return attempt();
  }
  function getOpenAI() {
    return loadOpenAISDK().then(function (mod) {
      var OpenAI = mod.default || mod.OpenAI;
      return new OpenAI({ apiKey: state.settings.ai.apiKey, dangerouslyAllowBrowser: true });
    });
  }
  function callOpenAI(messages, opts) {
    opts = opts || {};
    return getOpenAI().then(function (client) {
      var req = { model: state.settings.ai.model || "gpt-4o", messages: messages };
      if (opts.json) req.response_format = { type: "json_object" };
      return client.chat.completions.create(req);
    }).then(function (res) {
      return (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || "";
    });
  }
  function analyzeOpenAI(t) {
    var abs = state.abilities;
    var ids = abs.map(function (a) { return a.id; });
    var sys = "你是一位职业成长教练。给定一项已完成的工作，判断它主要锻炼了下列哪些能力，给每个相关能力打 1-3 分（合计不超过 6 分），只选真正相关的，可多选。" +
      "能力（id: 名称）：\n" + abs.map(function (a) { return a.id + ": " + a.name; }).join("\n") +
      '\n\n只返回 JSON，格式：{"reason":"一句话中文说明锻炼了什么","gains":[{"ability":"<上面的id之一>","points":<整数>}]}。ability 必须是上述 id 之一。';
    var p = project(t.projectId);
    var u = "工作标题：" + t.title + "\n描述：" + (t.notes || "无") + "\n项目：" + (p ? p.name : "无") +
      "\n优先级：" + PRIORITIES[t.priority].name + "\n子任务数：" + (t.subtasks ? t.subtasks.length : 0);
    return callOpenAI([{ role: "system", content: sys }, { role: "user", content: u }], { json: true })
      .then(function (text) {
        var data = JSON.parse(text), gains = {};
        (data.gains || []).forEach(function (g) { if (g && g.points > 0 && ids.indexOf(g.ability) >= 0) gains[g.ability] = Math.min(3, g.points | 0); });
        if (Object.keys(gains).length === 0 && ability("execution")) gains.execution = 1;
        return { gains: gains, reason: data.reason || "AI 分析", by: "openai" };
      });
  }

  function buildDigest(range) {
    var now = new Date(), today = todayStr();
    function inDays(ts, days) { return ts && (now - ts) <= days * 86400000; }
    var done, label;
    if (range === "today") { label = "今日"; done = state.tasks.filter(function (t) { return t.status === "done" && t.completedAt && ymd(new Date(t.completedAt)) === today; }); }
    else if (range === "week") { label = "本周"; done = state.tasks.filter(function (t) { return t.status === "done" && inDays(t.completedAt, 7); }); }
    else { label = "全部"; done = state.tasks.filter(function (t) { return t.status === "done"; }); }
    var doing = state.tasks.filter(function (t) { return t.status === "doing"; });
    var todo = state.tasks.filter(function (t) { return t.status === "todo"; });
    var overdue = state.tasks.filter(function (t) { return t.due && t.due < today && t.status !== "done"; });
    return { label: label, range: range, done: done, doing: doing, todo: todo, overdue: overdue };
  }
  function tn(t) { var p = project(t.projectId); return t.title + (p ? "（" + p.name + "）" : ""); }

  function summarizeLocal(range) {
    var d = buildDigest(range), out = [];
    out.push("## " + d.label + "工作总结");
    out.push("- ✅ 完成：**" + d.done.length + "** 项　🚧 进行中：**" + d.doing.length + "** 项　📋 待办：**" + d.todo.length + "** 项" + (d.overdue.length ? "　⚠️ 逾期：**" + d.overdue.length + "** 项" : ""));
    if (d.done.length) { out.push("### ✅ 已完成"); d.done.slice(0, 12).forEach(function (t) { out.push("- " + tn(t)); }); }
    if (d.doing.length) { out.push("### 🚧 进行中"); d.doing.slice(0, 8).forEach(function (t) { out.push("- " + tn(t) + (t.due ? "（" + dueLabel(t.due) + "）" : "")); }); }
    if (d.overdue.length) { out.push("### ⚠️ 需尽快处理（逾期）"); d.overdue.slice(0, 8).forEach(function (t) { out.push("- " + tn(t) + "（" + dueLabel(t.due) + "）"); }); }
    var topAb = state.abilities.slice().sort(function (a, b) { return b.points - a.points; })[0];
    if (topAb && topAb.points > 0) out.push("### 🧬 能力洞察\n- 当前最突出的能力是 **" + topAb.name + "**（" + topAb.points + " 分，Lv." + levelOf(topAb.points).level + "）。保持节奏，持续精进！");
    if (!d.done.length && !d.doing.length) out.push("\n_这个区间还没有记录。去新建或推进一些工作项吧！_");
    out.push("\n_由本地引擎生成 · 接入 OpenAI 可获得更有洞察力的总结_");
    return out.join("\n");
  }
  function summarizeOpenAI(range) {
    var d = buildDigest(range);
    function list(arr) { return arr.length ? arr.map(function (t) { return "- " + tn(t) + (t.due ? "（截止 " + t.due + "，" + dueLabel(t.due) + "）" : ""); }).join("\n") : "（无）"; }
    var digest = "区间：" + d.label +
      "\n\n【已完成】\n" + list(d.done) +
      "\n\n【进行中】\n" + list(d.doing) +
      "\n\n【待办】\n" + list(d.todo) +
      "\n\n【逾期】\n" + list(d.overdue);
    var sys = "你是用户的工作助理。根据其工作项数据，用中文写一份简洁、有洞察、鼓励性的" + d.label + "工作总结。用 Markdown，包含这些小节：## 进展亮点、## 完成情况、## 待推进与风险、## 建议。语气积极专业，避免空话，给出 2-3 条具体可执行建议。";
    return callOpenAI([{ role: "system", content: sys }, { role: "user", content: digest }]);
  }

  // minimal markdown → html
  function mdToHtml(md) {
    var lines = String(md).split("\n"), html = "", inList = false;
    function inline(s) {
      return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
    }
    lines.forEach(function (ln) {
      var m;
      if ((m = ln.match(/^###\s+(.*)/))) { if (inList) { html += "</ul>"; inList = false; } html += "<h3>" + inline(m[1]) + "</h3>"; }
      else if ((m = ln.match(/^##\s+(.*)/))) { if (inList) { html += "</ul>"; inList = false; } html += "<h2>" + inline(m[1]) + "</h2>"; }
      else if ((m = ln.match(/^#\s+(.*)/))) { if (inList) { html += "</ul>"; inList = false; } html += "<h1>" + inline(m[1]) + "</h1>"; }
      else if ((m = ln.match(/^\s*[-*]\s+(.*)/))) { if (!inList) { html += "<ul>"; inList = true; } html += "<li>" + inline(m[1]) + "</li>"; }
      else if (ln.trim() === "") { if (inList) { html += "</ul>"; inList = false; } }
      else { if (inList) { html += "</ul>"; inList = false; } html += "<p>" + inline(ln) + "</p>"; }
    });
    if (inList) html += "</ul>";
    return html;
  }

  // AI modal
  function openAi() { aiRange = "today"; updateAiTabs(); updateAiEngineLabel(); showOverlay("aiOverlay"); generateAi(); }
  function updateAiTabs() { document.querySelectorAll(".ai-tab").forEach(function (b) { b.classList.toggle("active", b.dataset.range === aiRange); }); }
  function updateAiEngineLabel() {
    var ai = state.settings.ai, useAI = ai.engine === "openai" && ai.apiKey;
    el("aiEngine").innerHTML = '<span class="dot2" style="background:' + (useAI ? "var(--accent)" : "var(--done)") + '"></span>' + (useAI ? "OpenAI · " + ai.model : "本地引擎");
  }
  var aiCurrentMd = "";
  function generateAi() {
    if (aiBusy) return;
    var ai = state.settings.ai, useAI = ai.engine === "openai" && ai.apiKey;
    var out = el("aiOut");
    if (!useAI) {
      aiCurrentMd = summarizeLocal(aiRange);
      out.innerHTML = mdToHtml(aiCurrentMd);
      return;
    }
    aiBusy = true;
    out.innerHTML = '<div class="ai-loading"><span class="spinner"></span> OpenAI 正在分析你的工作…</div>';
    summarizeOpenAI(aiRange).then(function (md) {
      aiCurrentMd = md; out.innerHTML = mdToHtml(md); aiBusy = false;
    }).catch(function (e) {
      aiBusy = false;
      aiCurrentMd = summarizeLocal(aiRange);
      out.innerHTML = '<div class="ai-empty">⚠️ OpenAI 调用失败，已回退到本地引擎。<br><span style="font-size:12px">' + esc(e.message) + "</span></div>" + mdToHtml(aiCurrentMd);
    });
  }

  // Settings modal
  var tmpEngine = "local";
  function openSettings() {
    tmpEngine = state.settings.ai.engine;
    el("setKey").value = state.settings.ai.apiKey || "";
    el("setKey").type = "password"; el("setKeyToggle").textContent = "显示";
    el("setModel").value = state.settings.ai.model || "gpt-4o";
    updateEngineSeg();
    showOverlay("settingsOverlay");
  }
  function updateEngineSeg() {
    document.querySelectorAll("#engineSeg button").forEach(function (b) { b.classList.toggle("active", b.dataset.engine === tmpEngine); });
    el("aiFields").style.display = tmpEngine === "openai" ? "" : "none";
  }
  function saveSettings() {
    state.settings.ai.engine = tmpEngine;
    state.settings.ai.apiKey = el("setKey").value.trim();
    state.settings.ai.model = el("setModel").value.trim() || "gpt-4o";
    if (tmpEngine === "openai" && !state.settings.ai.apiKey) { toast("已切换到 OpenAI，但未填写 API Key，将暂用本地引擎"); }
    save(); updateAiEngineLabel();
    hideOverlay("settingsOverlay");
    toast("AI 设置已保存");
  }

  // ---------------- Menu ----------------
  el("moreBtn").addEventListener("click", function (e) { e.stopPropagation(); el("morePop").hidden = !el("morePop").hidden; });
  document.addEventListener("click", function () { el("morePop").hidden = true; });
  el("morePop").addEventListener("click", function (e) {
    var act = e.target.dataset.act; if (!act) return;
    el("morePop").hidden = true;
    if (act === "ai-settings") openSettings();
    else if (act === "export") exportData();
    else if (act === "import") el("importFile").click();
    else if (act === "sample") loadSample();
    else if (act === "clear") clearAll();
  });
  el("importFile").addEventListener("change", function (e) { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ""; });

  // ---------------- Wire controls ----------------
  el("quickAddForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var raw = el("quickAdd").value.trim(); if (!raw) return;
    var parsed = parseQuickAdd(raw);
    if (!parsed.title) parsed.title = raw;
    addTask({ title: parsed.title, projectId: ensureProject(parsed.projectName), priority: parsed.priority, due: parsed.due, status: "todo" });
    el("quickAdd").value = "";
    persistAndRender();
  });
  el("search").addEventListener("input", function (e) { ui.search = e.target.value; render(); });
  el("projectFilter").addEventListener("change", function (e) {
    if (e.target.value === "__manage") { e.target.value = ui.project; openProjectManager(); return; }
    ui.project = e.target.value; render();
  });
  el("priorityFilter").addEventListener("change", function (e) { ui.priority = e.target.value; render(); });
  el("hideDone").addEventListener("change", function (e) { ui.hideDone = e.target.checked; render(); });
  document.querySelectorAll(".view-tab").forEach(function (b) { b.addEventListener("click", function () { setView(b.dataset.view); }); });
  function setView(v) { ui.view = v; state.settings.lastView = v; save(); render(); }

  el("themeBtn").addEventListener("click", cycleTheme);
  el("helpBtn").addEventListener("click", function () { showOverlay("helpOverlay"); });
  el("helpClose").addEventListener("click", function () { hideOverlay("helpOverlay"); });
  el("projClose").addEventListener("click", function () { hideOverlay("projOverlay"); render(); });
  el("modalClose").addEventListener("click", function () { hideOverlay("overlay"); });
  el("cancelBtn").addEventListener("click", function () { hideOverlay("overlay"); });
  el("saveBtn").addEventListener("click", saveTaskModal);
  el("deleteBtn").addEventListener("click", function () {
    var id = el("fId").value, t = task(id);
    if (t && confirm("删除「" + t.title + "」？")) { deleteTask(id); hideOverlay("overlay"); save(); render(); toast("已删除", "撤销", undoDelete); }
  });
  el("fTitle").addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveTaskModal(); });

  // AI modal controls
  el("aiBtn").addEventListener("click", openAi);
  el("aiClose").addEventListener("click", function () { hideOverlay("aiOverlay"); });
  el("aiTabs").addEventListener("click", function (e) {
    if (!e.target.classList.contains("ai-tab")) return;
    aiRange = e.target.dataset.range; updateAiTabs(); generateAi();
  });
  el("aiRegen").addEventListener("click", generateAi);
  el("aiCopy").addEventListener("click", function () {
    if (!aiCurrentMd) return;
    if (navigator.clipboard) navigator.clipboard.writeText(aiCurrentMd).then(function () { toast("已复制到剪贴板"); }, function () { toast("复制失败"); });
    else toast("当前环境不支持复制");
  });
  el("aiSettingsLink").addEventListener("click", function () { hideOverlay("aiOverlay"); openSettings(); });

  // Settings controls
  el("setClose").addEventListener("click", function () { hideOverlay("settingsOverlay"); });
  el("setCancel").addEventListener("click", function () { hideOverlay("settingsOverlay"); });
  el("setSave").addEventListener("click", saveSettings);
  el("engineSeg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; tmpEngine = b.dataset.engine; updateEngineSeg(); });
  el("setKeyToggle").addEventListener("click", function () {
    var k = el("setKey"); k.type = k.type === "password" ? "text" : "password";
    el("setKeyToggle").textContent = k.type === "password" ? "显示" : "隐藏";
  });

  // ---------------- Keyboard ----------------
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeAllOverlays(); return; }
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "n" || e.key === "N") { e.preventDefault(); openTaskModal(null); }
    else if (e.key === "/") { e.preventDefault(); el("search").focus(); }
    else if (e.key === "?") { e.preventDefault(); showOverlay("helpOverlay"); }
    else if (e.key === "1") setView("board");
    else if (e.key === "2") setView("list");
    else if (e.key === "3") setView("week");
    else if (e.key === "4") setView("project");
    else if (e.key === "5") setView("ability");
  });

  // ---------------- Service worker ----------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("./sw.js").catch(function () {}); });
  }

  // ---------------- Init ----------------
  applyTheme();
  save(); // persist normalized/migrated state
  render();
})();
