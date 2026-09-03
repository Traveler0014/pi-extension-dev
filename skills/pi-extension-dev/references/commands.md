# Command 设计规范

Command 是人类用户通过 `/command` 键入触发的。与 Tool 的根本差异：**面向人，接受自然表达**。

## 1. 比 tool 宽松

```bash
# Command（灵活）
/myplugin-schedule in 5m Call mom
/myplugin-schedule at 14:30 Meeting

# Tool（严格）
myplugin_schedule(delay_seconds=300, message="Call mom")
myplugin_schedule_at(timestamp="2026-06-26T14:30:00+08:00", message="Meeting")
```

## 2. LLM fallback

解析失败时将原始输入交给 agent 处理，而非报错退出：

```typescript
pi.registerCommand("myplugin-schedule", {
  handler: async (args, ctx) => {
    const parsed = tryParse(args);
    if (!parsed) {
      // ✅ agent 帮你处理 —— 绝不只报错
      if (ctx.isIdle()) {
        pi.sendUserMessage(
          `User invoked /myplugin-schedule with: "${args}". ` +
          `Use the appropriate tool to handle this request.`,
        );
      } else {
        ctx.ui.notify("Agent is busy, try again in a moment", "warning");
      }
      return;
    }
    // ... 正常处理
  },
});
```

## 3. 用户反馈用 ctx.ui.notify，不用返回值

```typescript
// ❌ handler 返回字符串 —— 用户看不到
handler(args, ctx) { return "Hello"; }

// ✅
handler(args, ctx) { ctx.ui.notify("Done!", "info"); }
```

## 4. 双模模式：Quick mode + Interactive fallback

每个需要参数的命令都应支持两种模式 —— 快速路径供脚本/熟练用户，交互向导供首次使用：

```typescript
pi.registerCommand("myplugin-add", {
  handler: async (args, ctx) => {
    const parsed = parseAddArgs(args);

    // Quick mode: 所有必填参数已提供 → 直接执行
    if (parsed.id && parsed.errors.length === 0) {
      await addFromParsed(parsed, ctx);
      return;
    }

    // Interactive mode: 缺参数 → 启动向导
    // ... wizard steps
  },
});
```

交互式向导的完整模式（可见默认值、示例占位、用途提示、结构化摘要、破坏性操作前确认）见 [interactive-commands.md](interactive-commands.md)。

## 5. 注册要点

```typescript
pi.registerCommand("myplugin-do", {
  description: "一句话说明用途和用法 — /myplugin-do <arg>",
  getArgumentCompletions: (prefix) => {  // 可选：参数自动补全
    const items = ["dev", "staging", "prod"].map((e) => ({ value: e, label: e }));
    const filtered = items.filter((i) => i.value.startsWith(prefix));
    return filtered.length > 0 ? filtered : null;
  },
  handler: async (args, ctx) => { /* ... */ },
});
```

- 命令名 `kebab-case`，与工具同前缀成组（`my_tool_do` ↔ `/myplugin-do`）
- description 里带用法示例 —— 它同时是 `/` 自动补全菜单里的说明文字
