/**
 * Self-contained stylesheet, injected once as a <style> element: the plugin
 * ships no CSS build step, and class names are prefixed to stay collision
 * free inside the web shell. Colors are declared as panel-scoped variables
 * with a dark default and a light `prefers-color-scheme` override, so the
 * panel follows the OS/shell theme without depending on host theme internals.
 * @module dsh-prompt-refine/client/styles
 */

const STYLE_ID = 'dsh-prompt-refine-styles'

/** The plugin's stylesheet. */
export const CSS = `
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
/* Mode chips:换一档重跑，就在结果旁边，不用回设置页。 */
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
/* 星号上挂的档位菜单：portal 到 body，用与结果面板同一套主题令牌，
   所以不会像原生 select 那样在深色输入框里弹出一个浅色系统菜单。 */
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

/* 增强历史（面板内的折叠块）。面板渲染在宿主页面里，所以和设置页一样只引用
   --dsw-alias-* 主题变量，保证跟随宿主主题。 */
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
`

/**
 * Inject the stylesheet once per document.
 * @returns true when injected, false when it was already present.
 */
export function ensureStyles(): boolean {
  if (document.getElementById(STYLE_ID) !== null) return false
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS
  document.head.appendChild(element)
  return true
}
