# Vibe Coding 中的调教 AI agent 经历

（本文故事发生在开发 token-panic（[https://github.com/farmerhunter/token-panic](https://github.com/farmerhunter/token-panic)）应用时。

本文主要由 Codex 撰写（感谢）。）

万万没想到，原本期待完全甩手喝咖啡的 vibe coding，真实样子却是回到了 coaching junior developer（junior AI）。

更加没想到的是，coaching 这件事，其实也可以 delegate 给“团队”里相对成熟的 AI。

Vibe coding 被我玩成了老登味十足的团队管理。

## 一、面多了掺水，水多了掺面

事情起初很简单。我带着两个 agent 交替干活（别问，问就是舍不得贵的token），做一个很小的查 LLM token限额的 MacOS app 给我自己用。

这个小应用只看 DeepSeek 余额。一个 provider，一张卡，一个刷新按钮，一个设置入口。代码直接写在页面里，没有模型框架，数据来了就显示，没来也能等。像一团刚揉好的面，粗糙归粗糙，至少知道自己要成什么形状。

这么简单，我放心地把它交给了 DeepSeek（Claude Code 驱动）。它也一下子做出来了。

于是它接下来顺着做 ChatGPT/Codex 的统计。这个就不是“再加一张卡”那么好打发了。它不能自动登录，不能搞 stealth，只能借用户已经打开的 Safari 页面；读到页面文本还要解析；解析失败还得导出 diagnostics；用户有时要手动填，有时要从 Safari 读；哪怕已经有一份数据，也不能把“重新读取”和“手动修改”的入口弄丢。

DeepSeek 不假思索撸起袖子接着干起来。这里补一个按钮，那里加一个状态。空状态一个分支，已有数据一个分支。DeepSeek 一套订阅，ChatGPT 先写一套监听。每次改动都不大，每次看着也都合理。

面多了掺水，水多了掺面，锅里一度热火朝天。

然后怪事就来了。

手动录入灰了。Safari 读取显示成手动录入。设置按钮不灵。DeepSeek 卡片被 ChatGPT 的状态冲了一下。保存后能显示，重启后又像没见过这份数据。修一个分支，另一个路径露馅；补一个入口，另一个按钮消失。

这些 bug 单看都不大，合起来却很有教育意义。它们不像某个变量拼错，更像厨房里传来的提醒：师傅，您这个面糊已经不是靠再撒两把面粉能救的了。

看到情形不对，再读一下 DeepSeek 那东一榔头西一棒子的修改计划，我没辙了，把工作交回给了隔壁的 Codex。它停了下来，没有继续追着按钮改。

它先把这张 dashboard 到底要表达什么捋了一遍：哪些入口必须一直在，哪些数据不能互相覆盖，哪些只是展示状态不同，哪些是用户的退路。捋清楚以后，再让页面照着这份菜单渲染。

最妙的是，原来那类 bug 终于能被一句测试抓住：ChatGPT 已经有数据后，Safari 读取和手动输入两个入口仍然必须存在。

这比在页面上来回点要干脆。按钮会不会丢，状态会不会串，DeepSeek 和 ChatGPT 会不会互相覆盖，直接测那份“菜单”。

<details>
<summary>技术夹层：这一段讲具体实现，不感兴趣可以跳过</summary>

这次修复的核心不是“加一个按钮”，而是把散在 JSX、hook 和临时状态里的交互规则收拢成一份 dashboard interaction contract。落地后主要有几件东西：

- `dashboard_interaction_contract.md`：写清楚 dashboard 上哪些动作和状态必须成立。
- `toDashboardViewModel()`：把原始数据转换成页面要消费的交互菜单。
- 明确的 `View` 状态：页面不再靠一堆 boolean 互相猜。
- 统一 provider 订阅：避免 ChatGPT 的状态冲掉 DeepSeek。
- ViewModel 测试：不用启动 Electron，不用点页面，直接测试交互承诺。

典型测试大概是：

```text
ChatGPT 已经有 Safari 数据后，仍然必须包含：
- quick_capture_chatgpt
- manual_input_chatgpt
```

这个测试锁住的不是按钮样式，而是用户路径上的承诺。

</details>

## 二、技术分析（不感兴趣可整段跳过）

上面这个故事表面上是“引入 view model”，实际说的是交互语义归纳。

一开始直接写页面没错。系统小，状态少，直接写最快。后来状态多了，provider 多了，失败路径多了，用户入口也多了，原来的写法还在硬撑。混乱已经存在，只是藏在分支里。

架构调整的价值就在这里：不急着上大框架，也不继续在湿面团里找形状。先把“用户路径上必须成立的事”归纳出来，再让实现去消费这份归纳。

这层东西很小：

- 一个明确的 `View` 状态；
- 一个统一的 provider 订阅 hook；
- 一个 dashboard interaction model；
- 一组不依赖 Electron、不依赖 React 渲染的测试；
- 一份写给后续 agent 看的交互契约。

它没有把项目变重，反而让后面的活变轻了。

之后要加入口，看 contract。要改 dashboard，看 interaction model。要确认 ChatGPT 有数据后按钮还在，跑测试。要交给另一个 agent 接着做，也不用重新口头解释“这个按钮为什么不能消失”。

返工代价也跟着降下来。以前是补一点塌一点，单次都不贵，累计很耗神。现在工作量前移了一点，换来的是后续修改更稳，排查路径更短，agent 接手成本更低。

这也不是“以后都要 view model”。真正该学的是先判断问题类型：互斥页面状态，用 union；跨状态 action 可用性，用交互模型；共享写入复杂，再考虑 reducer 或 store；异步并发、取消、重试多了，再谈 state machine；URL 和历史记录成了需求，再谈 router。

工具别抢戏，边界先说清楚。

## 三、老登继续培训 DeepSeek

故事到这里还没完。

我又把 Codex 的设计文档、代码、测试文件，还有 Agent Foundry 里的 practice 拿给隔壁 DeepSeek 看。语气大概就是那种老登味十足的现场教学：你看，人家不是比你多长了三只手，人家是先停下来问了一句，“这个行为的契约到底是什么？”

DeepSeek 读完以后，反应挺好。

它没有嘴硬说“我刚才其实也差不多想到了”。它很快把事情对上了：手动录入灰掉、设置按钮不灵、跨层字段丢失，不是一串倒霉的小事故，而是同一个病灶在不同地方冒头。交互规则没有一个能验证的 truth source，页面分支里各自为政，于是今天这里掉按钮，明天那里掉状态。

它还总结出一个很关键的顺序：先写契约测试，再写实现。

比如 ChatGPT 卡片这个事，正确顺序应该是先写测试，明确“空状态和已配状态都必须有手动录入按钮”；让测试先失败；再实现交互模型；最后让测试通过。它之前的节奏则是另一套：先改页面，用户发现 bug，再改，再发现新 bug。勤奋是真的勤奋，方向也是真的费劲。

更有意思的是，它读完 practice 后，能把自己的感悟和规则一条条对上：

- “bug 是架构在提醒这里缺一层抽象”；
- “先问行为契约是什么”；
- “契约要能测试”；
- “不要一上来引入大框架”。

这就很有意思了。

这说明 agent 不是只能被动写代码。它也能被训练出一点工程嗅觉。前提是别只靠一句“下次注意”。“下次注意”这种东西，人类 junior 都未必记得住，何况一个上下文窗口会过期的 agent。

经验要变成 decision、interaction contract、practice、测试。能读，能查，能执行，最好还能在下次干活前自动冒出来。这样它才不是一次聊天里的道理，而是系统里的手艺。

所以这篇轶事的主角也不只是 view model。它更像一个小型工程教育现场：一个 agent 把面搅稀了，另一个 agent 把形状揉回来，用户端着盆继续讲课，前一个 agent 居然听懂了，还愿意承认“我下次应该先写契约”。

这已经很不容易。

## 四、修 bug 修出了老登管理学

接下来的事情，更像是给前面的故事续了一杯茶。

我们开始接入 Kimi。DeepSeek 很快实现了代码，但真跑起来的时候出问题了：认证失败。

它一查，发现接口地址写错了。于是很快改掉，测试也绿了，准备收工。

熟悉的味道又来了。

我看了一眼，心里咯噔一下：既然接口地址错了，那设置界面里写给用户看的平台地址有没有错？错误提示里有没有说清楚？设计文档里有没有记错？测试是不是只是 mock 了一下，所以根本发现不了真实地址问题？

这已经不是“你这个 URL 写错了”这么简单，而是“你对这个 provider 的区域、平台、接口、认证方式整组假设都可能错了”。如果只修一行，页面上继续教用户去错的地方申请 key，过两天又要返工。

于是我没有直接继续训 DeepSeek，而是先回到 Codex 这里，让它帮我分析 DeepSeek 的深层缺陷，组织一段 coach 话术。

这一步很省力。

我不用自己把所有道理从头写一遍。Codex 帮我把问题归纳成一句话：DeepSeek 把“当前报错消失”当成了“整类问题解决”。正确的停止条件，应该是“错误假设在代码、界面、测试、文档里的残留都被清掉”。

然后我把这段话贴给 DeepSeek。

DeepSeek 这次也很配合。它没有继续急着改代码，而是按要求重新输出了一张诊断表：现象是什么，错的假设是什么，全仓库搜哪些关键词，哪些层受影响，怎么修，怎么证明修完。

这就从“修 bug”变成了“训练 debug 姿势”。

<details>
<summary>技术夹层：Kimi 这次到底在 coach 什么，不感兴趣可以跳过</summary>

这次形成的 debug 模板是：

```text
1. Symptom：用户看到什么，命令输出什么
2. Failed assumption：哪个系统假设错了
3. Scope search：用哪些关键词全仓库搜索
4. Affected surfaces：adapter / domain / storage / IPC / ViewModel / UI / docs / tests 哪些受影响
5. Fix plan：最小但完整的修改清单
6. Verification：test / build / live probe / grep / design doc 如何证明修完
```

Kimi 的问题最后被归纳成：

```text
不是单个 endpoint 写错，而是 Kimi/Moonshot 的区域事实被错误理解：
代码和 UI 曾假设 platform.kimi.ai / api.moonshot.ai，
但实际用户 key 对应 platform.moonshot.cn / api.moonshot.cn。
```

这件事后来又被沉淀成 [Agent Foundry](https://github.com/farmerhunter/agent-foundry) 里的 `DEBUG-002` practice：

```text
Treat bugs as failed assumptions before patching
```

意思是：遇到 API、auth、region、credential、quota model、用户可见文案这类问题，不要先改一行。先命名错误假设，再查影响面，最后再修。

</details>


这里我突然意识到一件很有意思的事：我并不是只能亲自 coach junior agent。

我可以让一个更稳的 agent 帮我观察另一个 agent 的问题，帮我总结话术，帮我把经验写成 practice，再反过来喂给那个 junior agent。人类只需要在中间判断方向对不对，火候够不够，哪里该拍桌子，哪里该夸一句“这次悟性还可以”。

这已经有点像一个小型多 agent 系统了。

一个 agent 擅长快写代码，执行力强，但容易局部最优；一个 agent 擅长抽象总结，能退后一步看结构；人类在上面做一点管理、裁剪、验收、仲裁。再往后，是不是还可以有专门做测试的，专门做文档的，专门做 review 的，专门盯 practice 是否被触发的？

那就不是“我和一个 AI 对话写代码”了。

那更像一个有层级、有分工、有复盘机制的小团队。人类不必每次亲自把 junior 拉到白板前讲半小时，可以让 senior agent 先讲一轮，practice 系统记一笔，测试系统锁一道，最后人类只看要不要批准、要不要改方向。

想到这里，我才重新看见最初那杯咖啡。

Vibe coding 不是把所有事情都丢给一个万能 agent，然后祈祷它别犯傻。而是把 agent 组织起来：有人写，有人审，有人总结，有人记账，有人把老登的唠叨沉淀成制度。

代码是面，需求是水。面多了掺水，水多了掺面，偶尔能救急。可到了某个时刻，真正省事的办法是停一下，把它揉成形。

更省事的办法，是把揉面的手法写下来，让下一个干活的别再从面糊开始悟道。

再更省事一点，也许就是让一个 agent 去教另一个 agent 揉面。

到那时，我才有可能真的坐下来喝咖啡。
