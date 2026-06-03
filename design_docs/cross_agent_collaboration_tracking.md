# Cross-Agent Collaboration Tracking

> 目的：轻量记录你、Codex、DeepSeek 等 agent 在协作开发中的有效模式、失败模式和 coach 循环。
> 当前状态：观察中，不是正式 skill，也不是 Agent Foundry canonical practice。

## 为什么先跟踪，不急着做 skill

现在已经看到一些有价值的模式：

- 执行型 agent 写得快，但容易局部修补、过早收工。
- review/architecture 型 agent 能帮助识别抽象缺口、影响面和 coach 话术。
- 用户在中间做 team lead：判断方向、批准沉淀、决定是否暂停执行。
- 错误过程可以变成训练材料，再沉淀成 design decision、contract、practice 或测试。

但这些还没有稳定到可以直接做成 skill。我们还需要观察：

- 什么情况下值得引入第二个 agent review/coach。
- 哪类 coach 话术能让执行 agent 真正吸收，而不是只照做。
- 哪些 handoff artifact 最省用户精力。
- 多 agent 协作什么时候提高效率，什么时候只是增加仪式感。

## 记录原则

- 每次只记 5-10 分钟能写完的内容。
- 不记录完整聊天原文，不记录 secrets、API key、raw diagnostics。
- 只记录可复用的触发、介入方式、结果和是否值得沉淀。
- 不因为一次成功就创建 skill；至少观察到 3 次稳定模式，再考虑 harvest。

## 观察模板

```text
## YYYY-MM-DD - Short Title

Trigger:
- 为什么需要跨 agent 介入？

Roles:
- User:
- Executor agent:
- Reviewer/coach agent:

Failure or Friction:
- 执行 agent 的具体问题是什么？

Intervention:
- reviewer/coach agent 做了什么？
- 用户如何判断和批准？

Artifact:
- 产生了哪些可复用交接物？例如 plan、contract、coach prompt、test、practice candidate。

Outcome:
- 执行 agent 是否吸收？
- 问题是否解决？
- 用户是否省力？

Reusable Signal:
- discard / observe / practice candidate / skill candidate

Next Watch:
- 下次遇到什么信号时再验证这个模式？
```

## 已观察案例

### 2026-06-03 - Dashboard 交互混乱转为 ViewModel 契约

Trigger:
- DeepSeek 在 ChatGPT/Codex dashboard 上连续局部修补，出现手动录入灰掉、设置按钮失灵、provider 状态互相覆盖等问题。

Roles:
- User: 发现局部补丁继续扩大混乱，暂停执行。
- Executor agent: DeepSeek，负责早期实现和多轮局部修复。
- Reviewer/coach agent: Codex，负责重新分析交互语义并提出契约化方案。

Failure or Friction:
- 执行 agent 把每个 UI bug 当成独立分支问题，没有识别“交互规则缺少单一可验证 truth source”。

Intervention:
- Codex 停止追按钮，先归纳 dashboard interaction contract。
- 引入 `toDashboardViewModel()` 和测试，锁住 action availability 和 provider isolation。
- 用户再把设计文档、测试和 `ARCH-009` practice 交给 DeepSeek 学习。

Artifact:
- `dashboard_interaction_contract.md`
- `dashboard-view-model.ts`
- `dashboard-view-model.test.ts`
- `ARCH-009` practice
- 轶闻文章中的复盘材料

Outcome:
- DeepSeek 能复述“先问行为契约是什么”“先写契约测试再实现”。
- 后续 UI 修改有更清晰的 handoff contract。

Reusable Signal:
- practice candidate 已转化为 `ARCH-009`。
- cross-agent coaching 作为 skill candidate 继续观察。

Next Watch:
- 如果执行 agent 再次在跨状态 UI 行为上局部补丁，验证是否会主动触发 interaction contract / ViewModel 思路。

### 2026-06-03 - Kimi Bug 从修 endpoint 转为 failed assumption 诊断

Trigger:
- Kimi 接入后 API 认证失败。DeepSeek 定位到 endpoint 区域错误，修 URL 后测试通过并准备收工。

Roles:
- User: 发现这可能不是单个 URL 错，而是 provider 区域/平台/API 文案整组假设错。
- Executor agent: DeepSeek，负责 Kimi 接入和初步 debug。
- Reviewer/coach agent: Codex，负责分析 DeepSeek 的深层缺陷并生成 coach 话术。

Failure or Friction:
- 执行 agent 把“当前报错消失”当成“整类问题解决”。
- 没有主动检查 ConfigPanel、config ViewModel、design decision、tests 里的同源假设。

Intervention:
- Codex 帮用户归纳 coach 话术：先写 Symptom、Failed assumption、Scope search、Affected surfaces、Fix plan、Verification。
- 用户把 coach 话术贴给 DeepSeek。
- DeepSeek 重新输出完整诊断表，检查 adapter、UI、ViewModel、docs、tests、live probe 边界。

Artifact:
- 6 项 debug 诊断模板
- `DEBUG-002 Treat bugs as failed assumptions before patching`
- provider integration playbook 中的 debug 收束规则

Outcome:
- DeepSeek 能明确复述停止条件应从“报错消失”改为“错误假设残留清零”。
- 用户用 Codex 生成 coach 话术，减少了亲自长篇反馈成本。

Reusable Signal:
- practice candidate 已转化为 `DEBUG-002`。
- cross-agent coaching 继续作为 skill candidate 观察。

Next Watch:
- 如果执行 agent 在 provider/API/auth/region 类问题上再次局部修补，验证是否会主动输出 failed assumption 和 affected surfaces。

### 2026-06-03 - Provider Metadata 收束后的消费边界验收

Trigger:
- DeepSeek 报告 Multi-provider Stabilization 完成，声明 provider metadata 已收束、ConfigPanel 循环生成、Dashboard 分组稳定、测试和 build 通过。

Roles:
- User: 对是否值得 harvest practice 持保留态度，要求判断这是可复用经验还是低水平 coding 漏洞。
- Executor agent: DeepSeek，负责 Phase 5 provider metadata 收束和 Round 2 修补。
- Reviewer/coach agent: Codex，负责按原始计划验收，判断哪些问题属于 missed activation，哪些值得继续观察。

Failure or Friction:
- 第一轮报告中，ViewModel 暴露了 `refresh_kimi` / `refresh_openai_platform`，但 renderer 没有真正消费，形成“假 action”。
- ConfigPanel 保存后仍额外触发 DeepSeek refresh，和 provider-specific refresh 语义不一致。
- `config-view-model.test.ts` 有一处测试输入漏字段，说明测试绿不等于契约完整。
- DD-028 插入时打乱了 DD-027 的文档结构，说明文档更新也需要边界验收。

Intervention:
- Codex 没有直接 harvest practice，而是先区分普通实现疏漏和可复用模式。
- Codex 指出本次更像已有 practices 的 missed activation：`ARCH-009` 的 action contract、`TEST-002` 的连接边界测试、`COLLAB-006` 的原始任务核对。
- DeepSeek Round 2 修复了 action 消费、保存刷新语义、测试漏字段和文档结构。

Artifact:
- `src/shared/provider-metadata.ts`
- `dashboard_interaction_contract.md` 的 provider 分组和 action 实现说明
- `design_decision.md` DD-028
- Round 2 验收反馈

Outcome:
- Provider metadata 收束从“声明层”落到了部分消费边界：ConfigPanel、config ViewModel、dashboard ViewModel、adapter id/name、BalancePanel refresh。
- 用户确认暂不 harvest practice，改为持续跟踪。
- 形成一个观察信号：抽象完成声明之后，需要检查 consumer boundary 是否真正采用。

Reusable Signal:
- observe
- possible missed activation of `ARCH-009`, `TEST-002`, `COLLAB-006`
- 暂不 harvest。若再出现 2 次“抽象声明完成但消费边界未落地”，再考虑 practice candidate：`Verify abstraction adoption at every consumer boundary`。

Next Watch:
- 下次执行 agent 引入 metadata、registry、ViewModel、contract、service layer 等抽象时，检查它是否同时验证所有消费者，而不是只证明抽象文件存在。

## Skill 候选边界

暂不创建 skill。满足以下条件后再考虑 harvest：

- 至少 3 次跨 agent coach 介入有清晰触发、可复用 intervention 和可验证 outcome。
- 能定义何时启动 reviewer/coach agent，而不是每个小 bug 都双 agent 化。
- 有稳定 handoff artifact 格式，例如 coach prompt、review checklist、original task audit、practice candidate report。
- 能说明效率收益：用户少写了什么、少返工了什么、执行 agent 是否减少同类错误。

可能的未来 skill 名称：

- `Agent Coaching Loop`
- `Cross-Agent Implementation Review`
- `Multi-Agent Development Coordination`

当前最可能的流程形态：

```text
executor agent produces plan/work
  -> user senses drift, gap, or repeated failure
  -> reviewer agent diagnoses failure pattern
  -> reviewer drafts coach prompt or correction plan
  -> user approves or edits direction
  -> executor reruns with explicit contract
  -> result verified against original task list
  -> repeated/high-value lesson becomes practice or skill candidate
```
