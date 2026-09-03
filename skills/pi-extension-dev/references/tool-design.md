# Tool 设计规范

Tool 是 LLM 自主调用的 API。设计目标：**模型不看文档也能正确调用、失败后能自我纠正**。

## 命名

`snake_case`，`<prefix>_<verb>` 格式：`gh_pr_create`、`db_query`、`alarm_set`。

- prefix 标识来源插件，过长可缩写
- verb 单一动词（`set` / `list` / `cancel` / `create` / `delete`）
- 例外：语义自明的 getter 可保留非动词（`alarm_now`、`gh_whoami`）

## 设计原则

### 1. 单一职责

一个 tool 只做一件事，禁止 `action` 枚举合并操作：

```typescript
// ❌ 反模式
pi.registerTool({
  name: "myplugin",
  parameters: Type.Object({
    action: StringEnum(["create", "list", "delete"]),
  }),
  async execute(params) { switch (params.action) { /* ... */ } },
});

// ✅ 拆分
pi.registerTool({ name: "myplugin_create", /* ... */ });
pi.registerTool({ name: "myplugin_list",   /* ... */ });
pi.registerTool({ name: "myplugin_delete", /* ... */ });
```

### 2. 同类概念分离

两种语义不同的输入模式（如相对 vs 绝对）拆为两个 tool：

```typescript
// ✅ 相对模式
myplugin_schedule(delay_seconds=300)
// ✅ 绝对模式
myplugin_schedule_at(timestamp="2026-06-26T14:30:00Z")
```

### 3. 参数严格校验

Tool 面向 agent，入口处严格校验，不做宽松运行时解析：

```typescript
const PATTERN = /^\d{4}-\d{2}-\d{2}$/;
if (!PATTERN.test(params.date)) {
  throw new Error(`Invalid date "${params.date}": expected YYYY-MM-DD`);
}
```

### 4. 合并冗余参数

同一概念不拆成多个参数：

```typescript
// ❌ 冗余
retryCount: Type.Optional(Type.Number()),
noRetry:    Type.Optional(Type.Boolean()),

// ✅ 统一
retry: Type.Optional(Type.String({
  description: "Number as string, or 'none'. Default: '3'.",
})),
```

### 5. 跨平台

```typescript
// ✅
const now = new Date();
const home = os.homedir();

// ❌
// execSync("date")
// process.env.HOME
```

### 6. 对称描述

同类工具共享句式、只突出差异点，让模型注意力集中在差异上：

```typescript
// ✅ 对称
alarm_wait: "Schedule a reminder alarm using a relative delay in seconds."
alarm_set:  "Schedule a reminder alarm using an absolute ISO 8601 timestamp."

// promptSnippet 也保持对称
alarm_wait: "Set alarm (relative): alarm_wait(delay=N, ...)"
alarm_set:  "Set alarm (absolute): alarm_set(at='...', ...)"
```

### 7. 正面描述优先

用正面描述说明工具做什么。准确的描述本身就是最好的约束：

```typescript
// ❌ "This is NOT a blocking sleep"
// ✅ "When triggered, a message is injected into the conversation"
```

## Schema 最佳实践

```typescript
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

pi.registerTool({
  name: "my_tool_do",
  label: "Do",
  description: "……做什么 + 什么时候用（模型据此决定调用时机）",
  promptSnippet: "Do X via my_tool_do(input)",   // Available tools 中的一行条目
  promptGuidelines: [                             // Guidelines 追加条目（可选）
    "Use my_tool_do when the user asks to ...",   // 必须点名工具，扁平拼接无分组
  ],
  parameters: Type.Object({
    input: Type.String({ description: "……" }),
    format: Type.Optional(StringEnum(["json", "text"] as const)),
  }),
  async execute(_toolCallId, params, signal, onUpdate, ctx) { /* ... */ },
});
```

- **`StringEnum` 而非 `Type.Union`/`Type.Literal`** —— 后者不兼容 Google API
- **`promptSnippet`**：不设置则工具不进系统提示的 Available tools 段（模型难以发现）
- **`promptGuidelines`**：追加到系统提示 Guidelines 段的条目；拼接是扁平的，每条必须点名工具
- **`contextBudget`**（package.json `pi` 字段）：声明上述注入的 token 预算
- 参数 `description` 认真写 —— 它就是模型的参数文档

## 错误信号：throw vs 结构化返回

pi 通过 `execute()` 是否抛异常设置 `isError: true` 并向模型报告错误。**返回值永远不会被标记为错误。** 两种模式各司其职：

**throw（硬失败）**—— 非法输入、前置条件不满足、不可恢复的运行时错误：

```typescript
async execute(_toolCallId, params) {
  if (!params.repo) {
    throw new Error("Missing required parameter: repo (owner/name)");
  }
}
```

**结构化返回 + 恢复线索（软失败）**—— 模型可以自行纠正的运行时失败。返回 content 说明发生了什么、下一步怎么做，不标记错误：

```typescript
async execute(_toolCallId, params) {
  const el = await page.$(params.selector).catch(() => null);
  if (!el) {
    // 返回恢复线索而非 throw：模型可据此换 selector 重试
    const visible = await getClickableSummary(page);
    return {
      content: [{ type: "text",
        text: `Selector "${params.selector}" not found. Visible clickable elements:\n${visible}` }],
      details: { selectorMiss: true },
    };
  }
}
```

```typescript
// ❌ 所有失败都返回文本 —— pi 不标记 isError，模型可能误以为调用成功
// ❌ 所有失败都 throw —— 模型拿不到恢复线索，只能盲目重试
// ✅ 非法输入 throw；可自纠错失败返回线索
```

## 结果契约

```typescript
function textResult(text: string, details?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], details: details ?? {} };
}
```

- **禁止返回裸字符串**（`return "OK"`）—— agent 无法解析
- `content` 给模型：核心内容直出，不带冗余前缀；大结果截断/落盘 + 分段读取
- `details` 给渲染与状态：`renderResult` 读取它决定 TUI 展示，`session_start` 从中重建状态
- 图片结果：`content` 支持 `{ type: "image", data: <base64>, mimeType: "image/png" }`（多模态模型直接可见）
- 嵌套 LLM 调用的用量：返回 `usage` 字段计入会话统计
- 流式进度：`onUpdate?.({ content: [{ type: "text", text: "Working..." }] })`
- 取消响应：检查 `signal?.aborted`，长操作把 `signal` 传给底层 API
- 文件变更类工具：**整个读-改-写窗口**包进 `withFileMutationQueue(absolutePath, fn)`，否则与内置 `edit`/`write` 并行时互相覆盖

## renderCall / renderResult（TUI 渲染）

```typescript
renderCall(args, theme) {
  let text = theme.fg("toolTitle", theme.bold("my_tool_do"));
  text += " " + theme.fg("accent", `"${args.input}"`);
  return new Text(text, 0, 0);
},

renderResult(result, _options, theme) {
  const details = result.details as { error?: string } | undefined;
  if (details?.error) {
    return new Text(theme.fg("error", "Failed"), 0, 0);
  }
  const firstLine = result.content[0]?.type === "text" ? result.content[0].text.split("\n")[0] : "";
  return new Text(theme.fg("muted", firstLine), 0, 0);
},
```

常用 theme 语义色：

| 调用 | 用途 |
|------|------|
| `theme.fg("toolTitle", bold(name))` | 工具名 |
| `theme.fg("accent", ...)` | 参数高亮（repo、ID） |
| `theme.fg("dim", ...)` | 次要信息 |
| `theme.fg("success", ...)` / `("error", ...)` / `("warning", ...)` | 结果状态 |
| `theme.fg("muted", ...)` | 紧凑摘要 |
