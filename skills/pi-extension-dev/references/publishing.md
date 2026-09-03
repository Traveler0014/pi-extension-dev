# 发布流程

以下步骤按顺序执行，不可跳过。前提：仓库有 `scripts/update-docs.ts` + `scripts/release.sh`（从 [pi-extension-dev](https://github.com/Traveler0014/pi-extension-dev) 模板继承）。

## Step 1: 完成编码

- 修改插件源码（`index.ts` + `lib.ts`）
- `npm run typecheck` 类型零错误
- 同步更新插件目录下的 `README.md`

## Step 2: 冒烟测试

```bash
pi -ne -e ./tools/my-plugin/index.ts -p 'list available tools'
npm test        # 单元测试全部通过
```

检查项：
- [ ] pi 正常启动，无崩溃
- [ ] 工具被 model tool list 识别
- [ ] `npm test` 通过
- [ ] 环境依赖型插件：`/myplugin-test` 自检通过
- [ ] Provider 类插件：模型列表可见，`/login` 流程正常

## Step 3: 补全文档

```bash
npm run update-docs
```

脚本通过 TypeScript AST 提取 `pi.registerProvider/Command/Tool/Shortcut/Flag` 与 `SKILL.md` frontmatter，重新生成根 `README.md` 的目录段。
**不要手动编辑**生成标记之间的内容。

## Step 4: 更新版本号并打 tag

```bash
bash scripts/release.sh <extension-path> <bump>
```

`<bump>`：`patch` | `minor` | `major` | `x.y.z`

脚本自动执行：
1. 更新插件 `package.json` 的 `version`
2. 重新生成根 `README.md`
3. `git commit -m "release: <name>@<version>"`
4. `git tag <name>@<version>`
5. `git push && git push --tags`

版本语义：
- **patch** — 纯修复、描述文案改进
- **minor** — 新工具/命令、向后兼容的行为增强
- **major** — 工具重命名/删除、参数契约破坏性变更

## Step 5: 验证发布

```bash
git log --oneline -3     # 确认提交
git tag -l               # 确认 tag
pi install <installUrl>  # 全新安装验证
# 安装后：/reload + 冒烟 + 自检
```

## Tag 命名规范

```
<extension-path>@<semver>
```

`<extension-path>` 即根 `package.json` 中 `pi.extensions` 声明的相对路径，与 `release.sh` 第一个参数一致：

- `my-plugin@1.0.0`
- `tools/alarm@0.3.1`

## 插件 README 结构（六段式）

1. **一句话描述**（被根 README 引用）
2. **功能说明** — 做什么、解决什么
3. **适用范围** — 什么场景使用
4. **设计说明** — 关键设计决策
5. **配置方法** — 环境变量、`/login` 步骤
6. **使用示例** — 模型选择、命令/Tool 调用示例

Tool 与 Command 分列并标注命名风格：

```markdown
## Tools (agent-facing, snake_case)
### `myplugin_create`
...

## Commands (user-facing, kebab-case)
### `/myplugin-create`
...
```
