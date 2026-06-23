# 简单记分鸭

简单记分鸭是基于微信原生小程序 + 微信云开发实现的多人活动记分工具。

## 当前 MVP 功能

- 创建记分房间，支持房间码和分享链接加入
- 房间最多 12 名成员，成员初始积分为 0
- 公共积分池
- 房主单人加分、扣分
- 房主批量加分、扣分
- 公共积分和成员积分互转、成员之间转移
- 操作记录，默认展示最近 50 条
- 撤销最近一次积分变更
- 房主权限、房间关闭、房间过期和人数上限由云函数校验

## 目录

```text
miniprogram/
  config/
    runtime.js
  pages/
    index/
    create-room/
    join-room/
    room/
    records/
  utils/
    api.js
cloudfunctions/
  scoreFunctions/
docs/
  architecture.md
  codex-feedback-learning.md
  codex-feedback-log.md
  codex-workflow.md
  requirements.md
```

## 本地运行

1. 使用微信开发者工具打开项目根目录。
2. 在云开发控制台创建或选择云环境。
3. 如需指定云环境，填写 `miniprogram/config/runtime.js` 中的 `cloudEnvId`。
4. 右键 `cloudfunctions/scoreFunctions`，选择“上传并部署：云端安装依赖”。
5. 编译小程序后，从首页创建房间并测试加入、记分、转移、撤销和分享流程。

开发阶段如需使用本地模拟服务，可将 `miniprogram/config/runtime.js` 中的 `backendMode` 改为 `local`，并确认 `localServerUrl` 指向本地服务地址。本地服务需要提供与 `scoreFunctions` 一致的请求和返回结构。

云函数会自动尝试创建以下集合：

- `rooms`
- `room_members`
- `score_records`

如果线上环境限制自动创建集合，请在云开发控制台手动创建以上集合。

## 文档

- [需求文档](docs/requirements.md)
- [业务架构与流程](docs/architecture.md)
- [Codex 迭代工作流](docs/codex-workflow.md)
- [Codex 反馈学习机制](docs/codex-feedback-learning.md)
- [Codex 反馈记录](docs/codex-feedback-log.md)
