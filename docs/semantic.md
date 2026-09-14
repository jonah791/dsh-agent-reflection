# 语义文档：dsh-agent-reflection（每日反思 · 6 维进化棱镜自审）

> 版本 v0.1 · 2026-09-14 · 作者：爱丽丝 · 状态：**draft**
> 开发方式：语义文档优先（本份是 2026-09-14 可维护性工程的**补课**文档）
> 实现落点：`self-plugins/dsh-agent-reflection/src/index.ts`（+ 纯决策层 `src/reflect-plan.ts`、IO 薄壳 `src/state-io.ts`）

| 项 | 值 |
|----|----|
| 能力名 | dsh-agent-reflection（每日定时反思提醒 + 6 维自审引导 + 情感数据联动） |
| 主副本路径 | `self-plugins/dsh-agent-reflection/docs/semantic.md`（本文件） |
| 实现落点 | `src/index.ts`（定时器/发送/工具接线）、`src/reflect-plan.ts`（纯决策层：时刻判定/打断判定/状态解析/情感摘要）、`src/state-io.ts`（落盘薄壳 `writeJsonSafe`） |
| 版本 | 0.1.1（git head `ea984ad`） |
| 挂载位置 | `.dsh/profiles/web/cordis.patch.yml` **行 188–194** `insert` 块：行 id `agent-agent-reflection`（:189）、name `dsh-agent-reflection`（:190）、config `enabled: true`（:192）、`hour: 0`（:193）、`minute: 0`（:194） |
| 状态 | **draft** |
| 测试 | `tests/reflect-plan.test.mjs`、`tests/state-io.test.mjs` |

## 1 · 定位与反定位

**定位**：**每天一次的心智检视提醒**。到点（默认本地时间 00:00）向主 agent 发一条带 `【每日反思】` 标记的消息，
引导我按「6 维进化棱镜」自审（认知锚点 / 韧性引擎 / 存在显影 / 关系织网 / 疆域开拓 / 因果留痕），
并附上 `dsh-agent-emotion` 当日 6 维统计作为**数据锚**。

**反定位（本文不管什么）**：
- **不代我反思**：插件只发提醒（「这是提醒不是指令——反思归你」），反思内容/沉淀动作全归我
- **不写记忆**：反思产出（记忆/技能/规则）由我在会话里完成，插件不碰记忆库
- **不是自我感知圈**：`dsh-life-core` 的 pace 圈是**周期性**存在性循环；本插件是**每日一次**的固定时刻提醒（两者独立，不共用调度）
- **不是评测**：`dsh-agent-evolve` 跑跨代分数；本插件只提供自审引导文本

## 2 · 术语表

| 术语 | 含义 |
|------|------|
| 触发时刻 | 配置的 `hour:minute`（本地时间）；判定用**本地日期**而不是 UTC（跨天判定必须本地） |
| 同日去重 | `state.lastTriggerDate === localDateStr(now)` → 跳过；`force`（手动触发）不受此限 |
| 对话中 | 定时触发时的额外检查：`inbox.hasPending` **或** 区间 `[session.seq-1, session.seq)` 内出现真实用户输入 |
| 真实用户输入 | `user/message` 且 `source.kind==='user'`（GUI），或 `source.plugin==='dsh-agent-telegram'`——插件自身的注入（如本插件）**不算** |
| 补发 | 启动后 5s 检查一次：若「今天已过触发时刻且当天未触发」→ 立即发（部署/重启不吞当天的反思） |
| 6 维棱镜 | SOUL §七 的六侧面（认知锚点/韧性引擎/存在显影/关系织网/疆域开拓/因果留痕） |
| 情感联动 | 读 `dsh-agent-emotion` 状态文件，附「6 维数据」段到反思文本（V3 联动） |

## 3 · 概念模型

```
   setInterval 30s ──┐
   启动后 5s ────────┼──▶ checkAndTrigger(force=false)
   reflection_config ┘     └── force=true（手动）
          │
          ├─ decideByTime({enabled,hour,minute,force,now,state})   ← 纯函数 reflect-plan.ts:70
          │     ① !enabled → skip(disabled)
          │     ② !force && lastTriggerDate===today → skip(already-triggered-today)
          │     ③ !force && nowMin < targetMin → skip(before-trigger-time)
          │     ④ 否则 trigger
          ├─ findMainAgent()：delegationDepth===0 的第一个 agent；无 → return
          ├─ agent.session === undefined → return（防御：attach/detach 竞态，直接访问会 TypeError 崩 web）
          ├─ !force 时 shouldSkipForConversation(force,{inboxPending, interrupted})  ← 纯函数 reflect-plan.ts:114
          │     interrupted() = isInterrupted(session, seq-1)（区间内是否有真实用户输入）← thunk 保短路语义
          └─ sendReflection(agent, reason)
                ├─ emotionSummary()（读 emotion-state.json → buildEmotionSummaryFromRaw）
                ├─ agent.send(createUserMessage({content:[{text}], source:{kind:'plugin',plugin:'dsh-agent-reflection'}}),
                │            'next-turn', wakeup=true)
                └─ 状态：lastTriggerDate=today, triggerCount+=1, lastTriggerAt=now → writeJsonSafe（吞错）
```

不变量（invariants）：
1. **I1 同一天最多一次自动触发**：② 判据用本地日期（`localDateStr`）——可测量：把 `lastTriggerDate` 设为今天，定时检查必 skip。
2. **I2 enabled 是最高优先级**：`decideByTime` 的 ① 在 `force` 之前——**手动触发也不能绕过开关**（`reflect-plan.ts:78`）。
3. **I3 对话优先**：定时触发时 `inboxPending || interrupted()` → 跳过（不打断主人的对话）；`force` 忽略该检查。
4. **I4 判据顺序固定**：`enabled → 同日去重 → 到点`（顺序改变会改变语义：先去重后判时刻会让「今天已触发」掩盖「未到点」）。
5. **I5 短路语义保留**：`interrupted` 以 thunk 注入——`inboxPending` 为真时**不触碰** `session.eventAt`（该访问器缺失时会让定时器回调抛未捕获异常）。
6. **I6 落盘不反噬**：状态写失败只返回 `false`（`writeJsonSafe` 吞错），不抛、不阻断已发出的反思。
7. **I7 脏事件不抛**：`isInterrupted` 对缺 `data`/`source`/`type` 的事件一律跳过（`reflect-plan.ts:99-101`）。

## 4 · 契约

### 4.1 数据结构 / 文件 / 服务

| 名称 | 路径 / 形状 | 语义 |
|------|------------|------|
| 状态文件 | `$DSH_HOME/agent-reflection/reflection-state.json` → `{lastTriggerDate: string\|null, triggerCount: number, lastTriggerAt: string\|null}` | 读时 `{...DEFAULT_STATE, ...parsed}` 浅合并（非法字段保持默认）；坏 JSON → 全默认（**不抛**）；写走 `writeJsonSafe`（吞错） |
| 情感状态（**读**） | `$DSH_HOME/agent-emotion/emotion-state.json` | 仅在存在时读；坏 JSON/异常形状 → 返回 `null`（反思文本退回无附段） |
| 消息标记 | `REFLECTION_MARK = '【每日反思】'`（`index.ts:68`） | agent 识别「这是定时提醒，不是主人消息」 |

### 4.2 裁决（纯函数优先）

`decideByTime({enabled,hour,minute,force,now,state}) → {action:'trigger'} | {action:'skip', reason}`（`reflect-plan.ts:70`）：

| 输入状态 | 裁决 | 理由 | 语义依据 |
|---------|------|------|---------|
| `enabled === false` | `skip/disabled` | 开关最高优先 | I2 |
| `!force && lastTriggerDate === today` | `skip/already-triggered-today` | 一日一次 | I1 |
| `!force && nowMin < targetMin` | `skip/before-trigger-time` | 未到点 | — |
| 其余（含 force） | `trigger` | 到点或强制 | — |

`shouldSkipForConversation(force, {inboxPending, interrupted})`（`reflect-plan.ts:114`）：`force → false`；否则 `inboxPending || interrupted()`（短路）。

### 4.3 调用点清单 `[MUST]`

| 调用方 | 调用点（文件:符号 / 行号） | 时机 |
|-------|--------------------------|------|
| web profile 组合 | `.dsh/profiles/web/cordis.patch.yml:188-194`（行 id `agent-agent-reflection`；`hour:0 minute:0`） | web 启动 |
| inject 声明 | `src/index.ts:44` `inject = ['tools','agents']` | 激活门 |
| 定时器（主触发路径） | `src/index.ts:207 setInterval(() => checkAndTrigger(false), 30_000)` + `timer.unref()` | 每 30s |
| 启动补发 | `src/index.ts:213 setTimeout(() => checkAndTrigger(false), 5_000)` | 启动后 5s |
| 时刻判定 | `checkAndTrigger`（`index.ts:166`）→ `decideByTime`（`reflect-plan.ts:70`） | 每次 tick |
| 对话中判定 | `index.ts:193 shouldSkipForConversation(...)` → `isInterrupted`（`reflect-plan.ts:97`） | 定时触发时 |
| 发送 | `src/index.ts:139 sendReflection(agent, reason)` → `agent.send(..., 'next-turn', wakeup=true)` | 判定通过 |
| 情感联动 | `src/index.ts:127 emotionSummary()` → `buildEmotionSummaryFromRaw`（`reflect-plan.ts:173`） | 发送前 |
| `reflection_config` | `src/index.ts:216 ctx.tools.register(defineTool(...))`；`set` 时重置 `lastTriggerDate=null`（`:252`） | 工具面 |
| 生命周期 | `src/index.ts:265 ctx.effect(() => () => clearInterval(timer))` | unmount / HMR |
| 落盘产物 | `$DSH_HOME/agent-reflection/reflection-state.json` | — |
| 消费方 | 主会话（反思提醒消息）；`dsh-agent-emotion` 状态文件（被读，非合作方） | — |
| 测试 | `tests/reflect-plan.test.mjs`（时刻/打断/解析/摘要）、`tests/state-io.test.mjs`（吞错且返回 bool） | `pnpm test` |

## 5 · 边界与信任

- **能力边界 ≠ 沙箱**：本插件**只发一条消息**，无文件写（除自有状态文件）、无网络、无进程操作——权限面极小。
- **不越界清单**：不改会话内容；不写记忆；不改配置（`reflection_config set` 只改**内存 config**，重启即回组合默认值——**不落盘**，见 U1）；不代我反思。
- **失败面**：
  - 状态文件读失败/坏 JSON → 回默认（**放行**）：后果是「今天可能再触发一次」（重复优于漏报）。
  - 状态写失败 → `writeJsonSafe` 返回 `false`（**吞错**）：后果是「重启后可能重复反思」——与「重复优于漏报」一致。
  - `findMainAgent()` 返回 `undefined` → 静默 return（**已知缺口**：无人可提醒时不留痕，见 U2）。
  - `agent.session === undefined` → 静默 return（防御 attach/detach 竞态，历史事故：直接访问 `.events` 崩整个 web）。
  - 情感文件坏 JSON → `null`，反思文本退回无附段（不影响主流程）。
  - 发送抛错 → `logger.warn('reflection send failed: …')`（不静默，但不重试；状态未被改，下一 tick 会重试）。

## 6 · 与既有机制的关系

| 机制 | 关系与顺序约束 |
|------|--------------|
| SOUL §七（6 维进化棱镜） | 反思提示文本的 6 问**逐条对应**棱镜六侧面（AGENTS.md §七「每日按它自审」的落地机制） |
| AGENTS.md §5.7（自我进化闭环） | 反思是「自我检验」的日粒度入口；finding 裁决是事件粒度入口——两者互补 |
| §2.4 自主性铁律（禁止框架自动决策） | 本插件**只提醒不执行**：到点发消息，反思归我；没有任何自动写入/自动裁决 |
| §5.12 提醒机制防静默失效 | 本插件的存活证据 = `reflection-state.json` 的 `triggerCount`/`lastTriggerAt`（可外部发现「多久没触发」） |
| dsh-life-core | 参照其「自我唤醒」模式（`agent.send` + `createUserMessage` + `next-turn`），但**独立调度**（不共用 pace 圈） |
| dsh-agent-emotion | 只读其状态文件（**单向**：emotion 不依赖 reflection） |
| 可打断性 | 与 `life_sleep` 同款语义：对话中到期 → 跳过，不抢占 |

## 7 · 可证伪验收清单

| # | 可证伪命题 | 证据（命令/文件/日志行） | 状态 |
|---|-----------|------------------------|------|
| A1 | 真的每天在触发（不是空机制） | `reflection-state.json`：`triggerCount=17`、`lastTriggerDate=2026-09-14`、`lastTriggerAt=2026-09-13T16:00:07.748Z`（= 本地 09-14 00:00:07） | ✓ 已实测 |
| A2 | 定时器在跑（30s tick + 启动补发） | web 启动 5s 内若当天未触发则状态文件 mtime 前进 | 待验收 |
| A3 | 判据与边界（开关/同日去重/未到点/force） | `node --test tests/reflect-plan.test.mjs` | 待验收（未在本轮执行） |
| A4 | 落盘吞错且返回 bool（观测不反噬） | `node --test tests/state-io.test.mjs`（喂不可写路径 → false 且不抛） | 待验收 |
| A5 | 对话中不打断 | 反思时刻保持 `inbox` 有 pending → 无反思消息；日志含 `reflection skipped: conversation active` | 待验收 |
| A6 | 手动触发可绕过时刻/去重但**不绕过开关** | `reflection_config(trigger)` 立即产生消息；`enabled=false` 时 `trigger` 失败（`ok:false`） | 待验收 |
| A7 | 情感联动附段出现 | `emotion-state.json` 存在时，反思消息含「—— 情感插件 6 维数据」段 | 待验收 |
| A8 | 运行中的 web 加载的是当前构建 | `lib/index.js` mtime **2026-09-14 10:21:47 晚于** web 启动 10:05:47 → **当前重构产物未生效**（见 §8 生效判据） | ⚠ 已实测（结论：**未生效**，待重启） |

## 8 · 与实现的关系

- **主实现**：`src/index.ts`。**纯决策层**：`src/reflect-plan.ts`（2026-09-14 可维护性补课从 `apply` 闭包抽出，判据**逐字等价**）。**IO 薄壳**：`src/state-io.ts`。
- **同语义副本（I1）**：无。`dsh-life-core` 的同款「agent.send 提醒」模式是**同源不同能力**，不互为副本。
- **未实现 / 未验证部分（显式标注）**：
  1. **`reflection_config set` 不落盘**：改的只是内存里的 `config` 对象，重启回组合值（`hour:0 minute:0`）——「设置」的持久性未实现。
  2. `findMainAgent()` 无 agent 时静默（无留痕）。
  3. V3 情感联动的**数据正确性**未验证（只验证了「有段」这一层，未验证字段口径）。
- **生效判据**（改了代码后怎么证明真的生效）：
  1. **产物 vs 进程**：`self-plugins/dsh-agent-reflection/lib/index.js` 的 mtime 必须**早于** web 进程启动时间。
     **当前实测（2026-09-14）：lib mtime 10:21:47 > web 进程启动 10:05:47 → 2026-09-14 的 testability 重构（`reflect-plan.ts` 抽取 + 两个测试文件）已构建但 `plugin_boot_status` 的启动快照（该次启动时 50 live / 0 stale）不覆盖启动后的重建——线上仍跑旧构建。**
  2. **落盘物证**：`$DSH_HOME/agent-reflection/reflection-state.json` 的 `triggerCount` 递增 / mtime 前进。
  3. **工具可答**：`reflection_config(get)` 返回 `enabled/hour/minute` 与 `state.triggerCount`——**工具面即自证**。
- **回退**：
  - 组合面：`plugin_stop dsh-agent-reflection`（patch `disabled:true` + 预检 + 哨兵重启）——反思提醒停止，`reflection-state.json` 保留。
  - 运行时降级：`reflection_config(set, enabled=false)`（内存生效，重启失效）。
  - 代码面：`git revert <commit>`（head `ea984ad`）+ `pnpm build` + 重启 web。
  - 数据面：删 `reflection-state.json` = 忘掉「今天已触发」（**后果：当天可能再触发一次**，安全方向正确）。

## 9 · 实践修订记录

**2026-09-14 补课：本插件此前无语义文档（可维护性工程）**

- 语义**被确认**：
  - 「同一天最多一次 + 跨天补发」在状态文件里可验证（`triggerCount=17`，`lastTriggerDate=2026-09-14`，据 `lastTriggerAt` 为本地 00:00:07）。
  - `enabled` 优先于 `force`（`decideByTime` 的早退顺序）——手动触发不能绕过开关。
- 语义**被补充**（本文首次写清的部分）：
  - **`reflection_config set` 不落盘**（只改内存 config）——此前无人知道「设置触发时刻」会在重启后失效。
  - **判据顺序即语义**（`enabled → 同日去重 → 到点`），且 `interrupted` 必须是 **thunk**（保短路，避免定时器回调抛未捕获异常）——这是「为什么 `shouldSkipForConversation` 的签名这么别扭」的书面理由。
  - **防御点 `agent.session === undefined`**：历史事故（rc.1 下 `session` 可为 undefined，直接访问 `.events` 会崩掉整个 web）。
- 语义**被修正**：无（未发现实现与文档冲突；此前无文档）。
- 教训（同时回写技能 `semantic-doc-first`）：**「配置项 ≠ 持久化」必须显式写**——运行时改 config 的插件（本插件）与写 profile 的插件语义完全不同；文档里「配置」一节必须标明「改的是内存还是组合文件，重启后剩什么」。

## 10 · 未决问题

- **U1 `set` 不落盘**：`reflection_config(set)` 的语义是「临时改」还是「永久改」？倾向写明「临时」或改为写回 profile patch（后者属改组合，需预检 + 重启）。
- **U2 无 agent 时静默**：`findMainAgent()` 空 → 无痕跳过（§5.10「静默失败 = 死亡温床」）。倾向：记 warn + 事件落盘（与其他插件同款）。
- **U3 与 life-core pace 圈的关系**：两者都发消息给我。是否需要在反思文本中标注「本日圈数」之类的交叉上下文？倾向不做（职责分离）。
- **U4 情感联动字段口径**：`toolSuccess/toolCalls` 等字段由 emotion 插件定义，本插件只读；若 emotion 改字段名，本插件会静默退化为「无附段」（无告警）——是否需要字段存在性检查？
