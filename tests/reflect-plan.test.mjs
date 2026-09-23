/**
 * tests/reflect-plan.test.mjs — 每日反思纯决策层的回归测试（跑 lib 产物，与运行时同源）。
 *
 * 覆盖：主路径（真实常数）／边界（等于触发时刻即触发）／退化与失败路径（脏数据、缺失字段、
 * 空输入必须**不抛**且行为保守）／短路语义（对话中判定的 thunk 不得被提前调用）。
 * 跑法：node --test tests/reflect-plan.test.mjs（先 tsc -p tsconfig.json 构建）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_STATE,
  buildEmotionSummary,
  buildEmotionSummaryFromRaw,
  computeHitRate,
  decideByTime,
  isInterrupted,
  localDateStr,
  parseState,
  pickSnapshot,
  buildReflectionPrompt,
  toTitleDate,
  shouldSkipForConversation,
} from '../lib/reflect-plan.js'

const at = (h, m, s = 0) => new Date(2026, 8, 14, h, m, s) // 本地时间 2026-09-14（月 0 基）

// ── 主路径：真实常数 ────────────────────────────────────────────────
test('localDateStr: 用本地时间而非 UTC（东八区凌晨不错位一天）', () => {
  assert.equal(localDateStr(new Date(2026, 0, 1, 0, 30)), '2026-01-01')
  assert.equal(localDateStr(new Date(2026, 8, 14, 23, 59)), '2026-09-14')
  assert.equal(localDateStr(new Date(2026, 11, 31, 12, 0)), '2026-12-31')
})

test('decideByTime: 到点即触发（时刻相等算到点）', () => {
  const v = decideByTime({ enabled: true, hour: 0, minute: 0, force: false, now: at(0, 0), state: { ...DEFAULT_STATE } })
  assert.equal(v.action, 'trigger')
  const edge = decideByTime({ enabled: true, hour: 23, minute: 59, force: false, now: at(23, 59), state: { ...DEFAULT_STATE } })
  assert.equal(edge.action, 'trigger') // nowMin === targetMin → 触发（判据是 < 才跳过）
})

test('decideByTime: 同日已触发 → 跳过（不重复反思）', () => {
  const v = decideByTime({
    enabled: true, hour: 0, minute: 0, force: false, now: at(9, 0),
    state: { lastTriggerDate: '2026-09-14', triggerCount: 1, lastTriggerAt: '2026-09-14T00:00:01.000Z' },
  })
  assert.deepEqual(v, { action: 'skip', reason: 'already-triggered-today' })
})

test('decideByTime: 昨天触发过 → 今天照常触发（跨天）', () => {
  const v = decideByTime({
    enabled: true, hour: 0, minute: 0, force: false, now: at(0, 1),
    state: { lastTriggerDate: '2026-09-13', triggerCount: 3, lastTriggerAt: '2026-09-13T00:00:01.000Z' },
  })
  assert.equal(v.action, 'trigger')
})

test('decideByTime: 手动触发（force）跳过时刻与同日去重', () => {
  const v = decideByTime({
    enabled: true, hour: 23, minute: 59, force: true, now: at(0, 1),
    state: { lastTriggerDate: '2026-09-14', triggerCount: 1, lastTriggerAt: null },
  })
  assert.equal(v.action, 'trigger')
})

test('buildEmotionSummary: 6 维正文与真实计数逐字对齐', () => {
  const text = buildEmotionSummary({
    today: '2026-09-14',
    stats: { toolCalls: 100, toolSuccess: 87, toolErrors: 13, outputs: 5, interactions: 9, frontierTools: 2, legacyWrites: 3 },
    weights: { service: 0.4, growth: 0.35 },
    emotions: { joy: 0.5 },
  })
  assert.ok(text.includes('—— 情感插件 6 维数据（dsh-agent-emotion，2026-09-14）——'))
  assert.ok(text.includes('一·认知锚点：工具预期命中率 87%（100 次）'))
  assert.ok(text.includes('二·韧性引擎：失败 13 次'))
  assert.ok(text.includes('三·存在显影：输出 5 / 交互 9'))
  assert.ok(text.includes('四·关系织网：交互 9 次'))
  assert.ok(text.includes('五·疆域开拓：新工具 2 个'))
  assert.ok(text.includes('六·因果留痕：写入 3 条'))
  assert.ok(text.includes('人格权重：S40% G35%'))
  assert.ok(text.includes('情感信号：{"joy":0.5}'))
})

// ── 日界错位修复（t-d9497d70 · 2026-09-22）────────────────────────
// 事故复刻：反思在 09-22 00:00 触发，emotion state 的 today/stats 已翻页为 09-22（全零），
// 而 09-21 的完整快照躺在 history 里。原实现取 st.stats ⇒ 报「昨天几乎没干活」。
const CROSS_DAY_STATE = {
  today: '2026-09-22',
  stats: { toolCalls: 0, toolSuccess: 0, toolErrors: 0, outputs: 0, interactions: 0, frontierTools: 0, legacyWrites: 0 },
  weights: { legacy: 0.2 },
  emotions: {},
  history: [
    { date: '2026-09-20', stats: { toolCalls: 1556, outputs: 1251, interactions: 282, legacyWrites: 414, toolErrors: 27 } },
    { date: '2026-09-21', stats: { toolCalls: 443, outputs: 330, interactions: 137, legacyWrites: 124, toolErrors: 14 }, weights: { legacy: 0.9 }, emotions: { legacy: 0.1 } },
  ],
}

test('尸体测试 · 跨零点反思取「已完结日」快照而非次日零值（真实事故样本）', () => {
  const text = buildEmotionSummary(CROSS_DAY_STATE)
  assert.ok(text.includes('—— 情感插件 6 维数据（dsh-agent-emotion，2026-09-21）——'), '标注日期应为已完结日')
  assert.ok(!text.includes('2026-09-22'), '不得再出现次日日期')
  assert.ok(text.includes('工具预期命中率 0%（443 次）'), '应取 09-21 的 443 次（toolSuccess 缺 ⇒ 命中率 0，保守）')
  assert.ok(text.includes('三·存在显影：输出 330 / 交互 137'))
  assert.ok(text.includes('六·因果留痕：写入 124 条'))
  assert.ok(text.includes('二·韧性引擎：失败 14 次'))
  assert.ok(text.includes('人格权重：L90%'), '权重同样取快照，不与当日混用')
  assert.ok(text.includes('情感信号：{"legacy":0.1}'))
})

test('pickSnapshot: 未给 forDate ⇒ 取 date < today 的最新一条（不假设数组已排序）', () => {
  const shuffled = { today: '2026-09-22', stats: { toolCalls: 1 }, history: [
    { date: '2026-09-21', stats: { toolCalls: 443 } },
    { date: '2026-09-11', stats: { toolCalls: 991 } },
    { date: '2026-09-20', stats: { toolCalls: 1556 } },
  ] }
  const p = pickSnapshot(shuffled)
  assert.equal(p.source, 'history')
  assert.equal(p.date, '2026-09-21')
  assert.equal(p.stats.toolCalls, 443)
})

test('pickSnapshot: 显式 forDate ⇒ 精确命中；未命中回落当日（保守）', () => {
  const p = pickSnapshot(CROSS_DAY_STATE, '2026-09-20')
  assert.equal(p.date, '2026-09-20')
  assert.equal(p.stats.toolCalls, 1556)
  const miss = pickSnapshot(CROSS_DAY_STATE, '2026-01-01')
  assert.equal(miss.source, 'today')
  assert.equal(miss.date, '2026-09-22')
  assert.equal(miss.stats.toolCalls, 0)
})

test('pickSnapshot: 无 history / today 缺失 / 脏项 ⇒ 一律回落当日且不抛', () => {
  const noHist = pickSnapshot({ today: '2026-09-22', stats: { toolCalls: 7 } })
  assert.equal(noHist.source, 'today')
  assert.equal(noHist.stats.toolCalls, 7)
  // today 缺失 ⇒ 无从判「更早」，保守用当日
  assert.equal(pickSnapshot({ history: [{ date: '2026-09-21', stats: { toolCalls: 443 } }] }).source, 'today')
  // 脏 history：null 项 / 标量 / 数组 / 缺 date / 非数组
  const dirty = { today: '2026-09-22', stats: { toolCalls: 2 }, history: [null, 42, [], { stats: {} }, 'x'] }
  const p = pickSnapshot(dirty)
  assert.equal(p.source, 'today')
  assert.equal(p.stats.toolCalls, 2)
  assert.equal(pickSnapshot({ today: '2026-09-22', history: 'not-an-array' }).source, 'today')
})

test('buildEmotionSummaryFromRaw: forDate 可透传（跨包读原始文件的调用路径）', () => {
  const raw = JSON.stringify(CROSS_DAY_STATE)
  assert.ok(buildEmotionSummaryFromRaw(raw).includes('2026-09-21'))
  assert.ok(buildEmotionSummaryFromRaw(raw, '2026-09-20').includes('2026-09-20'))
})

test('computeHitRate: 真实比值四舍五入（1/3 → 33）', () => {
  assert.equal(computeHitRate({ toolCalls: 100, toolSuccess: 87 }), 87)
  assert.equal(computeHitRate({ toolCalls: 3, toolSuccess: 1 }), 33)
})

// ── 退化/失败路径：不抛 + 保守 ──────────────────────────────────────
test('computeHitRate: 零调用/缺字段 → 0（保守，不返回 NaN/Infinity）', () => {
  assert.equal(computeHitRate({ toolCalls: 0, toolSuccess: 0 }), 0)
  assert.equal(computeHitRate({ toolCalls: 5 }), 0)
  assert.equal(computeHitRate(undefined), 0)
  assert.equal(computeHitRate({}), 0)
})

test('buildEmotionSummary: 空状态不抛，全字段保守补零', () => {
  const text = buildEmotionSummary({})
  assert.ok(text.includes('（dsh-agent-emotion，?）'))
  assert.ok(text.includes('工具预期命中率 0%（0 次）'))
  assert.ok(text.includes('人格权重：'))
  assert.ok(text.includes('情感信号：{}'))
})

test('buildEmotionSummaryFromRaw: 坏 JSON / JSON null / 空串 → 返回 null 不抛（退化路径）', () => {
  assert.equal(buildEmotionSummaryFromRaw('{ 半截'), null)
  assert.equal(buildEmotionSummaryFromRaw(''), null)
  assert.equal(buildEmotionSummaryFromRaw('null'), null) // 合法 JSON 但形状为空 → 保守降级
  // 数字/标量形状（合法 JSON 但非对象）：与原实现同语义——补零正文，不抛
  assert.ok(buildEmotionSummaryFromRaw('123').includes('工具预期命中率 0%（0 次）'))
})

test('buildEmotionSummaryFromRaw: 正常 JSON → 正文（主路径）', () => {
  const text = buildEmotionSummaryFromRaw(JSON.stringify({ today: '2026-09-14', stats: { toolCalls: 4, toolSuccess: 4 } }))
  assert.ok(typeof text === 'string' && text.includes('工具预期命中率 100%（4 次）'))
})

test('parseState: 空/坏 JSON/形状异常 → 回落到默认值（保守，不抛）', () => {
  assert.deepEqual(parseState(null), { ...DEFAULT_STATE })
  assert.deepEqual(parseState(undefined), { ...DEFAULT_STATE })
  assert.deepEqual(parseState('{ 半截 json'), { ...DEFAULT_STATE })
  const weird = parseState('"abc"')
  assert.equal(weird.lastTriggerDate, null)
  assert.equal(weird.triggerCount, 0)
  assert.equal(weird.lastTriggerAt, null)
})

test('parseState: 部分字段缺失 → 缺的补默认，有的保留（不污染）', () => {
  const s = parseState('{"triggerCount":5}')
  assert.equal(s.triggerCount, 5)
  assert.equal(s.lastTriggerDate, null)
  assert.equal(s.lastTriggerAt, null)
})

test('decideByTime: 关闭开关时 force 也不触发（开关优先于手动）', () => {
  const v = decideByTime({ enabled: false, hour: 0, minute: 0, force: true, now: at(12, 0), state: { ...DEFAULT_STATE } })
  assert.deepEqual(v, { action: 'skip', reason: 'disabled' })
})

test('decideByTime: 未到点/边界前一分钟 → 跳过（保守不触发）', () => {
  const before = decideByTime({ enabled: true, hour: 23, minute: 59, force: false, now: at(23, 58), state: { ...DEFAULT_STATE } })
  assert.deepEqual(before, { action: 'skip', reason: 'before-trigger-time' })
  const midnight = decideByTime({ enabled: true, hour: 23, minute: 59, force: false, now: at(0, 0), state: { ...DEFAULT_STATE } })
  assert.equal(midnight.action, 'skip')
})

test('isInterrupted: 用户消息/telegram 插件消息算打断，其他插件消息不算', () => {
  const s1 = { seq: 3, eventAt: (i) => [{ type: 'user/message', data: { source: { kind: 'dsh-agent-memory' } } }, { type: 'tool/result', data: {} }, { type: 'user/message', data: { source: { kind: 'user' } } }][i] }
  assert.equal(isInterrupted(s1, 0), true)
  // 0.1.7：生产者按自身 kind 声明来源（dsh-agent-telegram 现发 kind:'dsh-agent-telegram'）
  const s2 = { seq: 2, eventAt: (i) => [{ type: 'assistant/message', data: {} }, { type: 'user/message', data: { source: { kind: 'dsh-agent-telegram' } } }][i] }
  assert.equal(isInterrupted(s2, 0), true)
  const s3 = { seq: 1, eventAt: () => ({ type: 'user/message', data: { source: { kind: 'dsh-life-core' } } }) }
  assert.equal(isInterrupted(s3, 0), false)
})

test('尸体样本：v3 形状（kind=plugin + plugin=dsh-agent-telegram）**不**算打断——0.1.7 已移除该 source 形状', () => {
  const v3 = { seq: 1, eventAt: () => ({ type: 'user/message', data: { source: { kind: 'plugin', plugin: 'dsh-agent-telegram' } } }) }
  assert.equal(isInterrupted(v3, 0), false)
})

test('isInterrupted: 脏事件（undefined/缺 data/缺 source/空会话）不抛且保守判「未打断」', () => {
  const dirty = { seq: 4, eventAt: (i) => [undefined, {}, { type: 'user/message' }, { type: 'user/message', data: {} }][i] }
  assert.equal(isInterrupted(dirty, 0), false)
  assert.equal(isInterrupted({ seq: 0, eventAt: () => undefined }, 0), false)
  assert.equal(isInterrupted({ seq: 3, eventAt: (i) => [null, { type: 'user/message', data: { source: null } }, []][i] }, 0), false)
})

test('isInterrupted: 只算窗口 [startSeq, seq) 内的事件', () => {
  const s = { seq: 5, eventAt: (i) => (i < 3 ? { type: 'user/message', data: { source: { kind: 'user' } } } : undefined) }
  assert.equal(isInterrupted(s, 0), true)
  assert.equal(isInterrupted(s, 3), false) // 早于窗口的用户消息不算
})

// ── 标题日期与数据同源（t-d9497d70 第二处 · 2026-09-22）────────────
const R_MARK = '【每日反思】'

test('尸体测试 · 标题日期取「被反思的那一天」，不是模块加载日/发送日', () => {
  // 事故样本：web 在 09-21 启动、09-22 才发反思。原实现把 `new Date()` 写在**模块级常量**里
  // ⇒ 日期在模块加载那一刻冻结 ⇒ 标题写 09-21（启动日），数据块写 09-22——两处各说各话。
  const p = buildReflectionPrompt(R_MARK, '2026-09-21', new Date(2026, 8, 22, 0, 1))
  assert.ok(p.startsWith('【每日反思】（2026/9/21）'), '标题应取被反思日')
  assert.ok(!p.includes('（2026/9/22）'), '不得取发送日')
})

test('toTitleDate: YYYY-MM-DD → YYYY/M/D（月日不补零）；异常输入回落本地日期', () => {
  assert.equal(toTitleDate('2026-09-21'), '2026/9/21')
  assert.equal(toTitleDate('2026-01-05'), '2026/1/5')
  const fallback = new Date(2026, 8, 22).toLocaleDateString('zh-CN')
  assert.equal(toTitleDate(undefined, new Date(2026, 8, 22)), fallback, '缺失 ⇒ 回落')
  assert.equal(toTitleDate('not-a-date', new Date(2026, 8, 22)), fallback, '非日期串 ⇒ 回落')
  assert.equal(toTitleDate('2026-9-21', new Date(2026, 8, 22)), fallback, '形状严格：不补零的输入不被接受')
})

test('buildReflectionPrompt: 6 问与说明逐字保留（重构不得让正文漂移）', () => {
  const p = buildReflectionPrompt(R_MARK, '2026-09-21')
  assert.ok(p.includes('这是今天的每日反思提醒。请结合这一天的记忆，按 6 维进化棱镜自审：'))
  assert.ok(p.includes('侧面一·认知锚点') && p.includes('侧面六·因果留痕'))
  assert.ok(p.includes('反思方式由你决定'))
  assert.ok(p.includes('这是提醒不是指令——反思归你。'))
  assert.equal(p.split('\n').length, 12, '正文行数固定：标题1 + 引言1 + 空1 + 6问 + 空1 + 说明2')
})

test('标题与 6 维块同源：同一个 pickSnapshot.date 喂两者 ⇒ 日期一致', () => {
  const date = pickSnapshot(CROSS_DAY_STATE).date
  assert.equal(date, '2026-09-21')
  assert.ok(buildReflectionPrompt(R_MARK, date).includes('（2026/9/21）'))
  assert.ok(buildEmotionSummary(CROSS_DAY_STATE).includes('（dsh-agent-emotion，2026-09-21）'))
})

test('shouldSkipForConversation: 短路——inbox 有 pending 时不触碰会话访问器（不抛）', () => {
  let touched = false
  const skip = shouldSkipForConversation(false, {
    inboxPending: true,
    interrupted: () => { touched = true; throw new Error('不该被调用') },
  })
  assert.equal(skip, true)
  assert.equal(touched, false) // 原实现的 || 短路语义被保留（防定时器回调内未捕获异常）
})

test('shouldSkipForConversation: force 忽略打断；无 pending 时按 interrupted 判', () => {
  assert.equal(shouldSkipForConversation(true, { inboxPending: true, interrupted: () => true }), false)
  assert.equal(shouldSkipForConversation(false, { inboxPending: false, interrupted: () => true }), true)
  assert.equal(shouldSkipForConversation(false, { inboxPending: false, interrupted: () => false }), false)
})
