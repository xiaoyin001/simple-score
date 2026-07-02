# Codex 迭代工作流

版本：v0.1
更新日期：2026-06-23

## 1. 目标

本项目要求 Codex 在后续开发中具备持续改进能力。这里的“强化学习”不表示模型会在仓库内进行真实在线训练，而是通过项目级规则、验证清单、复盘记录和文档同步，让每次迭代都能把经验沉淀为下一次开发可执行的约束。

反馈学习机制详见 `docs/codex-feedback-learning.md`。反馈日志记录在 `docs/codex-feedback-log.md`。

## 2. 每轮开发流程

### 2.1 需求对齐

1. 先阅读 `docs/requirements.md` 和 `docs/architecture.md` 中与任务相关的部分。
2. 阅读 `docs/codex-feedback-learning.md`，并查看 `docs/codex-feedback-log.md` 中与本次任务相关的反馈。
3. 判断需求属于新功能、缺陷修复、架构调整、文档同步、发布配置或反馈复盘。
4. 明确本轮是否影响页面、云函数、数据集合、权限规则、审核文案或部署流程。
5. 根据历史高权重负向反馈列出本轮重点风险；如果没有相关反馈，应明确说明暂无历史反馈。

### 2.2 实现

1. 优先沿用当前微信原生小程序和云开发架构。
2. 前端只负责展示、输入和调用云函数。
3. 记分、权限、房间状态、记录写入必须在 `scoreFunctions` 中处理。
4. 非业务模板内容不得重新引入。
5. 修改行为时同步更新文档。

### 2.3 验证

每轮代码变更后至少执行：

```text
node --check cloudfunctions/scoreFunctions/index.js
node --check miniprogram/utils/api.js
node --check miniprogram/pages/index/index.js
node --check miniprogram/pages/create-room/index.js
node --check miniprogram/pages/join-room/index.js
node --check miniprogram/pages/room/index.js
node --check miniprogram/pages/records/index.js
rg -n "quickstart|QuickStart|example|cloudTipModal|envList|sales|scf|goods|databaseGuide|quickstartFunctions" miniprogram cloudfunctions README.md docs/architecture.md project.config.json
rg -n "赌博|下注|筹码|现金|输赢金额|牌局结算|赌局|代币|虚拟币|博彩" miniprogram cloudfunctions README.md docs/architecture.md project.config.json
```

微信开发者工具内需要人工验证：

1. 项目打开无缺失文件错误。
2. 云函数 `scoreFunctions` 可部署。
3. 创建房间成功。
4. 房间码加入成功。
5. 分享路径加入成功。
6. 房间页小程序二维码可展示，微信“扫一扫”和首页“扫码加入”都可识别并进入加入房间页，且加入页自动填入对应房间码。
7. 房主单人加扣分成功。
8. 房主批量加扣分成功。
9. 积分转移成功。
10. 公共积分不足时转出失败。
11. 撤销指定可撤销积分记录成功。
12. 普通成员不能加扣分、批量记分、撤销或关闭房间。
13. 普通成员可以将自己的积分转给他人或公共积分池，也可以从公共积分池转给自己。
14. 关闭房间后不能继续改分。
15. 超过 `expireAt` 的房间只读，超过 `hiddenAt` 的房间首页不展示并从 `users.roomIds` 懒清理。
16. 首页“已加入房间”按 `users.roomIds` 倒序分页展示，通过“加载更多”按钮加载下一页，不按房间更新时间重新排序。

当前项目只维护微信云开发路径，不再维护本地模拟服务。涉及 `cloudfunctions/scoreFunctions` 的后端行为改动，需要按 `docs/cloudbase-access.md` 从云函数目录部署，并用 `fn detail` 检查线上源码关键标记；仅看到 CLI 输出“部署成功”不算完成。部署验证通过后，再在微信开发者工具中验证。

CloudBase CLI 访问方式、当前环境 ID、只读检查命令和部署命令记录在 `docs/cloudbase-access.md`。需要访问云端资源时，优先使用 `tcb login` 产生的本机登录态，不导出或记录长期密钥。

### 2.4 复盘沉淀

如果本轮发现以下问题，需要把经验沉淀回文档或项目规则：

1. 审核风险文案遗漏。
2. 云函数权限边界不清。
3. 数据集合字段变更。
4. 微信开发者工具构建或部署步骤变化。
5. 页面流程变更。
6. 重复出现的 bug 或测试遗漏。

沉淀位置：

1. 产品规则变更写入 `docs/requirements.md`。
2. 实现行为变更写入 `docs/architecture.md`。
3. Codex 开发规则变更写入 `AGENTS.md` 或本文件。
4. 自动检查、Codex 复盘和人工体验评价写入 `docs/codex-feedback-log.md`。

### 2.5 反馈加权

Codex 应按 `docs/codex-feedback-learning.md` 中的权重公式评估反馈优先级：

```text
权重 = |分值| * 严重度 * 复现次数系数 * 置信度
```

处理原则：

1. 高扣分、高严重度、高置信度的问题优先修复。
2. 重复扣分的问题必须转化为自动检查、测试用例或更明确的验收项。
3. 高加分反馈作为体验保持约束，后续改动需要避免破坏。
4. 低置信度反馈先调查，不直接推翻现有架构规则。

## 3. 当前质量门禁

### 3.1 代码门禁

1. 不允许存在未引用模板资源。
2. 不允许存在 QuickStart 示例入口。
3. 不允许前端直接改核心积分字段。
4. 不允许绕过房主权限修改积分。
5. 不允许积分变更不写记录。

### 3.2 文案门禁

小程序页面、README、架构文档和云函数返回文案不得出现以下高风险表达：

```text
赌博
下注
筹码
现金
输赢金额
牌局结算
赌局
代币
虚拟币
博彩
```

需求文档中允许保留这些词作为“禁用词说明”。

## 4. 后续迭代 backlog

建议按以下顺序推进：

1. 在微信开发者工具中完成 MVP 全流程验证。
2. 拆分云函数内部模块，降低单文件维护成本。
3. 增加前端表单校验和更清晰的错误态。
4. 增加最近房间名称在加入后刷新为真实房间名。
5. 增加结算海报。
6. 增加更多撤销历史。
7. 增加云数据库索引说明和部署脚本。
