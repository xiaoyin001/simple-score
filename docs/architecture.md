# 简单记分业务架构与流程

版本：v0.1  
更新日期：2026-06-23

## 1. 当前范围

当前版本实现需求文档中的第一版 MVP：

1. 首页、创建房间、输入房间码加入、分享加入。
2. 房间成员列表、排行榜、公共积分池。
3. 房主单人加分、扣分。
4. 房主批量加分、扣分。
5. 公共积分和成员积分互转、成员之间转移。
6. 最近 50 条操作记录。
7. 撤销最近一次积分变更。
8. 房主权限、房间人数上限、房间状态和过期校验。

暂未实现：广告、结算图片、二维码/小程序码、模板市场、长期历史导出、独立管理后台。

## 2. 目录结构

```text
miniprogram/
  app.js
  app.json
  app.wxss
  config/
    runtime.js      运行环境和后端调用模式配置
  pages/
    index/          首页
    create-room/    创建房间
    join-room/      加入房间
    room/           房间详情和记分操作
    records/        操作记录
  utils/
    api.js          云函数调用封装
cloudfunctions/
  scoreFunctions/   记分业务云函数
docs/
  codex-workflow.md Codex 迭代工作流
  requirements.md   产品需求
  architecture.md   业务架构与流程
```

## 3. 前端页面流程

### 3.1 首页

路径：`pages/index/index`

职责：

1. 展示产品名和定位。
2. 提供创建房间、输入房间码、扫码加入入口。
3. 展示最近进入过的房间。
4. 接收分享路径中的 `roomId` 或 `roomCode`，跳转加入流程。

### 3.2 创建房间

路径：`pages/create-room/index`

提交字段：

```text
name
memberLimit
publicScore
nickname
```

成功后：

1. 写入本地最近房间。
2. 跳转到房间页。

### 3.3 加入房间

路径：`pages/join-room/index`

支持来源：

1. 用户手动输入房间码。
2. 首页扫码结果。
3. 分享路径参数。

成功后：

1. 写入本地最近房间。
2. 跳转到房间页。

### 3.4 房间页

路径：`pages/room/index`

职责：

1. 展示房间名称、房间码、人数、公共积分池。
2. 展示成员排行榜。
3. 展示最近记录。
4. 房主可执行单人加扣分、批量加扣分、积分转移、撤销和关闭房间。
5. 普通成员可查看、分享，并发起受限积分转移：自己的积分转给他人或公共积分池、公共积分池转给自己。

### 3.5 记录页

路径：`pages/records/index`

职责：

1. 展示最近 50 条操作记录。
2. 展示操作类型、操作人、对象、分值、时间和撤销状态。

## 4. 云函数

业务云函数：`scoreFunctions`

前端统一通过 `miniprogram/utils/api.js` 调用：

```js
callScoreFunction(type, data)
```

`miniprogram/config/runtime.js` 控制开发期后端模式：

```text
backendMode: cloud | local
cloudEnvId: 指定微信云开发环境 ID，留空时使用默认环境
localServerUrl: 本地模拟服务地址
localMockOpenid: 本地模拟用户标识
```

默认 `backendMode` 为 `cloud`，通过 `wx.cloud.callFunction` 调用云函数。开发期可临时切换为 `local`，由 `wx.request` 请求本地模拟服务；本地服务必须保持与 `scoreFunctions` 相同的 action、权限校验和返回结构，不能让前端直接修改积分、房间状态、成员关系或积分记录。

当前操作类型：

```text
login / getOpenId
createRoom
joinRoom
getRoom
updateScore
batchUpdateScore
transferScore
undoLastAction
closeRoom
```

## 5. 数据集合

云函数会尝试自动创建集合。如果线上环境限制自动创建，需要在云开发控制台手动创建。

### 5.1 rooms

```text
_id
roomCode
name
ownerOpenid
ownerNickname
memberLimit
publicScore
status
createdAt
updatedAt
expireAt
closedAt
version
```

`status`：

```text
active
closed
expired
```

### 5.2 room_members

```text
_id
roomId
openid
nickname
avatarUrl
score
role
joinedAt
updatedAt
leftAt
status
```

`role`：

```text
owner
member
```

`status`：

```text
active
left
```

### 5.3 score_records

```text
_id
roomId
operatorOpenid
operatorNickname
type
targets
amount
beforeSnapshot
afterSnapshot
remark
isUndone
undoRecordId
createdAt
```

## 6. 核心业务规则

### 6.1 房间

1. 房间名称不能为空，最多 20 个字符。
2. 人数上限为 2 到 12。
3. 房间默认有效期为 24 小时。
4. 已关闭或已过期房间不可继续修改积分。
5. 同一用户重复加入同一房间时返回已有成员，不重复占用名额。

### 6.2 权限

1. 使用微信 openid 识别用户。
2. 只有房主可以加扣分、批量记分、撤销操作和关闭房间。
3. 普通成员只能将自己的积分转给其他成员或公共积分池，也只能从公共积分池转给自己。
4. 权限判断全部在云函数中完成。

### 6.3 积分

1. 成员初始积分为 0。
2. 分值必须是 1 到 9999 的整数。
3. 允许成员积分变成负数。
4. 公共积分作为转出来源时不允许不足。
5. 积分变更使用云函数事务处理，并写入操作记录。

### 6.4 撤销

1. 撤销最近一次未撤销的积分变更。
2. 撤销不会删除原记录，而是新增 `undo` 记录。
3. 原记录会标记为 `isUndone: true`。

## 7. 发布前检查

1. `miniprogram/config/runtime.js` 中 `backendMode` 已切回 `cloud`，云环境 ID 已配置或使用默认环境。
2. `scoreFunctions` 已上传并部署云端安装依赖。
3. 云数据库集合存在：`rooms`、`room_members`、`score_records`。
4. 微信开发者工具中完成创建、加入、加扣分、批量、转移、撤销、关闭和分享验证。
5. 页面文案不出现 `docs/requirements.md` 第 12.4 节列出的高风险表达。
