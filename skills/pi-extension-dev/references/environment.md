# 外部依赖与运行环境

## dependencies vs devDependencies（最重要）

`pi install` 安装 git/npm 包时执行 `npm install --omit=dev`（生产安装）：

- **运行时依赖必须放 `dependencies`** —— devDependencies 在用户机器上不存在
- typescript / tsx / vitest 等**仅开发期需要的**放 `devDependencies`
- `peerDependencies`（`@earendil-works/pi-coding-agent` 等）：npm 7+ 会自动安装，用于声明"宿主生态"而非固定版本

## 大型二进制依赖（浏览器、引擎等）

postinstall 尽力安装 + 运行时发现 + 降级告警，三层兜底：

```json
{
  "dependencies": { "playwright-core": "^1.61.0" },
  "scripts": {
    "postinstall": "npx --yes playwright@1 install chromium || true"
  }
}
```

1. **postinstall `|| true`**：受限网络下下载失败不阻断 `pi install`
2. **运行时多路径发现**：缓存目录 → 环境变量（`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 等）→ 系统 PATH
3. **降级告警**：`before_agent_start` 注入 system prompt 告知模型"工具将失败 + 用户应执行的安装命令"；工具调用时返回带修复指引的错误

网络受限环境支持：文档写明镜像变量（如 `PLAYWRIGHT_DOWNLOAD_HOST`）。

## 资源启动纪律

- 工厂函数**零后台资源**（进程/socket/watcher/timer 都不行）——`pi --list-models` 等无会话调用也会执行工厂
- 重资源 lazy-launch：首次工具调用时才启动（单例 + `ensure()` 模式）
- `session_shutdown` 配对清理；崩溃自愈：监听 disconnect，下次调用自动重建
- 考虑空闲超时回收（如浏览器实例 N 分钟无调用自动关闭）

## UI 守卫

```typescript
pi.on("some_event", async (_event, ctx) => {
  if (!ctx.hasUI) return;              // print (-p) / json 模式无 UI，跳过对话框
  const ok = await ctx.ui.confirm("Title", "Proceed?");  // select/input/confirm 同理
  if (ctx.mode === "tui") { /* TUI 专属能力（custom 组件等） */ }
});
```

- `ctx.ui.notify` / `setStatus` / `setWidget` 在 TUI + RPC 模式可用；对话框（select/confirm/input/editor）需 `ctx.hasUI`
- 无 UI 时的高危操作默认拒绝并在结果中说明原因，提供配置项显式豁免

## 取消与超时

- `execute(toolCallId, params, signal, ...)` 的 `signal`：Esc 触发；传给底层 API（`fetch(url, { signal })` 等），长操作必须响应
- `pi.exec(cmd, args, { signal, timeout })` 执行外部命令
- 网络请求一律带超时

## 版本兼容

pi 迭代快，peerDependencies 用 `"*"`；`prepareArguments(args)` 兼容垫片可让旧 session 的工具调用参数适配新 schema（恢复旧会话不炸）。
