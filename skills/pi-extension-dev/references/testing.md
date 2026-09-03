# 测试策略

三层测试，各司其职：

| 层 | 验证什么 | 触发方式 | 成本 |
|----|----------|----------|------|
| 单元测试 | lib.ts 纯函数逻辑 | `npx vitest run` | 零外部依赖，进 CI |
| 识别冒烟 | 插件加载不崩溃、工具/命令被识别 | `pi -ne -e <path> -p '...'` | 一次模型调用，人工/发布前 |
| 运行时自检 | 外部依赖真实可用 | `/<plugin>-test` 命令 | 用户侧一键排障 |

## 单元测试（vitest）

`vitest.config.ts`：

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    exclude: ["**/e2e.test.ts", "**/node_modules/**"],
  },
});
```

分层：

| 层级 | 说明 | 示例 |
|------|------|------|
| 纯函数测试 | lib.ts，无外部依赖 | `validateEmail()`、`parseRepo()` |
| 配置测试 | load/save config | `loadConfig()` 返回默认值 |
| 集成测试 | 真实 API，env var 门控 | `describe.skipIf(!token)("...")` |

```typescript
import { describe, expect, it } from "vitest";
import { parseRepo } from "./lib";

describe("parseRepo", () => {
  it("parses owner/name", () => {
    expect(parseRepo("octocat/hello")).toEqual({ owner: "octocat", name: "hello" });
  });
});

// 集成测试：无凭证环境自动跳过
describe.skipIf(!process.env.MY_API_TOKEN)("api integration", () => {
  it("fetches widgets", async () => { /* ... */ });
});
```

## 识别冒烟

非交互模式加载插件 + 一句简单 prompt，验证「启动不崩溃 + 工具被识别」：

```bash
pi -ne -e ./tools/my-plugin/index.ts -p 'list available tools'
```

检查项：
- [ ] pi 正常启动，无崩溃
- [ ] agent 正常响应，无异常日志
- [ ] 工具出现在 model tool list 中
- [ ] Provider 类：模型列表可见，`/login` 正常

## 运行时自检命令（环境依赖型插件必备）

识别冒烟测不出环境问题（二进制缺失、端口冲突、登录态失效、网络不可达）。有外部依赖的插件应内置自检命令，把常见故障一步定位：

```typescript
pi.registerCommand("myplugin-test", {
  description: "Runtime self-check: binary, endpoint, auth",
  handler: async (_args, ctx) => {
    const checks: { name: string; run: () => Promise<string | Error> }[] = [
      { name: "binary",  run: async () => findBinary() ?? new Error("not found — run: npx mytool install") },
      { name: "endpoint", run: async () => pingEndpoint() },
      { name: "auth",    run: async () => loadToken() ?? new Error("run /myplugin-login") },
    ];

    let failed = 0;
    for (const c of checks) {
      const r = await c.run().catch((e: Error) => e);
      const ok = !(r instanceof Error);
      if (!ok) failed++;
      ctx.ui.notify(`${ok ? "✓" : "✗"} ${c.name}: ${ok ? r : r.message}`, ok ? "info" : "error");
    }
    ctx.ui.notify(failed === 0 ? "All checks passed" : `${failed} check(s) failed`, failed === 0 ? "info" : "warning");
  },
});
```

要点：
- 每项检查失败时给出**修复指引**（命令、文档链接），不只是报错
- 纯逻辑插件（无环境依赖）不需要此命令，vitest 足够

## e2e / fixture（重量级插件）

浏览器、服务器类插件应提供零外网依赖的本地 fixture（静态页面 + 本地 HTTP server），契约测试可进 CI。参考 pi-headless-browser 的 fixture-server 模式。
