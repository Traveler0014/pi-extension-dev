---
name: pi-extension-dev
description: Develop extensions (plugins) for the pi coding agent — LLM-facing tools, user slash commands, model providers, and skills. Use when creating or modifying a pi extension, designing tool parameters and result contracts, writing extension tests, or packaging a repository for `pi install`.
license: MIT
---

# pi 插件开发

为 [pi coding agent](https://pi.dev) 开发扩展的完整工作流：**脚手架 → 设计 → 实现 → 测试 → 发布**。

四类扩展能力：

| 能力 | 面向 | 注册方式 |
|------|------|----------|
| Tool | LLM（agent 自主调用） | `pi.registerTool()` |
| Command | 人类（`/command` 键入） | `pi.registerCommand()` |
| Provider | 模型接入 | `pi.registerProvider()` |
| 事件钩子 | 生命周期拦截 | `pi.on("tool_call", ...)` 等 |

完整可运行示例：[pi-extension-dev 仓库](https://github.com/Traveler0014/pi-extension-dev)（`tools/example-plugin/`）。

## 1. 脚手架

最小插件目录（在任何仓库中均可创建）：

```
my-plugin/
├── package.json
├── index.ts        # pi 注册胶水层（唯一允许 import pi API 的文件）
├── lib.ts          # 纯逻辑（零 pi 依赖，可独立测试）
├── lib.test.ts     # vitest 单元测试
└── README.md       # 一句话描述/功能/适用范围/设计说明/配置/示例
```

`package.json`：

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./index.ts"],
    "contextBudget": "~200 tokens"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "dependencies": {}
}
```

要点：
- `pi.extensions` 指向入口文件；`pi.contextBudget` 声明系统提示注入预算（有 `before_agent_start` 注入或 `promptGuidelines` 时才需要）
- **运行时依赖必须放 `dependencies`** —— `pi install` 走 `npm install --omit=dev`，devDependencies 在用户机器上不存在（详见 [environment.md](references/environment.md)）
- 仓库根 `package.json` 需把插件路径加入 `pi.extensions` 数组，并声明 `installUrl`（HTTPS，供 `pi install`）

`index.ts` 骨架：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { doWork } from "./lib.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "my_tool_do",          // snake_case + 前缀
    label: "Do",
    description: "Do X. Use when the user asks to ...",  // 决定模型何时调用
    promptSnippet: "Do X via my_tool_do(input)",
    parameters: Type.Object({
      input: Type.String({ description: "..." }),
    }),
    async execute(_toolCallId, params) {
      const result = doWork(params.input);
      return { content: [{ type: "text", text: result }], details: {} };
    },
  });
}
```

开发循环：

```bash
pi -e ./my-plugin/index.ts                    # 会话中加载
pi -ne -e ./my-plugin/index.ts -p 'list tools'  # 非交互冒烟
npx vitest                                    # 单测
```

## 2. 设计

核心决策表：

| 需求 | 用什么 |
|------|--------|
| agent 自主执行动作/查询 | Tool（严格参数，见 [tool-design.md](references/tool-design.md)） |
| 人类触发、参数自然语言 | Command（宽松解析，见 [commands.md](references/commands.md)） |
| 接入自定义 LLM API | Provider |
| 按需加载的领域知识/流程 | Skill（本文件即是一例） |

命名规范：Tool 用 `snake_case`（`gh_pr_create`），Command 用 `kebab-case`（`/gh-pr-create`），同前缀成组。

## 3. 实现硬规则（正确性相关，违反即故障）

1. **错误信号分层**：非法输入/不可恢复失败 → `throw new Error(...)`（pi 标记 `isError`）；模型可自纠错的软失败 → 结构化返回 content + 恢复线索（如 selector 未命中时返回相近元素列表）。**返回值永远不会被标记为错误。**
2. **字符串枚举必须用 `StringEnum`**（`@earendil-works/pi-ai`）；`Type.Union`/`Type.Literal` 不兼容 Google API。
3. **`promptSnippet` 决定可发现性**：不设置则工具不出现在系统提示的 Available tools 段。
4. **文件变更类工具用 `withFileMutationQueue(path, fn)`** 包裹整个读-改-写窗口，否则与内置 `edit`/`write` 并行执行会互相覆盖。
5. **`content` 给模型（截断、清洗），`details` 给 TUI 渲染与状态重建**。
6. **工厂函数零后台资源**：不启动进程/socket/watcher/timer；延迟到 `session_start` 或首次使用；`session_shutdown` 配对清理。
7. **跨平台**：`os.homedir()`、`new Date()`，不 `exec("date")`、不读 `process.env.HOME`。

## 4. 测试

三层（详见 [testing.md](references/testing.md)）：

| 层 | 验证 | 方式 |
|----|------|------|
| 单元测试 | lib.ts 纯函数 | `npx vitest run` |
| 识别冒烟 | 加载不崩溃、工具被识别 | `pi -ne -e <path> -p 'list tools'` |
| 运行时自检 | 外部依赖连通（二进制/端点/登录态） | 插件内置 `/<plugin>-test` 命令 |

## 5. 发布

```bash
npm run update-docs                          # AST 重新生成根 README 目录
bash scripts/release.sh <extension-path> <bump>   # 版本号 + commit + tag + push
```

Tag 规范 `<extension-path>@<semver>`；版本语义、发布验证清单见 [publishing.md](references/publishing.md)。

## 进阶主题

- 跨会话状态持久化与恢复 → [state.md](references/state.md)
- 外部依赖（二进制下载、postinstall、降级告警）、UI 守卫 → [environment.md](references/environment.md)
- 交互式命令向导 → [interactive-commands.md](references/interactive-commands.md)

## 参考资料

- 本机 pi API 文档（`@earendil-works/pi-coding-agent` 包内 `docs/`）：

```bash
find ~/.local/share/pnpm -path "*/pi-coding-agent*/docs" -type d 2>/dev/null
# 或 find /usr/lib/node_modules ~/.npm -name extensions.md -path "*pi-coding-agent*" 2>/dev/null
```

  关键文件：`extensions.md`（ExtensionAPI 全参考）、`tui.md`、`skills.md`、`packages.md`、`custom-provider.md`

- 真实插件：[pi-alarm](https://github.com/Traveler0014/pi-alarm)（状态管理/定时器）、[pi-github](https://github.com/Traveler0014/pi-github)（lib 分层/TUI 渲染/测试）、[pi-providers](https://github.com/Traveler0014/pi-providers)（Provider 注册/compat）
