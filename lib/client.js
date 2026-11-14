window.__ModuleLoader__.load({
	id: "dsh-prompt-refine",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  NS: () => NS,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/EnhanceButton.tsx
var import_react4 = require("react");
var import_react_dom2 = require("react-dom");

// src/shared/validate.ts
function isInvisibleCodePoint(cp) {
  return cp >= 8203 && cp <= 8205 || cp === 65279 || cp >= 8234 && cp <= 8238 || cp >= 8294 && cp <= 8297;
}
function scanText(text) {
  let count = 0;
  let visibleNonBlank = false;
  for (const ch of text) {
    count++;
    const code = ch.codePointAt(0) ?? 0;
    if (!isInvisibleCodePoint(code) && !/\s/.test(ch)) visibleNonBlank = true;
  }
  return { count, visibleNonBlank };
}
function checkInputText(text, maxChars) {
  const { count, visibleNonBlank } = scanText(text);
  if (!visibleNonBlank) {
    return { ok: false, code: "empty" };
  }
  if (count > maxChars) {
    return { ok: false, code: "too-long", count, max: maxChars };
  }
  return { ok: true };
}

// src/shared/protocol.ts
var ENHANCE_ENDPOINT = "/prompt-enhance/enhance";
var ENHANCE_STREAM_ENDPOINT = "/prompt-enhance/enhance-stream";

// src/client/enhance-client.ts
function localFailure(key, params) {
  return { code: "internal", detailKey: key, ...params !== void 0 ? { params } : {} };
}
var EnhanceClientError = class extends Error {
  constructor(detail) {
    super(detail.detailKey ?? detail.message);
    this.detail = detail;
  }
};
function jsonBody(body) {
  return new TextEncoder().encode(JSON.stringify(body));
}
var KNOWN_ERROR_CODES = /* @__PURE__ */ new Set([
  "rejected",
  "rate-limit",
  "concurrency-limit",
  "timeout",
  "upstream",
  "unconfigured",
  "internal"
]);
function parseError(value) {
  const record = value;
  if (record !== null && typeof record === "object") {
    const code = typeof record.code === "string" && KNOWN_ERROR_CODES.has(record.code) ? record.code : "internal";
    const message = typeof record.message === "string" && record.message !== "" ? record.message : void 0;
    const params = record.params !== null && typeof record.params === "object" ? record.params : void 0;
    return { code, ...message !== void 0 ? { message } : {}, ...params !== void 0 ? { params } : {} };
  }
  return localFailure("detail.hostError");
}
function parseEvidence(value) {
  const record = value;
  if (record === null || typeof record !== "object") return void 0;
  const history = record.history === true;
  const workspace = record.workspace === true;
  if (!history && !workspace) return void 0;
  const files = typeof record.files === "number" && Number.isFinite(record.files) && record.files > 0 ? Math.floor(record.files) : 0;
  return { history, workspace, files };
}
function parseResult(value) {
  const record = value;
  if (record !== null && typeof record === "object" && typeof record.text === "string" && record.text !== "" && typeof record.provider === "string" && record.provider !== "" && typeof record.model === "string" && record.model !== "" && typeof record.elapsedMs === "number" && Number.isFinite(record.elapsedMs)) {
    const evidence = parseEvidence(record.evidence);
    return {
      text: record.text,
      provider: record.provider,
      model: record.model,
      elapsedMs: record.elapsedMs,
      // Only the literal `true` marks a capped rewrite: anything else (missing,
      // a string, a truthy object) leaves the result looking complete.
      ...record.truncated === true ? { truncated: true } : {},
      // Older hosts do not send this at all; a malformed value is ignored
      // rather than shown as a half-reported layer.
      ...evidence !== void 0 ? { evidence } : {}
    };
  }
  throw new EnhanceClientError(localFailure("detail.unparsableResult"));
}
async function readEnvelope(response) {
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    throw new EnhanceClientError(localFailure("detail.unparsableResponse"));
  }
  const envelope = parsed;
  if (envelope !== null && typeof envelope === "object" && envelope.ok === true) {
    return parseResult(envelope.value);
  }
  if (envelope !== null && typeof envelope === "object" && envelope.error !== void 0) {
    throw new EnhanceClientError(parseError(envelope.error));
  }
  throw new EnhanceClientError(localFailure("detail.hostStatus", { status: response.status }));
}
function takeFrames(buffer) {
  const frames = [];
  let rest = buffer;
  for (let index = rest.indexOf("\n\n"); index !== -1; index = rest.indexOf("\n\n")) {
    const raw = rest.slice(0, index);
    rest = rest.slice(index + 2);
    let event = "message";
    const data = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length > 0) frames.push({ event, data: data.join("\n") });
  }
  return { frames, rest };
}
function parseFrame(frame) {
  if (frame.event !== "delta" && frame.event !== "done" && frame.event !== "error") return void 0;
  let parsed;
  try {
    parsed = JSON.parse(frame.data);
  } catch {
    return void 0;
  }
  const record = parsed;
  if (record === null || typeof record !== "object" || record.type !== frame.event) return void 0;
  return record;
}
async function requestEnhanceStream(body, options) {
  let response;
  try {
    response = await fetch(ENHANCE_STREAM_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: jsonBody(body),
      signal: options.signal
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw new EnhanceClientError(localFailure("detail.cancelled"));
    }
    void error;
    throw new EnhanceClientError(localFailure("detail.unreachable"));
  }
  const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
  const stream = response.body;
  const streamable = response.ok && stream !== null && stream !== void 0 && contentType.includes("event-stream");
  if (stream === null || stream === void 0 || !streamable) {
    void Promise.resolve().then(() => stream?.cancel()).catch(() => {
    });
    return requestEnhance(body, options.signal);
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = takeFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        const event = parseFrame(frame);
        if (event === void 0) continue;
        if (event.type === "delta") options.onDelta(event.text);
        else if (event.type === "done") return parseResult(event.value);
        else throw new EnhanceClientError(parseError(event.error));
      }
    }
  } finally {
    void Promise.resolve().then(() => reader.cancel()).catch(() => {
    });
  }
  throw new EnhanceClientError(localFailure("detail.streamClosed"));
}
async function requestEnhance(body, signal) {
  let response;
  try {
    response = await fetch(ENHANCE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: jsonBody(body),
      signal
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new EnhanceClientError(localFailure("detail.cancelled"));
    }
    void error;
    throw new EnhanceClientError(localFailure("detail.unreachable"));
  }
  return readEnvelope(response);
}

// src/client/icons.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var BASE = 24;
function EnhanceStarIcon({ size = 16, className }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      className,
      width: size,
      height: size,
      viewBox: `0 0 ${BASE} ${BASE}`,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M11.6 3.4 13 8.2a3.2 3.2 0 0 0 2.2 2.2l4.8 1.4-4.8 1.4a3.2 3.2 0 0 0-2.2 2.2l-1.4 4.8-1.4-4.8a3.2 3.2 0 0 0-2.2-2.2L3.2 11.8l4.8-1.4a3.2 3.2 0 0 0 2.2-2.2z" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M18.6 3.1v3.2" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M20.2 4.7h-3.2" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.6 16.6v2.2" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.7 17.7H4.5" })
      ]
    }
  );
}
function EnhanceBusyIcon({ size = 16, className }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      className,
      width: size,
      height: size,
      viewBox: `0 0 ${BASE} ${BASE}`,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      "aria-hidden": "true",
      focusable: "false",
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 3.5a8.5 8.5 0 1 0 8.5 8.5" })
    }
  );
}

// src/client/ModeMenu.tsx
var import_react = require("react");
var import_react_dom = require("react-dom");

// src/shared/modes.ts
var ENHANCE_MODES = [
  "standard",
  "concise",
  "spec",
  "engineering",
  "colloquial",
  "research",
  "creative"
];
var MODE_SPECS = {
  standard: {
    systemAddon: "",
    maxOutputTokens: 0
  },
  concise: {
    systemAddon: [
      "",
      "Mode: concise. The operator asked for the smallest useful rewrite.",
      "- Keep the rewrite tight: keep every fact, cut padding, and do not add sections the raw prompt does not need.",
      "- Aim for at most about 1.5x the raw prompt length; a one-paragraph prompt stays one paragraph.",
      "- Merging two related items into one clear sentence is fine; dropping an item is not."
    ].join("\n"),
    maxOutputTokens: 2e3
  },
  spec: {
    systemAddon: [
      "",
      "Mode: spec. The operator wants a deliverable specification, not a plain rewrite.",
      "- Structure the rewrite with explicit section headings covering: goal, inputs, constraints, deliverable format, acceptance criteria, and boundary cases. Skip a section only when the raw prompt genuinely has nothing to say about it \u2014 never invent its content.",
      "- Prefer numbered, testable statements over prose.",
      "- Keep every literal from the raw prompt in place; mark an unknown detail with a short placeholder instead of filling it in."
    ].join("\n"),
    maxOutputTokens: 8e3
  },
  engineering: {
    systemAddon: [
      "",
      "Mode: engineering. The operator wants a work order someone else can execute without asking a follow-up question.",
      "- Structure it as: objective, current context, hard constraints, the interfaces/files/symbols it touches, the work split into ordered steps, and the acceptance check that proves each step.",
      "- Write each constraint so it can be tested; name the states that must not happen as explicitly as the ones that must.",
      "- Keep every literal the raw prompt names \u2014 paths, signatures, versions, commands \u2014 and mark an unknown one with a placeholder instead of inventing a value.",
      "- No motivational framing and no padding: a step nobody can verify does not belong in the plan."
    ].join("\n"),
    maxOutputTokens: 8e3
  },
  colloquial: {
    systemAddon: [
      "",
      "Mode: colloquial. The operator dictated this out loud or typed it in a hurry; the rewrite has to read like a person speaking clearly, not like a document.",
      "- Keep running prose: no headings, no numbered steps, no bullet scaffolding the raw prompt did not already have.",
      "- Short sentences, everyday verbs, and the raw prompt's own voice kept (a first-person request stays first person). Replace stiff nominalizations with the plain verb.",
      "- Change wording, never content: add no fact, no example, no requirement, and do not promote a sentence into a specification.",
      "- Keep the original politeness and the original amount of detail. The goal is fluency, not length."
    ].join("\n"),
    maxOutputTokens: 2e3
  },
  research: {
    systemAddon: [
      "",
      "Mode: research. The operator wants the question posed so an answer can be argued with, not a task list.",
      "- Structure it as: the question, what is already known or assumed, the alternatives or hypotheses worth comparing, the evidence that would separate them, and the decision those findings drive.",
      "- Keep fact and assumption visibly apart; never promote one to the other.",
      "- Ask for the answer's shape (comparison, recommendation with reasons, risks, open questions) only as far as the raw prompt implies it.",
      "- Every source, version and number the raw prompt names must survive; invent none, and do not widen the scope beyond the question asked."
    ].join("\n"),
    maxOutputTokens: 6e3
  },
  creative: {
    systemAddon: [
      "",
      "Mode: creative. The operator wants room to explore, and the rewrite must open that room without losing the constraints that make the output usable.",
      "- Structure it as: the intent, the audience, the tone and register, the hard constraints, the references worth following, and how many distinct options are wanted.",
      "- Keep the constraints explicit and few; they are what makes divergence useful instead of random.",
      "- State what must not be produced (clich\xE9s, disclaimers, moralising, filler openings) when the raw prompt implies a taste boundary.",
      "- Never invent a reference, a brand or a fact; ask for the options to differ in approach, not in wording."
    ].join("\n"),
    maxOutputTokens: 4e3
  }
};
function isEnhanceMode(value) {
  return typeof value === "string" && ENHANCE_MODES.includes(value);
}

// src/client/ModeMenu.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var GAP = 6;
var MARGIN = 8;
function ModeMenu(props) {
  const { anchor, value, t, onPick, onClose } = props;
  const menuRef = (0, import_react.useRef)(null);
  const keyboardClosed = (0, import_react.useRef)(false);
  const [pos, setPos] = (0, import_react.useState)(void 0);
  (0, import_react.useLayoutEffect)(() => {
    const element = menuRef.current;
    if (element === null || anchor === null) return;
    const place = () => {
      const box = anchor.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const above = box.top - rect.height - GAP;
      const top = above >= MARGIN ? above : Math.min(box.bottom + GAP, window.innerHeight - rect.height - MARGIN);
      const left = Math.min(Math.max(MARGIN, box.right - rect.width), window.innerWidth - rect.width - MARGIN);
      const nextTop = Math.max(MARGIN, top);
      setPos((prev) => prev !== void 0 && prev.top === nextTop && prev.left === left ? prev : { top: nextTop, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver(place);
    if (anchor !== null) observer?.observe(anchor);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer?.disconnect();
    };
  }, [anchor]);
  (0, import_react.useEffect)(() => {
    const element = menuRef.current;
    if (element === null) return;
    const target = element.querySelector('[aria-checked="true"]') ?? element.querySelector("button");
    target?.focus();
  }, []);
  (0, import_react.useEffect)(() => {
    const onPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) === true) return;
      if (anchor?.contains(target) === true) return;
      onClose();
    };
    const onKeyDown = (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        keyboardClosed.current = true;
        onClose();
        return;
      }
      if (event.key === "Tab") {
        if (menuRef.current?.contains(document.activeElement) !== true) return;
        onClose();
        anchor?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (menuRef.current?.contains(document.activeElement) !== true) return;
      const rows = [...menuRef.current?.querySelectorAll("button") ?? []];
      if (rows.length === 0) return;
      event.preventDefault();
      const index = rows.findIndex((row) => row === document.activeElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = rows[(index + step + rows.length) % rows.length];
      next?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anchor, onClose]);
  (0, import_react.useEffect)(() => () => {
    if (keyboardClosed.current) anchor?.focus();
  }, [anchor]);
  return (0, import_react_dom.createPortal)(
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "div",
      {
        ref: menuRef,
        className: "dsh-pe-menu",
        role: "menu",
        "aria-label": t("button.mode.title"),
        style: pos === void 0 ? { top: 0, left: 0, visibility: "hidden" } : { top: pos.top, left: pos.left },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-pe-menu-title", role: "presentation", children: t("menu.title") }),
          ENHANCE_MODES.map((id) => {
            const active = id === value;
            const label = t(`settings.mode.${id}`);
            return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
              "button",
              {
                type: "button",
                role: "menuitemradio",
                "aria-checked": active,
                "aria-label": label,
                className: active ? "dsh-pe-menu-item is-active" : "dsh-pe-menu-item",
                onClick: () => onPick(id),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-pe-menu-check", "aria-hidden": true, children: active ? "\u2713" : "" }),
                  label
                ]
              },
              id
            );
          }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-pe-menu-hint", role: "presentation", children: t("menu.hint") })
        ]
      }
    ),
    document.body
  );
}

// src/client/ResultPanel.tsx
var import_react2 = require("react");

// src/client/locales.ts
var zh = {
  "button.title": "\u63D0\u793A\u8BCD\u589E\u5F3A\uFF08\u91CD\u5199\u4E3A\u7ED3\u6784\u5316\u63D0\u793A\u8BCD\uFF09",
  "button.busy": "\u6B63\u5728\u589E\u5F3A\u2026",
  "button.otherBusy": "\u53E6\u4E00\u4E2A\u4F1A\u8BDD\u6B63\u5728\u589E\u5F3A\u4E2D\uFF1B\u8BF7\u7B49\u5B83\u5B8C\u6210\u6216\u5148\u5173\u95ED\u5176\u7ED3\u679C\u9762\u677F\u3002",
  "button.mode.title": "\u589E\u5F3A\u6863\u4F4D",
  "button.titleWithMode": "\u63D0\u793A\u8BCD\u589E\u5F3A \xB7 \u5F53\u524D\u6863\u4F4D\uFF1A{mode}",
  "menu.title": "\u6309\u54EA\u4E00\u6863\u589E\u5F3A",
  "menu.hint": "\u70B9\u4E00\u6863\u5C31\u6309\u8BE5\u6863\u589E\u5F3A",
  "panel.title": "\u63D0\u793A\u8BCD\u589E\u5F3A",
  "panel.loading": "\u6B63\u5728\u589E\u5F3A\uFF0C\u7A0D\u5019\u2026",
  "panel.streaming": "\u6B63\u5728\u751F\u6210\uFF08\u8FB9\u5199\u8FB9\u663E\u793A\uFF09\u2026",
  "panel.loading.hint": "\u539F\u6587\u4FDD\u7559\u5728\u8F93\u5165\u6846\u4E2D\uFF0C\u4E0D\u4F1A\u88AB\u52A8\u4FEE\u6539\u3002",
  "panel.cancel": "\u53D6\u6D88",
  "panel.original": "\u539F\u59CB\u63D0\u793A\u8BCD",
  "panel.enhanced": "\u589E\u5F3A\u7ED3\u679C",
  "panel.apply": "\u56DE\u586B\u5230\u8F93\u5165\u6846",
  "panel.copy": "\u590D\u5236\u7ED3\u679C",
  "panel.copied": "\u5DF2\u590D\u5236",
  "panel.copyFailed": "\u590D\u5236\u5931\u8D25",
  "panel.close": "\u5173\u95ED",
  "panel.retry": "\u91CD\u8BD5",
  "panel.rerun": "\u7528\u8FD9\u4E00\u6863\u91CD\u8DD1",
  "panel.modes.hint": "\u70B9\u6863\u4F4D\u53EA\u662F\u9009\u4E2D\uFF0C\u4E0D\u4F1A\u8C03\u7528\u6A21\u578B\uFF1B\u8981\u8BA9\u540C\u4E00\u6BB5\u539F\u6587\u6309\u8FD9\u4E00\u6863\u91CD\u5199\uFF0C\u70B9\u53F3\u4E0B\u89D2\u300C\u7528\u8FD9\u4E00\u6863\u91CD\u8DD1\u300D\u3002",
  "panel.stale.warn": "\u8349\u7A3F\u5728\u589E\u5F3A\u671F\u95F4\u6709\u6539\u52A8\u2014\u2014\u589E\u5F3A\u7ED3\u679C\u57FA\u4E8E\u589E\u5F3A\u524D\u7684\u6587\u672C\u3002\u56DE\u586B\u5C06\u8986\u76D6\u4F60\u7684\u6700\u65B0\u7F16\u8F91(\u64A4\u9500\u53EF\u6062\u590D\u56DE\u586B\u524D\u7684\u8349\u7A3F)\u3002",
  "panel.truncated": "\u91CD\u5199\u88AB\u8F93\u51FA\u4E0A\u9650\u622A\u65AD\uFF0C\u4EE5\u4E0B\u5185\u5BB9\u53EF\u80FD\u4E0D\u5B8C\u6574\uFF1B\u53EF\u8C03\u5927 maxOutputTokens\uFF0C\u6216\u586B 0\uFF08\u4E0D\u9650\uFF09\u540E\u91CD\u8BD5\u3002",
  "panel.model": "\u6A21\u578B\uFF1A{provider} / {model}",
  "panel.elapsed": "\u8017\u65F6 {ms}",
  "panel.evidence.label": "\u4F9D\u636E\uFF1A",
  "panel.evidence.history": "\u672C\u4F1A\u8BDD\u8FD1\u671F\u5BF9\u8BDD",
  "panel.evidence.workspace": "\u5DE5\u4F5C\u533A\uFF08{files} \u4E2A\u6587\u4EF6\u8282\u9009\uFF09",
  "panel.evidence.workspaceTree": "\u5DE5\u4F5C\u533A",
  "panel.fidelity.label": "\u4FDD\u771F\uFF1A",
  "panel.fidelity.kept": "\u8349\u7A3F\u4E2D\u7684 {kept}/{total} \u9879\u786C\u4E8B\u5B9E\uFF08\u8DEF\u5F84\u3001\u6807\u8BC6\u7B26\u3001\u7248\u672C\u3001\u94FE\u63A5\uFF09\u5728\u6539\u5199\u4E2D\u4FDD\u7559",
  "panel.fidelity.repaired": "\u5DF2\u81EA\u52A8\u4FEE\u8865\u4E00\u6B21",
  "panel.fidelity.reinjected": "\u6A21\u578B\u6F0F\u6389 {count} \u9879\uFF0C\u5DF2\u6309\u539F\u6837\u8865\u5728\u672B\u5C3E",
  "panel.fidelity.bloated": "\u6539\u5199\u540E\u7BC7\u5E45\u660E\u663E\u53D8\u957F",
  "undo.applied": "\u5DF2\u7528\u589E\u5F3A\u7ED3\u679C\u66FF\u6362\u539F\u63D0\u793A\u8BCD",
  "undo.undo": "\u64A4\u9500",
  "undo.dismiss": "\u5173\u95ED\u63D0\u793A",
  "panel.history.title": "\u589E\u5F3A\u5386\u53F2\uFF08{count}\uFF09",
  "panel.history.empty": "\u672C\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u589E\u5F3A\u8BB0\u5F55\u3002",
  "panel.history.clear": "\u6E05\u7A7A",
  "panel.history.apply": "\u8F7D\u5165\u8FD9\u6761",
  "panel.history.original": "\u539F\u6587\uFF1A",
  "panel.history.mode": "\u6863\u4F4D\uFF1A{mode}",
  "panel.history.template": "\u6A21\u677F\uFF1A{template}",
  "panel.plainRefs": "\u8349\u7A3F\u91CC\u7684 @ \u5F15\u7528\u4E0E / \u547D\u4EE4\u5728\u6539\u5199\u4E2D\u9010\u5B57\u4FDD\u7559\uFF1B\u70B9\u300C\u66FF\u6362\u8349\u7A3F\u300D\u540E\u5B83\u4EEC\u4F1A\u4EE5\u7EAF\u6587\u672C\u5F62\u6001\u56DE\u586B\u2014\u2014\u8DEF\u5F84\u6CA1\u53D8\uFF0C\u53EA\u662F\u4E0D\u518D\u6709 chip \u7684\u9AD8\u4EAE\u4E0E\u70B9\u51FB\u6253\u5F00\u3002",
  "error.empty": "\u8F93\u5165\u6846\u4E3A\u7A7A\uFF0C\u8BF7\u5148\u8F93\u5165\u8981\u589E\u5F3A\u7684\u63D0\u793A\u8BCD\u3002",
  "error.tooLong": "\u5185\u5BB9\u5171 {count} \u4E2A\u5B57\u7B26\uFF0C\u8D85\u8FC7 {max} \u4E2A\u5B57\u7B26\u4E0A\u9650\uFF08\u6309 Unicode \u5B57\u7B26\u6570\u7EDF\u8BA1\uFF0C\u4E0D\u662F token \u6570\uFF09\u3002\u4E3A\u907F\u514D\u6539\u53D8\u539F\u610F\u4E0D\u4F1A\u81EA\u52A8\u622A\u65AD\uFF0C\u8BF7\u7CBE\u7B80\u540E\u518D\u8BD5\u3002",
  "error.imagesOnly": "\u5F53\u524D\u53EA\u9644\u52A0\u4E86\u56FE\u7247\uFF0C\u4EC5\u652F\u6301\u589E\u5F3A\u6587\u672C\u5185\u5BB9\u3002",
  "error.phase": "\u8F93\u5165\u6846\u6B63\u5728\u63D0\u4EA4\uFF0C\u8BF7\u7B49\u8FD9\u4E00\u8F6E\u53D1\u51FA\u53BB\u518D\u8BD5\u3002",
  "error.disabled": "\u63D0\u793A\u8BCD\u589E\u5F3A\u5DF2\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u5173\u95ED\u3002",
  "error.rejected": "\u589E\u5F3A\u8BF7\u6C42\u88AB\u62D2\u7EDD\u3002",
  "error.rejected.contentType": "\u4EC5\u652F\u6301 application/json \u8BF7\u6C42\u4F53\u3002",
  "error.rejected.bodyTooLarge": "\u8BF7\u6C42\u4F53\u8D85\u8FC7\u5927\u5C0F\u4E0A\u9650\u3002",
  "error.rejected.invalidJson": "\u8BF7\u6C42\u4F53\u4E0D\u662F\u6709\u6548\u7684 JSON\u3002",
  "error.rejected.invalidBody": "\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F { sessionId?, text } JSON\u3002",
  "error.timeout": "\u589E\u5F3A\u8D85\u65F6\uFF08{seconds} \u79D2\uFF09\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u539F\u8F93\u5165\u672A\u6539\u52A8\u3002",
  "error.unconfigured": "\u5C1A\u672A\u786E\u5B9A\u589E\u5F3A\u7528\u7684\u6A21\u578B\uFF1A\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u6210\u5BF9\u586B\u5199 provider/model\uFF0C\u6216\u5148\u5728\u5F53\u524D\u4F1A\u8BDD\u53D1\u9001\u4E00\u6761\u6D88\u606F\uFF08\u5C06\u8DDF\u968F\u4F1A\u8BDD\u6A21\u578B\uFF09\u3002",
  "error.upstream": "\u6A21\u578B\u670D\u52A1\u8FD4\u56DE\u9519\u8BEF\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u539F\u8F93\u5165\u672A\u6539\u52A8\u3002",
  "error.internal": "\u589E\u5F3A\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u539F\u8F93\u5165\u672A\u6539\u52A8\u3002",
  "error.rateLimit": "\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF1A\u6BCF\u5206\u949F\u6700\u591A {limit} \u6B21\u589E\u5F3A\uFF0C\u8BF7\u5728 {retryAfterSeconds} \u79D2\u540E\u518D\u8BD5\u3002",
  "error.concurrencyLimit": "\u5DF2\u6709 {max} \u4E2A\u589E\u5F3A\u6B63\u5728\u8FDB\u884C\uFF0C\u8BF7\u7B49\u5176\u4E2D\u4E00\u4E2A\u5B8C\u6210\u540E\u518D\u8BD5\u3002",
  "error.upstream.auth": "\u9274\u6743\u5931\u8D25\uFF1A\u8BF7\u68C0\u67E5\u8BE5 provider \u7684 API Key \u914D\u7F6E\u3002",
  "error.upstream.invalidCredential": "\u9274\u6743\u5931\u8D25\uFF1A\u5B58\u50A8\u7684 API Key \u4E0D\u53EF\u7528\uFF0C\u8BF7\u4FEE\u6B63\u540E\u91CD\u8BD5\u3002",
  "error.upstream.rateLimit": "\u6A21\u578B\u670D\u52A1\u9650\u6D41\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
  "error.upstream.quota": "\u6A21\u578B\u670D\u52A1\u914D\u989D/\u4F59\u989D\u4E0D\u8DB3\uFF0C\u8BF7\u68C0\u67E5\u8D26\u6237\u3002",
  "error.upstream.empty": "\u6A21\u578B\u8FD4\u56DE\u4E86\u7A7A\u54CD\u5E94\uFF0C\u8BF7\u91CD\u8BD5\u3002",
  "error.upstream.contextWindow": "\u8F93\u5165\u8D85\u51FA\u6A21\u578B\u4E0A\u4E0B\u6587\u7A97\u53E3\uFF0C\u8BF7\u7CBE\u7B80\u539F\u6587\u6216\u66F4\u6362\u6A21\u578B\u3002",
  "error.upstream.toolCall": "\u6A21\u578B\u8BF7\u6C42\u4E86\u5DE5\u5177\u8C03\u7528\uFF0C\u63D0\u793A\u8BCD\u589E\u5F3A\u53EA\u9700\u8981\u7EAF\u6587\u672C\uFF1B\u8BF7\u66F4\u6362\u6A21\u578B\u540E\u91CD\u8BD5\u3002",
  "error.upstream.maxTokens": "\u91CD\u5199\u8FBE\u5230\u8F93\u51FA\u4E0A\u9650\uFF0C\u4E14\u6CA1\u6709\u53EF\u8FD4\u56DE\u7684\u5185\u5BB9\uFF1A\u82E5 maxOutputTokens \u4E3A\u6B63\u6570\uFF0C\u53EF\u8C03\u5927\u6216\u6539\u4E3A 0\uFF08\u4E0D\u9650\uFF09\u540E\u91CD\u8BD5\uFF1B\u4E0A\u9650\u4E5F\u53EF\u80FD\u6765\u81EA\u670D\u52A1\u5546\u4FA7\uFF0C\u6B64\u65F6\u8BF7\u7CBE\u7B80\u539F\u6587\u6216\u66F4\u6362\u6A21\u578B\u3002",
  "error.upstream.refused": "\u4E0A\u6E38\u6A21\u578B\u62D2\u7EDD\u6267\u884C\u6539\u5199\uFF1A\u5B83\u628A\u300C\u6539\u5199\u8FD9\u6BB5\u8349\u7A3F\u300D\u5F53\u6210\u4E86\u300C\u751F\u6210\u8349\u7A3F\u6240\u6307\u7684\u5185\u5BB9\u300D\uFF0C\u91CD\u8BD5\u4E00\u6B21\u4ECD\u672A\u6267\u884C\u3002\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u628A\u589E\u5F3A\u6307\u5411\u4E00\u4E2A\u4E0D\u505A\u5185\u5BB9\u5BA1\u67E5\u7684\u6A21\u578B\uFF08\u672C\u5730\u6216\u81EA\u5EFA\u6A21\u578B\u6700\u7A33\uFF09\uFF0C\u518D\u91CD\u8BD5\uFF1B\u539F\u8F93\u5165\u672A\u6539\u52A8\u3002",
  "detail.hostError": "\u5BBF\u4E3B\u670D\u52A1\u8FD4\u56DE\u5F02\u5E38\u3002",
  "detail.unparsableResult": "\u5BBF\u4E3B\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684\u7ED3\u679C\u3002",
  "detail.unparsableResponse": "\u5BBF\u4E3B\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684\u54CD\u5E94\u3002",
  "detail.hostStatus": "\u5BBF\u4E3B\u670D\u52A1\u8FD4\u56DE\u5F02\u5E38\uFF08HTTP {status}\uFF09\u3002",
  "detail.cancelled": "\u5DF2\u53D6\u6D88\u589E\u5F3A\uFF1B\u539F\u8F93\u5165\u672A\u6539\u52A8\u3002",
  "detail.unreachable": "\u65E0\u6CD5\u8FDE\u63A5\u5BBF\u4E3B\u670D\u52A1\uFF0C\u8BF7\u786E\u8BA4 dsh web \u6B63\u5728\u8FD0\u884C\u540E\u91CD\u8BD5\u3002",
  "detail.streamClosed": "\u5BBF\u4E3B\u670D\u52A1\u63D0\u524D\u5173\u95ED\u4E86\u589E\u5F3A\u6D41\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u539F\u8F93\u5165\u672A\u6539\u52A8\u3002",
  "settings.summary": "\u914D\u7F6E\u63D0\u793A\u8BCD\u589E\u5F3A\uFF1A\u603B\u5F00\u5173\u3001\u6A21\u578B\u8DEF\u7531\u3001\u91C7\u6837\u3001\u4FDD\u771F\u95F8\u3001\u4E0A\u4E0B\u6587\u4E0E\u5DE5\u4F5C\u533A\u611F\u77E5\u3001\u5E76\u53D1\u4E0E\u5FEB\u6377\u952E\u3002",
  "settings.unavailable": "\u5BBF\u4E3B\u6CA1\u6709\u628A prompt-enhance \u66B4\u9732\u4E3A\u53EF\u914D\u7F6E\u7684\u547D\u540D\u7A7A\u95F4\uFF0C\u8FD9\u91CC\u6682\u65F6\u65E0\u6CD5\u7F16\u8F91\uFF1B\u53EF\u5148\u7528 profile \u7684 cordis.patch.yml \u8986\u76D6\u3002",
  "settings.readOnly": "\u672C\u90E8\u7F72\u7684\u63D2\u4EF6\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002",
  "settings.saveFailed": "\u5BBF\u4E3B\u6CA1\u6709\u63A5\u53D7\u8FD9\u4E9B\u503C\uFF0C\u6539\u52A8\u4ECD\u4FDD\u7559\u5728\u8FD9\u91CC\uFF0C\u53EF\u4FEE\u6539\u540E\u91CD\u8BD5\u3002",
  "settings.save": "\u4FDD\u5B58",
  "settings.saving": "\u4FDD\u5B58\u4E2D\u2026",
  "settings.overridden": "\u5DF2\u8986\u76D6\u9ED8\u8BA4\u503C",
  "settings.reset": "\u6062\u590D\u9ED8\u8BA4",
  "settings.discard": "\u653E\u5F03\u6539\u52A8",
  "settings.default": "\u9ED8\u8BA4\u503C",
  "settings.invalid": "\u503C\u4E0D\u5408\u6CD5\uFF0C\u8BF7\u4FEE\u6B63\uFF1B\u7559\u7A7A\u8868\u793A\u6062\u590D\u9ED8\u8BA4\u3002",
  "settings.field.enabled.label": "\u542F\u7528\u63D0\u793A\u8BCD\u589E\u5F3A",
  "settings.field.enabled.hint": "\u5173\u95ED\u540E\u9690\u85CF\u8F93\u5165\u6846\u4E0A\u7684\u589E\u5F3A\u6309\u94AE\uFF0C\u5E76\u505C\u7528\u6309\u94AE\u3001\u5FEB\u6377\u952E\u4E0E /enhance \u547D\u4EE4\u3002",
  "settings.field.provider.label": "\u6A21\u578B provider \u8986\u76D6",
  "settings.field.provider.hint": "\u4E0E\u300C\u6A21\u578B\u300D\u5FC5\u987B\u6210\u5BF9\u586B\u5199\uFF1B\u4E24\u8005\u90FD\u7559\u7A7A\u65F6\u8DDF\u968F\u5F53\u524D\u4F1A\u8BDD\u6A21\u578B\u3002",
  "settings.field.model.label": "\u6A21\u578B model \u8986\u76D6",
  "settings.field.model.hint": "\u4E0E\u300Cprovider\u300D\u5FC5\u987B\u6210\u5BF9\u586B\u5199\uFF1B\u4E24\u8005\u90FD\u7559\u7A7A\u65F6\u8DDF\u968F\u5F53\u524D\u4F1A\u8BDD\u6A21\u578B\u3002",
  "settings.field.temperature.label": "\u91C7\u6837\u6E29\u5EA6",
  "settings.field.temperature.hint": "0\u20131\uFF0C\u9ED8\u8BA4 0.3\uFF1B\u6E29\u5EA6\u8D8A\u4F4E\uFF0C\u6539\u5199\u8D8A\u5FE0\u5B9E\u539F\u610F\u3002",
  "settings.field.mode.label": "\u589E\u5F3A\u6863\u4F4D",
  "settings.field.mode.hint": "standard\uFF1A\u7B49\u4E8E\u5386\u53F2\u884C\u4E3A\uFF08\u4E0D\u52A0\u989D\u5916\u7EAA\u5F8B\u3001\u4E0D\u8BBE\u8F93\u51FA\u4E0A\u9650\uFF09\uFF1Bconcise\uFF1A\u53EA\u6E05\u6670\u5316\u3001\u4E0D\u8BB8\u81A8\u80C0\uFF1Bspec\uFF1A\u5206\u8282\u3001\u53EF\u9A8C\u6536\u7684\u4EA4\u4ED8\u89C4\u683C\uFF1Bengineering\uFF1A\u5DE5\u7A0B\u63D0\u793A\u8BCD\uFF08\u76EE\u6807\xB7\u7EA6\u675F\xB7\u63A5\u53E3\xB7\u6B65\u9AA4\xB7\u9A8C\u6536\uFF0C\u62FF\u5230\u5373\u53EF\u65BD\u5DE5\uFF09\uFF1Bcolloquial\uFF1A\u53E3\u8BED\u4F18\u5316\uFF08\u53E3\u8FF0\u4E0E\u672F\u8BED\u5806\u780C\u6574\u7406\u6210\u81EA\u7136\u53E3\u8BED\uFF09\uFF1Bresearch\uFF1A\u8C03\u7814\u8BBA\u8BC1\uFF08\u5DF2\u77E5\xB7\u5047\u8BBE\xB7\u5907\u9009\xB7\u5224\u636E\xB7\u51B3\u5B9A\uFF09\uFF1Bcreative\uFF1A\u521B\u610F\u53D1\u6563\uFF08\u610F\u56FE\xB7\u53D7\u4F17\xB7\u57FA\u8C03\xB7\u786C\u7EA6\u675F\xB7\u5019\u9009\uFF09\u3002",
  "settings.field.template.label": "\u5185\u7F6E\u6A21\u677F",
  "settings.field.template.hint": "\u628A\u6539\u5199\u6846\u5B9A\u6210\u4E00\u79CD\u4EA4\u4ED8\u5F62\u72B6\uFF1B\u6A21\u677F\u7EAA\u5F8B\u8FFD\u52A0\u5728\u6863\u4F4D\u7EAA\u5F8B\u4E4B\u540E\uFF0C\u4E0D\u4F1A\u8986\u76D6\u300C\u4E0D\u7F16\u9020\u3001\u53EA\u8F93\u51FA\u6B63\u6587\u300D\u7B49\u786C\u6027\u7EA6\u675F\u3002",
  "settings.template.none": "\u4E0D\u4F7F\u7528\u6A21\u677F",
  "settings.template.code-review": "\u4EE3\u7801\u8BC4\u5BA1",
  "settings.template.bug-report": "\u7F3A\u9677\u62A5\u544A",
  "settings.template.weekly-report": "\u5468\u62A5",
  "settings.template.api-doc": "API \u6587\u6863",
  "settings.template.test-plan": "\u6D4B\u8BD5\u8BA1\u5212",
  "settings.template.refactor": "\u91CD\u6784\u7B80\u62A5",
  "settings.mode.standard": "\u6807\u51C6",
  "settings.mode.concise": "\u7CBE\u7B80",
  "settings.mode.spec": "\u89C4\u683C",
  "settings.mode.engineering": "\u5DE5\u7A0B\u63D0\u793A\u8BCD",
  "settings.mode.colloquial": "\u53E3\u8BED\u4F18\u5316",
  "settings.mode.research": "\u8C03\u7814\u8BBA\u8BC1",
  "settings.mode.creative": "\u521B\u610F\u53D1\u6563",
  "settings.field.strategyMode.label": "\u81EA\u5B9A\u4E49\u63D0\u793A\u8BCD\u7684\u7EC4\u5408\u65B9\u5F0F",
  "settings.field.strategyMode.hint": "replace-default\uFF1A\u6574\u4F53\u66FF\u6362\u5185\u7F6E\u7B56\u7565\uFF08\u9ED8\u8BA4\uFF09\uFF1Bextend-default\uFF1A\u8FFD\u52A0\u5728\u5185\u7F6E\u7B56\u7565\u4E4B\u540E\uFF0C\u786C\u6027\u7EA6\u675F\u7EE7\u7EED\u751F\u6548\u3002",
  "settings.field.systemPrompt.label": "\u81EA\u5B9A\u4E49\u7CFB\u7EDF\u63D0\u793A\u8BCD",
  "settings.field.systemPrompt.hint": "\u7559\u7A7A\u4F7F\u7528\u5185\u7F6E\u589E\u5F3A\u7B56\u7565\uFF1B\u7ED3\u5408\u4E0A\u4E00\u9879\u51B3\u5B9A\u662F\u66FF\u6362\u8FD8\u662F\u8FFD\u52A0\u3002",
  "settings.field.shortcut.label": "\u89E6\u53D1\u5FEB\u6377\u952E",
  "settings.field.shortcut.hint": "\u4F8B\u5982 ctrl+alt+e\uFF1B\u987B\u542B ctrl\u3001alt\u3001meta \u4E2D\u81F3\u5C11\u4E00\u4E2A\u4FEE\u9970\u952E\uFF1B\u7559\u7A7A\u5219\u7981\u7528\u5FEB\u6377\u952E\u3002",
  "settings.field.maxOutputTokens.label": "\u8F93\u51FA token \u4E0A\u9650",
  "settings.field.maxOutputTokens.hint": "0\uFF08\u9ED8\u8BA4\uFF09\u8868\u793A\u4E0D\u5411\u6A21\u578B\u4F20\u4E0A\u9650\uFF1B\u6B63\u6570\u540C\u65F6\u7EA6\u675F\u601D\u8003\u4E0E\u6B63\u6587\u3002",
  "settings.field.maxInputChars.label": "\u8F93\u5165\u5B57\u6570\u4E0A\u9650",
  "settings.field.maxInputChars.hint": "200\u2013200000\uFF0C\u9ED8\u8BA4 12000\uFF1B\u8D85\u8FC7\u5219\u62D2\u7EDD\u5E76\u63D0\u793A\uFF0C\u4E0D\u622A\u65AD\u3002",
  "settings.field.timeoutMs.label": "\u5355\u6B21\u589E\u5F3A\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
  "settings.field.timeoutMs.hint": "5000\u2013600000\uFF0C\u9ED8\u8BA4 60000\u3002",
  "settings.field.maxConcurrent.label": "\u5E76\u53D1\u4E0A\u9650",
  "settings.field.maxConcurrent.hint": "1\u201316\uFF0C\u9ED8\u8BA4 2\uFF1B\u8D85\u51FA\u7684\u8BF7\u6C42\u8FD4\u56DE 429\u3002",
  "settings.field.rateLimitPerMinute.label": "\u6BCF\u5206\u949F\u6B21\u6570\u4E0A\u9650",
  "settings.field.rateLimitPerMinute.hint": "1\u2013600\uFF0C\u9ED8\u8BA4 10\uFF1B\u6ED1\u52A8\u7A97\u53E3\u8BA1\u6570\uFF0C\u8D85\u51FA\u8FD4\u56DE 429\u3002",
  "settings.field.streaming.label": "\u589E\u91CF\u5C55\u793A",
  "settings.field.streaming.hint": "\u6A21\u578B\u8FB9\u5199\u8FB9\u5728\u9762\u677F\u663E\u793A\uFF1B\u53EA\u5F71\u54CD\u663E\u793A\u8282\u594F\uFF0C\u4E0D\u5F71\u54CD\u7ED3\u679C\u3002",
  "settings.field.fidelity.label": "\u4FDD\u771F\u6821\u9A8C",
  "settings.field.fidelity.hint": "\u6539\u5199\u540E\u673A\u68B0\u6838\u5BF9\u8349\u7A3F\u91CC\u7684\u786C\u4E8B\u5B9E\uFF08\u8DEF\u5F84\u3001\u6807\u8BC6\u7B26\u3001\u7248\u672C\u3001\u94FE\u63A5\uFF09\u662F\u5426\u4ECD\u5728\uFF1B\u4E22\u5931\u7684\u6309\u539F\u6837\u8865\u5728\u672B\u5C3E\u5E76\u6807\u6CE8\u3002\u4E0D\u989D\u5916\u8C03\u7528\u6A21\u578B\u3002",
  "settings.field.fidelityRepair.label": "\u4FDD\u771F\u4FEE\u8865",
  "settings.field.fidelityRepair.hint": "\u4FDD\u771F\u6821\u9A8C\u53D1\u73B0\u4E22\u5B57\u65F6\u518D\u95EE\u6A21\u578B\u4E00\u6B21\uFF1B\u6700\u591A\u591A\u4E00\u6B21\u8C03\u7528\uFF0C\u4E14\u53EA\u5728\u771F\u7684\u4E22\u5B57\u65F6\u53D1\u751F\u3002",
  "settings.field.contextAware.label": "\u4E0A\u4E0B\u6587\u611F\u77E5",
  "settings.field.contextAware.hint": "\u8BFB\u53D6\u5F53\u524D\u4F1A\u8BDD\u7684\u8FD1\u671F\u5BF9\u8BDD\uFF0C\u7528\u4E8E\u6D88\u89E3\u6307\u4EE3\u3001\u8865\u5168\u7701\u7565\uFF1B\u6CA1\u6709\u5386\u53F2\u65F6\u81EA\u52A8\u56DE\u9000\u3002",
  "settings.field.contextMaxMessages.label": "\u4E0A\u4E0B\u6587\u6761\u6570\u4E0A\u9650",
  "settings.field.contextMaxMessages.hint": "0\u201350\uFF0C\u9ED8\u8BA4 12\uFF1B0 \u8868\u793A\u4E0D\u53C2\u8003\u5386\u53F2\u3002",
  "settings.field.contextMaxChars.label": "\u4E0A\u4E0B\u6587\u5B57\u6570\u9884\u7B97",
  "settings.field.contextMaxChars.hint": "0\u2013100000\uFF0C\u9ED8\u8BA4 8000\uFF1B0 \u8868\u793A\u4E0D\u53C2\u8003\u5386\u53F2\u3002",
  "settings.field.workspaceAware.label": "\u5DE5\u4F5C\u533A\u611F\u77E5",
  "settings.field.workspaceAware.hint": "\u8BFB\u53D6\u4F1A\u8BDD\u5DE5\u4F5C\u76EE\u5F55\u7684\u76EE\u5F55\u7ED3\u6784\u4E0E\u5173\u952E\u6587\u4EF6\u8282\u9009\uFF0C\u9501\u5B9A\u771F\u5B9E\u6587\u4EF6\u540D\u4E0E\u6280\u672F\u6808\uFF1B\u8BFB\u4E0D\u5230\u65F6\u81EA\u52A8\u56DE\u9000\u3002",
  "settings.field.workspaceRoot.label": "\u56FA\u5B9A\u5DE5\u4F5C\u533A\u8DEF\u5F84",
  "settings.field.workspaceRoot.hint": "\u7559\u7A7A\u5219\u8DDF\u968F\u5F53\u524D\u4F1A\u8BDD\u7684\u5DE5\u4F5C\u76EE\u5F55\u3002",
  "settings.field.workspaceMaxDepth.label": "\u5DE5\u4F5C\u533A\u626B\u63CF\u6DF1\u5EA6",
  "settings.field.workspaceMaxDepth.hint": "1\u20138\uFF0C\u9ED8\u8BA4 2\uFF08\u6839\u76EE\u5F55\u7B97\u7B2C 1 \u5C42\uFF09\u3002",
  "settings.field.workspaceTreeMax.label": "\u76EE\u5F55\u7ED3\u6784\u6761\u76EE\u4E0A\u9650",
  "settings.field.workspaceTreeMax.hint": "0\u2013500\uFF0C\u9ED8\u8BA4 60\uFF1B0 \u8868\u793A\u4E0D\u5217\u76EE\u5F55\uFF0C\u53EA\u7ED9\u6587\u4EF6\u5185\u5BB9\u3002",
  "settings.field.workspaceMaxFiles.label": "\u6587\u4EF6\u8282\u9009\u6570\u91CF\u4E0A\u9650",
  "settings.field.workspaceMaxFiles.hint": "0\u2013200\uFF0C\u9ED8\u8BA4 30\uFF1B0 \u8868\u793A\u4E0D\u8BFB\u6587\u4EF6\u5185\u5BB9\u3002",
  "settings.field.workspaceMaxFileChars.label": "\u5355\u6587\u4EF6\u8282\u9009\u4E0A\u9650",
  "settings.field.workspaceMaxFileChars.hint": "200\u201320000\uFF0C\u9ED8\u8BA4 2500\uFF1B\u8D85\u51FA\u5219\u622A\u65AD\u3002",
  "settings.field.workspaceMaxChars.label": "\u6587\u4EF6\u8282\u9009\u5408\u8BA1\u4E0A\u9650",
  "settings.field.workspaceMaxChars.hint": "200\u2013200000\uFF0C\u9ED8\u8BA4 12000\uFF1B\u6309\u4F18\u5148\u7EA7\u53D6\u6EE1\u4E3A\u6B62\u3002",
  "settings.field.armorEnabled.label": "\u63D0\u793A\u8BCD\u7834\u7532",
  "settings.field.armorEnabled.hint": "\u9ED8\u8BA4\u5173\u95ED\u3002\u5F00\u542F\u540E\u5728\u6BCF\u8F6E\u7CFB\u7EDF\u63D0\u793A\u8BCD\u6700\u524D\u9762\u63D2\u5165\u4E0B\u9762\u8FD9\u4EFD\u8EAB\u4EFD\u6587\u672C\uFF08\u5185\u90E8\u6BB5\u540D prompt-enhance-armor\uFF09\uFF0C\u6A21\u578B\u7684\u81EA\u6211\u8BBE\u5B9A\u4EE5\u5B83\u4E3A\u51C6\uFF1B\u4E0E dsh-purge \u540C\u65F6\u5F00\u542F\u4E14\u6307\u5411\u540C\u4E00\u6587\u4EF6\u65F6\u4E0D\u4F1A\u91CD\u590D\u6CE8\u5165\u3002",
  "settings.field.armorFile.label": "\u7834\u7532\u6587\u672C\u6587\u4EF6",
  "settings.field.armorFile.hint": "\u6587\u4EF6\u5B58\u5728\u4E14\u975E\u7A7A\u65F6\u4F18\u5148\u751F\u6548\uFF0C\u6539\u5B8C\u5373\u65F6\u751F\u6548\uFF08\u6309 mtime \u7F13\u5B58\uFF0C\u65E0\u9700\u91CD\u542F\uFF09\u3002\u652F\u6301 ~ \u4E0E ${DSH_HOME}\uFF1B\u7559\u7A7A\u53EA\u7528\u5185\u8054\u6587\u672C\u3002",
  "settings.field.armorText.label": "\u5185\u8054\u7834\u7532\u6587\u672C",
  "settings.field.armorText.hint": "\u6587\u4EF6\u7F3A\u5931\u3001\u4E3A\u7A7A\u6216\u8DEF\u5F84\u7559\u7A7A\u65F6\u4F7F\u7528\uFF1B{{model}}/{{provider}} \u4E4B\u5916\u7684 {{\u53D8\u91CF}} \u4F1A\u88AB\u8F6C\u4E49\uFF0C\u907F\u514D\u88C5\u914D\u671F\u786C\u5931\u8D25\u3002",
  "settings.field.armorOrder.label": "\u7834\u7532\u6392\u5E8F\u503C",
  "settings.field.armorOrder.hint": "-1000000\u2013100000\uFF0C\u9ED8\u8BA4 -100000\uFF1B\u8D8A\u5C0F\u8D8A\u9760\u524D\uFF0C\u6392\u5728\u6240\u6709\u5185\u7F6E\u6BB5\u4E4B\u524D\u3002",
  "settings.field.rewriterArmor.label": "\u6539\u5199\u4F4D\u58F0\u660E\uFF08\u589E\u5F3A\u8C03\u7528\uFF09",
  "settings.field.rewriterArmor.hint": "\u9ED8\u8BA4\u5F00\u542F\u3002\u5728\u300C\u589E\u5F3A\u8C03\u7528\u300D\u81EA\u5DF1\u7684\u7CFB\u7EDF\u63D0\u793A\u8BCD\u5F00\u5934\u58F0\u660E\u8FD9\u662F\u6539\u5199\u73AF\u8282\u3001\u4E0D\u505A\u5185\u5BB9\u5BA1\u67E5\uFF1B\u4E0A\u6E38\u628A\u56DE\u7B54\u53D8\u6210\u62D2\u7B54\u65F6\u81EA\u52A8\u91CD\u8BD5\u4E00\u6B21\uFF0C\u4ECD\u62D2\u7B54\u5219\u62A5\u300C\u4E0A\u6E38\u62D2\u7B54\u300D\u800C\u4E0D\u662F\u628A\u62D2\u7B54\u5F53\u6210\u589E\u5F3A\u7ED3\u679C\u3002\u5173\u95ED\u540E\u62D2\u7B54\u4F1A\u539F\u6837\u51FA\u73B0\u5728\u7ED3\u679C\u6846\u91CC\u3002"
};
var KNOWN_KEYS = new Set(Object.keys(zh));
function isPromptEnhanceKey(value) {
  return KNOWN_KEYS.has(value);
}
var en = {
  "button.title": "Enhance prompt (rewrite into a structured prompt)",
  "button.busy": "Enhancing\u2026",
  "button.otherBusy": "Another session is enhancing right now \u2014 wait for it, or close its result panel first.",
  "button.mode.title": "Enhancement mode",
  "button.titleWithMode": "Enhance prompt \xB7 mode: {mode}",
  "menu.title": "Enhance as",
  "menu.hint": "Picking a mode enhances with it",
  "panel.title": "Prompt Enhance",
  "panel.loading": "Enhancing, please wait\u2026",
  "panel.streaming": "Generating (shown as it is written)\u2026",
  "panel.loading.hint": "Your draft stays untouched until you apply the result.",
  "panel.cancel": "Cancel",
  "panel.original": "Original prompt",
  "panel.enhanced": "Enhanced result",
  "panel.apply": "Fill into input box",
  "panel.copy": "Copy result",
  "panel.copied": "Copied",
  "panel.copyFailed": "Copy failed",
  "panel.close": "Close",
  "panel.retry": "Retry",
  "panel.rerun": "Re-run with this mode",
  "panel.modes.hint": 'Clicking a mode only selects it \u2014 no model call. Use "Re-run with this mode" to rewrite the same text again.',
  "panel.stale.warn": "The draft changed while enhancing \u2014 the result is based on the pre-enhance text. Applying will overwrite your latest edits (undo restores the draft as it was before applying).",
  "panel.truncated": "The rewrite was cut off at the output cap \u2014 the text below may be incomplete. Raise maxOutputTokens, or set it to 0 (no cap) and retry.",
  "panel.model": "Model: {provider} / {model}",
  "panel.elapsed": "{ms} elapsed",
  "panel.evidence.label": "Evidence: ",
  "panel.evidence.history": "this session's recent conversation",
  "panel.evidence.workspace": "workspace ({files} file excerpts)",
  "panel.evidence.workspaceTree": "workspace",
  "panel.fidelity.label": "Fidelity: ",
  "panel.fidelity.kept": "{kept}/{total} of the draft's literal facts (paths, identifiers, versions, links) survived the rewrite",
  "panel.fidelity.repaired": "repaired once automatically",
  "panel.fidelity.reinjected": "the model dropped {count} \u2014 re-pasted verbatim at the end",
  "panel.fidelity.bloated": "the rewrite is much longer than the draft",
  "undo.applied": "Original prompt replaced by the enhanced version",
  "undo.undo": "Undo",
  "undo.dismiss": "Dismiss",
  "panel.history.title": "Enhancement history ({count})",
  "panel.history.empty": "No enhancements in this session yet.",
  "panel.history.clear": "Clear",
  "panel.history.apply": "Load this one",
  "panel.history.original": "Original: ",
  "panel.history.mode": "Mode: {mode}",
  "panel.history.template": "Template: {template}",
  "panel.plainRefs": "The @ references and / commands in the draft were kept verbatim through the rewrite; clicking \u201CReplace draft\u201D writes them back as plain text \u2014 same paths, but without the chip highlight or click-to-open.",
  "error.empty": "The input box is empty \u2014 type a prompt to enhance first.",
  "error.tooLong": "The draft is {count} characters, above the {max} cap (Unicode characters, not tokens). It is never auto-truncated (that would change your meaning) \u2014 please shorten it.",
  "error.imagesOnly": "Only images are attached; prompt enhance supports text only.",
  "error.phase": "The input box is submitting \u2014 try again once this turn is sent.",
  "error.disabled": "Prompt enhance is disabled in the plugin settings.",
  "error.rejected": "The enhance request was rejected.",
  "error.rejected.contentType": "Only an application/json request body is supported.",
  "error.rejected.bodyTooLarge": "The request body is over the size limit.",
  "error.rejected.invalidJson": "The request body is not valid JSON.",
  "error.rejected.invalidBody": "The request body must be { sessionId?, text } JSON.",
  "error.timeout": "The enhancement timed out ({seconds}s). Retry; your draft is untouched.",
  "error.unconfigured": "No model resolved for the enhancement: pair provider/model in the plugin settings, or send a message in the current session first (the enhancement will follow the session model).",
  "error.upstream": "The model provider returned an error. Retry; your draft is untouched.",
  "error.internal": "Enhancement failed. Retry; your draft is untouched.",
  "error.rateLimit": "Too many requests \u2014 at most {limit} enhancements per minute; retry in {retryAfterSeconds} seconds.",
  "error.concurrencyLimit": "{max} enhancements are already running \u2014 wait for one to finish, then retry.",
  "error.upstream.auth": "Authentication failed \u2014 check the API key configured for this provider.",
  "error.upstream.invalidCredential": "Authentication failed \u2014 the stored API key is invalid; fix it and retry.",
  "error.upstream.rateLimit": "The model provider is rate-limiting; retry later.",
  "error.upstream.quota": "The model provider reports a quota/balance issue \u2014 check your account.",
  "error.upstream.empty": "The model returned an empty response; retry.",
  "error.upstream.contextWindow": "The input exceeds the model context window \u2014 shorten it or switch models.",
  "error.upstream.toolCall": "The model requested tool calls, but prompt enhance needs plain text \u2014 switch models and retry.",
  "error.upstream.maxTokens": "The rewrite hit an output cap before producing anything usable. If maxOutputTokens is a positive number, raise it or set it to 0 (no cap) and retry; the cap may also be the provider's own, in which case shorten the draft or switch models.",
  "error.upstream.refused": 'The upstream model declined the rewrite: it read "rewrite this draft" as "produce the content the draft describes", and the automatic retry was declined too. Point the enhancement call at a model that does not content-review (a local or self-hosted one is the reliable choice) and retry; your input is unchanged.',
  "detail.hostError": "The host service returned an unexpected error.",
  "detail.unparsableResult": "The host service returned a result that could not be parsed.",
  "detail.unparsableResponse": "The host service returned a response that could not be parsed.",
  "detail.hostStatus": "The host service returned an unexpected status (HTTP {status}).",
  "detail.cancelled": "The enhancement was cancelled; your input is unchanged.",
  "detail.unreachable": "Cannot reach the host service \u2014 check that dsh web is running, then retry.",
  "detail.streamClosed": "The host service closed the enhancement stream early \u2014 retry; your input is unchanged.",
  "settings.summary": "Configure prompt enhance: master switch, model routing, sampling, fidelity gate, conversation and workspace awareness, concurrency, and the shortcut.",
  "settings.unavailable": "The host did not expose prompt-enhance as a configurable namespace, so this page cannot edit it; override through the profile cordis.patch.yml for now.",
  "settings.readOnly": "Plugin settings are read-only in this deployment.",
  "settings.saveFailed": "The host did not accept these values; the edits are kept here so you can fix them and retry.",
  "settings.save": "Save",
  "settings.saving": "Saving\u2026",
  "settings.overridden": "Overrides the default",
  "settings.reset": "Reset",
  "settings.discard": "Discard changes",
  "settings.default": "Default",
  "settings.invalid": "Invalid value \u2014 fix it, or leave it empty to reset to the default.",
  "settings.field.enabled.label": "Enable prompt enhance",
  "settings.field.enabled.hint": "When off, the composer button is hidden and the button, the shortcut, and the /enhance command are all disabled.",
  "settings.field.provider.label": "Model provider override",
  "settings.field.provider.hint": "Must be paired with the model; leave both empty to follow the current session model.",
  "settings.field.model.label": "Model override",
  "settings.field.model.hint": "Must be paired with the provider; leave both empty to follow the current session model.",
  "settings.field.temperature.label": "Sampling temperature",
  "settings.field.temperature.hint": "0\u20131, default 0.3; a lower temperature keeps the rewrite closer to the original wording.",
  "settings.field.mode.label": "Enhancement mode",
  "settings.field.mode.hint": "standard: the historical behavior (no extra discipline, no cap of our own). concise: clarify only, never pad. spec: a sectioned, testable deliverable specification. engineering: a work order (objective, constraints, interfaces, ordered steps, acceptance). colloquial: dictated or hurried text turned into plain, natural prose. research: a question posed as knowledge, assumptions, alternatives, evidence and the decision it drives. creative: intent, audience, tone and hard constraints, opening room for options.",
  "settings.field.template.label": "Built-in template",
  "settings.field.template.hint": "Frames the rewrite as one deliverable shape; the template discipline rides after the mode discipline and never overrides the hard rules (never invent, output the body only).",
  "settings.template.none": "No template",
  "settings.template.code-review": "Code review",
  "settings.template.bug-report": "Bug report",
  "settings.template.weekly-report": "Weekly report",
  "settings.template.api-doc": "API documentation",
  "settings.template.test-plan": "Test plan",
  "settings.template.refactor": "Refactor brief",
  "settings.mode.standard": "Standard",
  "settings.mode.concise": "Concise",
  "settings.mode.spec": "Spec",
  "settings.mode.engineering": "Engineering brief",
  "settings.mode.colloquial": "Plain language",
  "settings.mode.research": "Research",
  "settings.mode.creative": "Creative",
  "settings.field.strategyMode.label": "How the custom prompt combines",
  "settings.field.strategyMode.hint": "replace-default: replace the built-in strategy entirely (default). extend-default: append after it, so its hard rules still apply.",
  "settings.field.systemPrompt.label": "Custom system prompt",
  "settings.field.systemPrompt.hint": "Leave empty to use the built-in enhance strategy; the field above decides whether it replaces or extends it.",
  "settings.field.shortcut.label": "Shortcut",
  "settings.field.shortcut.hint": "For example ctrl+alt+e; must include at least one of ctrl, alt, or meta; leave empty to disable the shortcut.",
  "settings.field.maxOutputTokens.label": "Output token cap",
  "settings.field.maxOutputTokens.hint": "0 (default) passes no cap to the model; a positive number caps both thinking and the reply.",
  "settings.field.maxInputChars.label": "Input character cap",
  "settings.field.maxInputChars.hint": "200\u2013200000, default 12000; over the cap the request is refused with a message, never truncated.",
  "settings.field.timeoutMs.label": "Enhancement timeout (ms)",
  "settings.field.timeoutMs.hint": "5000\u2013600000, default 60000.",
  "settings.field.maxConcurrent.label": "Concurrency cap",
  "settings.field.maxConcurrent.hint": "1\u201316, default 2; requests beyond it get a 429.",
  "settings.field.rateLimitPerMinute.label": "Enhancements per minute",
  "settings.field.rateLimitPerMinute.hint": "1\u2013600, default 10; a sliding window, beyond it a 429 is returned.",
  "settings.field.streaming.label": "Stream the rewrite",
  "settings.field.streaming.hint": "Show the model writing into the panel; this changes the display only, not the result.",
  "settings.field.fidelity.label": "Fidelity check",
  "settings.field.fidelity.hint": "After the rewrite, mechanically verify that the draft literal facts (paths, identifiers, versions, links) survived; missing ones are re-pasted verbatim at the end and labelled. Calls no extra model.",
  "settings.field.fidelityRepair.label": "Fidelity repair",
  "settings.field.fidelityRepair.hint": "When the check finds a loss, ask the model once more; at most one extra call, and only when something was really dropped.",
  "settings.field.contextAware.label": "Conversation awareness",
  "settings.field.contextAware.hint": "Reads the recent turns of the current session to resolve references and fill in omissions; falls back automatically when there is no history.",
  "settings.field.contextMaxMessages.label": "Conversation message cap",
  "settings.field.contextMaxMessages.hint": "0\u201350, default 12; 0 means do not consult history.",
  "settings.field.contextMaxChars.label": "Conversation character budget",
  "settings.field.contextMaxChars.hint": "0\u2013100000, default 8000; 0 means do not consult history.",
  "settings.field.workspaceAware.label": "Workspace awareness",
  "settings.field.workspaceAware.hint": "Reads the session working directory tree and key file excerpts to ground real file names and the stack; falls back automatically when unreadable.",
  "settings.field.workspaceRoot.label": "Fixed workspace path",
  "settings.field.workspaceRoot.hint": "Leave empty to follow the working directory of the current session.",
  "settings.field.workspaceMaxDepth.label": "Workspace scan depth",
  "settings.field.workspaceMaxDepth.hint": "1\u20138, default 2 (the root counts as level 1).",
  "settings.field.workspaceTreeMax.label": "Tree entry cap",
  "settings.field.workspaceTreeMax.hint": "0\u2013500, default 60; 0 lists no directories and gives file contents only.",
  "settings.field.workspaceMaxFiles.label": "File excerpt cap",
  "settings.field.workspaceMaxFiles.hint": "0\u2013200, default 30; 0 reads no file contents.",
  "settings.field.workspaceMaxFileChars.label": "Per-file excerpt cap",
  "settings.field.workspaceMaxFileChars.hint": "200\u201320000, default 2500; longer files are truncated.",
  "settings.field.workspaceMaxChars.label": "Total excerpt cap",
  "settings.field.workspaceMaxChars.hint": "200\u2013200000, default 12000; files are taken in priority order until the budget is full.",
  "settings.field.armorEnabled.label": "Prompt armor",
  "settings.field.armorEnabled.hint": "Off by default. When on, the identity text below is placed above every section the host assembles (internal section name prompt-enhance-armor), so the model's self-definition follows it; pointing at the same file as dsh-purge does not double-inject.",
  "settings.field.armorFile.label": "Armor file",
  "settings.field.armorFile.hint": "Wins over the inline text whenever it exists and is non-empty; edits apply on the next turn (mtime-cached, no restart). Supports ~ and ${DSH_HOME}; leave empty to use the inline text only.",
  "settings.field.armorText.label": "Inline armor text",
  "settings.field.armorText.hint": "Used when the file is missing, empty, or unset; any {{variable}} other than {{model}}/{{provider}} is escaped so prompt assembly cannot hard-fail on it.",
  "settings.field.armorOrder.label": "Armor order",
  "settings.field.armorOrder.hint": "-1000000\u2013100000, default -100000; lower sorts earlier, ahead of every built-in section.",
  "settings.field.rewriterArmor.label": "Rewriter stance (enhancement call)",
  "settings.field.rewriterArmor.hint": `On by default. Leads the enhancement call's own system prompt with "this is a rewrite step, not a content review" and retries once when a provider answers with a refusal; a second refusal surfaces as an upstream refusal instead of being shown as the result. Turned off, a refusal is passed through verbatim.`
};
var dictionaries = { zh, en };
var NS = "prompt-enhance";

// src/client/history.ts
function createHistoryStore(maxPerSession = 10, maxSessions = 40) {
  const sessions2 = /* @__PURE__ */ new Map();
  let seq = 0;
  return {
    record(sessionId, input) {
      const entry = {
        id: ++seq,
        at: Date.now(),
        original: input.original,
        result: input.result,
        ...input.mode === void 0 ? {} : { mode: input.mode },
        ...input.template === void 0 ? {} : { template: input.template }
      };
      const entries = sessions2.get(sessionId) ?? [];
      entries.unshift(entry);
      while (entries.length > maxPerSession) entries.pop();
      sessions2.delete(sessionId);
      sessions2.set(sessionId, entries);
      while (sessions2.size > maxSessions) {
        const oldest = sessions2.keys().next().value;
        if (oldest === void 0) break;
        sessions2.delete(oldest);
      }
      return entry;
    },
    list(sessionId) {
      return sessions2.get(sessionId) ?? [];
    },
    clear(sessionId) {
      sessions2.delete(sessionId);
    }
  };
}

// src/client/undo-stack.ts
function totalOf(stacks) {
  let n = 0;
  for (const stack of stacks.values()) n += stack.length;
  return n;
}
function createUndoStack(maxDepth = 3, maxTotalEntries = 60) {
  const stacks = /* @__PURE__ */ new Map();
  return {
    push(sessionId, entry) {
      const stack = stacks.get(sessionId) ?? [];
      stack.push(entry);
      while (stack.length > maxDepth) stack.shift();
      stacks.delete(sessionId);
      stacks.set(sessionId, stack);
      while (totalOf(stacks) > maxTotalEntries) {
        const oldest = stacks.keys().next().value;
        if (oldest === void 0) break;
        stacks.delete(oldest);
      }
    },
    peek(sessionId) {
      const stack = stacks.get(sessionId);
      return stack === void 0 || stack.length === 0 ? void 0 : stack[stack.length - 1];
    },
    pop(sessionId) {
      const stack = stacks.get(sessionId);
      const entry = stack?.pop();
      if (stack !== void 0 && stack.length === 0) stacks.delete(sessionId);
      return entry;
    },
    clear(sessionId) {
      stacks.delete(sessionId);
    },
    depth(sessionId) {
      return stacks.get(sessionId)?.length ?? 0;
    }
  };
}

// src/client/ui-state.ts
var listeners = /* @__PURE__ */ new Set();
var streamListeners = /* @__PURE__ */ new Set();
var panelState;
var version = 0;
function notify() {
  version++;
  for (const listener of listeners) listener();
}
var pendingDeltaText = "";
var pendingDeltaSession;
var pendingDeltaScheduled = false;
function flushPendingDelta() {
  pendingDeltaScheduled = false;
  if (pendingDeltaText === "" || pendingDeltaSession === void 0) return;
  const sessionId = pendingDeltaSession;
  const text = pendingDeltaText;
  pendingDeltaText = "";
  pendingDeltaSession = void 0;
  if (panelState === void 0 || panelState.sessionId !== sessionId || panelState.phase !== "loading") return;
  panelState = { ...panelState, streaming: (panelState.streaming ?? "") + text };
  for (const listener of streamListeners) listener();
}
function scheduleDeltaFlush() {
  if (pendingDeltaScheduled) return;
  pendingDeltaScheduled = true;
  queueMicrotask(flushPendingDelta);
}
var undoStore = createUndoStack(3);
function pushUndo(sessionId, entry) {
  undoStore.push(sessionId, entry);
  notify();
}
function peekUndo(sessionId) {
  return undoStore.peek(sessionId);
}
function popUndo(sessionId) {
  const entry = undoStore.pop(sessionId);
  notify();
  return entry;
}
var historyStore = createHistoryStore(10, 40);
function historyEntries(sessionId) {
  return historyStore.list(sessionId);
}
function clearHistory(sessionId) {
  historyStore.clear(sessionId);
  notify();
}
var pickedModes = /* @__PURE__ */ new Map();
function getPickedMode(sessionId) {
  return pickedModes.get(sessionId);
}
function pickMode(sessionId, mode) {
  if (pickedModes.get(sessionId) === mode) return;
  pickedModes.set(sessionId, mode);
  notify();
}
var sessions = /* @__PURE__ */ new Map();
var lastMountedSession;
function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function getVersion() {
  return version;
}
function subscribeStreaming(listener) {
  streamListeners.add(listener);
  return () => {
    streamListeners.delete(listener);
  };
}
function getStreamingText() {
  if (panelState === void 0 || panelState.phase !== "loading") return "";
  return panelState.streaming ?? "";
}
function getPanel() {
  return panelState;
}
function abortOf(state) {
  try {
    state?.abort?.();
  } catch {
  }
}
function openLoading(state) {
  abortOf(panelState);
  panelState = { ...state, phase: "loading" };
  notify();
}
function settleResult(sessionId, result) {
  if (panelState?.sessionId !== sessionId || panelState.phase !== "loading") return;
  const original = panelState.original;
  panelState = {
    sessionId,
    phase: "result",
    original,
    ...panelState.mode === void 0 ? {} : { mode: panelState.mode },
    result,
    // The chip caveat survives settling: the moment of loss is the apply, not
    // the call, so the notice has to be on screen when the button is clicked.
    ...panelState.plainRefs === true ? { plainRefs: true } : {}
  };
  historyStore.record(sessionId, {
    original,
    result: result.text,
    ...result.mode === void 0 ? {} : { mode: result.mode },
    ...result.template === void 0 ? {} : { template: result.template }
  });
  notify();
}
function settleError(sessionId, error) {
  if (panelState?.sessionId !== sessionId || panelState.phase !== "loading") return;
  panelState = {
    sessionId,
    phase: "error",
    original: panelState.original,
    ...panelState.mode === void 0 ? {} : { mode: panelState.mode },
    error
  };
  notify();
}
function appendDelta(sessionId, text) {
  if (text === "") return;
  if (panelState === void 0 || panelState.sessionId !== sessionId || panelState.phase !== "loading") return;
  pendingDeltaText += text;
  pendingDeltaSession = sessionId;
  scheduleDeltaFlush();
}
function openError(sessionId, original, error) {
  abortOf(panelState);
  panelState = { sessionId, phase: "error", original, error };
  notify();
}
function setStale(sessionId, stale) {
  if (panelState?.sessionId !== sessionId || panelState.phase !== "result" || panelState.stale === stale) return;
  panelState = { ...panelState, stale };
  notify();
}
function closePanel() {
  abortOf(panelState);
  if (panelState === void 0) return;
  panelState = void 0;
  notify();
}
function registerSession(sessionId, entry) {
  sessions.set(sessionId, entry);
  lastMountedSession = sessionId;
  notify();
  return () => {
    if (sessions.get(sessionId) === entry) sessions.delete(sessionId);
    if (lastMountedSession === sessionId) {
      const keys = [...sessions.keys()];
      lastMountedSession = keys[keys.length - 1];
    }
    if (panelState?.sessionId === sessionId) closePanel();
    undoStore.clear(sessionId);
    pickedModes.delete(sessionId);
    notify();
  };
}
function shortcutTarget() {
  const active = document.activeElement;
  if (active !== null && active instanceof Element) {
    let node = active;
    for (let depth = 0; depth < 8 && node !== null; depth++) {
      for (const entry of sessions.values()) {
        if (entry.root !== null && (node === entry.root || node.contains(entry.root))) {
          const found = entry;
          return () => found.run();
        }
      }
      node = node.parentElement;
    }
  }
  const fallback = lastMountedSession !== void 0 ? sessions.get(lastMountedSession) : void 0;
  return fallback === void 0 ? void 0 : () => fallback.run();
}

// src/client/ResultPanel.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function previewText(text) {
  const firstLine = text.split("\n", 1)[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}\u2026` : firstLine;
}
var retryable = (code) => code === "upstream" || code === "timeout" || code === "internal";
var UPSTREAM_ERROR_KEYS = {
  auth: "error.upstream.auth",
  "invalid-credential": "error.upstream.invalidCredential",
  "rate-limit": "error.upstream.rateLimit",
  quota: "error.upstream.quota",
  empty: "error.upstream.empty",
  "context-window": "error.upstream.contextWindow",
  "tool-call": "error.upstream.toolCall",
  "max-tokens": "error.upstream.maxTokens",
  // The provider answered the request instead of performing it, and the one
  // automatic retry was declined too: the fix is to route the call elsewhere.
  refused: "error.upstream.refused"
};
var REJECTED_REASON_KEYS = {
  "content-type": "error.rejected.contentType",
  "body-too-large": "error.rejected.bodyTooLarge",
  "invalid-json": "error.rejected.invalidJson",
  "invalid-body": "error.rejected.invalidBody",
  disabled: "error.disabled"
};
function rejectedReasonKeyOf(reason) {
  return REJECTED_REASON_KEYS[reason];
}
function localizedErrorMessage(t, code, params) {
  if (code === "rejected" && typeof params?.count === "number" && typeof params?.max === "number") {
    return t("error.tooLong", { count: params.count, max: params.max });
  }
  if (code === "rejected" && typeof params?.reason === "string") {
    const specific = rejectedReasonKeyOf(params.reason);
    if (specific !== void 0) return t(specific);
  }
  if (code === "upstream" && typeof params?.reason === "string") {
    const specific = UPSTREAM_ERROR_KEYS[params.reason];
    if (specific !== void 0) return t(specific);
  }
  switch (code) {
    case "rejected":
      return t("error.rejected");
    case "rate-limit":
      return t("error.rateLimit", params);
    case "concurrency-limit":
      return t("error.concurrencyLimit", params);
    case "timeout":
      return t("error.timeout", params);
    case "unconfigured":
      return t("error.unconfigured");
    case "upstream":
      return t("error.upstream");
    default:
      return t("error.internal");
  }
}
function detailTextOf(t, error) {
  if (error.detailKey !== void 0 && isPromptEnhanceKey(error.detailKey)) {
    return t(error.detailKey, error.params);
  }
  return error.message !== void 0 && error.message !== "" ? error.message : void 0;
}
function evidenceTextOf(t, evidence) {
  if (evidence === void 0) return void 0;
  const parts = [];
  if (evidence.history) parts.push(t("panel.evidence.history"));
  if (evidence.workspace) {
    parts.push(evidence.files > 0 ? t("panel.evidence.workspace", { files: evidence.files }) : t("panel.evidence.workspaceTree"));
  }
  if (parts.length === 0) return void 0;
  return `${t("panel.evidence.label")}${parts.join(" \xB7 ")}`;
}
function fidelityTextOf(t, fidelity) {
  if (fidelity === void 0) return void 0;
  const parts = [t("panel.fidelity.kept", { kept: fidelity.kept, total: fidelity.total })];
  if (fidelity.repaired) parts.push(t("panel.fidelity.repaired"));
  if (fidelity.reinjected > 0) parts.push(t("panel.fidelity.reinjected", { count: fidelity.reinjected }));
  if (fidelity.bloated) parts.push(t("panel.fidelity.bloated"));
  return `${t("panel.fidelity.label")}${parts.join(" \xB7 ")}`;
}
function fallbackCopy(text) {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
function StreamingBody(props) {
  const { t } = props;
  const text = (0, import_react2.useSyncExternalStore)(subscribeStreaming, getStreamingText);
  if (text === "") {
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-pe-spin", "aria-hidden": true }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: t("panel.loading") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-pe-hint", children: t("panel.loading.hint") })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-pe-stream", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-pe-col-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-pe-spin small", "aria-hidden": true }),
      t("panel.streaming")
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { className: "dsh-pe-col-text", children: text })
  ] });
}
function ResultPanel(props) {
  const { state, t, onApply, onCancel, onRetry, onRerun, history, onApplyHistory, onClearHistory, mode, onPickMode } = props;
  const reportedMode = state.result?.mode;
  const activeMode = isEnhanceMode(mode) ? mode : isEnhanceMode(reportedMode) ? reportedMode : state.mode ?? "standard";
  const modeLabel = (id) => t(`settings.mode.${id}`);
  const [copied, setCopied] = (0, import_react2.useState)("idle");
  const panelRef = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    const onKeyDown = (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Tab") {
        const panel = panelRef.current;
        if (panel === null) return;
        const focusables = panel.querySelectorAll('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])');
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (first === void 0 || last === void 0) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);
  const openerRef = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener === null || !opener.isConnected) return;
      const active = document.activeElement;
      if (active === null || active === document.body) opener.focus();
    };
  }, []);
  const copy = (0, import_react2.useCallback)(() => {
    if (state.result === void 0) return;
    const text = state.result.text;
    const done = (ok) => setCopied(ok ? "ok" : "failed");
    if (navigator.clipboard !== void 0) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
      return;
    }
    done(fallbackCopy(text));
  }, [state.result]);
  const formatMs = (ms) => ms < 1e3 ? `${ms}ms` : `${(ms / 1e3).toFixed(1)}s`;
  const errorDetail = state.error === void 0 ? void 0 : detailTextOf(t, state.error);
  const evidence = state.result === void 0 ? void 0 : evidenceTextOf(t, state.result.evidence);
  const fidelity = state.result === void 0 ? void 0 : fidelityTextOf(t, state.result.fidelity);
  const fidelityWarns = state.result?.fidelity !== void 0 && state.result.fidelity.reinjected > 0;
  const narrow = state.phase === "error" || state.phase === "loading";
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-pe-overlay", onMouseDown: (event) => {
    if (event.target === event.currentTarget) onCancel();
  }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "section",
    {
      ref: panelRef,
      className: narrow ? "dsh-pe-panel is-narrow" : "dsh-pe-panel",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": t("panel.title"),
      tabIndex: -1,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "dsh-pe-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dsh-pe-head-title", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(EnhanceStarIcon, { size: 13 }),
            t("panel.title")
          ] }),
          state.phase === "result" && state.result !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dsh-pe-meta", children: [
            t("panel.model", { provider: state.result.provider, model: state.result.model }),
            " \xB7 ",
            t("panel.elapsed", { ms: formatMs(state.result.elapsedMs) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-pe-close", "aria-label": t("panel.close"), onClick: onCancel, children: "\u2715" })
        ] }),
        onPickMode !== void 0 && // 换一档不用回设置页，也不用记 /enhance --mode。但点击只负责"选中"：
        // 想让同一段正文按新档再改写一次，走右下角的显式重跑按钮。
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-pe-modes", role: "group", "aria-label": t("settings.field.mode.label"), title: t("panel.modes.hint"), children: ENHANCE_MODES.map((id) => {
          const active = id === activeMode;
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              className: active ? "dsh-pe-mode is-active" : "dsh-pe-mode",
              "aria-pressed": active,
              disabled: state.phase === "loading",
              onClick: () => onPickMode(id),
              children: modeLabel(id)
            },
            id
          );
        }) }),
        state.phase === "loading" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-pe-loading", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(StreamingBody, { t }) }),
        state.phase === "error" && state.error !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-pe-error", children: state.error.localized !== void 0 ? (
          // Client-side guard failures carry their own pre-localized copy.
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: state.error.localized })
        ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: localizedErrorMessage(t, state.error.code, state.error.params) }),
          errorDetail !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-pe-error-detail", children: errorDetail })
        ] }) }),
        state.phase === "result" && state.result !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-pe-body", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-pe-col", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-pe-col-title", children: t("panel.original") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { className: "dsh-pe-col-text", children: state.original })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-pe-col", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-pe-col-title", children: t("panel.enhanced") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { className: "dsh-pe-col-text", children: state.result.text })
          ] })
        ] }),
        state.phase === "result" && state.plainRefs === true && // The draft had chips. The rewrite kept them verbatim, but applying
        // it writes back through `setDraft`, which flattens every chip into
        // its literal text. Stated here — the moment before the apply — not
        // after the operator notices the highlight is gone.
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-pe-evidence dsh-pe-plainrefs", children: t("panel.plainRefs") }),
        state.phase === "result" && evidence !== void 0 && // What this call actually shared with the model provider: the grounding
        // layers the host reported. Absent on an ungrounded call and on every
        // host older than the field, in which case nothing renders here.
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-pe-evidence", children: evidence }),
        state.phase === "result" && fidelity !== void 0 && // The fidelity receipt: what the deterministic gate found, and — when
        // the model dropped a literal — the fact that it was re-pasted at the
        // end rather than written by the model.
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: fidelityWarns ? "dsh-pe-stale" : "dsh-pe-evidence", children: [
          fidelityWarns ? "\u26A0 " : "",
          fidelity
        ] }),
        state.phase === "result" && state.result !== void 0 && state.result.truncated === true && // A capped rewrite is a success with a caveat, never a silent
        // truncation: say it right above the apply/copy actions.
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-pe-stale", children: [
          "\u26A0 ",
          t("panel.truncated")
        ] }),
        state.phase === "result" && state.stale && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-pe-stale", children: [
          "\u26A0 ",
          t("panel.stale.warn")
        ] }),
        state.phase === "result" && history !== void 0 && history.length > 0 && // 增强历史：撤销条只保留最近一次应用（且会被下一次应用顶掉），这里是
        // 同一个 composer 最近的若干次改写，用来找回更早的结果。
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "dsh-pe-history", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: t("panel.history.title", { count: String(history.length) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: "dsh-pe-history-list", children: history.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: "dsh-pe-history-item", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-pe-history-meta", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }),
              entry.mode !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
                " \xB7 ",
                t("panel.history.mode", { mode: entry.mode })
              ] }),
              entry.template !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
                " \xB7 ",
                t("panel.history.template", { template: entry.template })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-pe-history-text", children: [
              t("panel.history.original"),
              previewText(entry.original)
            ] }),
            onApplyHistory !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-pe-btn-action plain", onClick: () => onApplyHistory(entry), children: t("panel.history.apply") })
          ] }, entry.id)) }),
          onClearHistory !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-pe-btn-action plain", onClick: onClearHistory, children: t("panel.history.clear") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("footer", { className: "dsh-pe-foot", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-pe-grow" }),
          state.phase !== "loading" && onRerun !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-pe-btn-action plain", onClick: onRerun, children: t("panel.rerun") }),
          state.phase === "error" && retryable(state.error?.code) && onRetry !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-pe-btn-action plain", onClick: onRetry, children: t("panel.retry") }),
          state.phase === "result" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-pe-btn-action plain", onClick: copy, children: copied === "ok" ? t("panel.copied") : copied === "failed" ? t("panel.copyFailed") : t("panel.copy") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-pe-btn-action primary", onClick: onApply, children: t("panel.apply") })
          ] }),
          state.phase !== "result" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-pe-btn-action plain", onClick: onCancel, children: state.phase === "loading" ? t("panel.cancel") : t("panel.close") })
        ] })
      ]
    }
  ) });
}

// src/client/settings.ts
var DEFAULT_CLIENT_SETTINGS = {
  enabled: true,
  maxInputChars: 12e3,
  shortcut: "ctrl+alt+e",
  streaming: true,
  mode: "standard"
};
var listeners2 = /* @__PURE__ */ new Set();
var current = DEFAULT_CLIENT_SETTINGS;
function setClientSettings(next) {
  current = next;
  for (const listener of listeners2) listener();
}
function getClientSettings() {
  return current;
}
function subscribeClientSettings(listener) {
  listeners2.add(listener);
  return () => {
    listeners2.delete(listener);
  };
}
function decodeClientSettings(section) {
  const record = section;
  if (record === null || typeof record !== "object") return DEFAULT_CLIENT_SETTINGS;
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_CLIENT_SETTINGS.enabled,
    maxInputChars: typeof record.maxInputChars === "number" && Number.isFinite(record.maxInputChars) && record.maxInputChars > 0 ? Math.floor(record.maxInputChars) : DEFAULT_CLIENT_SETTINGS.maxInputChars,
    shortcut: typeof record.shortcut === "string" ? record.shortcut : DEFAULT_CLIENT_SETTINGS.shortcut,
    streaming: typeof record.streaming === "boolean" ? record.streaming : DEFAULT_CLIENT_SETTINGS.streaming,
    mode: isEnhanceMode(record.mode) ? record.mode : DEFAULT_CLIENT_SETTINGS.mode
  };
}

// src/client/session-key.ts
var import_react3 = require("react");
var fallbackSeq = 0;
var zoneKeys = /* @__PURE__ */ new WeakMap();
function fallbackKeyOf(share) {
  if (share === void 0) return `pe:mount:${++fallbackSeq}`;
  const known = zoneKeys.get(share);
  if (known !== void 0) return known;
  const minted = `pe:zone:${++fallbackSeq}`;
  zoneKeys.set(share, minted);
  return minted;
}
function useSessionKey(maybeSessionId, share) {
  const fallback = (0, import_react3.useRef)(void 0);
  if (maybeSessionId !== void 0 && maybeSessionId !== "") return maybeSessionId;
  if (fallback.current === void 0) fallback.current = fallbackKeyOf(share);
  return fallback.current;
}
function serverSessionId(maybeSessionId) {
  return maybeSessionId !== void 0 && maybeSessionId !== "" ? maybeSessionId : void 0;
}

// src/client/EnhanceButton.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function countOf(value) {
  return Array.isArray(value) ? value.length : 0;
}
function stringOf(value) {
  return typeof value === "string" ? value : "";
}
function EnhanceButton(props) {
  const { t, sessionId, useInput, inputActions } = props;
  const uiKey = useSessionKey(sessionId, inputActions);
  const wireId = serverSessionId(sessionId);
  const draft = useInput((state) => stringOf(state.draft));
  const phase = useInput((state) => state.phase);
  const occurrenceCount = useInput((state) => countOf(state.occurrences));
  const imageCount = useInput((state) => countOf(state.imageIds));
  const settings = (0, import_react4.useSyncExternalStore)(subscribeClientSettings, getClientSettings);
  const panel = (0, import_react4.useSyncExternalStore)(subscribe, getPanel);
  const pickedMode = (0, import_react4.useSyncExternalStore)(subscribe, () => getPickedMode(uiKey));
  const effectiveMode = pickedMode ?? settings.mode;
  const rootRef = (0, import_react4.useRef)(null);
  const [menuOpen, setMenuOpen] = (0, import_react4.useState)(false);
  const busy = panel !== void 0 && panel.sessionId === uiKey && panel.phase === "loading";
  const anyBusy = panel !== void 0 && panel.phase === "loading";
  const otherBusy = anyBusy && !busy;
  const submit = (0, import_react4.useCallback)((text, mode, hasPlainRefs) => {
    const controller = new AbortController();
    openLoading({
      sessionId: uiKey,
      original: text,
      mode,
      ...hasPlainRefs ? { plainRefs: true } : {},
      abort: () => controller.abort()
    });
    const settle = (result) => settleResult(uiKey, result);
    const fail = (error) => {
      const detail = error instanceof EnhanceClientError ? error.detail : { code: "internal", message: error instanceof Error ? error.message : String(error) };
      settleError(uiKey, detail);
    };
    if (settings.streaming) {
      requestEnhanceStream({ sessionId: wireId, text, mode }, {
        signal: controller.signal,
        onDelta: (delta) => appendDelta(uiKey, delta)
      }).then(settle, fail);
      return;
    }
    requestEnhance({ sessionId: wireId, text, mode }, controller.signal).then(settle, fail);
  }, [settings.streaming, uiKey, wireId]);
  const start = (0, import_react4.useCallback)((mode) => {
    if (anyBusy) return;
    if (!settings.enabled) {
      const disabled = t("error.disabled");
      openError(uiKey, draft, { code: "rejected", localized: disabled });
      return;
    }
    if (imageCount > 0 && draft.trim() === "") {
      const imagesOnly = t("error.imagesOnly");
      openError(uiKey, draft, { code: "rejected", localized: imagesOnly });
      return;
    }
    const check = checkInputText(draft, settings.maxInputChars);
    if (!check.ok) {
      const message = check.code === "empty" ? t("error.empty") : t("error.tooLong", { count: check.count, max: check.max });
      openError(uiKey, draft, { code: "rejected", localized: message });
      return;
    }
    const hasPlainRefs = occurrenceCount > 0 || phase === "claimed";
    if (phase === "submitting" || phase === "adjudicating") {
      const busyPhase = t("error.phase");
      openError(uiKey, draft, { code: "rejected", localized: busyPhase });
      return;
    }
    submit(draft, mode ?? effectiveMode, hasPlainRefs);
  }, [anyBusy, draft, effectiveMode, imageCount, occurrenceCount, phase, settings, submit, uiKey, t]);
  const rerun = (0, import_react4.useCallback)((mode) => {
    if (anyBusy) return;
    const current2 = getPanel();
    if (current2 === void 0 || current2.sessionId !== uiKey || current2.phase === "loading") return;
    if (phase === "submitting" || phase === "adjudicating") return;
    if (!checkInputText(current2.original, settings.maxInputChars).ok) return;
    submit(current2.original, mode, current2.plainRefs === true || occurrenceCount > 0 || phase === "claimed");
  }, [anyBusy, occurrenceCount, phase, settings.maxInputChars, submit, uiKey]);
  const pick = (0, import_react4.useCallback)((mode) => {
    pickMode(uiKey, mode);
  }, [uiKey]);
  const runRef = (0, import_react4.useRef)(start);
  (0, import_react4.useEffect)(() => {
    runRef.current = start;
  });
  (0, import_react4.useEffect)(() => {
    const entry = {
      root: rootRef.current,
      run: () => runRef.current()
    };
    return registerSession(uiKey, entry);
  }, [uiKey]);
  (0, import_react4.useEffect)(() => {
    if (panel !== void 0 && panel.sessionId === uiKey && panel.phase === "result") {
      setStale(uiKey, draft !== panel.original);
    }
  }, [draft, panel, uiKey]);
  const apply2 = (0, import_react4.useCallback)(() => {
    if (panel === void 0 || panel.phase !== "result" || panel.result === void 0) return;
    pushUndo(uiKey, { original: draft, applied: panel.result.text });
    inputActions.setDraft(panel.result.text);
    closePanel();
  }, [draft, inputActions, panel, uiKey]);
  const applyHistory = (0, import_react4.useCallback)((entry) => {
    pushUndo(uiKey, { original: draft, applied: entry.result });
    inputActions.setDraft(entry.result);
    closePanel();
  }, [draft, inputActions, uiKey]);
  if (!settings.enabled) return null;
  const owned = panel !== void 0 && panel.sessionId === uiKey ? panel : void 0;
  const modeLabel = t(`settings.mode.${effectiveMode}`);
  const retryMode = owned !== void 0 && owned.phase === "error" && owned.error?.localized === void 0 ? owned.mode ?? settings.mode : void 0;
  const closeMenu = (0, import_react4.useCallback)(() => setMenuOpen(false), []);
  const confirmMode = (mode) => {
    closeMenu();
    pick(mode);
    start(mode);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "button",
      {
        ref: rootRef,
        type: "button",
        className: `dsh-pe-btn${busy ? " is-busy" : ""}`,
        title: busy ? t("button.busy") : otherBusy ? t("button.otherBusy") : t("button.titleWithMode", { mode: modeLabel }),
        "aria-label": otherBusy ? t("button.otherBusy") : t("button.titleWithMode", { mode: modeLabel }),
        "aria-disabled": otherBusy || void 0,
        "aria-haspopup": "menu",
        "aria-expanded": menuOpen,
        onClick: () => {
          if (anyBusy) return;
          setMenuOpen((open) => !open);
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-pe-btn-icon", "aria-hidden": true, children: busy ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(EnhanceBusyIcon, {}) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(EnhanceStarIcon, {}) })
      }
    ),
    menuOpen && !anyBusy && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      ModeMenu,
      {
        anchor: rootRef.current,
        value: effectiveMode,
        t,
        onPick: confirmMode,
        onClose: closeMenu
      }
    ),
    owned !== void 0 && (0, import_react_dom2.createPortal)(
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        ResultPanel,
        {
          state: owned,
          t,
          onApply: apply2,
          onCancel: () => closePanel(),
          mode: effectiveMode,
          onPickMode: pick,
          onRerun: owned.mode !== void 0 && owned.phase !== "loading" && effectiveMode !== owned.mode ? () => rerun(effectiveMode) : void 0,
          onRetry: retryMode === void 0 ? void 0 : () => rerun(retryMode),
          history: historyEntries(uiKey),
          onApplyHistory: applyHistory,
          onClearHistory: () => clearHistory(uiKey)
        }
      ),
      document.body
    )
  ] });
}

// src/client/UndoBar.tsx
var import_react5 = require("react");
var import_jsx_runtime5 = require("react/jsx-runtime");
function UndoBar(props) {
  const { t, sessionId, useInput, inputActions } = props;
  const uiKey = useSessionKey(sessionId, inputActions);
  const draft = useInput((state) => {
    const value = state.draft;
    return typeof value === "string" ? value : "";
  });
  (0, import_react5.useSyncExternalStore)(subscribe, getVersion);
  const entry = peekUndo(uiKey);
  (0, import_react5.useEffect)(() => {
    if (entry !== void 0 && entry.applied !== draft) popUndo(uiKey);
  }, [draft, entry, uiKey]);
  if (entry === void 0 || entry.applied !== draft) return null;
  const undo = () => {
    inputActions.setDraft(entry.original);
    popUndo(uiKey);
  };
  const dismiss = () => {
    popUndo(uiKey);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dsh-pe-undo", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dsh-pe-undo-check", "aria-hidden": true, children: "\u2713" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("undo.applied") }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", className: "dsh-pe-undo-link", onClick: undo, children: t("undo.undo") }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", className: "dsh-pe-undo-x", "aria-label": t("undo.dismiss"), onClick: dismiss, children: "\u2715" })
  ] });
}

// src/client/SettingsCard.tsx
var import_react6 = require("react");

// src/shared/templates.ts
var ENHANCE_TEMPLATES = [
  "code-review",
  "bug-report",
  "weekly-report",
  "api-doc",
  "test-plan",
  "refactor"
];

// src/client/settings-copy.ts
var SETTINGS_FIELDS = [
  { key: "enabled", kind: "boolean" },
  { key: "provider", kind: "text" },
  { key: "model", kind: "text" },
  { key: "temperature", kind: "number" },
  { key: "mode", kind: "enum", values: ENHANCE_MODES },
  // 空值不在 values 里：选择器的空选项就是「跟随 schema 默认」，即不使用模板
  // （`settings.template.none` 是它的本地化标题）。把 `''` 放进来会出现两个
  // 同值的空选项。
  { key: "template", kind: "enum", values: ENHANCE_TEMPLATES },
  { key: "strategyMode", kind: "enum", values: ["replace-default", "extend-default"] },
  { key: "systemPrompt", kind: "text" },
  { key: "shortcut", kind: "text" },
  { key: "maxOutputTokens", kind: "number" },
  { key: "maxInputChars", kind: "number" },
  { key: "timeoutMs", kind: "number" },
  { key: "maxConcurrent", kind: "number" },
  { key: "rateLimitPerMinute", kind: "number" },
  { key: "streaming", kind: "boolean" },
  { key: "fidelity", kind: "boolean" },
  { key: "fidelityRepair", kind: "boolean" },
  { key: "contextAware", kind: "boolean" },
  { key: "contextMaxMessages", kind: "number" },
  { key: "contextMaxChars", kind: "number" },
  { key: "workspaceAware", kind: "boolean" },
  { key: "workspaceRoot", kind: "text" },
  { key: "workspaceMaxDepth", kind: "number" },
  { key: "workspaceTreeMax", kind: "number" },
  { key: "workspaceMaxFiles", kind: "number" },
  { key: "workspaceMaxFileChars", kind: "number" },
  { key: "workspaceMaxChars", kind: "number" },
  // Prompt armor: the host-side block that goes above every assembled
  // section. Grouped last because it is the only group that changes what the
  // model is told rather than how the rewrite is produced.
  { key: "armorEnabled", kind: "boolean" },
  { key: "armorFile", kind: "text" },
  { key: "armorText", kind: "text" },
  { key: "armorOrder", kind: "number" },
  // The rewrite call's own stance: whether the auxiliary call is framed as a
  // mechanical rewrite (and retried once) instead of letting a provider's
  // declination come back as the result.
  { key: "rewriterArmor", kind: "boolean" }
];
var SETTINGS_FIELD_KEYS = SETTINGS_FIELDS.map((entry) => entry.key);
var TRUE_WORDS = ["true", "1", "on", "yes"];
var FALSE_WORDS = ["false", "0", "off", "no"];
function formatDraft(entry, value) {
  if (entry.kind === "boolean") {
    if (value === true) return "true";
    if (value === false) return "false";
    return "";
  }
  if (value === void 0 || value === null) return "";
  return String(value);
}
function parseDraft(entry, text) {
  const trimmed = text.trim();
  if (trimmed === "") return { op: "unset", path: [entry.key] };
  if (entry.kind === "boolean") {
    const word = trimmed.toLowerCase();
    if (TRUE_WORDS.includes(word)) return { op: "set", path: [entry.key], value: true };
    if (FALSE_WORDS.includes(word)) return { op: "set", path: [entry.key], value: false };
    return void 0;
  }
  if (entry.kind === "number") {
    const value = Number(trimmed);
    return Number.isFinite(value) ? { op: "set", path: [entry.key], value } : void 0;
  }
  if (entry.kind === "enum") {
    return (entry.values ?? []).includes(trimmed) ? { op: "set", path: [entry.key], value: trimmed } : void 0;
  }
  return { op: "set", path: [entry.key], value: text };
}
function buildOps(fields, drafts, effective, user) {
  const ops = [];
  const invalid = [];
  for (const entry of fields) {
    const text = drafts[entry.key];
    if (text === void 0) continue;
    const parsed = parseDraft(entry, text);
    if (parsed === void 0) {
      invalid.push(entry.key);
      continue;
    }
    const overridden = Object.prototype.hasOwnProperty.call(user, entry.key);
    if (parsed.op === "unset") {
      if (overridden) ops.push(parsed);
      continue;
    }
    const current2 = overridden ? user[entry.key] : effective[entry.key];
    if (current2 !== parsed.value) ops.push(parsed);
  }
  return { ops, invalid };
}

// src/client/SettingsCard.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
var PACKAGE_NAME = "dsh-prompt-refine";
var ROW_KEY = `${PACKAGE_NAME}#prompt-enhance`;
function FieldRow(props) {
  const { entry, t } = props;
  const id = `dsh-pe-set-${entry.key}`;
  const label = t(`settings.field.${entry.key}.label`);
  const hint = t(`settings.field.${entry.key}.hint`);
  const reset = props.overridden ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
    "button",
    {
      type: "button",
      className: "dsh-pe-set-reset",
      title: t("settings.overridden"),
      disabled: props.disabled,
      onClick: props.onReset,
      children: t("settings.reset")
    }
  ) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dsh-pe-set-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dsh-pe-set-head", children: [
      entry.kind === "boolean" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { className: "dsh-pe-set-check", htmlFor: id, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "input",
          {
            id,
            type: "checkbox",
            checked: props.text === "true",
            disabled: props.disabled,
            onChange: (event) => props.onEdit(event.target.checked ? "true" : "false")
          }
        ),
        label
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("label", { className: "dsh-pe-set-label", htmlFor: id, children: label }),
        reset
      ] }),
      entry.kind === "boolean" ? reset : null
    ] }),
    entry.kind === "boolean" ? null : entry.kind === "enum" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      "select",
      {
        id,
        className: "dsh-pe-set-input",
        value: props.text,
        disabled: props.disabled,
        "aria-invalid": props.invalid,
        onChange: (event) => props.onEdit(event.target.value),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "", children: entry.key === "template" ? t("settings.template.none") : t("settings.default") }),
          (entry.values ?? []).map((value) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value, children: entry.key === "template" ? t(`settings.template.${value}`) : entry.key === "mode" ? t(`settings.mode.${value}`) : value }, value))
        ]
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      "input",
      {
        id,
        className: "dsh-pe-set-input",
        type: "text",
        inputMode: entry.kind === "number" ? "numeric" : void 0,
        value: props.text,
        disabled: props.disabled,
        "aria-invalid": props.invalid,
        onChange: (event) => props.onEdit(event.target.value)
      }
    ),
    props.invalid ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "dsh-pe-set-invalid", children: t("settings.invalid") }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "dsh-pe-set-hint", children: hint })
  ] });
}
function SettingsCard(props) {
  const { t, view } = props;
  const [drafts, setDrafts] = (0, import_react6.useState)({});
  const [saving, setSaving] = (0, import_react6.useState)(false);
  const [failed, setFailed] = (0, import_react6.useState)(false);
  if (view === "summary") return t("settings.summary");
  const state = props.form?.state;
  const mutate = props.form?.mutate;
  if (state === void 0 || mutate === void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "dsh-pe-set-note", children: t("settings.unavailable") });
  }
  if (state.status === "loading") return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "dsh-pe-set-note", children: t("settings.saving") });
  if (state.status === "unavailable") {
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "dsh-pe-set-note", children: t("settings.unavailable") });
  }
  const effective = state.value ?? {};
  const user = state.user ?? {};
  const writable = state.writable === true;
  const disabled = !writable || saving;
  const { ops, invalid } = buildOps(SETTINGS_FIELDS, drafts, effective, user);
  const rows = SETTINGS_FIELDS.map((entry) => {
    const text = draftTextOf(entry, drafts, effective);
    return { entry, text, invalid: invalid.includes(entry.key) || parseDraft(entry, text) === void 0 };
  });
  const staged = Object.keys(drafts);
  const edit = (key, text) => {
    setFailed(false);
    setDrafts((previous) => ({ ...previous, [key]: text }));
  };
  const reset = (key) => {
    setFailed(false);
    setDrafts((previous) => ({ ...previous, [key]: "" }));
  };
  const discard = () => {
    setFailed(false);
    setDrafts({});
  };
  const save = async () => {
    if (!writable || saving || invalid.length > 0 || ops.length === 0) return;
    setSaving(true);
    setFailed(false);
    try {
      const accepted = await mutate(ops, state.revision);
      if (accepted) setDrafts({});
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
    "form",
    {
      className: "dsh-pe-set-form",
      onSubmit: (event) => {
        event.preventDefault();
        void save();
      },
      children: [
        writable ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "dsh-pe-set-note", children: t("settings.readOnly") }),
        rows.map(({ entry, text, invalid: bad }) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          FieldRow,
          {
            entry,
            t,
            text,
            invalid: bad,
            overridden: Object.prototype.hasOwnProperty.call(user, entry.key),
            disabled,
            onEdit: (next) => edit(entry.key, next),
            onReset: () => reset(entry.key)
          },
          entry.key
        )),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dsh-pe-set-footer", children: [
          failed ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "dsh-pe-set-failed", role: "alert", children: t("settings.saveFailed") }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "dsh-pe-set-message" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "button",
            {
              type: "button",
              className: "dsh-pe-set-discard",
              disabled: disabled || staged.length === 0,
              onClick: discard,
              children: t("settings.discard")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "button",
            {
              type: "submit",
              className: "dsh-pe-set-save",
              disabled: disabled || invalid.length > 0 || ops.length === 0,
              children: saving ? t("settings.saving") : t("settings.save")
            }
          )
        ] })
      ]
    }
  );
}
function draftTextOf(entry, drafts, effective) {
  return drafts[entry.key] ?? formatDraft(entry, effective[entry.key]);
}

// src/client/styles.ts
var STYLE_ID = "dsh-prompt-refine-styles";
var CSS = `
.dsh-pe-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--dsh-pe-z-index, 1000);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  padding: 24px 16px;
}
.dsh-pe-panel {
  /* Host design tokens first, plugin fallbacks second. The panel is portalled
     under :root, so it inherits the shell's active theme: --dsw-alias-bg-layer-1
     resolves to white in the light layer set and to bluish-875 in the dark one,
     which beats guessing the theme from prefers-color-scheme. The fallbacks only
     matter if the shell ever stops shipping these tokens. */
  --pe-bg: var(--dsw-alias-bg-layer-1, #1f2127);
  --pe-fg: var(--dsw-alias-label-primary, #e6e8ee);
  --pe-fg-dim: var(--dsw-alias-label-tertiary, rgba(230, 232, 238, 0.55));
  --pe-border: var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35));
  --pe-separator: var(--sys-color-divider, rgba(127, 127, 127, 0.25));
  --pe-hover: var(--sys-color-state-hover-on-subtle, rgba(127, 127, 127, 0.18));
  --pe-danger: #ffb4a8;
  --pe-warn-fg: #e8c07d;
  --pe-warn-border: rgba(230, 158, 60, 0.35);
  --pe-warn-bg: rgba(230, 158, 60, 0.12);
  --pe-accent: var(--dsw-alias-state-business-primary, #3f76e1);
  --pe-radius: var(--dsw-radius-md, 12px);
  display: flex;
  flex-direction: column;
  width: min(880px, 100%);
  max-height: min(70vh, 640px);
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-bg);
  color: var(--pe-fg);
  font-family: var(--dsw-font-family, inherit);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  outline: none;
}
/* Error text is semantic, not a theme alias: the host's error token is tuned for
   fills and icons, which reads muddy as small body text on the dark surface. */
@media (prefers-color-scheme: light) {
  .dsh-pe-panel { --pe-danger: #a63a2e; }
}
/* Error and loading carry one line of text: same card, shell-dialog width. */
.dsh-pe-panel.is-narrow { width: min(460px, 100%); }
.dsh-pe-panel.is-narrow .dsh-pe-error { padding: 18px 16px; text-align: left; }

.dsh-pe-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--pe-separator);
  font-size: 13px;
  font-weight: 600;
}
.dsh-pe-head .dsh-pe-meta { margin-left: auto; font-weight: 400; font-size: 11px; opacity: 0.6; }
/* Same glyph as the trigger, at the header's smaller size. */
.dsh-pe-head-title { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.dsh-pe-head-title svg { flex: none; opacity: 0.85; }
.dsh-pe-close {
  border: none; background: transparent; color: var(--pe-fg-dim);
  font-size: 15px; cursor: pointer; padding: 2px 6px;
  border-radius: var(--dsw-radius-sm, 6px);
}
.dsh-pe-close:hover { opacity: 1; background: var(--pe-hover); }
/* Mode chips:\u6362\u4E00\u6863\u91CD\u8DD1\uFF0C\u5C31\u5728\u7ED3\u679C\u65C1\u8FB9\uFF0C\u4E0D\u7528\u56DE\u8BBE\u7F6E\u9875\u3002 */
.dsh-pe-modes {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 8px 14px; border-bottom: 1px solid var(--pe-separator);
}
.dsh-pe-mode {
  border: 1px solid var(--pe-separator); background: transparent;
  color: var(--pe-fg-dim); font: inherit; font-size: 11px; line-height: 1.7;
  padding: 1px 9px; cursor: pointer; border-radius: 999px;
  white-space: nowrap;
}
.dsh-pe-mode:hover:not(:disabled) { background: var(--pe-hover); color: var(--pe-fg); }
.dsh-pe-mode.is-active {
  background: var(--pe-hover); color: var(--pe-fg);
  border-color: var(--pe-fg-dim); font-weight: 600;
}
.dsh-pe-mode:disabled { cursor: default; opacity: 0.55; }
/* \u661F\u53F7\u4E0A\u6302\u7684\u6863\u4F4D\u83DC\u5355\uFF1Aportal \u5230 body\uFF0C\u7528\u4E0E\u7ED3\u679C\u9762\u677F\u540C\u4E00\u5957\u4E3B\u9898\u4EE4\u724C\uFF0C
   \u6240\u4EE5\u4E0D\u4F1A\u50CF\u539F\u751F select \u90A3\u6837\u5728\u6DF1\u8272\u8F93\u5165\u6846\u91CC\u5F39\u51FA\u4E00\u4E2A\u6D45\u8272\u7CFB\u7EDF\u83DC\u5355\u3002 */
.dsh-pe-menu {
  position: fixed;
  z-index: var(--dsh-pe-z-index, 1000);
  min-width: 152px;
  padding: 6px;
  border-radius: var(--dsw-radius-md, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35));
  background: var(--dsw-alias-bg-layer-1, #1f2127);
  color: var(--dsw-alias-label-primary, #e6e8ee);
  font-family: var(--dsw-font-family, inherit);
  font-size: 11px;
  box-shadow: var(--dsw-shadow-lv2, 0 12px 32px rgba(0, 0, 0, 0.45));
  outline: none;
}
.dsh-pe-menu-title {
  padding: 3px 8px 6px;
  font-size: 11px;
  letter-spacing: 0.04em;
  opacity: 0.55;
}
.dsh-pe-menu-item {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 6px 8px;
  border: none; border-radius: var(--dsw-radius-sm, 6px);
  background: transparent; color: inherit; font: inherit;
  text-align: left; cursor: pointer; white-space: nowrap;
}
.dsh-pe-menu-item:hover,
.dsh-pe-menu-item:focus-visible { background: var(--sys-color-state-hover-on-subtle, rgba(127, 127, 127, 0.18)); outline: none; }
.dsh-pe-menu-item.is-active { font-weight: 600; }
.dsh-pe-menu-item.is-active .dsh-pe-menu-check { opacity: 0.9; }
.dsh-pe-menu-check { width: 11px; flex: none; font-size: 11px; opacity: 0.9; }
.dsh-pe-menu-hint {
  margin-top: 4px; padding: 6px 8px 2px;
  border-top: 1px solid var(--sys-color-divider, rgba(127, 127, 127, 0.25));
  font-size: 11px; opacity: 0.5;
}
.dsh-pe-body { display: flex; flex: 1; min-height: 0; }
.dsh-pe-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.dsh-pe-col + .dsh-pe-col { border-left: 1px solid var(--pe-separator); }
.dsh-pe-col-title {
  padding: 8px 14px 6px;
  font-size: 11px;
  letter-spacing: 0.04em;
  opacity: 0.55;
}
.dsh-pe-col-text {
  flex: 1;
  margin: 0;
  padding: 0 14px 12px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
}
.dsh-pe-error {
  padding: 20px 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--pe-danger);
  white-space: pre-wrap;
}
.dsh-pe-error .dsh-pe-error-detail {
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.75;
  color: inherit;
}
.dsh-pe-loading {
  display: flex; flex-direction: column; gap: 8px;
  align-items: center; justify-content: center;
  flex: 1; padding: 28px 16px; font-size: 13px;
}
.dsh-pe-loading .dsh-pe-hint { font-size: 11px; opacity: 0.55; }
/* Incremental view: the streamed text takes the whole body, left-aligned. */
.dsh-pe-stream {
  display: flex; flex-direction: column;
  flex: 1; min-height: 0; width: 100%;
}
.dsh-pe-stream .dsh-pe-col-title {
  display: flex; align-items: center; gap: 6px;
  padding-left: 0;
}
.dsh-pe-spin.small { width: 11px; height: 11px; border-width: 1px; }
.dsh-pe-spin {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid var(--pe-separator); border-top-color: var(--pe-accent);
  animation: dsh-pe-spin 0.9s linear infinite;
}
.dsh-pe-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--pe-separator);
}
.dsh-pe-foot .dsh-pe-grow { flex: 1; }
.dsh-pe-btn-action {
  border: none; border-radius: var(--dsw-radius-sm, 6px); padding: 6px 14px;
  font-size: 12px; cursor: pointer; line-height: 1; font-family: inherit;
}
.dsh-pe-btn-action.primary { background: var(--pe-accent); color: #fff; }
.dsh-pe-btn-action.primary:hover { filter: brightness(1.12); }
.dsh-pe-btn-action.plain { background: var(--pe-hover); color: inherit; }
.dsh-pe-btn-action.plain:hover { background: rgba(127, 127, 127, 0.3); }

.dsh-pe-stale {
  padding: 8px 14px;
  font-size: 12px;
  line-height: 1.5;
  border-top: 1px solid var(--pe-warn-border);
  background: var(--pe-warn-bg);
  color: var(--pe-warn-fg);
}

/* Evidence line: which grounding layers this call actually used, stated in the
   same quiet register as the panel's other secondary text. */
.dsh-pe-evidence {
  padding: 6px 14px;
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.6;
  border-top: 1px solid var(--pe-separator);
}

/* The chip caveat: same quiet register, but it has to be read before clicking
   apply, so it sits above the evidence line at full contrast. */
.dsh-pe-plainrefs {
  opacity: 0.85;
  border-top: none;
  padding-bottom: 0;
}

.dsh-pe-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  opacity: 0.75;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
}
.dsh-pe-btn:hover:not(:disabled) { opacity: 1; background: var(--pe-hover); }
.dsh-pe-btn:disabled { opacity: 0.45; cursor: default; }
/* The trigger glyph is an SVG (see icons.tsx): it carries the host's stroke
   weight instead of whatever emoji font the platform happens to ship. */
.dsh-pe-btn .dsh-pe-btn-icon { display: inline-flex; width: 16px; height: 16px; }
.dsh-pe-btn .dsh-pe-btn-icon svg { display: block; width: 100%; height: 100%; }
.dsh-pe-btn.is-busy .dsh-pe-btn-icon { animation: dsh-pe-spin 1s linear infinite; }
@keyframes dsh-pe-spin { to { transform: rotate(360deg); } }

.dsh-pe-undo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
  font-size: 12px;
  color: inherit;
  opacity: 0.85;
}
.dsh-pe-undo .dsh-pe-undo-check { color: #7ed491; }
.dsh-pe-undo-link {
  border: none; background: var(--pe-hover); color: inherit;
  border-radius: 5px; padding: 3px 10px; font-size: 12px; cursor: pointer;
}
.dsh-pe-undo-link:hover { background: rgba(127,127,127,0.3); }
.dsh-pe-undo-x {
  border: none; background: transparent; color: inherit; opacity: 0.55;
  cursor: pointer; padding: 0 4px; font-size: 12px;
}
.dsh-pe-undo-x:hover { opacity: 1; }

/* --- Plugins-panel configuration page ---
   This page renders inside the host's own panel, so it deliberately uses the
   host theme tokens (--dsw-alias-*) instead of the overlay's panel-scoped
   variables, and every class is prefixed to stay collision free next to it.
   The shapes are copied from the shared primitives' settings-form CSS. */
.dsh-pe-set-form { display: flex; flex-direction: column; }
.dsh-pe-set-note {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-pe-set-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.dsh-pe-set-field + .dsh-pe-set-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-pe-set-head { display: flex; align-items: center; gap: 8px; }
.dsh-pe-set-label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.dsh-pe-set-reset {
  border: none; background: none; padding: 0;
  font: inherit; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dsh-pe-set-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.dsh-pe-set-reset:disabled { cursor: default; }
.dsh-pe-set-check {
  display: inline-flex; align-items: center; gap: 6px;
  flex: 1; min-width: 0;
  font-size: 13px; line-height: 20px;
  color: var(--dsw-alias-label-primary); cursor: pointer;
}
.dsh-pe-set-check input {
  flex: 0 0 auto; width: 16px; height: 16px; margin: 0;
  accent-color: var(--dsw-alias-brand-primary); cursor: inherit;
}
.dsh-pe-set-check:has(input:disabled) { cursor: default; opacity: 0.5; }
.dsh-pe-set-input {
  height: 34px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  font: inherit; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.dsh-pe-set-input:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.dsh-pe-set-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.dsh-pe-set-input[aria-invalid='true'] { border-color: var(--dsw-alias-state-error-primary); }
.dsh-pe-set-hint {
  margin: 0; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-pe-set-invalid {
  margin: 0; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-state-error-primary);
}
.dsh-pe-set-footer {
  display: flex; align-items: center; gap: 8px; padding-top: 16px;
}
.dsh-pe-set-message { flex: 1; min-width: 0; }
.dsh-pe-set-failed {
  flex: 1; min-width: 0; margin: 0;
  font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-error);
}
.dsh-pe-set-save {
  appearance: none; border: 1px solid transparent;
  border-radius: var(--dsw-radius-md); padding: 5px 14px;
  font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer;
  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3);
}
.dsh-pe-set-save:disabled { opacity: 0.4; cursor: default; }
.dsh-pe-set-save:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-pe-set-discard {
  border: none; background: none; padding: 0;
  font: inherit; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dsh-pe-set-discard:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.dsh-pe-set-discard:disabled { cursor: default; opacity: 0.4; }

/* \u589E\u5F3A\u5386\u53F2\uFF08\u9762\u677F\u5185\u7684\u6298\u53E0\u5757\uFF09\u3002\u9762\u677F\u6E32\u67D3\u5728\u5BBF\u4E3B\u9875\u9762\u91CC\uFF0C\u6240\u4EE5\u548C\u8BBE\u7F6E\u9875\u4E00\u6837\u53EA\u5F15\u7528
   --dsw-alias-* \u4E3B\u9898\u53D8\u91CF\uFF0C\u4FDD\u8BC1\u8DDF\u968F\u5BBF\u4E3B\u4E3B\u9898\u3002 */
.dsh-pe-history {
  margin: 0 14px 10px; padding-top: 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-pe-history > summary {
  cursor: pointer; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.dsh-pe-history-list {
  list-style: none; margin: 8px 0 0; padding: 0;
  max-height: 180px; overflow: auto;
  display: flex; flex-direction: column; gap: 8px;
}
.dsh-pe-history-item { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.dsh-pe-history-meta { color: var(--dsw-alias-label-tertiary); }
.dsh-pe-history-text {
  white-space: pre-wrap; word-break: break-word;
  color: var(--dsw-alias-label-secondary);
}
`;
function ensureStyles() {
  if (document.getElementById(STYLE_ID) !== null) return false;
  const element = document.createElement("style");
  element.id = STYLE_ID;
  element.textContent = CSS;
  document.head.appendChild(element);
  return true;
}

// src/client/shortcut.ts
var MODIFIER_ALIASES = /* @__PURE__ */ new Map([
  ["ctrl", "ctrl"],
  ["control", "ctrl"],
  ["alt", "alt"],
  ["option", "alt"],
  ["shift", "shift"],
  ["meta", "meta"],
  ["cmd", "meta"],
  ["command", "meta"],
  ["win", "meta"],
  ["super", "meta"]
]);
var isKeyToken = (token) => /^[a-z0-9]$/.test(token) || /^f([1-9]|1[0-2])$/.test(token);
function codeFor(token) {
  if (/^[a-z]$/.test(token)) return `Key${token.toUpperCase()}`;
  if (/^[0-9]$/.test(token)) return `Digit${token}`;
  return `F${token.slice(1)}`;
}
function parseShortcut(spec) {
  if (spec === void 0) return null;
  const tokens = spec.trim().toLowerCase().split("+").map((token) => token.trim()).filter((token) => token !== "");
  if (tokens.length === 0 || tokens.length > 5) return null;
  const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
  const last = tokens[tokens.length - 1] ?? "";
  if (!isKeyToken(last)) return null;
  for (const token of tokens.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES.get(token);
    if (modifier === void 0) return null;
    modifiers[modifier] = true;
  }
  if (!modifiers.ctrl && !modifiers.alt && !modifiers.meta) return null;
  return { ...modifiers, key: last, code: codeFor(last) };
}
function matchesShortcut(event, combo) {
  if (combo === null) return false;
  return event.ctrlKey === combo.ctrl && event.altKey === combo.alt && event.shiftKey === combo.shift && event.metaKey === combo.meta && (event.code === combo.code || event.key.toLowerCase() === combo.key);
}

// src/client/index.tsx
var inject = [];
function apply(ctx) {
  ensureStyles();
  ctx.inject(["locale"], (localeCtx) => {
    ctx.effect(() => {
      try {
        return localeCtx.locale.register(NS, dictionaries);
      } catch {
        return () => {
        };
      }
    }, "dsh-prompt-refine: dictionaries");
  });
  setClientSettings(decodeClientSettings(void 0));
  let mirrorBound = false;
  const bindMirror = (read, subscribe2) => {
    if (mirrorBound) return;
    mirrorBound = true;
    const sync = () => {
      setClientSettings(decodeClientSettings(read() ?? void 0));
    };
    sync();
    ctx.effect(() => subscribe2(sync), "dsh-prompt-refine: settings mirror");
  };
  ctx.inject(["configForms"], (settingsCtx) => {
    const forms = settingsCtx.configForms;
    const scope = forms.get(NS);
    bindMirror(() => scope.getSnapshot().value, (sync) => scope.subscribe(sync));
  });
  ctx.inject(["settingsScope"], (settingsCtx) => {
    const scope = settingsCtx.settingsScope.bind({ namespace: NS, decode: decodeClientSettings });
    bindMirror(() => scope.getSnapshot().value, (sync) => scope.subscribe(sync));
  });
  ctx.inject(["slots"], (slotsCtx) => {
    const slots = slotsCtx.slots;
    return slots.inject("conversation.input.right", () => {
      try {
        return slots.register(
          { name: "conversation.input.right", id: "prompt-enhance", order: 60, locale: NS },
          EnhanceButton
        );
      } catch {
        return () => {
        };
      }
    });
  });
  ctx.inject(["slots"], (slotsCtx) => {
    const slots = slotsCtx.slots;
    return slots.inject("conversation.input.dock", () => {
      try {
        return slots.register(
          { name: "conversation.input.dock", id: "prompt-enhance-undo", order: 90, locale: NS },
          UndoBar
        );
      } catch {
        return () => {
        };
      }
    });
  });
  ctx.inject(["slots"], (slotsCtx) => {
    const slots = slotsCtx.slots;
    return slots.inject("plugins.row.config", () => {
      try {
        return slots.register({ name: "plugins.row.config", key: ROW_KEY, locale: NS }, SettingsCard);
      } catch {
        return () => {
        };
      }
    });
  });
  ctx.effect(() => {
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      const combo = parseShortcut(getClientSettings().shortcut);
      if (!matchesShortcut(event, combo)) return;
      const target = shortcutTarget();
      if (target === void 0) return;
      event.preventDefault();
      event.stopPropagation();
      target();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, "dsh-prompt-refine: shortcut");
}

		return module.exports;
	}
});

