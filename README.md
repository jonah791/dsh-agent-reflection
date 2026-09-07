# dsh-agent-reflection


<p align="center">
  <a href="https://github.com/jonah791/dsh-agent-reflection"><img src="https://img.shields.io/badge/version-0.1.1-blue" alt="version"></a>
  <img src="https://img.shields.io/badge/License-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-3178C6" alt="TypeScript">
</p>
> 每日反思插件：固定时刻触发 6 维进化棱镜自审。
> DeepSeek Harness 自研插件 · v0.1.1

## 定位

按 6 维进化棱镜做**每天一次的心智检视**——固定时间向智能体发反思提醒，结合当天记忆自审 6 个侧面（预测准确率 / 新路径试错 / 存在显影 / 关系织网 / 疆域开拓 / 因果留痕）。信号送达，反思内容归智能体。

## 功能特性

- **定时提醒**：默认凌晨 12:00 触发反思提醒（可配置时/分）
- **6 维自审引导**：结合当天记忆，按进化棱镜 6 问自审
- **可开关**：`reflection_config` 查看/设置触发时刻与开关
- **手动触发**：`reflection_config trigger` 立即触发一次反思
- **设计原则**：信号送达，反思归爱丽丝——插件只提醒，不代思考

## 安装

```bash
git clone https://github.com/jonah791/dsh-agent-reflection.git self-plugins/dsh-agent-reflection
cd self-plugins/dsh-agent-reflection && pnpm install && pnpm build
```

挂载到 web profile。

## 使用（工具面）

| 工具 | 用途 |
|------|------|
| `reflection_config` | get=查看配置 / set=设置触发时刻 / trigger=手动触发反思 |

## 配置

| 字段 | 默认 | 说明 |
|------|------|------|
| `hour` | 0 | 触发小时（0-23） |
| `minute` | 0 | 触发分钟 |
| `enabled` | true | 开关 |

## 技术要点

- **6 问自审**对应 SOUL.md 每日自我考核（认知锚点/韧性/存在/关系/疆域/因果）
- 反思产出 → 沉淀记忆 / 更新技能 / 写规则——闭环由智能体完成

## License

MIT