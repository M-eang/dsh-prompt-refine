# dsh-prompt-refine 0.2.13 — seven output shapes

0.2.13 adds four enhancement modes and a per-call switch for choosing any of the seven. Nothing changes for a caller that does not name a mode.

## The modes

Same hard rules in every mode — preserve intent, never fabricate, body only, mirror the input language. A mode only decides the shape of the deliverable and how much output it may take.

| id | 标签 | budget | shape |
|---|---|---|---|
| `standard` | 标准 | 0 (no cap) | historical behavior: no addon, byte-identical request |
| `concise` | 精简 | 2000 | clarifies, never pads |
| `spec` | 规格 | 8000 | sectioned, testable deliverable specification |
| `engineering` | 工程提示词 | 8000 | work order: objective, context, constraints, interfaces, ordered steps, acceptance |
| `colloquial` | 口语优化 | 2000 | dictated or term-stacked text as plain prose — no headings, no bullets |
| `research` | 调研论证 | 6000 | known, assumed, alternatives, criteria, decision |
| `creative` | 创意发散 | 4000 | intent, audience, tone, hard constraints, several openings |

Each addon opens with `Mode: <id>. ` and is appended after the strategy, before the template addon and the reference rules — the order is contractual and tested.

## Per-call override

- `/enhance --mode engineering 帮我把这个需求写成施工单` — the switch is explicit because `standard`, `spec` and `creative` are all plausible first words of a draft.
- `/enhance -m colloquial <text>` — same thing, shorter.
- `/enhance modes` (or `/enhance 档位`) lists the ids without calling the model.
- An unknown id is an error at the command plane; the HTTP body path (`{"text": "...", "mode": "..."}`) ignores an unknown id and keeps the configured mode instead.

An explicit `maxOutputTokens` still wins over the mode's budget, and `standard` still produces the exact pre-0.2.13 payload (no `mode` field).

## Tests

518 across 36 files, +8 for the new modes and the two override paths (`tests/modes.test.ts`, `tests/enhance-command.test.ts`, `tests/orchestrate.test.ts`, `tests/http-route.test.ts`).
