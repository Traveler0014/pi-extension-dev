# 状态管理与生命周期

## 短期状态（会话内存）

模块级变量即可。注意 `/reload`、`/new`、`/resume` 会触发 `session_shutdown` → 重新加载扩展实例，内存状态清零。

## 跨会话持久状态：appendEntry + session_start 恢复

```typescript
const CUSTOM_TYPE = "myplugin-state";

let items: Item[] = [];

// 1. 写入：状态变化时追加 session entry（不进 LLM 上下文）
function persistState() {
  pi.appendEntry(CUSTOM_TYPE, {
    items: items.map((i) => ({ ...i })),
    nextId,
  });
}

// 2. 恢复：session_start 时从当前分支重建
pi.on("session_start", async (_event, ctx) => {
  items = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === CUSTOM_TYPE) {
      // 后写的覆盖先写的 —— 取最后一条
      const data = entry.data as { items: Item[] };
      items = data.items;
    }
  }
});

// 3. 清理：shutdown 时关闭定时器/socket/子进程
pi.on("session_shutdown", async () => {
  clearAllTimers();
});
```

## tool result details 作为状态载体

会话分支切换（`/tree`）后需要重建的状态，放在工具结果的 `details` 里随 session 持久化：

```typescript
pi.registerTool({
  name: "myplugin_add",
  async execute(_toolCallId, params) {
    items.push(params.item);
    return {
      content: [{ type: "text", text: `Added: ${params.item}` }],
      details: { items: [...items] },   // session_start 时从这里重建
    };
  },
});
```

## 磁盘持久状态

配置、缓存、登录态等放 `~/.pi/agent/<myplugin>-config.json`（纯 Node API 读写，见 lib.ts 的 loadConfig/saveConfig 模式）。路径用 `os.homedir()` 拼接，跨平台。

## 生命周期事件速查

| 事件 | 时机 | 典型用途 |
|------|------|----------|
| `session_start` | 启动/`/reload`/`/new`/`/resume`/`/fork` | 重建内存状态、启动后台资源 |
| `session_shutdown` | 退出/切换/fork 前 | **清理一切**（进程/socket/timer），配对使用 |
| `before_agent_start` | 每轮对话开始前 | 注入 system prompt 指引 |
| `tool_call` | 工具执行前（可 block） | 权限门、参数审计 |
| `tool_result` | 工具执行后（可修改） | 结果脱敏/增强 |

⚠️ 扩展工厂函数（`export default function (pi) {...)`）在**无会话的调用中也会执行**（如 `pi --list-models`）——工厂内禁止启动任何后台资源，一律延迟到 `session_start` 或首次使用。
