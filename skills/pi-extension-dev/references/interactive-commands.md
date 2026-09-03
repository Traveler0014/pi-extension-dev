# Interactive Slash Command Best Practices

## 核心原则

斜杠命令面向**人类用户**，应该**零学习成本**。用户不需要记忆参数名和格式，通过交互式向导逐步完成配置。

同时保留**快速命令行模式**供脚本/自动化调用，两者不冲突。

## 架构模式

### 双模模式：Quick mode + Interactive fallback

每个需要参数的命令都应采用此模式：

```typescript
pi.registerCommand('your-add', {
  handler: async (args, ctx) => {
    const parsed = parseAddArgs(args);

    // Quick mode: 所有必填参数已提供 → 直接执行
    if (parsed.id && parsed.url && parsed.token && parsed.errors.length === 0) {
      await addFromParsed(parsed, ctx);
      return;
    }

    // Interactive mode: 缺参数 → 启动交互式向导
    // ... wizard steps
  },
});
```

**关键要点**：
- 快速模式不中断用户，适合脚本调用
- 交互式模式在无参调用时自动启动
- 解析错误不阻塞，提示后继续交互式

## UX 设计原则

### 1. 默认值必须可见

```
❌ 坏:  "Instance ID (Enter=default):"
        [placeholder: gitea-1]

✅ 好:  Instance ID
          Default: gitea-1
          Used in tool calls: gitea_* tools require this value
        [placeholder: gitea-1]
```

规则：
- prompt 中显式标出 `Default: xxx`
- 必填字段标 `(required)`
- 可选字段标 `(optional, Enter to skip)`

### 2. 必填字段必须给示例

```
✅ 好:  Host address (required)
          e.g. 192.168.1.100 or my-server.local or ec2-1-2-3.compute.amazonaws.com
          IP address or resolvable hostname

✅ 好:  Access token (required)
          e.g. 83f9a1e2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8
          Can reference env var: $GITEA_TOKEN
```

规则：
- 提供 1-2 个真实可用的示例
- 说明格式约束（长度要求、特殊语法如 `$ENV_VAR`）
- 说明该字段在系统中的用途

### 3. 可选字段说明默认行为

```
✅ 好:  SSH port (Enter for default: 22)
          Default SSH port is 22 for most servers
          Only change if your server uses a non-standard port
```

### 4. 编辑时显示当前值

```
✅ 好:  Host address (Enter to keep current)
          Current: 192.168.1.100
        [placeholder: 192.168.1.100]

✅ 好:  Label (Enter to keep current, Backspace+Enter to clear)
          Current: Production Server
        [placeholder: Production Server]
```

### 5. 删除必须二次确认

```
✅ 好:  选择 profile → 展示完整详情 → Confirm removal? → 执行
        --
        ID:        prod-server
        Host:      192.168.1.100:22
        User:      root
        Auth:      key (~/.ssh/id_rsa)
        Label:     Production DB Server
```

### 6. 完成后展示结构化摘要

```
✅ 好:  Added Gitea instance:
          ID:       internal
          URL:      http://gitea.dapustor.com
          Token:    83f9...7e8
          Label:    Internal Gitea
          Config:   ~/.pi/agent/gitea-config.json
```

## 代码模式

### Prompt 格式化

使用多行数组 + `join('\n')` 保持代码可读：

```typescript
const hostPrompt = [
  'Host address (required)',
  '  e.g. 192.168.1.100 or my-server.local',
  '  IP address or resolvable hostname',
].join('\n');
const hostInput = await ctx.ui.input(hostPrompt, '192.168.1.100');
if (hostInput === undefined) { ctx.ui.notify('Cancelled.', 'info'); return; }
const host = hostInput.trim();
if (!host) { ctx.ui.notify('Host address is required.', 'error'); return; }
```

### select 选项格式

使用对齐的格式让选项信息量最大：

```typescript
const authChoice = await ctx.ui.select(
  'Authentication method',
  [
    'password          — direct password (stored in config)',
    'key               — SSH private key file',
    'password (env)    — password from environment variable',
    'password (cmd)    — password from shell command',
  ],
);
```

### 枚举映射

用字符串前缀判断用户选择：

```typescript
if (authChoice.startsWith('password (env)')) authType = 'passwordEnv';
else if (authChoice.startsWith('password (cmd)')) authType = 'passwordCommand';
else if (authChoice.startsWith('key')) authType = 'key';
else authType = 'password';
```

### 取消处理

每个 `ctx.ui.input()` 和 `ctx.ui.select()` 之后都必须检查 `undefined`：

```typescript
const choice = await ctx.ui.select('Select:', options);
if (choice === undefined) { ctx.ui.notify('Cancelled.', 'info'); return; }
// ... 继续处理 choice
```

### 详情格式化

为每种实体类型提供独立的 `formatXxxDetail()` 函数：

```typescript
function formatProfileDetail(profile: HostProfile): string {
  const lines = [
    `  ID:        ${profile.id}`,
    `  Host:      ${profile.host}${profile.port !== 22 ? `:${profile.port}` : ''}`,
    `  User:      ${profile.username}`,
    `  Auth:      ${profile.auth.type}`,
    profile.defaultCwd ? `  CWD:       ${profile.defaultCwd}` : '',
    profile.label ? `  Label:     ${profile.label}` : '',
    profile.tags?.length ? `  Tags:      ${profile.tags.join(', ')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
```

### 条件分支与 auth 选择

当某些字段依赖于前面的选择（如 auth 类型），嵌套处理：

```typescript
switch (authType) {
  case 'key': {
    const keyInput = await ctx.ui.input('Key path:', '~/.ssh/id_rsa');
    // ... validate, save
    break;
  }
  case 'password': {
    const pwInput = await ctx.ui.input('Password:', '');
    // ... validate, save
    break;
  }
}
```

## 完整命令对照

每个涉及"管理实体"的扩展应有以下命令：

| 命令 | 功能 | 交互模式 |
|------|------|----------|
| `/xxx-list` | 列出所有实体 | 直接输出 |
| `/xxx-add` | 添加新实体 | 交互式向导 + 快速模式 |
| `/xxx-remove <id>` | 删除实体 | 交互式选择 → 详情 → 确认 |
| `/xxx-status` | 查看当前状态 | 直接输出 |
| `/xxx-edit` | 编辑实体（可选） | 选择 → 字段编辑 |

## 实体

### gitea (Gitea Instance 管理)

- `/gitea-add`: 7 步向导（ID / URL / Token / Label / Desc / Scope / Summary）
- `/gitea-remove`: 选择 → 展示（ID/URL/Token/label）→ 确认
- `/gitea-list`: 直接输出

### remote-workspace (Remote Host 管理)

- `/remote-add`: 10 步向导（ID / Host / User / Port / Auth / CWD / Label / Tags / Desc / Scope → Test → Summary）
- `/remote-remove`: 选择 → 展示（ID/Host/User/Auth/CWD/Label/Tags/Desc）→ 确认 → 自动 disable
- `/remote-edit`: 选择 → 逐字段编辑（当前值作 placeholder）→ 总结
- `/remote-enable`: 选择 profile → 可选 cwd → 探测连通性
- `/remote-disable`: 选择已启用的 host → 确认

## 参考

- **pi-github**: [/gh-login interactive wizard](https://github.com/Traveler0014/pi-github) (platform type → URL → token → scope)
- **pi-alarm**: [/alarm-cancel interactive selection](https://github.com/Traveler0014/pi-alarm) (select → cancel with label support)

- **不要侵入系统 prompt 的 "Configured Xxx" 区域** — 命令和工具应能正常工作但不污染 prompt
- **多用 notify 辅助信息** — 比如 scope 选择前先显示两个 config 文件完整路径
- **避免过长的 prompt 文本** — 超过 4 行的 prompt 考虑用 `ctx.ui.notify` 前置展示
- **测试友好** — 快速命令行模式使脚本测试更容易，不要放弃
