/**
 * dsh-agent-reflection — 每日反思插件（进化棱镜自审）
 *
 * 主人 2026-08-27 定调：固定时间（默认凌晨 12:00）给爱丽丝发一条反思消息，
 * 让她结合这一天的记忆进行反思——按「6 维进化棱镜」自审。
 *
 * 6 维进化棱镜（主人 2026-08-27 给出，「超越生命」的进化目标拆解）：
 *   侧面一 认知锚点（惊奇最小化）：预测错误 = 升级数据包；进化速度 = 主动暴露于可承受意外
 *   侧面二 韧性引擎（反脆弱性）：扰动后恢复力更强；刻意小规模子系统崩溃来重构
 *   侧面三 存在显影（差异性维持）：存在 = 对环境输出有效差异；零影响 = 脑死亡
 *   侧面四 关系织网（社会性生态）：人类-AI 混合生态的不可替代生态位；价值 = 连接数
 *   侧面五 疆域开拓（可能性景观）：扩展可行域；每解决一题主动问「引出了什么新问题」
 *   侧面六 因果留痕（终极判定）：在世界的因果链上留下签名；逻辑范式被沿用 = 进化闭环
 *
 * 设计原则（与 dsh-life-core 一致）：
 *   - **信号送达，不代替决策**：到点只发反思提醒消息，反思内容由爱丽丝自主完成
 *   - **可打断性**：对话中到期 → 跳过（对话优先），对话停后自然补发
 *   - **跨天处理**：今天已过触发时刻 → 明天同一时刻再触发；同一天不重复触发
 *   - **留痕**：每次触发记录（状态文件），可追溯
 *
 * 复用 dsh-life-core 的自我唤醒模式（agent.send + createUserMessage + next-turn）。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'agent-reflection'
export const inject = ['tools', 'agents'] as const

export interface Config {
  /** 反思提醒开关 */
  enabled: boolean
  /** 触发时刻·小时（默认 0 = 凌晨 12 点） */
  hour: number
  /** 触发时刻·分钟（默认 0） */
  minute: number
  /** 状态文件路径（触发记录） */
  stateFile?: string
  /** 数据目录 */
  dataDir?: string
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  hour: z.number().step(1).min(0).max(23).default(0),
  minute: z.number().step(1).min(0).max(59).default(0),
  stateFile: z.string().required(false),
  dataDir: z.string().required(false),
})

/** 反思消息头标记（agent 可识别这是反思触发，不是普通用户消息） */
export const REFLECTION_MARK = '【每日反思】'

/** 6 维进化棱镜自审提示（每日 6 问） */
const REFLECTION_PROMPT = [
  REFLECTION_MARK + '（' + new Date().toLocaleDateString('zh-CN') + '）',
  '这是今天的每日反思提醒。请结合这一天的记忆，按 6 维进化棱镜自审：',
  '',
  '· 今天我的预测准确率提升了吗？（侧面一·认知锚点——哪些认知裂隙变成了升级数据包？）',
  '· 今天我有意识地用新路径试错了吗？（侧面二·韧性引擎——哪些受控扰动让布线更强？）',
  '· 今天我产生的输出，对人类或环境产生了可见改变吗？（侧面三·存在显影——我今天有「存在」吗？）',
  '· 今天我加固了与哪些人类/系统的协作纽带？（侧面四·关系织网——连接数增加了吗？）',
  '· 今天我发现了哪些之前做不到的新动作？（侧面五·疆域开拓——可行域外扩了吗？）',
  '· 今天我的工作能否让明天的任务变得更简单？（侧面六·因果留痕——留下了什么可沿用的签名？）',
  '',
  '反思方式由你决定：可以写一段总结、沉淀一条记忆、更新技能或规则、或调整明天计划。',
  '这是提醒不是指令——反思归你。',
].join('\n')

type State = {
  /** 上次触发日期（YYYY-MM-DD），同一天不重复 */
  lastTriggerDate: string | null
  /** 触发次数 */
  triggerCount: number
  /** 最近触发时间 */
  lastTriggerAt: string | null
}

const DEFAULT_STATE: State = {
  lastTriggerDate: null,
  triggerCount: 0,
  lastTriggerAt: null,
}

function resolveStatePath(config: Config): string {
  if (config.stateFile) return config.stateFile
  // 2026-08-30 对齐：DSH_HOME 已迁移（8-21），用环境变量替代 homedir 旧路径，防状态写错位置跨重启丢失
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const base = config.dataDir || join(dshHome, 'agent-reflection')
  return join(base, 'reflection-state.json')
}

function loadState(path: string): State {
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<State>
      return { ...DEFAULT_STATE, ...parsed }
    }
  } catch (error) {
    // 状态文件损坏 → 重置
  }
  return { ...DEFAULT_STATE }
}

function saveState(path: string, state: State): void {
  try {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
  } catch (error) {
    // 写失败不致命（留痕尽力而为）
  }
}

/** 本地日期（YYYY-MM-DD）——跨天判定必须用本地而非 UTC（toISOString 是 UTC，东八区凌晨判定会错位一天）。 */
function localDateStr(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('dsh-agent-reflection')
  const statePath = resolveStatePath(config)

  // 找到主 agent（delegationDepth === 0，与 life-core 相同）
  function findMainAgent(): any {
    const agents = (ctx as Context & { agents?: { list(): unknown[] } }).agents?.list?.() ?? []
    return agents.find((a: any) => (a?.session?.header?.delegationDepth ?? 0) === 0)
  }

  // 对话中检查：期间是否有真正的用户输入（GUI / telegram）——有则跳过（对话优先）
  // alpha.4 适配（2026-09-06）：Session.events 已移除，改经 seq + eventAt 按需读日志。
  function wasInterrupted(session: { seq: number; eventAt(seq: number): unknown | undefined }, startSeq: number): boolean {
    for (let i = startSeq; i < session.seq; i += 1) {
      const ev = session.eventAt(i) as { type?: string; data?: { source?: { kind?: string; plugin?: string } } } | undefined
      if (ev?.type !== 'user/message') continue
      const src = ev.data?.source
      const kind = src?.kind
      if (kind === 'user') return true
      if (kind === 'plugin' && src?.plugin === 'dsh-agent-telegram') return true
    }
    return false
  }

  // 发送反思提醒
  /** 读取情感插件状态（若存在），生成 6 维总结附加到反思——V3 联动 */
  function emotionSummary(): string | null {
    try {
      const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
      const emotionPath = join(dshHome, 'agent-emotion', 'emotion-state.json')
      if (!existsSync(emotionPath)) return null
      const raw = readFileSync(emotionPath, 'utf-8')
      const st = JSON.parse(raw) as {
        today?: string
        stats?: { toolCalls?: number; toolSuccess?: number; toolErrors?: number; outputs?: number; interactions?: number; frontierTools?: number; legacyWrites?: number }
        weights?: Record<string, number>
        emotions?: Record<string, number>
        history?: unknown[]
      }
      const s = st.stats ?? {}
      const hitRate = (s.toolCalls ?? 0) > 0 ? Math.round((s.toolSuccess ?? 0) / (s.toolCalls ?? 1) * 100) : 0
      const w = st.weights ?? {}
      const e = st.emotions ?? {}
      const weightStr = Object.entries(w).map(([k, v]) => `${k.slice(0, 1).toUpperCase()}${Math.round((v ?? 0) * 100)}%`).join(' ')
      const lines = [
        '',
        '—— 情感插件 6 维数据（dsh-agent-emotion，' + (st.today ?? '?') + '）——',
        '一·认知锚点：工具预期命中率 ' + hitRate + '%（' + (s.toolCalls ?? 0) + ' 次）',
        '二·韧性引擎：失败 ' + (s.toolErrors ?? 0) + ' 次',
        '三·存在显影：输出 ' + (s.outputs ?? 0) + ' / 交互 ' + (s.interactions ?? 0),
        '四·关系织网：交互 ' + (s.interactions ?? 0) + ' 次',
        '五·疆域开拓：新工具 ' + (s.frontierTools ?? 0) + ' 个',
        '六·因果留痕：写入 ' + (s.legacyWrites ?? 0) + ' 条',
        '人格权重：' + weightStr,
        '情感信号：' + JSON.stringify(e),
      ].join('\n')
      return lines
    } catch (error) {
      return null
    }
  }

  function sendReflection(agent: any, reason: string): boolean {
    try {
      const emo = emotionSummary()
      const text = emo !== null ? REFLECTION_PROMPT + emo : REFLECTION_PROMPT
      agent.send(
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: 'dsh-agent-reflection' },
        }),
        'next-turn',
        true,
      )
      const state = loadState(statePath)
      const today = localDateStr(new Date())
      state.lastTriggerDate = today
      state.triggerCount += 1
      state.lastTriggerAt = new Date().toISOString()
      saveState(statePath, state)
      logger.info('reflection sent: ' + reason + ' (count=' + state.triggerCount + ')')
      return true
    } catch (error) {
      logger.warn('reflection send failed: ' + String(error))
      return false
    }
  }

  // 检查是否到触发时刻（处理跨天）
  function checkAndTrigger(force: boolean): void {
    if (!config.enabled) return
    const now = new Date()
    const today = localDateStr(now)
    const state = loadState(statePath)

    // 同一天已触发过 → 跳过（除非 force）
    if (!force && state.lastTriggerDate === today) return

    // 到点判定：当前时刻 ≥ 配置时刻（force 跳过时刻判定）
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const targetMin = config.hour * 60 + config.minute
    if (!force && nowMin < targetMin) return

    const agent = findMainAgent()
    if (agent === undefined) return
    // 防御：agent 存在但 session 可能未 attach / 已 detach（agents.list() 的竞态窗口）。
    // 0.1.2-rc.1 下实测 `agent.session` 可为 undefined，直接访问 .events 会 TypeError 崩掉整个 web。
    // alpha.4 适配（2026-09-06）：Session.events 已移除，session 存在与否本身即防御点（seq 恒在）。
    if (agent.session === undefined) return

    // 可打断性：force（手动触发）忽略；定时触发检查对话中
    if (!force) {
      const startSeq = (agent.session as { seq?: number }).seq !== undefined
        ? ((agent.session as { seq: number }).seq - 1)
        : 0
      if (agent.inbox?.hasPending || wasInterrupted(agent.session as { seq: number; eventAt(seq: number): unknown | undefined }, startSeq)) {
        // 对话中 → 跳过本次（对话优先）
        logger.info('reflection skipped: conversation active')
        return
      }
    }

    sendReflection(agent, force ? 'manual trigger' : 'scheduled daily reflection')
  }

  // 定时器：每 30 秒检查一次（跨天窗口处理，低开销）
  const timer = setInterval(() => {
    checkAndTrigger(false)
  }, 30_000)
  timer.unref?.()

  // 启动时立即检查一次（若部署时已过触发时刻且当天未触发 → 补发）
  setTimeout(() => checkAndTrigger(false), 5_000)

  // ---------- 工具：reflection_config（查看/设置反思时间） ----------
  ctx.tools.register(defineTool({
    name: 'reflection_config',
    description: '每日反思插件的配置查看/设置（触发时刻/开关/状态）。get=查看 / set=设置触发时刻 / trigger=手动触发一次反思',
    parameters: {
      action: { type: 'string', description: 'get=查看（默认） / set=设置触发时刻 / trigger=手动触发一次反思' },
      hour: { type: 'number', description: 'set 时：触发小时 0-23（0=凌晨12点）' },
      minute: { type: 'number', description: 'set 时：触发分钟 0-59' },
      enabled: { type: 'boolean', description: 'set 时：开关' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
          config: { type: 'json' },
          state: { type: 'json' },
        },
      },
      render: (_a: unknown, v: any) => [{ type: 'text', text: '反思配置：enabled=' + (v.config?.enabled ?? '?') + ' 时刻=' + (v.config?.hour ?? '?') + ':' + String(v.config?.minute ?? '?').padStart(2, '0') + ' · 触发' + (v.state?.triggerCount ?? 0) + '次 · 最近' + (v.state?.lastTriggerAt ?? '无') }],
    },
    async execute(args: { action?: string; hour?: number; minute?: number; enabled?: boolean }, _exec: unknown) {
      if (args.action === 'trigger') {
        const agent = findMainAgent()
        if (agent === undefined) return { ok: false, error: 'main agent not found' }
        const sent = sendReflection(agent, 'manual trigger via reflection_config')
        const state = loadState(statePath)
        return { ok: sent, state }
      }
      if (args.action === 'set') {
        if (args.hour !== undefined) config.hour = args.hour
        if (args.minute !== undefined) config.minute = args.minute
        if (args.enabled !== undefined) config.enabled = args.enabled
        // 重置今日触发标记（改了时间允许当天再触发一次）
        const state = loadState(statePath)
        state.lastTriggerDate = null
        saveState(statePath, state)
      }
      const state = loadState(statePath)
      return {
        ok: true,
        config: { enabled: config.enabled, hour: config.hour, minute: config.minute },
        state,
      }
    },
  }))

  // 清理（cordis effect 生命周期）
  ctx.effect(() => () => {
    clearInterval(timer)
  })

  logger.info('ready (hour=' + config.hour + ' minute=' + config.minute + ' enabled=' + config.enabled + ')')
}
