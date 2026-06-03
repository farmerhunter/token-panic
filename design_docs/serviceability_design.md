# Serviceability Design

> 本文记录 token-panic 的可调试性设计。目标是同时服务传统线上运维思维和本地 vibe coding / coding agent 排查闭环。

---

## 设计目标

token-panic 是本地 Electron app，不是典型服务端系统。它仍然需要 serviceability，但主要故障闭环有两类：

1. **传统 serviceability**：用户或开发者能判断系统在哪个阶段失败、失败是否可归类、是否需要改配置、重试或修代码。
2. **Agent serviceability**：用户能把足够上下文带回 coding agent，让 agent 快速复现、补测试、修 parser/IPC/UI，再由用户重新验证。

核心原则：

- diagnostics 是排障数据，不是业务数据。
- 默认低敏，不自动持久化完整页面文本、credential、cookie、localStorage 或截图。
- 每次关键用户动作都应有 `trace_id`，让 main、renderer、capture、parser、storage 事件可关联。
- debug bundle 的目标不是完整遥测，而是最小可复现上下文。
- 失败要尽量落到稳定 taxonomy，而不是只留下自由文本错误。

---

## 两类 Serviceability 的关系

传统线上运维和 agent serviceability 共享同一批基础能力：

- Trace correlation
- Structured event log
- Failure taxonomy
- Diagnostic artifact
- Environment snapshot
- Data retention policy

区别在于优化目标：

| 维度 | 传统线上运维 | Agent serviceability |
|------|--------------|----------------------|
| 主要读者 | 开发者、SRE、支持人员 | coding agent + 用户 |
| 目标 | 判断故障阶段和影响范围 | 生成最小复现并修代码 |
| 产物 | log、trace、metrics、alert | debug bundle、fixture、test |
| 数据范围 | 聚合、长期趋势、频率 | 单次失败上下文 |
| 风险控制 | 脱敏、采样、权限 | raw/redacted 双轨、用户显式导出 |
| 成功标准 | 能定位和恢复服务 | 能补测试并完成修复闭环 |

本项目当前 MVP 更偏向 agent serviceability，但采用传统 serviceability 的结构化模型。

---

## 当前重点链路

阶段 4 优先覆盖以下链路：

```text
用户点击 Safari assisted capture
  → main process 定位 Safari tab
  → AppleScript / Safari Apple Events 读取可见页面文本
  → renderer 调用 text parser
  → 用户确认解析结果
  → IPC save manual snapshot
  → domain 生成 summary
  → renderer 展示结果
```

主要故障点：

- Safari 未运行或没有匹配 tab。
- 目标 URL 不在允许列表。
- Apple Events 权限不足。
- Safari 未启用 JavaScript from Apple Events。
- 页面为空、加载异常、登录页、验证码或 connection limited。
- 读到了文本，但 parser 找不到候选。
- 找到了候选，但无法构造可信 `LimitPayload`。
- 用户取消确认。
- debug bundle 导出失败或 raw cache 已过期。

---

## Diagnostics Event Schema

MVP event envelope：

```ts
type DiagnosticEvent = {
  timestamp: string;
  trace_id: string;
  component:
    | 'safari_capture'
    | 'text_parser'
    | 'manual_provider'
    | 'summary'
    | 'debug_bundle';
  action: string;
  status: 'ok' | 'warning' | 'error';
  reason?: string;
  metadata?: Record<string, unknown>;
};
```

约束：

- `metadata` 默认不得包含完整 raw text、credential、cookie、localStorage、sessionStorage。
- URL 只记录 `host`、`path` 和必要 allowlist 判断，不记录敏感 query。
- parser candidate lines 只记录短 snippet，并限制数量和长度。
- event log 使用 JSONL，方便追加、过滤和被 agent 读取。

---

## Failure Taxonomy

MVP 优先覆盖这些稳定 reason：

| Reason | 组件 | 含义 |
|--------|------|------|
| `safari_not_running` | `safari_capture` | Safari 不可访问或未运行 |
| `tab_not_found` | `safari_capture` | 没有找到允许 URL 的 analytics tab |
| `url_not_allowed` | `safari_capture` | 当前 tab URL 不在允许列表 |
| `apple_events_denied` | `safari_capture` | macOS Apple Events 权限不足 |
| `javascript_probe_failed` | `safari_capture` | Safari JS from Apple Events 不可用 |
| `empty_page_text` | `safari_capture` | 成功读取但页面文本为空 |
| `empty_text` | `text_parser` | parser 输入为空 |
| `no_limit_candidates` | `text_parser` | 未找到可能的限额候选行 |
| `candidate_lines_found_but_no_valid_limit` | `text_parser` | 有候选行，但不能构造有效限额 |
| `manual_confirmation_required` | `manual_provider` | 需要用户确认后才能保存 |
| `raw_cache_expired` | `debug_bundle` | 用户想导出 raw text，但内存缓存已过期 |
| `bundle_export_failed` | `debug_bundle` | debug bundle 写入失败 |

自由文本错误仍可放在 `metadata.message`，但 UI 和 agent 优先依赖稳定 reason。

---

## Parser Diagnostics

Parser diagnostics 是 domain observability，不是业务输出语义。

业务接口：

```ts
parseLimitText(text): LimitParseResult | null
```

排障接口：

```ts
parseLimitTextWithDiagnostics(text, traceId?): {
  result: LimitParseResult | null;
  diagnostics: ParserDiagnostics;
}
```

`ParserDiagnostics` 应包含：

- `trace_id`
- `text_length`
- `line_count`
- `strategies_tried`
- `candidate_lines`
- `failure_reason`

候选行策略：

- 只保留和 limit/balance/usage/reset 等关键词相关的短 snippet。
- 限制候选数量，避免 UI 和 bundle 被整页文本淹没。
- 成功解析时也保留使用过的 strategy，方便后续评估 parser 稳定性。

---

## Raw Data Policy

raw data 指完整页面文本、截图、DOM、HTML、cookie、localStorage、sessionStorage、API key 等可能含敏感内容的数据。

当前策略：

- 完整页面文本默认不落盘。
- 完整页面文本只进入短期内存缓存。
- 当前实现目标：最多 3 条、TTL 10 分钟。
- 只有用户显式选择“导出含完整文本”时，才写入 debug bundle。
- 不读取、不保存 ChatGPT cookie、localStorage、sessionStorage。
- 不默认截图。
- 不上传任何 diagnostics 或 debug bundle。

后续增强：

- 增加 redacted text 导出。
- 增加仅导出相关行上下文的模式。
- 对 email、account id、team name、明显 token-like 字符串做 mask。
- UI 在导出 raw text 前展示风险提示。

---

## Debug Bundle Schema

MVP 结构：

```text
debug-bundle-<trace_id>/
  manifest.json
  environment.json
  trace.jsonl
  parser-diagnostics.json
  raw-text.txt              # 仅用户显式选择时存在
```

`environment.json` 建议包含：

```json
{
  "app_name": "token-panic",
  "app_version": "0.0.0",
  "platform": "darwin",
  "arch": "arm64",
  "node_version": "...",
  "electron_version": "...",
  "created_at": "..."
}
```

后续增强结构：

```text
debug-bundle-<trace_id>/
  environment.json
  trace.jsonl
  parser-diagnostics.json
  redacted-text.txt
  raw-text.txt              # 仅用户显式选择时存在
  reproduction.md           # 可选，不在 MVP 自动生成
```

`manifest.json` 建议包含：

```json
{
  "schema_version": 1,
  "trace_id": "...",
  "created_at": "...",
  "capture_method": "safari_visible_tab",
  "include_raw_text": false,
  "contains_sensitive_data": false,
  "files": [
    "environment.json",
    "trace.jsonl",
    "parser-diagnostics.json"
  ]
}
```

---

## Agent Handoff Workflow

目标闭环：

```text
用户触发 capture
  → app 失败并显示 diagnostics
  → 用户导出 debug bundle 或复制诊断摘要
  → coding agent 读取 bundle
  → agent 判断故障边界
  → 若是 parser 问题：把 raw/redacted text 转为 fixture
  → agent 添加失败测试
  → agent 修改 parser
  → npm test / npm run build
  → 用户重新 capture 验证
```

agent 处理 bundle 时的优先级：

1. 先看 `parser-diagnostics.json` 和 `trace.jsonl`。
2. 如果 failure reason 已足够明确，不要求用户提供 raw text。
3. 只有 parser candidate 不足以定位时，才建议用户导出含完整文本的 bundle。
4. 修复 parser 时优先新增 fixture test，避免只按当前页面临时 patch。

---

## MVP 验收标准

1. Safari capture 成功和失败都能生成 `trace_id`。
2. Parser 失败时 UI 展示 parser diagnostics。
3. 默认 diagnostics log 不包含完整页面文本、cookie、localStorage、API key。
4. 用户可以导出不含 raw text 的 debug bundle。
5. 用户显式选择后，可以在 raw cache 未过期时导出含完整文本的 debug bundle。
6. debug bundle 中的信息足够支持新增一个 parser fixture test。
7. parser diagnostics 成功/失败路径有测试覆盖。
8. `npm test` 和 `npm run build` 通过。

---

## 当前实现状态

阶段 4 MVP baseline 已实现：

- `src/shared/diagnostics.ts` 定义 diagnostics event、failure reason、debug bundle manifest 和诊断摘要 formatter。
- `src/main/diagnostics.ts` 写 metadata-only JSONL，维护短期 raw cache，并导出 manifest、environment、trace、parser diagnostics 和可选 raw text。
- `src/main/safari-capture.ts` 为 Safari tab 查找、JS probe、页面文本读取生成 trace 和稳定失败 reason。
- `src/domain/text-parser.ts` 提供 `parseLimitTextWithDiagnostics()`，业务 API `parseLimitText()` 保持不变。
- `src/renderer/components/ManualInputForm.tsx` 在 parse 失败时展示 diagnostics，支持导出 debug bundle 和复制诊断摘要。
- 当前测试覆盖 parser diagnostics 与 shared diagnostics manifest/summary。

---

## 非目标

- 不接入远程 telemetry 平台。
- 不上传 diagnostics 或 debug bundle。
- 不自动采集完整页面文本、截图、DOM、cookie 或 storage。
- 不把 diagnostics 写入 provider snapshot/history。
- 不为排障重新引入 ChatGPT stealth、Playwright 登录或 browser scrape。
