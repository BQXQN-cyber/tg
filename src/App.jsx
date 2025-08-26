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
const genId = () =>
  `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const currency = (n) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-";
const percent = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : "-");
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
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

// —— 默认“魔道&天官群”规则
const DEFAULT_MDTG_RULES = {
  tiers: [
    { min: 0, max: 300, rate: 6.5 },
    { min: 300, max: 500, rate: 6.3 },
    { min: 500, max: null, rate: 6.0 },
  ],
  depositPolicy: {
    small: { upTo: 300, type: "deposit", ratio: 0.3 }, // <300：定金30%
    mid: { from: 300, to: 500, type: "deposit", ratio: 0.5 }, // 300-499：定金50%
    large: { from: 500, type: "full", ratio: 1.0 }, // >=500：全款
  },
  priorityWindowMin: 30, // 交预付者优先窗口（分钟）
};

const DEFAULT_EVENT = () => ({
  id: genId(),
  name: "示例活动：魔道&天官 池袋扫街",
  date: new Date().toISOString().slice(0, 10),
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
    if (t.max == null) {
      if (n >= t.min) return t.rate;
    } else if (n >= t.min && n < t.max) return t.rate;
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
  const [data, setData] = useState(
    () => loadData() || { events: [DEFAULT_EVENT()], selectedEventId: null }
  );
  const [route, setRoute] = useState(() => parseRoute());

  const selectedEvent = useMemo(() => {
    const id = data.selectedEventId ?? data.events[0]?.id;
    return data.events.find((e) => e.id === id) || data.events[0] || null;
  }, [data]);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!data.selectedEventId && data.events[0])
      setData((d) => ({ ...d, selectedEventId: d.events[0].id }));
  }, []);

  useEffect(() => {
    saveData(data);
  }, [data]);

  const createEvent = (evt) =>
    setData((d) => ({
      ...d,
      events: [evt, ...d.events],
      selectedEventId: evt.id,
    }));
  const updateEvent = (id, patch) =>
    setData((d) => ({
      ...d,
      events: d.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  const removeEvent = (id) =>
    setData((d) => {
      const filtered = d.events.filter((e) => e.id !== id);
      return { events: filtered, selectedEventId: filtered[0]?.id ?? null };
    });
  const addParticipant = (evtId, p) =>
    setData((d) => ({
      ...d,
      events: d.events.map((e) =>
        e.id === evtId
          ? { ...e, participants: [{ ...p, id: genId() }, ...e.participants] }
          : e
      ),
    }));
  const updateParticipant = (evtId, pid, patch) =>
    setData((d) => ({
      ...d,
      events: d.events.map((e) =>
        e.id === evtId
          ? {
              ...e,
              participants: e.participants.map((p) =>
                p.id === pid ? { ...p, ...patch } : p
              ),
            }
          : e
      ),
    }));
  const removeParticipant = (evtId, pid) =>
    setData((d) => ({
      ...d,
      events: d.events.map((e) =>
        e.id === evtId
          ? { ...e, participants: e.participants.filter((p) => p.id !== pid) }
          : e
      ),
    }));

  if (route.name === "join") {
    return (
      <JoinPage
        route={route}
        event={data.events.find((e) => e.id === route.eventId) || null}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", color: "#0f172a" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: 16 }}>
        <Header data={data} setData={setData} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 16,
            marginTop: 16,
          }}
        >
          <div>
            <EventSidebar
              data={data}
              onSelect={(id) => setData((d) => ({ ...d, selectedEventId: id }))}
              onCreate={createEvent}
              onRemove={removeEvent}
              onUpdate={(id, patch) => updateEvent(id, patch)}
            />
          </div>
          <div>
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
  const totalParticipants = data.events.reduce(
    (acc, e) => acc + e.participants.length,
    0
  );
  const fileInputRef = useRef(null);

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `saogai_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importJSON = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const obj = JSON.parse(String(e.target?.result || ""));
        if (!obj?.events) throw new Error("格式不正确");
        setData(obj);
      } catch (err) {
        alert("导入失败：" + err.message);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
      }}
    >
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>
          扫街参与统计（本地版 · 魔道&天官规则）
        </h1>
        <p style={{ color: "#475569", fontSize: 14 }}>
          活动：{totalEvents} 个 · 总参与记录：{totalParticipants} 条
        </p>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={exportJSON}>备份/导出JSON</button>
        <label style={{ cursor: "pointer" }}>
          导入JSON
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => importJSON(e.target.files?.[0])}
          />
        </label>
        <button
          onClick={() => {
            if (confirm("确定要清空所有数据吗？此操作不可撤销。")) {
              localStorage.removeItem(STORAGE_KEY);
              window.location.reload();
            }
          }}
        >
          清空数据
        </button>
      </div>
    </div>
  );
}

// ===== 活动侧栏 =====
function EventSidebar({ data, onSelect, onCreate, onRemove, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const l = data.events.filter((e) =>
      [e.name, e.location, e.notes].join(" ").toLowerCase().includes(q.toLowerCase())
    );
    return l.sort((a, b) => b.createdAt - a.createdAt);
  }, [data.events, q]);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ fontWeight: 600 }}>扫街活动</h2>
        <button onClick={() => setOpen(true)}>新建</button>
      </div>
      <div style={{ marginBottom: 8 }}>
        <input
          placeholder="搜索活动名称/地点/备注..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>
      <div style={{ maxHeight: "60vh", overflow: "auto" }}>
        {list.map((e) => (
          <div
            key={e.id}
            onClick={() => onSelect(e.id)}
            style={{
              padding: 8,
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              marginBottom: 8,
              background:
                data.selectedEventId === e.id ? "rgba(241,245,249,0.8)" : "white",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>
                {e.name}
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{e.date || "-"}</div>
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              {e.location || "-"} · 成行门槛 {e.thresholds?.headcount || 0} 人 · 规则：
              {e.group === "mdtg" ? "魔道&天官" : "—"}
            </div>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
              参与 {e.participants.length} 人
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  const name = prompt("修改名称", e.name);
                  if (name != null) onUpdate(e.id, { name });
                }}
              >
                编辑
              </button>
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (confirm("删除活动将同时删除其所有参与者，确认删除？"))
                    onRemove(e.id);
                }}
                style={{ color: "#b91c1c" }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <div style={{ fontSize: 14, color: "#64748b" }}>没有找到活动</div>
        )}
      </div>
      {open && <NewEventModal onClose={() => setOpen(false)} onCreate={onCreate} />}
    </div>
  );
}

function NewEventModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    name: "",
    date: new Date().toISOString().slice(0, 10),
    location: "池袋",
    notes: "",
    group: "mdtg",
    thresholds: { headcount: 6 },
    rules: { mdtg: DEFAULT_MDTG_RULES },
  });
  const submit = () => {
    if (!form.name) return alert("请填写活动名称");
    const evt = { ...form, id: genId(), createdAt: Date.now(), participants: [] };
    onCreate(evt);
    onClose();
  };
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ fontWeight: 600, fontSize: 18 }}>新建扫街活动</h3>
          <button onClick={onClose}>关闭</button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <TextField
            label="活动名称"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
          />
          <TextField
            label="日期"
            type="date"
            value={form.date}
            onChange={(v) => setForm({ ...form, date: v })}
          />
          <TextField
            label="地点"
            value={form.location}
            onChange={(v) => setForm({ ...form, location: v })}
          />
          <NumberField
            label="成行门槛（人数）"
            step={1}
            value={form.thresholds.headcount}
            onChange={(v) =>
              setForm({
                ...form,
                thresholds: {
                  ...form.thresholds,
                  headcount: clamp(Number(v) || 0, 0, 999),
                },
              })
            }
          />
          <SelectField
            label="群组"
            value={form.group}
            onChange={(v) => setForm({ ...form, group: v })}
            options={[{ value: "mdtg", label: "魔道&天官群（池袋）" }]}
          />
          <div style={{ fontSize: 12, color: "#475569", display: "flex", alignItems: "end" }}>
            群组暂仅提供“魔道&天官”规则；杂项群后续再加。
          </div>
        </div>
        <div
          style={{
            marginTop: 8,
            padding: 8,
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            background: "#f8fafc",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>分档汇率（RMB）</div>
          <div style={{ fontSize: 12, color: "#475569" }}>
            当前：0-299→6.5，300-499→6.3，≥500→6.0
          </div>
        </div>
        <div style={{ marginTop: 12, display: "flex", justifyContent: "end", gap: 8 }}>
          <button onClick={onClose}>取消</button>
          <button onClick={submit} style={{ background: "#0f172a", color: "white" }}>
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== 活动详情 =====
function EventDetail({ evt, onAdd, onUpdateP, onRemoveP }) {
  const [q, setQ] = useState("");
  const stats = useMemo(() => calcStats(evt), [evt]);
  const filtered = useMemo(() => {
    const text = q.toLowerCase();
    return evt.participants.filter((p) =>
      [p.name, p.handle, p.wish, p.note].join(" ").toLowerCase().includes(text)
    );
  }, [evt, q]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: "#64748b" }}>#{evt.id.slice(-6)}</div>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{evt.name}</h2>
            <div style={{ fontSize: 14, color: "#475569" }}>
              {evt.date || "-"} · {evt.location || "-"} · 规则：
              {evt.group === "mdtg" ? "魔道&天官" : "—"}
            </div>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
              报名链接：
              <span style={{ textDecoration: "underline", wordBreak: "break-all" }}>
                {joinURL({ eventId: evt.id, eventName: evt.name, group: evt.group })}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <QRButton evt={evt} />
            <ExportCSVButton evt={evt} />
            <CopySummaryButton stats={stats} evt={evt} />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 12,
            marginTop: 12,
          }}
        >
          <StatCard label="参与人数" value={stats.count} />
          <StatCard label="进行中" value={stats.activeCount} />
          <StatCard label="预估金额(RMB)" value={currency(stats.totalReserveRMB)} />
          <StatCard label="已收预付(RMB)" value={currency(stats.collectedPrepayRMB)} />
          <div style={{ gridColumn: "1 / -1" }}>
            <ProgressBar
              label={`成行门槛：${evt.thresholds.headcount} 人`}
              current={stats.activeCount}
              total={evt.thresholds.headcount}
            />
          </div>
        </div>
      </div>

      <QuickCalc rateOf={(rmb) => mdtgRateOf(rmb, evt.rules.mdtg)} />

      <div
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <h3 style={{ fontWeight: 600 }}>参与者列表</h3>
          <input
            placeholder="搜索姓名/账号/需求/备注..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 280 }}
          />
        </div>
        <AddParticipantForm evt={evt} onAdd={onAdd} />
        <ParticipantTable
          evt={evt}
          list={filtered}
          onUpdateP={onUpdateP}
          onRemoveP={onRemoveP}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div
      style={{
        padding: 12,
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        background: "#f8fafc",
      }}
    >
      <div style={{ fontSize: 12, color: "#64748b" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function ProgressBar({ label, current, total }) {
  const pct = Math.max(0, Math.min(100, Math.round(((current || 0) / (total || 1)) * 100)));
  return (
    <div>
      <div style={{ fontSize: 12, color: "#475569", marginBottom: 4 }}>
        {label} · 进度 {pct}%
      </div>
      <div style={{ height: 10, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
        <div style={{ height: 10, width: `${pct}%`, background: "#10b981" }} />
      </div>
    </div>
  );
}

function QRButton({ evt }) {
  const url = joinURL({ eventId: evt.id, eventName: evt.name, group: evt.group });
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
    url
  )}`;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <a href={url} target="_blank" rel="noreferrer">
        <button style={{ background: "#059669", color: "#fff" }}>报名链接</button>
      </a>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          alert("报名链接已复制");
        }}
      >
        复制链接
      </button>
      <details>
        <summary>二维码</summary>
        <div style={{ marginTop: 8, border: "1px solid #e2e8f0", borderRadius: 12, padding: 8 }}>
          <img src={src} alt="QR" style={{ display: "block" }} />
        </div>
      </details>
    </div>
  );
}

// ===== 工具：换算器（按 mdtg 分档展示当前档位） =====
function QuickCalc({ rateOf }) {
  const [rmb, setRmb] = useState("");
  const rate = useMemo(() => rateOf(Number(rmb) || 0), [rmb, rateOf]);
  const jpy = useMemo(() => {
    const n = Number(rmb) || 0;
    return n * (rate || 0);
  }, [rmb, rate]);
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 12,
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <h3 style={{ fontWeight: 600 }}>快速换算（按当前预算档位）</h3>
        <div style={{ fontSize: 14, color: "#475569" }}>当前档汇率：≈ {rate} JPY / RMB</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <NumberField label="预算（RMB）" value={rmb} onChange={setRmb} />
        <div style={{ display: "flex", alignItems: "end" }}>
          <div
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
            }}
          >
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>≈ 可买（JPY）</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{currency(jpy)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== 添加参与者（管理端手动） =====
function AddParticipantForm({ evt, onAdd }) {
  const [form, setForm] = useState({
    name: "",
    handle: "",
    wish: "",
    reserveRMB: "",
    note: "",
  });
  const prepay = useMemo(
    () => mdtgPrepayOf(Number(form.reserveRMB) || 0, evt.rules.mdtg),
    [form.reserveRMB, evt.rules.mdtg]
  );
  const prepayAmt = useMemo(
    () => (Number(form.reserveRMB) || 0) * prepay.ratio,
    [form.reserveRMB, prepay]
  );
  const submit = () => {
    if (!form.name) return alert("请填写参与者姓名/昵称");
    onAdd({
      ...form,
      reserveRMB: Number(form.reserveRMB) || 0,
      depositPaid: false,
      prepayType: prepay.type,
      status: "active",
    });
    setForm({ name: "", handle: "", wish: "", reserveRMB: "", note: "" });
  };
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 8,
        }}
      >
        <TextField
          label="姓名/昵称"
          value={form.name}
          onChange={(v) => setForm({ ...form, name: v })}
        />
        <TextField
          label="账号（微信/小红书等）"
          value={form.handle}
          onChange={(v) => setForm({ ...form, handle: v })}
        />
        <TextField
          label="需求/想要的东西"
          value={form.wish}
          onChange={(v) => setForm({ ...form, wish: v })}
        />
        <NumberField
          label="预算/预估（RMB）"
          value={form.reserveRMB}
          onChange={(v) => setForm({ ...form, reserveRMB: v })}
        />
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>预付类型（自动）</div>
          <div style={{ padding: 8, borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff" }}>
            {prepay.type === "full" ? "全款" : `定金 ${percent(prepay.ratio)}`}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>需预付金额</div>
          <div style={{ padding: 8, borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff" }}>
            ≈ {currency(prepayAmt)} RMB
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button onClick={submit} style={{ width: "100%", background: "#059669", color: "#fff" }}>
            添加
          </button>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <TextField
          label="备注（可写时间/上限价格/替代款等）"
          value={form.note}
          onChange={(v) => setForm({ ...form, note: v })}
        />
      </div>
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
    <div style={{ overflow: "auto", borderRadius: 12, border: "1px solid #e2e8f0" }}>
      <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
        <thead style={{ background: "#eef2f7" }}>
          <tr>
            <Th>#</Th>
            <Th>姓名/昵称</Th>
            <Th>账号</Th>
            <Th>需求</Th>
            <Th style={{ textAlign: "right" }}>预算(RMB)</Th>
            <Th style={{ textAlign: "right" }}>档位汇率</Th>
            <Th>预付类型</Th>
            <Th style={{ textAlign: "right" }}>应预付(RMB)</Th>
            <Th>已收预付</Th>
            <Th>状态</Th>
            <Th>备注</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {list.map((p, i) => {
            const { rule, amt } = prepayOf(p);
            const rate = mdtgRateOf(p.reserveRMB, evt.rules.mdtg);
            return (
              <tr key={p.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <Td style={{ color: "#64748b" }}>{i + 1}</Td>
                <Td>{p.name}</Td>
                <Td style={{ color: "#475569" }}>{p.handle}</Td>
                <Td title={p.wish} style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.wish}
                </Td>
                <Td style={{ textAlign: "right" }}>{currency(p.reserveRMB)}</Td>
                <Td style={{ textAlign: "right" }}>{rate}</Td>
                <Td>{rule.type === "full" ? "全款" : `定金 ${percent(rule.ratio)}`}</Td>
                <Td style={{ textAlign: "right" }}>{currency(amt)}</Td>
                <Td>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={!!p.depositPaid}
                      onChange={(e) => onUpdateP(p.id, { depositPaid: e.target.checked })}
                    />
                    <span style={{ fontSize: 12, color: "#475569" }}>
                      {p.depositPaid ? "已收" : "未收"}
                    </span>
                  </label>
                </Td>
                <Td>
                  <select
                    value={p.status}
                    onChange={(e) => onUpdateP(p.id, { status: e.target.value })}
                  >
                    <option value="active">进行中</option>
                    <option value="fulfilled">已完成</option>
                    <option value="cancelled">已取消</option>
                  </select>
                </Td>
                <Td title={p.note} style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.note}
                </Td>
                <Td>
                  <div style={{ display: "flex", gap: 8, justifyContent: "end" }}>
                    <button
                      onClick={() => {
                        const nv = prompt("修改预算（RMB）", String(p.reserveRMB ?? 0));
                        if (nv == null) return;
                        onUpdateP(p.id, { reserveRMB: clamp(Number(nv) || 0, 0, 9999999) });
                      }}
                    >
                      改预算
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`确认删除 ${p.name} 的记录？`)) onRemoveP(p.id);
                      }}
                      style={{ color: "#b91c1c" }}
                    >
                      删除
                    </button>
                  </div>
                </Td>
              </tr>
            );
          })}
          {list.length === 0 && (
            <tr>
              <Td colSpan={12} style={{ textAlign: "center", color: "#64748b", padding: 24 }}>
                暂无数据，先在上方添加参与者吧～
              </Td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ===== 导出 & 汇总 =====
function ExportCSVButton({ evt }) {
  const handle = () => {
    const headers = [
      "序号",
      "姓名",
      "账号",
      "需求",
      "预算(RMB)",
      "档位汇率",
      "预付类型",
      "应预付(RMB)",
      "已收预付",
      "状态",
      "备注",
    ];
    const rows = evt.participants.map((p, i) => {
      const rate = mdtgRateOf(p.reserveRMB, evt.rules.mdtg);
      const pre = mdtgPrepayOf(p.reserveRMB, evt.rules.mdtg);
      const amt = (p.reserveRMB || 0) * pre.ratio;
      return [
        i + 1,
        safeCSV(p.name),
        safeCSV(p.handle),
        safeCSV(p.wish),
        p.reserveRMB ?? 0,
        rate,
        pre.type === "full" ? "全款" : `定金 ${percent(pre.ratio)}`,
        amt.toFixed(2),
        p.depositPaid ? "已收" : "未收",
        statusLabel(p.status),
        safeCSV(p.note),
      ];
    });
    const content = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${evt.name}_参与统计_${evt.date || ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return <button onClick={handle}>导出CSV</button>;
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
  return <button onClick={handle}>复制汇总</button>;
}

function statusLabel(s) {
  switch (s) {
    case "active":
      return "进行中";
    case "fulfilled":
      return "已完成";
    case "cancelled":
      return "已取消";
    default:
      return s || "-";
  }
}
function calcStats(evt) {
  const count = evt.participants.length;
  const activeList = evt.participants.filter((p) => p.status === "active");
  const activeCount = activeList.length;
  const totalReserveRMB = Math.round(
    evt.participants.reduce((a, p) => a + (Number(p.reserveRMB) || 0), 0) * 100
  ) / 100;
  const collectedPrepayRMB = Math.round(
    evt.participants.reduce((a, p) => {
      const pre = mdtgPrepayOf(p.reserveRMB, evt.rules.mdtg);
      const need = (p.reserveRMB || 0) * pre.ratio;
      return a + (p.depositPaid ? need : 0);
    }, 0) * 100
  ) / 100;
  return { count, activeCount, totalReserveRMB, collectedPrepayRMB };
}

// ===== 公共控件 =====
function TextField({ label, value, onChange, type = "text" }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: 8, border: "1px solid #e2e8f0", borderRadius: 10 }}
      />
    </label>
  );
}
function NumberField({ label, value, onChange, step = 0.01 }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: 8, border: "1px solid #e2e8f0", borderRadius: 10 }}
      />
    </label>
  );
}
function SelectField({ label, value, onChange, options }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: 8, border: "1px solid #e2e8f0", borderRadius: 10 }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function Th({ children, style }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 12px",
        fontSize: 12,
        fontWeight: 600,
        color: "#475569",
        ...style,
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, style, colSpan }) {
  return (
    <td style={{ padding: "8px 12px", verticalAlign: "top", ...style }} colSpan={colSpan}>
      {children}
    </td>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px dashed #94a3b8",
        borderRadius: 14,
        padding: 32,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 8 }}>🛍️</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>还没有活动</div>
      <div style={{ color: "#475569" }}>点击下方按钮创建你的第一个“扫街”活动</div>
      <button
        onClick={() => onCreate(DEFAULT_EVENT())}
        style={{ marginTop: 12, background: "#0f172a", color: "white", padding: "8px 16px" }}
      >
        先用示例快速开始
      </button>
    </div>
  );
}

function Footer() {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", fontSize: 12, color: "#64748b" }}>
      <div>© {new Date().getFullYear()} 扫街参与统计 · 本地存储 · 单页应用</div>
      <div style={{ marginTop: 4 }}>
        提示：更换浏览器/设备会看不到旧数据，记得先在顶部“导出JSON”备份。
      </div>
    </div>
  );
}

// ===== 报名页（公开） =====
function JoinPage({ route, event }) {
  const [form, setForm] = useState({
    name: "",
    handle: "",
    wish: "",
    reserveRMB: "",
    note: "",
  });
  const rules = event?.rules?.mdtg || DEFAULT_MDTG_RULES;
  const pre = useMemo(
    () => mdtgPrepayOf(Number(form.reserveRMB) || 0, rules),
    [form.reserveRMB, rules]
  );
  const need = useMemo(
    () => (Number(form.reserveRMB) || 0) * pre.ratio,
    [form.reserveRMB, pre]
  );

  const payload = useMemo(
    () => ({
      eventId: route.eventId,
      group: route.group || "mdtg",
      name: form.name.trim(),
      handle: form.handle.trim(),
      wish: form.wish.trim(),
      reserveRMB: Number(form.reserveRMB) || 0,
      note: form.note.trim(),
      prepayType: pre.type,
      prepayRatio: pre.ratio,
      ts: Date.now(),
    }),
    [route, form, pre]
  );

  const jsonText = useMemo(() => JSON.stringify(payload), [payload]);

  const submit = async () => {
    if (!payload.name) return alert("请填写姓名/昵称");
    try {
      await navigator.clipboard.writeText(jsonText);
    } catch {}
    alert("报名成功！已复制报名码(JSON)。请发给主办方以完成登记。");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", color: "#0f172a" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
        <div
          style={{
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>
            扫街报名 · {route.eventName || "（未命名活动）"}
          </h1>
          <div style={{ color: "#475569", marginTop: 4, fontSize: 14 }}>
            活动ID：{route.eventId || "未知"} · 群组：魔道&天官
          </div>
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <TextField
              label="姓名/昵称"
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
            />
            <TextField
              label="联系方式/账号（微信/小红书等）"
              value={form.handle}
              onChange={(v) => setForm({ ...form, handle: v })}
            />
            <TextField
              label="想要的东西（可附上限价/替代款）"
              value={form.wish}
              onChange={(v) => setForm({ ...form, wish: v })}
            />
            <NumberField
              label="预算（RMB）"
              value={form.reserveRMB}
              onChange={(v) => setForm({ ...form, reserveRMB: v })}
            />
            <TextField
              label="备注（时间/其他说明）"
              value={form.note}
              onChange={(v) => setForm({ ...form, note: v })}
            />
          </div>
          <div
            style={{
              marginTop: 12,
              padding: 12,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              borderRadius: 12,
              fontSize: 14,
            }}
          >
            预付要求：{pre.type === "full" ? "需全款预付" : `需定金 ${percent(pre.ratio)}`}，约{" "}
            {currency(need)} RMB。
            <br />
            说明：预付用户享有优先选择窗口 {rules.priorityWindowMin} 分钟。
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button
              onClick={submit}
              style={{ background: "#059669", color: "white", padding: "8px 14px" }}
            >
              提交并复制报名码
            </button>
            <a href="#/">
              <button>返回主页</button>
            </a>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>
            提示：本地版不含云端同步。请将报名码发送给主办方，由其粘贴导入（管理端后续可加“粘贴报名码导入”入口）。
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== 其他 =====
function safeCSV(text) {
  const s = String(text ?? "");
  // 若包含逗号、双引号或换行，则使用 CSV 规范进行包裹与转义
  if (s.includes(",") || s.includes("\"") || s.includes("\\n")) {
    return `"${s.replaceAll("\"", '""')}"`;
  }
  return s;
}

// ===== 轻量自检（浏览器控制台） =====
function runUnitTests() {
  try {
    console.assert(safeCSV("hello") === "hello", "plain stays plain");
    console.assert(safeCSV("a,b") === "\"a,b\"", "comma quoted");
    console.assert(
      safeCSV('He said "Hi"') === '"He said ""Hi"""',
      "quotes escaped"
    );
    const withNL = safeCSV("multi\nline");
    console.assert(withNL.startsWith('"') && withNL.endsWith('"'), "newline quoted");
    const content = [["h1", "h2"], ["1", "2"]].map((r) => r.join(",")).join("\n");
    console.assert(content.includes("\n"), "LF join works");
    // eslint-disable-next-line no-console
    console.log("[Saogai] Unit tests passed");
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[Saogai] Unit tests failed", e);
  }
}
if (typeof window !== "undefined" && !window.__SAOGAI_TESTED__) {
  window.__SAOGAI_TESTED__ = true;
  runUnitTests();
}
