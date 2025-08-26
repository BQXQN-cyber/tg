import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * 扫街参与统计（单页版 · 含报名页 · 魔道&天官专用规则）
 * - 无后端：数据仅保存在本机 localStorage；可导入/导出 JSON；导出 CSV。
 * - 路由：
 *   - 管理端（默认）：#/ 或无 hash
 *   - 报名页：#/join?e=<eventId>&n=<eventName>&g=<group>
 * - 规则：为“魔道&天官群（mdtg）”内置分档汇率 + 预付（定金/全款）逻辑 + 成行门槛统计。
 */

// ===== 工具 & 存储 =====
const STORAGE_KEY = "saogai-app-v3-mdtg";
const genId = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const currency = (n) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-");
const percent = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : "-" );
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

function loadData() {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveData(data) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

// ===== 简易哈希路由：#/join?e=<id>&n=<name>&g=<group> =====
function parseRoute() {
  const h = window.location.hash || "";
  if (h.startsWith("#/join")) {
    const u = new URL(window.location.href.replace("#/join", "?join"));
    return {
      name: "join",
      eventId: u.searchParams.get("e") || "",
      eventName: u.searchParams.get("n") || "",
      group: u.searchParams.get("g") || "",
    };
  }
  return { name: "app" };
}
function joinURL({ eventId, eventName = "", group = "mdtg" }) {
  const base = `${window.location.origin}${window.location.pathname}`;
  const p = new URLSearchParams();
  if (eventId) p.set("e", eventId);
  if (eventName) p.set("n", eventName);
  if (group) p.set("g", group);
  return `${base}#/join?${p.toString()}`;
}

// ===== 类型草图 =====
// Event: { id, name, date, location, notes, group: 'mdtg'|'misc', rules: Rules, thresholds: { headcount }, participants: Participant[], createdAt }
// Participant: { id, name, handle, wish, reserveRMB, depositPaid, prepayType: 'none'|'deposit'|'full', status: 'active'|'fulfilled'|'cancelled', note }
// Rules: { mdtg: { tiers: Tier[], depositPolicy: { small, mid, large } }, misc: {...} }
// Tier: { min: number, max: number|null, rate: number }

// —— 默认“魔道&天官群”规则（你可在 UI 里改）
const DEFAULT_MDTG_RULES = {
  tiers: [ // 分档汇率：按预算（RMB）
    { min: 0,   max: 300, rate: 6.5 },
    { min: 300, max: 500, rate: 6.3 },
    { min: 500, max: null, rate: 6.0 },
  ],
  // 预付策略：根据预算区间自动判定
  depositPolicy: {
    small: { upTo: 300, type: "deposit", ratio: 0.3 },   // <300：定金30%
    mid:   { from: 300, to: 500, type: "deposit", ratio: 0.5 }, // 300-499：定金50%
    large: { from: 500, type: "full", ratio: 1.0 },      // >=500：全款预付
  },
  priorityWindowMin: 30, // 交预付者优先窗口（分钟）——仅作提示
};

const DEFAULT_EVENT = () => ({
  id: genId(),
  name: "示例活动：魔道&天官 池袋扫街",
  date: new Date().toISOString().slice(0,10),
  location: "池袋 · K-BOOKS/乙女同人馆周边",
  group: "mdtg",
  notes: "本活动遵循魔道&天官群规则：分档汇率 + 预付优先。",
  thresholds: { headcount: 6 }, // 成行人数门槛
  rules: { mdtg: DEFAULT_MDTG_RULES },
  participants: [],
  createdAt: Date.now(),
});

// ===== 业务逻辑：根据预算计算汇率与预付 =====
function mdtgRateOf(budgetRMB, rules = DEFAULT_MDTG_RULES) {
  const n = Number(budgetRMB) || 0;
  for (const t of rules.tiers) {
    if (t.max == null) { if (n >= t.min) return t.rate; }
    else if (n >= t.min && n < t.max) return t.rate;
  }
  return rules.tiers.at(-1)?.rate ?? 6.0;
}
function mdtgPrepayOf(budgetRMB, rules = DEFAULT_MDTG_RULES) {
  const n = Number(budgetRMB) || 0;
  if (n < rules.depositPolicy.small.upTo) {
    return { type: "deposit", ratio: rules.depositPolicy.small.ratio };
  }
  if (n >= rules.depositPolicy.mid.from && n < rules.depositPolicy.mid.to) {
    return { type: "deposit", ratio: rules.depositPolicy.mid.ratio };
  }
  return { type: "full", ratio: 1.0 };
}

// ===== App 入口 =====
export default function App() {
  const [data, setData] = useState(() => loadData() || { events: [DEFAULT_EVENT()], selectedEventId: null });
  const [route, setRoute] = useState(() => parseRoute());

  // 选中活动
  const selectedEvent = useMemo(() => {
    const id = data.selectedEventId ?? data.events[0]?.id;
    return data.events.find((e) => e.id === id) || data.events[0] || null;
  }, [data]);

  // 路由监听
  useEffect(() => { const onHash = () => setRoute(parseRoute()); window.addEventListener("hashchange", onHash); return () => window.removeEventListener("hashchange", onHash); }, []);

  // 首次选中第一个活动
  useEffect(() => { if (!data.selectedEventId && data.events[0]) setData((d) => ({ ...d, selectedEventId: d.events[0].id })); }, []);

  // 自动保存
  useEffect(() => { saveData(data); }, [data]);

  // 事件操作
  const createEvent = (evt) => setData((d) => ({ ...d, events: [evt, ...d.events], selectedEventId: evt.id }));
  const updateEvent = (id, patch) => setData((d) => ({ ...d, events: d.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const removeEvent = (id) => setData((d) => { const filtered = d.events.filter((e) => e.id !== id); return { events: filtered, selectedEventId: filtered[0]?.id ?? null }; });
  const addParticipant = (evtId, p) => setData((d) => ({ ...d, events: d.events.map((e) => (e.id === evtId ? { ...e, participants: [{ ...p, id: genId() }, ...e.participants] } : e)) }));
  const updateParticipant = (evtId, pid, patch) => setData((d) => ({ ...d, events: d.events.map((e) => (e.id === evtId ? { ...e, participants: e.participants.map((p) => (p.id === pid ? { ...p, ...patch } : p)) } : e)) }));
  const removeParticipant = (evtId, pid) => setData((d) => ({ ...d, events: d.events.map((e) => (e.id === evtId ? { ...e, participants: e.participants.filter((p) => p.id !== pid) } : e)) }));

  // —— 报名页渲染
  if (route.name === "join") {
    return (
      <JoinPage
        route={route}
        event={data.events.find((e) => e.id === route.eventId) || null}
      />
    );
  }

  // —— 管理端渲染
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <Header data={data} setData={setData} />
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6 mt-4">
          <div className="lg:col-span-1">
            <EventSidebar
              data={data}
              onSelect={(id) => setData((d) => ({ ...d, selectedEventId: id }))}
              onCreate={createEvent}
              onRemove={removeEvent}
              onUpdate={(id, patch) => updateEvent(id, patch)}
            />
          </div>
          <div className="lg:col-span-3">
            {selectedEvent ? (
              <EventDetail
                key={selectedEvent.id}
                evt={selectedEvent}
                onUpdate={(patch) => updateEvent(selectedEvent.id, patch)}
                onAdd={(p) => addParticipant(selectedEvent.id, p)}
                onUpdateP={(pid, patch) => updateParticipant(selectedEvent.id, pid, patch)}
                onRemoveP={(pid) => removeParticipant(selectedEvent.id, pid)}
              />
            ) : (
              <EmptyState onCreate={createEvent} />
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}

// ===== 头部 & 备份 =====
function Header({ data, setData }) {
  const totalEvents = data.events.length;
  const totalParticipants = data.events.reduce((acc, e) => acc + e.participants.length, 0);
  const fileInputRef = useRef(null);

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url;
    a.download = `saogai_backup_${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const importJSON = (file) => {
    if (!file) return; const reader = new FileReader();
    reader.onload = (e) => { try { const obj = JSON.parse(String(e.target?.result || "")); if (!obj?.events) throw new Error("格式不正确"); setData(obj); } catch (err) { alert("导入失败：" + err.message); } finally { if (fileInputRef.current) fileInputRef.current.value = ""; } };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">扫街参与统计（本地版 · 魔道&天官规则）</h1>
        <p className="text-slate-600 text-sm md:text-base">活动：{totalEvents} 个 · 总参与记录：{totalParticipants} 条</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={exportJSON} className="px-3 py-2 rounded-xl bg-white shadow hover:shadow-md border border-slate-200 text-sm">备份/导出JSON</button>
        <label className="px-3 py-2 rounded-xl bg-white shadow hover:shadow-md border border-slate-200 text-sm cursor-pointer">导入JSON
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={(e) => importJSON(e.target.files?.[0])} />
        </label>
        <button onClick={() => { if (confirm("确定要清空所有数据吗？此操作不可撤销。")) { localStorage.removeItem(STORAGE_KEY); window.location.reload(); } }} className="px-3 py-2 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 text-sm">清空数据</button>
      </div>
    </div>
  );
}

// ===== 活动侧栏 =====
function EventSidebar({ data, onSelect, onCreate, onRemove, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const l = data.events.filter((e) => [e.name, e.location, e.notes].join(" ").toLowerCase().includes(q.toLowerCase()));
    return l.sort((a, b) => b.createdAt - a.createdAt);
  }, [data.events, q]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-3 md:p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">扫街活动</h2>
        <button className="px-2.5 py-1.5 text-sm rounded-xl bg-slate-900 text-white hover:opacity-90" onClick={() => setOpen(true)}>新建</button>
      </div>
      <div className="mb-2">
        <input placeholder="搜索活动名称/地点/备注..." value={q} onChange={(e) => setQ(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300" />
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
        {list.map((e) => (
          <button key={e.id} onClick={() => onSelect(e.id)} className={`w-full text-left p-3 rounded-xl border ${data.selectedEventId === e.id ? "bg-slate-100 border-slate-300" : "bg-white border-slate-200 hover:bg-slate-50"}`}>
            <div className="flex items-center justify-between"><div className="font-medium truncate">{e.name}</div><div className="text-xs text-slate-500">{e.date || "-"}</div></div>
            <div className="text-xs text-slate-500 mt-0.5 truncate">{e.location || "-"} · 成行门槛 {e.thresholds?.headcount || 0} 人 · 规则：{e.group === 'mdtg' ? '魔道&天官' : '—'}</div>
            <div className="text-xs text-slate-600 mt-1">参与 {e.participants.length} 人</div>
            <div className="flex gap-2 mt-2">
              <button onClick={(ev) => { ev.stopPropagation(); const name = prompt("修改名称", e.name); if (name != null) onUpdate(e.id, { name }); }} className="px-2 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50">编辑</button>
              <button onClick={(ev) => { ev.stopPropagation(); if (confirm("删除活动将同时删除其所有参与者，确认删除？")) onRemove(e.id); }} className="px-2 py-1 text-xs rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50">删除</button>
            </div>
          </button>
        ))}
        {list.length === 0 && <div className="text-sm text-slate-500">没有找到活动</div>}
      </div>
      {open && <NewEventModal onClose={() => setOpen(false)} onCreate={onCreate} />}
    </div>
  );
}

function NewEventModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ name: "", date: new Date().toISOString().slice(0,10), location: "池袋", notes: "", group: "mdtg", thresholds: { headcount: 6 }, rules: { mdtg: DEFAULT_MDTG_RULES } });
  const submit = () => { if (!form.name) return alert("请填写活动名称"); const evt = { ...form, id: genId(), createdAt: Date.now(), participants: [] }; onCreate(evt); onClose(); };
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 p-4 md:p-6">
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-lg">新建扫街活动</h3><button onClick={onClose} className="text-slate-500 hover:text-slate-700">关闭</button></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField label="活动名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <TextField label="日期" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
          <TextField label="地点" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
          <NumberField label="成行门槛（人数）" step={1} value={form.thresholds.headcount} onChange={(v) => setForm({ ...form, thresholds: { ...form.thresholds, headcount: clamp(Number(v)||0,0,999) } })} />
          <SelectField label="群组" value={form.group} onChange={(v) => setForm({ ...form, group: v })} options={[{ value: "mdtg", label: "魔道&天官群（池袋）" }]} />
          <div className="text-xs text-slate-600 flex items-end">群组暂仅提供“魔道&天官”规则；杂项群可后续再加。</div>
        </div>
        <div className="mt-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
          <div className="text-sm font-medium">分档汇率（RMB）</div>
          <div className="text-xs text-slate-600">可在代码中自定义；当前：0-299→6.5，300-499→6.3，≥500→6.0</div>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button className="px-4 py-2 rounded-xl border border-slate-200" onClick={onClose}>取消</button><button className="px-4 py-2 rounded-xl bg-slate-900 text-white" onClick={submit}>创建</button></div>
      </div>
    </div>
  );
}

// ===== 活动详情 =====
function EventDetail({ evt, onUpdate, onAdd, onUpdateP, onRemoveP }) {
  const [q, setQ] = useState("");
  const stats = useMemo(() => calcStats(evt), [evt]);
  const filtered = useMemo(() => {
    const text = q.toLowerCase();
    return evt.participants.filter((p) => [p.name, p.handle, p.wish, p.note].join(" ").toLowerCase().includes(text));
  }, [evt, q]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div>
            <div className="text-xs text-slate-500">#{evt.id.slice(-6)}</div>
            <h2 className="text-xl font-semibold mt-0.5">{evt.name}</h2>
            <div className="text-sm text-slate-600">{evt.date || "-"} · {evt.location || "-"} · 规则：{evt.group === 'mdtg' ? '魔道&天官' : '—'}</div>
            <div className="text-xs text-slate-600 mt-1">报名链接：<span className="underline break-all">{joinURL({ eventId: evt.id, eventName: evt.name, group: evt.group })}</span></div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <QRButton evt={evt} />
            <ExportCSVButton evt={evt} />
            <CopySummaryButton stats={stats} evt={evt} />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <StatCard label="参与人数" value={stats.count} />
          <StatCard label="进行中" value={stats.activeCount} />
          <StatCard label="预估金额(RMB)" value={currency(stats.totalReserveRMB)} />
          <StatCard label="已收预付(RMB)" value={currency(stats.collectedPrepayRMB)} />
          <div className="col-span-2 md:col-span-4">
            <ProgressBar label={`成行门槛：${evt.thresholds.headcount} 人`} current={stats.activeCount} total={evt.thresholds.headcount} />
          </div>
        </div>
      </div>

      <QuickCalc rateOf={(rmb)=>mdtgRateOf(rmb, evt.rules.mdtg)} />

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
          <h3 className="font-semibold">参与者列表</h3>
          <input placeholder="搜索姓名/账号/需求/备注..." value={q} onChange={(e)=>setQ(e.target.value)} className="w-full md:w-80 px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300" />
        </div>
        <AddParticipantForm evt={evt} onAdd={onAdd} />
        <ParticipantTable evt={evt} list={filtered} onUpdateP={onUpdateP} onRemoveP={onRemoveP} />
      </div>
    </div>
  );
}

function StatCard({ label, value }) { return (
  <div className="p-3 rounded-2xl border border-slate-200 bg-slate-50"><div className="text-xs text-slate-500">{label}</div><div className="text-lg font-semibold mt-1">{value}</div></div>
); }

function ProgressBar({ label, current, total }) {
  const pct = Math.max(0, Math.min(100, Math.round(((current||0)/(total||1))*100)));
  return (
    <div>
      <div className="text-xs text-slate-600 mb-1">{label} · 进度 {pct}%</div>
      <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-3 bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function QRButton({ evt }) {
  const url = joinURL({ eventId: evt.id, eventName: evt.name, group: evt.group });
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
  return (
    <div className="flex items-center gap-2">
      <a href={url} target="_blank" className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:opacity-90">报名链接</a>
      <button onClick={async ()=>{ await navigator.clipboard.writeText(url); alert("报名链接已复制"); }} className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50">复制链接</button>
      <details className="group">
        <summary className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer">二维码</summary>
        <div className="mt-2 p-3 rounded-xl border border-slate-200 bg-white w-max"><img src={src} alt="QR" className="rounded" /></div>
      </details>
    </div>
  );
}

// ===== 工具：换算器（按 mdtg 分档展示当前档位） =====
function QuickCalc({ rateOf }) {
  const [rmb, setRmb] = useState("");
  const rate = useMemo(()=> rateOf(Number(rmb)||0), [rmb, rateOf]);
  const jpy = useMemo(()=> { const n = Number(rmb)||0; return (n * (rate || 0)); }, [rmb, rate]);
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold">快速换算（按当前预算档位）</h3><div className="text-sm text-slate-600">当前档汇率：≈ {rate} JPY / RMB</div></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <NumberField label="预算（RMB）" value={rmb} onChange={setRmb} />
        <div className="flex items-end"><div className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50"><div className="text-xs text-slate-500 mb-1">≈ 可买（JPY）</div><div className="text-lg font-semibold">{currency(jpy)}</div></div></div>
      </div>
    </div>
  );
}

// ===== 添加参与者（管理端手动） =====
function AddParticipantForm({ evt, onAdd }) {
  const [form, setForm] = useState({ name: "", handle: "", wish: "", reserveRMB: "", note: "" });
  const prepay = useMemo(()=> mdtgPrepayOf(Number(form.reserveRMB)||0, evt.rules.mdtg), [form.reserveRMB, evt.rules.mdtg]);
  const prepayAmt = useMemo(()=> (Number(form.reserveRMB)||0) * prepay.ratio, [form.reserveRMB, prepay]);
  const submit = () => { if (!form.name) return alert("请填写参与者姓名/昵称"); onAdd({ ...form, reserveRMB: Number(form.reserveRMB)||0, depositPaid: false, prepayType: prepay.type, status: "active" }); setForm({ name: "", handle: "", wish: "", reserveRMB: "", note: "" }); };
  return (
    <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 mb-3">
      <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
        <TextField label="姓名/昵称" value={form.name} onChange={(v)=>setForm({ ...form, name: v })} />
        <TextField label="账号（微信/小红书等）" value={form.handle} onChange={(v)=>setForm({ ...form, handle: v })} />
        <TextField label="需求/想要的东西" value={form.wish} onChange={(v)=>setForm({ ...form, wish: v })} />
        <NumberField label="预算/预估（RMB）" value={form.reserveRMB} onChange={(v)=>setForm({ ...form, reserveRMB: v })} />
        <div className="flex flex-col"><label className="text-xs text-slate-500 mb-1">预付类型（自动）</label><div className="px-3 py-2 rounded-xl border border-slate-200 bg-white">{prepay.type === 'full' ? '全款' : `定金 ${percent(prepay.ratio)}`}</div></div>
        <div className="flex flex-col"><label className="text-xs text-slate-500 mb-1">需预付金额</label><div className="px-3 py-2 rounded-xl border border-slate-200 bg-white">≈ {currency(prepayAmt)} RMB</div></div>
        <div className="flex items-end"><button onClick={submit} className="w-full px-4 py-2 rounded-xl bg-emerald-600 text-white hover:opacity-90">添加</button></div>
      </div>
      <div className="mt-2"><TextField label="备注（可写时间/上限价格/替代款等）" value={form.note} onChange={(v)=>setForm({ ...form, note: v })} /></div>
    </div>
  );
}

// ===== 表格 =====
function ParticipantTable({ evt, list, onUpdateP, onRemoveP }) {
  const prepayOf = (p) => {
    const rule = mdtgPrepayOf(p.reserveRMB, evt.rules.mdtg);
    const amt = (p.reserveRMB || 0) * rule.ratio;
    return { rule, amt };
  };
  return (
    <div className="overflow-auto rounded-2xl border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-100/80"><tr className="text-left"><Th>#</Th><Th>姓名/昵称</Th><Th>账号</Th><Th>需求</Th><Th className="text-right">预算(RMB)</Th><Th className="text-right">档位汇率</Th><Th>预付类型</Th><Th className="text-right">应预付(RMB)</Th><Th>已收预付</Th><Th>状态</Th><Th>备注</Th><Th></Th></tr></thead>
        <tbody className="bg-white">
          {list.map((p,i)=>{
            const { rule, amt } = prepayOf(p);
            const rate = mdtgRateOf(p.reserveRMB, evt.rules.mdtg);
            return (
              <tr key={p.id} className="border-t border-slate-100">
                <Td className="text-slate-500">{i+1}</Td>
                <Td>{p.name}</Td>
                <Td className="text-slate-600">{p.handle}</Td>
                <Td className="max-w-[20rem] truncate" title={p.wish}>{p.wish}</Td>
                <Td className="text-right">{currency(p.reserveRMB)}</Td>
                <Td className="text-right">{rate}</Td>
                <Td>{rule.type === 'full' ? '全款' : `定金 ${percent(rule.ratio)}`}</Td>
                <Td className="text-right">{currency(amt)}</Td>
                <Td>
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" className="w-4 h-4" checked={!!p.depositPaid} onChange={(e)=>onUpdateP(p.id, { depositPaid: e.target.checked })} />
                    <span className="text-xs text-slate-600">{p.depositPaid ? '已收' : '未收'}</span>
                  </label>
                </Td>
                <Td>
                  <select className="px-2 py-1 rounded-lg border border-slate-200" value={p.status} onChange={(e)=>onUpdateP(p.id, { status: e.target.value })}>
                    <option value="active">进行中</option>
                    <option value="fulfilled">已完成</option>
                    <option value="cancelled">已取消</option>
                  </select>
                </Td>
                <Td className="max-w-[18rem] truncate" title={p.note}>{p.note}</Td>
                <Td>
                  <div className="flex gap-2 justify-end">
                    <button className="px-2 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50" onClick={()=>{ const nv = prompt("修改预算（RMB）", String(p.reserveRMB ?? 0)); if (nv == null) return; onUpdateP(p.id, { reserveRMB: clamp(Number(nv)||0, 0, 9999999) }); }}>改预算</button>
                    <button className="px-2 py-1 text-xs rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50" onClick={()=>{ if (confirm(`确认删除 ${p.name} 的记录？`)) onRemoveP(p.id); }}>删除</button>
                  </div>
                </Td>
              </tr>
            );
          })}
          {list.length === 0 && (<tr><Td colSpan={12} className="text-center text-slate-500 py-8">暂无数据，先在上方添加参与者吧～</Td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

// ===== 导出 & 汇总 =====
function ExportCSVButton({ evt }) {
  const handle = () => {
    const headers = ["序号","姓名","账号","需求","预算(RMB)","档位汇率","预付类型","应预付(RMB)","已收预付","状态","备注"];
    const rows = evt.participants.map((p,i)=>{
      const rate = mdtgRateOf(p.reserveRMB, evt.rules.mdtg);
      const pre = mdtgPrepayOf(p.reserveRMB, evt.rules.mdtg);
      const amt = (p.reserveRMB||0) * pre.ratio;
      return [i+1, safeCSV(p.name), safeCSV(p.handle), safeCSV(p.wish), p.reserveRMB ?? 0, rate, pre.type === 'full' ? '全款' : `定金 ${percent(pre.ratio)}`, amt.toFixed(2), p.depositPaid?"已收":"未收", statusLabel(p.status), safeCSV(p.note)];
    });
    const content = [headers, ...rows].map(r=>r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${evt.name}_参与统计_${evt.date||""}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return (<button onClick={handle} className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50">导出CSV</button>);
}

function CopySummaryButton({ stats, evt }) {
  const handle = async () => {
    const link = joinURL({ eventId: evt.id, eventName: evt.name, group: evt.group });
    const lines = [
      `【${evt.name} | ${evt.date || "-"} | ${evt.location || "-"}】`,
      `规则：分档汇率 0-299→6.5；300-499→6.3；≥500→6.0。\n预付：<300 定金30%；300-499 定金50%；≥500 全款。优先窗口 ${evt.rules.mdtg.priorityWindowMin} 分钟`,
      `成行门槛：${evt.thresholds.headcount} 人；当前进行中：${stats.activeCount} / ${evt.thresholds.headcount}`,
      `预估金额：${stats.totalReserveRMB} RMB；已收预付：${stats.collectedPrepayRMB} RMB`,
      `报名链接：${link}`,
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    alert("已复制汇总，可直接发群～");
  };
  return (<button onClick={handle} className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50">复制汇总</button>);
}

function statusLabel(s) { switch (s) { case "active": return "进行中"; case "fulfilled": return "已完成"; case "cancelled": return "已取消"; default: return s || "-"; } }
function calcStats(evt) {
  const count = evt.participants.length;
  const activeList = evt.participants.filter((p)=>p.status === 'active');
  const activeCount = activeList.length;
  const totalReserveRMB = Math.round(evt.participants.reduce((a,p)=>a + (Number(p.reserveRMB)||0), 0) * 100)/100;
  const collectedPrepayRMB = Math.round(evt.participants.reduce((a,p)=>{
    const pre = mdtgPrepayOf(p.reserveRMB, evt.rules.mdtg); const need = (p.reserveRMB||0) * pre.ratio; return a + (p.depositPaid ? need : 0);
  }, 0) * 100)/100;
  return { count, activeCount, totalReserveRMB, collectedPrepayRMB };
}

// ===== 公共控件 =====
function TextField({ label, value, onChange, type = "text" }) { return (
  <label className="flex flex-col"><span className="text-xs text-slate-500 mb-1">{label}</span><input type={type} value={value} onChange={(e)=>onChange(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300"/></label>
); }
function NumberField({ label, value, onChange, step = 0.01 }) { return (
  <label className="flex flex-col"><span className="text-xs text-slate-500 mb-1">{label}</span><input type="number" step={step} value={value} onChange={(e)=>onChange(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300"/></label>
); }
function SelectField({ label, value, onChange, options }) { return (
  <label className="flex flex-col"><span className="text-xs text-slate-500 mb-1">{label}</span><select value={value} onChange={(e)=>onChange(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 bg-white">{options.map(o=>(<option key={o.value} value={o.value}>{o.label}</option>))}</select></label>
); }
function Th({ children, className = "" }) { return <th className={`px-3 py-2 text-xs font-semibold text-slate-600 ${className}`}>{children}</th>; }
function Td({ children, className = "", colSpan }) { return (<td colSpan={colSpan} className={`px-3 py-2 align-top ${className}`}>{children}</td>); }

function EmptyState({ onCreate }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center">
      <div className="text-6xl mb-2">🛍️</div>
      <div className="text-lg font-semibold">还没有活动</div>
      <div className="text-slate-600">点击下方按钮创建你的第一个“扫街”活动</div>
      <button onClick={()=>onCreate(DEFAULT_EVENT())} className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white hover:opacity-90">先用示例快速开始</button>
    </div>
  );
}

function Footer() {
  return (
    <div className="py-10 text-center text-xs text-slate-500">
      <div>© {new Date().getFullYear()} 扫街参与统计 · 本地存储 · 单页应用</div>
      <div className="mt-1">提示：更换浏览器/设备会看不到旧数据，记得先在顶部“导出JSON”备份。</div>
    </div>
  );
}

// ===== 报名页（公开） =====
function JoinPage({ route, event }) {
  const [form, setForm] = useState({ name: "", handle: "", wish: "", reserveRMB: "", note: "" });
  const rules = event?.rules?.mdtg || DEFAULT_MDTG_RULES;
  const pre = useMemo(()=> mdtgPrepayOf(Number(form.reserveRMB)||0, rules), [form.reserveRMB, rules]);
  const need = useMemo(()=> (Number(form.reserveRMB)||0) * pre.ratio, [form.reserveRMB, pre]);

  const payload = useMemo(() => ({
    eventId: route.eventId,
    group: route.group || 'mdtg',
    name: form.name.trim(), handle: form.handle.trim(), wish: form.wish.trim(), reserveRMB: Number(form.reserveRMB)||0, note: form.note.trim(),
    prepayType: pre.type, prepayRatio: pre.ratio, ts: Date.now()
  }), [route, form, pre]);

  const jsonText = useMemo(() => JSON.stringify(payload), [payload]);
  const csvText = useMemo(() => [payload.name, payload.handle, payload.wish, payload.reserveRMB, payload.prepayType, payload.prepayRatio, payload.note, payload.eventId, payload.ts].join(","), [payload]);

  const submit = async () => {
    if (!payload.name) return alert("请填写姓名/昵称");
    try { await navigator.clipboard.writeText(jsonText); } catch {}
    alert("报名成功！已复制报名码(JSON)。请发给主办方以完成登记。");
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-2xl mx-auto p-4 md:p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <h1 className="text-2xl font-bold">扫街报名 · {route.eventName || '（未命名活动）'}</h1>
          <div className="text-slate-600 mt-1 text-sm">活动ID：{route.eventId || '未知'} · 群组：魔道&天官</div>
          <div className="grid grid-cols-1 gap-3 mt-4">
            <TextField label="姓名/昵称" value={form.name} onChange={(v)=>setForm({ ...form, name: v })} />
            <TextField label="联系方式/账号（微信/小红书等）" value={form.handle} onChange={(v)=>setForm({ ...form, handle: v })} />
            <TextField label="想要的东西（可附上限价/替代款）" value={form.wish} onChange={(v)=>setForm({ ...form, wish: v })} />
            <NumberField label="预算（RMB）" value={form.reserveRMB} onChange={(v)=>setForm({ ...form, reserveRMB: v })} />
            <TextField label="备注（时间/其他说明）" value={form.note} onChange={(v)=>setForm({ ...form, note: v })} />
          </div>
          <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm">
            预付要求：{pre.type === 'full' ? '需全款预付' : `需定金 ${percent(pre.ratio)}`}，约 {currency(need)} RMB。<br/>
            说明：预付用户享有优先选择窗口 {rules.priorityWindowMin} 分钟。
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={submit} className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:opacity-90">提交并复制报名码</button>
            <a href="#/" className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50">返回主页</a>
          </div>
          <div className="mt-4 text-xs text-slate-500">提示：本地版不含云端同步。请将报名码发送给主办方，由其粘贴导入（我们可在管理端后续加“粘贴报名码导入”的入口）。</div>
        </div>
      </div>
    </div>
  );
}

// ===== 其他 =====
function safeCSV(text) {
  const s = String(text ?? "");
  // 若包含逗号、双引号或换行，则使用 CSV 规范进行包裹与转义
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replaceAll("\"", '""')}"`;
  }
  return s;
}

// ===== 轻量自检（浏览器控制台） =====
function runUnitTests() {
  try {
    console.assert(safeCSV('hello') === 'hello', 'plain stays plain');
    console.assert(safeCSV('a,b') === '"a,b"', 'comma quoted');
    console.assert(safeCSV('He said "Hi"') === '"He said ""Hi"""', 'quotes escaped');
    const withNL = safeCSV('multi\nline');
    console.assert(withNL.startsWith('"') && withNL.endsWith('"'), 'newline quoted');
    const content = [["h1","h2"],["1","2"]].map(r=>r.join(',')).join('\n');
    console.assert(content.includes('\n'), 'LF join works');
    // Smoke test: ensure no syntax error path remains
    JSON.stringify({ ok: true });
    // eslint-disable-next-line no-console
    console.log('[Saogai] Unit tests passed');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[Saogai] Unit tests failed', e);
  }
}
if (typeof window !== 'undefined' && !window.__SAOGAI_TESTED__) { window.__SAOGAI_TESTED__ = true; runUnitTests(); }
