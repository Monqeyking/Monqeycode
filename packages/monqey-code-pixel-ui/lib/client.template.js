window.__ModuleLoader__.load({
  id: "monqey-code-pixel-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const { jsx, jsxs } = require("react/jsx-runtime");

    // Sprite rows are 32x32 (16x16 for "mini"); each character indexes into `colors`, "." is transparent.
    const SPRITES = __SPRITES__;

    const THEME_TOKENS = {
      "--dsw-alias-bg-base": { light: "#fff4dc", dark: "#17120e" },
      "--dsw-alias-bg-layer-1": { light: "#f7e6c0", dark: "#211a14" },
      "--dsw-alias-bg-layer-2": { light: "#f1d9a6", dark: "#2b2219" },
      "--dsw-alias-bg-overlay": { light: "#fffaf0", dark: "#1d1611" },
      "--dsw-alias-border-l1": { light: "#2b2118", dark: "#6b5238" },
      "--dsw-alias-border-l2": { light: "#2b2118", dark: "#7d6244" },
      "--dsw-alias-border-l3": { light: "#2b2118", dark: "#a88b5e" },
      "--dsw-alias-brand-primary": { light: "#c8782a", dark: "#f0a43c" },
      "--dsw-alias-label-primary": { light: "#2b2118", dark: "#f7e2c2" },
      "--dsw-alias-label-secondary": { light: "#5b4b3d", dark: "#d5b48d" },
      "--dsw-alias-label-tertiary": { light: "#816e58", dark: "#a88b5e" },
      "--dsw-alias-interactive-bg-hover": { light: "#f8d98d", dark: "#3a2c1c" }
    };

    const FONT = "'Pixelify Sans','VT323','Cascadia Mono','Consolas',ui-monospace,monospace";
    const LIGHT = "html body:not([data-ds-dark-theme])";
    const DARK = "html body[data-ds-dark-theme]";

    const CSS = `
@font-face { font-family: 'Pixelify Sans'; font-weight: 400; font-style: normal; src: url(__FONT400__) format('truetype'); }
@font-face { font-family: 'Pixelify Sans'; font-weight: 500 700; font-style: normal; src: url(__FONT600__) format('truetype'); }
:root { --monqey-pixel-font: ${FONT}; --monqey-pixel-border: 2px; }
html body *, html body *::before, html body *::after { border-radius: 0 !important; }
html body .monqey-pixel-round, html body .monqey-pixel-round * { border-radius: 50% !important; }
html body * { font-family: var(--monqey-pixel-font); }
html body code, html body pre, html body kbd, html body samp, html body pre *, html body code * { font-family: 'Cascadia Mono','Consolas',ui-monospace,monospace; }
html body textarea:focus, html body input:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 0; }
html body :is([class*="_card_"], [class*="_addCard_"], [class*="_fileCard_"], [class*="_instructionsCard_"], [class*="_ioCard_"], [class*="_rowCard_"], [class*="_setupCard_"], [class*="_dockHintCard_"]) { border: var(--monqey-pixel-border) solid var(--dsw-alias-border-l1) !important; box-shadow: 3px 3px 0 var(--monqey-pixel-shadow); }
${LIGHT} {
  --dsw-alias-bg-base: #fff4dc; --dsw-alias-bg-layer-1: #f7e6c0; --dsw-alias-bg-layer-2: #f1d9a6;
  --dsw-alias-bg-overlay: #fffaf0; --dsw-alias-border-l1: #2b2118; --dsw-alias-border-l2: #2b2118;
  --dsw-alias-border-l3: #2b2118; --dsw-alias-brand-primary: #c8782a; --dsw-alias-label-primary: #2b2118;
  --dsw-alias-label-secondary: #5b4b3d; --dsw-alias-label-tertiary: #816e58;
  --dsw-alias-interactive-bg-hover: #f8d98d; --dsw-specific-sidebar-fill: #f7e6c0; --dsw-specific-input-major: #fffaf0;
  --monqey-pixel-shadow: #2b2118;
  --dsw-specific-bubble: #f8d98d; --dsw-alias-markdown-code-block: #fbf0d3;
  --dsw-alias-button-primary-fill: #c8782a; --dsw-alias-label-primary-foreground: #fffaf0;
  --dsw-alias-bg-layer-3: #fff4dc; --dsw-alias-bg-layer-4: #fff4dc; --dsw-specific-selector: #f7e6c0; --dsw-alias-bg-multi-select: #f7e6c0;
  --dsw-alias-button-elevated-fill: #fff4dc; --dsw-alias-button-floating-fill: #fff4dc; --dsw-alias-button-floating-hover: #f8d98d;
  --dsw-alias-interactive-bg-hover-solid: #f8d98d; --dsw-specific-sidebar-nav-item-active: #e8c98a; --dsw-specific-sidebar-nav-item-hover: #f8d98d;
  --dsw-alias-markdown-code-block-banner: #f1d9a6; --dsw-alias-button-ghost-active-fill: #e8c98a; --dsw-alias-button-ghost-active-hover: #f1d9a6;
  --dsw-static-neutral-bluish-00: #fff4dc; --dsw-static-neutral-bluish-50: #fbf0d3; --dsw-static-neutral-bluish-60: #f7e6c0; --dsw-static-neutral-bluish-75: #f1d9a6;
  --dsw-static-neutral-bluish-100: #e8c98a; --dsw-static-neutral-bluish-150: #e3c383; --dsw-static-neutral-bluish-200: #d9b97a;
}
${DARK} {
  --dsw-alias-bg-base: #17120e; --dsw-alias-bg-layer-1: #211a14; --dsw-alias-bg-layer-2: #2b2219;
  --dsw-alias-bg-overlay: #1d1611; --dsw-alias-border-l1: #6b5238; --dsw-alias-border-l2: #7d6244;
  --dsw-alias-border-l3: #a88b5e; --dsw-alias-brand-primary: #f0a43c; --dsw-alias-label-primary: #f7e2c2;
  --dsw-alias-label-secondary: #d5b48d; --dsw-alias-label-tertiary: #a88b5e;
  --dsw-alias-interactive-bg-hover: #3a2c1c; --dsw-specific-sidebar-fill: #211a14; --dsw-specific-input-major: #1d1611;
  --monqey-pixel-shadow: #000000;
  --dsw-specific-bubble: #3a2c1c; --dsw-alias-markdown-code-block: #120e0a;
  --dsw-alias-button-primary-fill: #f0a43c; --dsw-alias-label-primary-foreground: #17120e;
  --dsw-alias-bg-layer-3: #2b2219; --dsw-alias-bg-layer-4: #33281c; --dsw-specific-selector: #2b2219; --dsw-alias-bg-multi-select: #2b2219;
  --dsw-alias-button-elevated-fill: #2b2219; --dsw-alias-button-floating-fill: #2b2219; --dsw-alias-button-floating-hover: #3a2c1c;
  --dsw-alias-interactive-bg-hover-solid: #3a2c1c; --dsw-specific-sidebar-nav-item-active: #4a3820; --dsw-specific-sidebar-nav-item-hover: #3a2c1c;
  --dsw-alias-markdown-code-block-banner: #2b2219; --dsw-alias-button-ghost-active-fill: #4a3820; --dsw-alias-button-ghost-active-hover: #3a2c1c;
}
html body { font-family: var(--monqey-pixel-font); -webkit-font-smoothing: none; font-smooth: never; }
html body button, html body input, html body textarea, html body select,
html body [role="dialog"], html body [role="menu"], html body [role="listbox"], html body [role="tooltip"] {
  border-radius: 0 !important; font-family: var(--monqey-pixel-font);
}
html body [role="dialog"], html body [role="menu"], html body [role="listbox"] {
  border: var(--monqey-pixel-border) solid var(--dsw-alias-border-l1) !important;
  box-shadow: 4px 4px 0 var(--monqey-pixel-shadow) !important;
}
html body button[data-turn-process] {
  display: flex; align-items: center; gap: 8px; padding: 4px 10px; cursor: pointer;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
  border: var(--monqey-pixel-border) solid var(--dsw-alias-border-l1); box-shadow: 2px 2px 0 var(--monqey-pixel-shadow);
}
html body button[data-turn-process]:hover { background: var(--dsw-alias-interactive-bg-hover); }
html body button[data-turn-process]:active { transform: translate(2px, 2px); box-shadow: none; }
html body button[data-turn-process][data-open] .monqey-pixel-chevron { transform: rotate(180deg); }
.monqey-pixel-sprite { image-rendering: pixelated; shape-rendering: crispEdges; display: block; }
.monqey-pixel-label { font-size: 13px; letter-spacing: .02em; }

html body [data-monqey-thinking] { display: flex; align-items: center; gap: 8px; }
html body [data-monqey-thinking]::before {
  content: ""; flex: none; width: 28px; height: 28px; image-rendering: pixelated;
  background: var(--monqey-pixel-think) center / contain no-repeat;
}
html body [data-monqey-state="error"] { display: flex; align-items: center; gap: 8px; }
html body [data-monqey-state="error"]::before {
  content: ""; flex: none; width: 28px; height: 28px; image-rendering: pixelated;
  background: var(--monqey-pixel-sweat) center / contain no-repeat;
}
html body [data-turn-tail][data-actions-reveal="always"]::before {
  content: ""; display: inline-block; flex: none; width: 24px; height: 24px; margin-right: 6px; vertical-align: middle; image-rendering: pixelated;
  background: var(--monqey-pixel-love) center / contain no-repeat;
}
html body [data-approval-key] > div > div:first-child { display: flex; align-items: center; gap: 8px; font-weight: 600; }
html body [data-approval-key] > div > div:first-child::before {
  content: ""; flex: none; width: 28px; height: 28px; image-rendering: pixelated;
  background: var(--monqey-pixel-alert) center / contain no-repeat;
}
html body button[aria-label="Open remaining Codex usage"], html body button[aria-label="Open Qoder usage"] {
  position: absolute; width: 0 !important; min-width: 0 !important; padding: 0 !important; opacity: 0; pointer-events: none; overflow: hidden;
}
.monqey-pixel-meter { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 6px; cursor: pointer; background: transparent; color: var(--dsw-alias-label-secondary); border: 0; font-size: 13px; }
.monqey-pixel-meter:hover { background: var(--dsw-alias-interactive-bg-hover); }
.monqey-pixel-meter-cells { display: inline-flex; gap: 1px; padding: 2px; border: 2px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.monqey-pixel-meter-cells i { display: block; width: 4px; height: 10px; background: var(--dsw-alias-border-l2); opacity: .18; }
.monqey-pixel-meter-cells i[data-on] { opacity: 1; background: var(--monqey-pixel-meter-color); }
html body button[aria-label="New agent"] { background: var(--dsw-alias-bg-layer-2) !important; font-weight: 600; box-shadow: 2px 2px 0 var(--dsw-alias-border-l1); }
html body button[aria-label="New agent"]:hover { background: var(--dsw-alias-interactive-bg-hover) !important; }
html body button[aria-label="New agent"]:active { box-shadow: none; transform: translate(2px, 2px); }
html body div:has(> button[aria-pressed]:nth-child(3)) > button[aria-pressed] { background: var(--dsw-alias-bg-base) !important; border: 2px solid var(--dsw-alias-border-l1) !important; color: var(--dsw-alias-label-secondary); }
html body div:has(> button[aria-pressed]:nth-child(3)) > button[aria-pressed="true"] { background: var(--dsw-alias-bg-layer-2) !important; color: var(--dsw-alias-label-primary); font-weight: 600; box-shadow: 2px 2px 0 var(--dsw-alias-border-l1); }
${LIGHT} [role="dialog"] { --dsw-specific-input-major: #fbe8c0; }
html body button[style*="rgb(105, 87, 255)"] { background: var(--dsw-alias-brand-primary) !important; border: 2px solid var(--dsw-alias-border-l1) !important; color: var(--dsw-alias-label-primary-foreground) !important; box-shadow: 2px 2px 0 var(--dsw-alias-border-l1); }
html body input[type="checkbox"], html body input[type="radio"] { accent-color: var(--dsw-alias-brand-primary); }
html body [role="dialog"] select, html body [role="dialog"] input:not([type="checkbox"]):not([type="radio"]), html body [role="dialog"] textarea { background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary); border: 2px solid var(--dsw-alias-border-l1); }
.monqey-pixel-activity { display: flex; flex-direction: column; height: 100%; min-height: 0; font-size: 12px; }
.monqey-pixel-activity-bar { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; border-bottom: 2px solid var(--dsw-alias-border-l1); }
.monqey-pixel-chip { padding: 2px 8px; cursor: pointer; color: var(--dsw-alias-label-secondary); background: transparent; border: 2px solid var(--dsw-alias-border-l1); font-size: 12px; }
.monqey-pixel-chip[data-on] { background: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.monqey-pixel-activity-list { flex: 1; min-height: 0; overflow: auto; padding: 4px 0; }
.monqey-pixel-activity-row { display: block; width: 100%; text-align: left; padding: 3px 8px; cursor: pointer; background: transparent; border: 0; color: var(--dsw-alias-label-primary); font-size: 12px; }
.monqey-pixel-activity-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.monqey-pixel-activity-time { color: var(--dsw-alias-label-tertiary); margin-right: 6px; }
.monqey-pixel-activity-tag { display: inline-block; min-width: 64px; margin-right: 6px; padding: 0 4px; border: 2px solid var(--dsw-alias-border-l1); }
.monqey-pixel-activity-tag[data-error] { background: #d6453a; color: #fff; border-color: #d6453a; }
.monqey-pixel-activity-raw { margin: 2px 8px 6px; padding: 6px; max-height: 240px; overflow: auto; white-space: pre-wrap; word-break: break-all; border: 2px solid var(--dsw-alias-border-l1); font-family: Consolas, monospace; font-size: 11px; }
.monqey-pixel-activity-empty { padding: 16px 8px; color: var(--dsw-alias-label-tertiary); }
`;

    function Sprite({ name, size }) {
      const sprite = SPRITES[name] || SPRITES.default;
      const n = sprite.rows.length;
      const rects = [];
      sprite.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const color = sprite.colors[row[x]];
          if (color) rects.push(jsx("rect", { x, y, width: 1, height: 1, fill: color }, x + "," + y));
        }
      });
      return jsx("svg", {
        className: "monqey-pixel-sprite", viewBox: "0 0 " + n + " " + n, width: size, height: size,
        "aria-hidden": "true", children: rects
      });
    }

    // Idle: the mascot falls asleep after IDLE_MS without pointer or keyboard activity.
    const IDLE_MS = 5 * 60 * 1000;
    function useIdle() {
      const [idle, setIdle] = react.useState(false);
      react.useEffect(() => {
        let timer;
        const wake = () => {
          setIdle(false);
          clearTimeout(timer);
          timer = setTimeout(() => setIdle(true), IDLE_MS);
        };
        const events = ["pointerdown", "pointermove", "keydown", "wheel", "focus"];
        events.forEach((name) => window.addEventListener(name, wake, { passive: true }));
        wake();
        return () => { clearTimeout(timer); events.forEach((name) => window.removeEventListener(name, wake)); };
      }, []);
      return idle;
    }

    function BrandMark({ size }) {
      const idle = useIdle();
      return jsx(Sprite, { name: idle ? "sleep" : size && size <= 24 ? "mini" : "default", size: size || 24 });
    }

    function HeroMark() {
      const idle = useIdle();
      return jsx(Sprite, { name: idle ? "sleep" : "default", size: 96 });
    }

    function TurnProcessRow({ node, turnProcess, t }) {
      if (turnProcess === undefined) throw new Error("turn-process node requires Turn process owner state");
      if (!turnProcess.foldable) return null;
      const open = turnProcess.open;
      const labels = [];
      const add = (count, base) => {
        if (count > 0) labels.push(t(base + (count === 1 ? ".one" : ".other"), { count }));
      };
      add(node.data.toolCallCount, "message.turnProcess.toolCalls");
      add(node.data.messageCount, "message.turnProcess.messages");
      add(node.data.subagentCount, "message.turnProcess.subagents");
      const label = labels.length === 0
        ? t("message.turnProcess.thoughtForAWhile")
        : labels.join(t("message.turnProcess.separator"));
      return jsxs("button", {
        type: "button",
        "data-open": open || undefined,
        "data-turn-process": node.data.turn,
        "data-turn-process-messages": node.data.messageCount,
        "data-turn-process-tool-calls": node.data.toolCallCount,
        "data-turn-process-subagents": node.data.subagentCount,
        "aria-expanded": open,
        onClick: (event) => { event.currentTarget.focus(); turnProcess.setOpen(!open); },
        children: [
          jsx(Sprite, { name: open ? "think" : "default", size: 16 }),
          jsx("span", { className: "monqey-pixel-label", children: label }),
          jsx("span", { className: "monqey-pixel-chevron", "aria-hidden": "true", children: "▾" })
        ]
      });
    }

    const react = require("react");

    function spriteUri(name) {
      const sprite = SPRITES[name];
      const n = sprite.rows.length;
      let d = "";
      const parts = [];
      sprite.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const color = sprite.colors[row[x]];
          if (color) parts.push('<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + color + '"/>');
        }
      });
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges">' + parts.join("") + "</svg>";
      return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
    }

    const USAGE_REFRESH_MS = 60000;
    const OLD_USAGE_BUTTON = { codex: 'button[aria-label="Open remaining Codex usage"]', qoder: 'button[aria-label="Open Qoder usage"]' };

    function usagePercent(kind, usage) {
      if (!usage) return null;
      if (kind === "codex") {
        const values = [usage.primary?.usedPercent, usage.secondary?.usedPercent].filter((v) => Number.isFinite(v));
        return values.length ? Math.max(...values) : null;
      }
      const value = usage.totalUsagePercentage ?? usage.userQuota?.percentage;
      return Number.isFinite(value) ? value : null;
    }

    // Only providers with a usage source get a meter; it refreshes itself while the window is visible.
    function UsageMeter({ directory, remote }) {
      const state = react.useSyncExternalStore((l) => directory.subscribe(l), () => directory.getSnapshot(), () => directory.getSnapshot());
      const provider = state.current?.provider;
      const kind = provider === "openai-codex" ? "codex" : provider === "qoder" ? "qoder" : null;
      const [usage, setUsage] = react.useState(null);
      react.useEffect(() => {
        setUsage(null);
        if (kind === null) return undefined;
        let controller = new AbortController();
        const load = async () => {
          if (document.hidden) return;
          controller.abort();
          controller = new AbortController();
          try {
            const result = kind === "codex" ? await remote?.llm?.getCodexUsage(controller.signal) : await remote?.llm?.getQoderUsage(controller.signal);
            if (result?.ok && !controller.signal.aborted) setUsage(result.value);
          } catch { /* keep the last reading; the full panel shows errors */ }
        };
        void load();
        const timer = setInterval(load, USAGE_REFRESH_MS);
        document.addEventListener("visibilitychange", load);
        return () => { clearInterval(timer); controller.abort(); document.removeEventListener("visibilitychange", load); };
      }, [kind, remote]);
      if (kind === null) return null;
      const percent = usagePercent(kind, usage);
      const filled = percent === null ? 0 : Math.round(Math.min(100, Math.max(0, percent)) / 10);
      const color = percent === null ? "var(--dsw-alias-label-tertiary)" : percent >= 90 ? "#d6453a" : percent >= 70 ? "#e0a030" : "#55ad6c";
      const label = percent === null ? "Usage" : Math.round(percent) + "%";
      const cells = [];
      for (let i = 0; i < 10; i++) cells.push(jsx("i", { "data-on": i < filled || undefined }, i));
      return jsxs("button", {
        type: "button",
        className: "monqey-pixel-meter",
        style: { "--monqey-pixel-meter-color": color },
        title: percent === null ? "Open usage" : "Used " + Math.round(percent) + "% – open usage details",
        "aria-label": "Usage meter",
        onClick: (event) => {
          const old = event.currentTarget.parentElement?.parentElement?.querySelector(OLD_USAGE_BUTTON[kind]) || document.querySelector(OLD_USAGE_BUTTON[kind]);
          old?.click();
        },
        children: [jsx("span", { className: "monqey-pixel-meter-cells", "aria-hidden": "true", children: cells }), jsx("span", { children: label })]
      });
    }

    // Activity log: every event the session emits, grouped by category; raw data is one click away.
    const ACTIVITY_CATEGORIES = ["Model", "Tools", "Approvals", "Retries", "Compaction", "Context", "Turns", "Errors"];
    const ACTIVITY_LIMIT = 400;

    function activityCategory(event) {
      const type = String(event.type);
      const data = event.data || {};
      if ((type === "turn/end" && data.reason?.kind === "error") || (type === "tool/result" && data.error)) return "Errors";
      if (type.startsWith("request/") || type === "model/selection" || type.startsWith("assistant/")) return "Model";
      if (type.startsWith("tool/")) return "Tools";
      if (type.startsWith("approval/")) return "Approvals";
      if (type.startsWith("llm/retry")) return "Retries";
      if (type.startsWith("compaction/")) return "Compaction";
      if (type === "user/message" && data.source && data.source !== "user") return "Context";
      return "Turns";
    }

    function activitySummary(event) {
      const type = String(event.type);
      const d = event.data || {};
      const cfg = d.header?.config || d.config || {};
      switch (type) {
        case "tool/call": return (d.name || "tool") + (d.callId ? " · " + String(d.callId).slice(0, 8) : "");
        case "tool/result": return (d.error ? "failed" : "ok") + (d.callId ? " · " + String(d.callId).slice(0, 8) : "");
        case "request/header": return [cfg.provider, cfg.model, cfg.effort].filter(Boolean).join(" · ") || "request";
        case "approval/asked": return (d.toolName || "tool") + (d.reason ? " – " + d.reason : "");
        case "approval/decided": return String(d.outcome || "decided");
        case "llm/retry": return "retry " + d.retry + (d.maxRetries ? "/" + d.maxRetries : "") + " in " + Math.round((d.delayMs || 0) / 1000) + "s";
        case "llm/retry-started": return "retry " + d.retry + " started";
        case "turn/end": return d.reason?.kind === "error" ? "error: " + (d.reason.error?.message || "failed") : String(d.reason?.kind || "ended");
        case "user/message": return d.source && d.source !== "user" ? "context from " + d.source : "user message";
        default: return type;
      }
    }

    function activityTime(time) {
      const date = new Date(time);
      return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour12: false }) : "";
    }

    function ActivityPanel({ binding }) {
      const source = binding?.eventSource;
      const snapshot = react.useSyncExternalStore(
        (listener) => source ? source.subscribe(listener) : () => {},
        () => source ? source.getSnapshot() : null,
        () => source ? source.getSnapshot() : null
      );
      const [filter, setFilter] = react.useState("All");
      const [open, setOpen] = react.useState(null);
      const rows = react.useMemo(() => {
        const list = [];
        for (const entry of snapshot?.entries ?? []) {
          const event = entry?.event ?? entry;
          if (!event || typeof event.type !== "string") continue;
          list.push({ event, category: activityCategory(event) });
        }
        return list.slice(-ACTIVITY_LIMIT);
      }, [snapshot]);
      const visible = filter === "All" ? rows : rows.filter((row) => row.category === filter);
      const chips = ["All", ...ACTIVITY_CATEGORIES].map((name) => jsx("button", {
        type: "button", className: "monqey-pixel-chip", "data-on": name === filter || undefined, onClick: () => setFilter(name), children: name
      }, name));
      const items = [];
      visible.forEach((row, index) => {
        const key = (row.event.seq ?? index) + ":" + row.event.type + ":" + index;
        items.push(jsxs("button", {
          type: "button", className: "monqey-pixel-activity-row", onClick: () => setOpen(open === key ? null : key),
          children: [
            jsx("span", { className: "monqey-pixel-activity-time", children: activityTime(row.event.time) }),
            jsx("span", { className: "monqey-pixel-activity-tag", "data-error": row.category === "Errors" || undefined, children: row.category }),
            jsx("span", { children: activitySummary(row.event) })
          ]
        }, key));
        if (open === key) {
          let raw;
          try { raw = JSON.stringify(row.event, null, 2); } catch { raw = String(row.event.type); }
          if (raw.length > 12000) raw = raw.slice(0, 12000) + "\n… truncated";
          items.push(jsx("pre", { className: "monqey-pixel-activity-raw", children: raw }, key + ":raw"));
        }
      });
      return jsxs("div", {
        className: "monqey-pixel-activity",
        children: [
          jsx("div", { className: "monqey-pixel-activity-bar", children: chips }),
          jsx("div", { className: "monqey-pixel-activity-list", children: items.length ? items : jsx("div", { className: "monqey-pixel-activity-empty", children: "No activity yet." }) })
        ]
      });
    }

    function ActivityButton({ open }) {
      return jsx("button", {
        type: "button", onClick: open, title: "Open Activity log", "aria-label": "Open Activity log",
        style: { color: "var(--dsw-alias-label-secondary)", background: "transparent", border: 0, cursor: "pointer", padding: "0 8px", height: 28, font: "inherit", fontSize: 13 },
        children: "Activity"
      });
    }

    const inject = ["slots", "theme"];

    function apply(ctx) {
      ctx.effect(() => ctx.theme.overrideTokens("monqey-code-pixel-ui", THEME_TOKENS), "monqey-code-pixel-ui: theme tokens");
      if (typeof document !== "undefined") {
        ctx.effect(() => {
          const style = document.createElement("style");
          style.setAttribute("data-plugin", "monqey-code-pixel-ui");
          style.textContent = CSS.replace("var(--monqey-pixel-think)", spriteUri("think")).replace("var(--monqey-pixel-sweat)", spriteUri("sweat")).replace("var(--monqey-pixel-love)", spriteUri("love")).replace("var(--monqey-pixel-alert)", spriteUri("alert"));
          document.head.appendChild(style);
          return () => style.remove();
        }, "monqey-code-pixel-ui: styles");
      }
      ctx.slots.inject("sidebar.brand.mark", () =>
        ctx.slots.inject("conversation.hero.brand.mark", () =>
          ctx.slots.inject("conversation.chat.node", function* () {
            yield ctx.slots.register({ name: "sidebar.brand.mark", priority: -1 }, BrandMark);
            yield ctx.slots.register({ name: "conversation.hero.brand.mark", priority: -1 }, HeroMark);
            yield ctx.slots.register({ name: "conversation.chat.node", key: "turn-process", locale: "chat", priority: -1 }, TurnProcessRow);
          })
        )
      );

      ctx.inject(["slots", "remote", "remote.llm", "modelDirectories"], (scope) => {
        scope.slots.inject("conversation.input.right", () => scope.slots.register({
          name: "conversation.input.right",
          id: "monqey-pixel-usage-meter",
          order: 10,
          inject: (sessionId) => ({ directory: scope.modelDirectories.directoryFor(sessionId).store, remote: scope.remote })
        }, UsageMeter));
      });

      ctx.inject(["sessions", "sidebarRightTabs", "sidebarRight"], (scope) => {
        const id = "monqey-code-pixel-ui:activity";
        scope.effect(() => scope.sidebarRightTabs.register({ id, kind: "monqey-activity", title: () => "Activity", guide: [] }), "monqey-code-pixel-ui: activity tab");
        scope.slots.inject("sidebar.right.pane.tab", () => scope.slots.register({
          name: "sidebar.right.pane.tab", key: id,
          inject: (sessionId) => {
            let binding = null;
            try { binding = scope.sessions.binding(sessionId); } catch { /* session not bound yet */ }
            return { sessionId, binding };
          }
        }, ActivityPanel));
        scope.slots.inject("conversation.session.header.utilities", () => scope.slots.register({
          name: "conversation.session.header.utilities", id, order: 60,
          inject: (sessionId) => ({ open: () => scope.sidebarRight.openTabIn(sessionId, "monqey-activity") })
        }, ActivityButton));
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
