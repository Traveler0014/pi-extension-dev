# AGENTS.md — 仓库开发 & 发布规则

本仓库是**双重用途**的：

- **install 用户**：`pi install` 后获得插件开发技能 `/skill:pi-extension-dev`（`pi.skills` 声明，不注册任何示例扩展）
- **fork 用户**：以本仓库为脚手架开发自己的插件集合（examples 是复制起点）

> **插件设计规范**（命名、tool/command 设计、错误信号、测试、状态管理、环境依赖）
> 位于 `skills/pi-extension-dev/`。在本仓库内开发时按需加载该 skill
> （`/skill:pi-extension-dev`），**勿在本文件重复维护** —— 单一事实源。

---

## 仓库结构

根据插件数量选择一种布局：

### Layout 1: 裸文件（不推荐）

```
my-extension.ts
```

❌ 无 `package.json` 无法追踪版本，不支持 `pi install`。仅适合临时实验。

### Layout 2: 简单插件

```
<repo>/
├── README.md              # 自动生成目录段 + 手动前言
├── package.json           # 仓库根配置
├── skills/                # 开发技能（本仓库的 install 产物）
├── scripts/
│   ├── update-docs.ts     # 文档生成脚本（manifest 驱动 + skills 扫描）
│   └── release.sh         # 发布辅助脚本
├── <plugin-name>/
│   ├── index.ts           # pi 注册入口
│   ├── lib.ts             # 纯逻辑（零 pi 依赖）
│   ├── lib.test.ts        # vitest 单元测试
│   ├── package.json       # 插件元数据（含独立版本号）
│   └── README.md          # 插件文档
└── LICENSE
```

### Layout 3: 分组插件

```
<category>/<plugin-name>/{index.ts, lib.ts, package.json, README.md}
```

## 配置说明

### 根 `package.json`

```json
{
  "name": "my-extensions",
  "type": "module",
  "repository": "git@github.com:USERNAME/REPO.git",
  "installUrl": "https://github.com/USERNAME/REPO.git",
  "pi": {
    "extensions": [
      "plugin-a",
      "category/plugin-b"
    ],
    "skills": ["./skills"]
  }
}
```

| 字段 | 说明 |
|------|------|
| `repository` | SSH 地址，用于 `git push` |
| `installUrl` | HTTPS 地址，用于 `pi install`（公开只读） |
| `pi.extensions` | 插件目录的相对路径列表 —— **install 用户会加载这些**，只放实际插件 |
| `pi.skills` | 技能目录列表（fork 不需要可删） |

### 插件 `package.json`

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

- **运行时依赖必须放 `dependencies`**：`pi install` 执行 `npm install --omit=dev`，devDependencies 在用户机器上不存在（详见 skill 的 environment.md）
- Provider 类插件需额外声明 `@earendil-works/pi-ai` 为 peerDependency
- `pi.contextBudget`：有 system prompt 注入（`promptGuidelines`/`before_agent_start`）时声明 token 预算

## 开发流程

```bash
# 1. 脚手架
cp -r tools/example-plugin tools/my-plugin     # 或按 skill §1 从零创建

# 2. 开发时快速加载（显式路径，不依赖 manifest）
pi -e ./tools/my-plugin/index.ts

# 3. 单元测试（lib.ts 纯函数）
npx vitest

# 4. 识别冒烟
pi -ne -e ./tools/my-plugin/index.ts -p 'list available tools'

# 5. 注册：把 "tools/my-plugin" 加入根 package.json 的 pi.extensions

# 6. 文档 + 发布
npm run update-docs
bash scripts/release.sh tools/my-plugin patch
```

## 发布流程

按顺序执行，不可跳过：

1. **完成编码** — `npm run typecheck` 类型零错误，同步插件 README
2. **冒烟测试** — `pi -ne -e ./tools/<name>/index.ts -p 'list available tools'` + `npm test`；环境依赖型插件跑 `/​<plugin>-test` 自检
3. **补全文档** — `npm run update-docs`（AST 扫描 `pi.extensions` manifest + `pi.skills`；勿手编生成段）
4. **版本号 + tag** — `bash scripts/release.sh <extension-path> <bump>`（bump + 重新生成文档 + commit + tag + push）
5. **验证发布** — `pi install <installUrl>` 全新安装 + `/reload` + 冒烟

## Tag 命名规范

```
<extension-path>@<semver>
```

`<extension-path>` 即根 `package.json` 中 `pi.extensions` 里声明的相对路径，与 `release.sh` 第一个参数一致：`tools/alarm@0.3.1`。

版本语义：patch = 纯修复；minor = 新工具/向后兼容增强；major = 工具重命名/删除、契约破坏。

## 创建新插件

### 在现有仓库中添加

1. 创建插件目录（`index.ts`、`lib.ts`、`lib.test.ts`、`package.json`、`README.md`）
2. 根 `package.json` 的 `pi.extensions` 追加路径
3. `npm run update-docs`

### 从零创建新仓库

1. 从本仓库 fork / Use this template
2. 修改根 `package.json`：`name`、`repository`、`installUrl`；`pi.extensions` 换成你的插件路径
3. 删除不需要的示例（`example-provider/`、`tools/example-plugin/`）或保留作参考（它们未被 manifest 注册，不会随 install 加载）
4. `npm install && npm run update-docs`

## 注意事项

- 插件版本号独立管理，互不影响
- `pi.extensions` 是 install 用户的加载清单 —— **示例插件不要放进去**
- 本仓库 `pi.extensions` 为空数组是**故意的**（install 语义 = 只装 skill）；fork 后加入你的插件
- `scripts/update-docs.ts` 依赖 `tsx` 和 `typescript`（devDependencies），运行前需 `npm install`
- 插件 README 中的安装命令使用 HTTPS 地址（`installUrl`），不使用 SSH
- CI（`.github/workflows/ci.yml`）跑 typecheck + vitest + 文档同步检查；`npm ci` 依赖 lockfile，改依赖后记得提交 `package-lock.json`
