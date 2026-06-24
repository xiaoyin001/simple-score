# 简单记分鸭业务架构与流程

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
7. 撤销指定的一条可撤销积分变更。
8. 房主权限、房间人数上限、房间状态和过期校验。

暂未实现：广告、结算图片、模板市场、长期历史导出、独立管理后台。

## 2. 目录结构

```text
miniprogram/
  app.js
  app.json
  app.wxss
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
2. 支持点击展示房间二维码，二维码内容为房间码，其他成员可通过首页“扫码加入”扫描加入。
3. 展示成员排行榜。
4. 展示最近记录，包含操作类型、操作人、对象、分值、时间和撤销状态；房间页每页展示 5 条。
5. 房主可执行单人加扣分、批量加扣分、积分转移、指定记录撤销和关闭房间。
6. 普通成员可查看、分享，并发起受限积分转移：自己的积分转给他人或公共积分池、公共积分池转给自己。

### 3.5 记录页

路径：`pages/records/index`

职责：

1. 展示最近 50 条操作记录。
2. 展示操作类型、操作人、对象、分值、时间、撤销状态和可撤销记录入口。
3. 转移类记录根据目标积分变化展示来源和去向；当前用户参与时，前端将该成员显示为“我”。

## 4. 云函数

业务云函数：`scoreFunctions`

前端统一通过 `miniprogram/utils/api.js` 调用：

```js
callScoreFunction(type, data)
```

小程序启动时通过 `wx.cloud.init({ traceUser: true })` 初始化云开发，并使用开发者工具当前关联的小程序云环境。前端不再包含本地后端模式、本地模拟 openid 或本地服务地址配置。

所有记分、权限、房间状态、成员关系和记录写入仍由 `scoreFunctions` 处理，前端只负责展示、输入和调用云函数。

当前已验证的云开发环境 ID 为 `cloud1-d0g5o9l1ada4cc67e`。CloudBase CLI 登录、只读检查和部署命令统一记录在 `docs/cloudbase-access.md`。

当前操作类型：

```text
login / getOpenId
createRoom
joinRoom
getRoom
updateScore
batchUpdateScore
transferScore
batchTransferScore
undoLastAction
closeRoom
cleanupExpiredRooms
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
3. 房间默认有效期和最长存活时间均为 24 小时。
4. 已关闭或已过期房间不可继续修改积分。
5. 超过 `expireAt` 的房间、成员和操作记录由 `cleanupExpiredRooms` 定时清理。
6. 同一用户重复加入同一房间时返回已有成员，不重复占用名额。

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
6. 房间页不提供独立转移区；成员排行内的成员卡片提供单目标转移入口，成员排行头部提供批量转移模式。
7. 房间页成员转移默认从当前用户自己转出；公共积分池区域提供转入公共积分池和从公共积分池转给当前用户两个入口。
8. `batchTransferScore` 对同一来源到多个目标的转移做事务处理，每个目标获得相同分值，来源扣除目标数乘以分值。

### 6.4 撤销

1. 房主可以撤销指定的一条未撤销积分变更，前端通过 `recordId` 指定原记录。
2. 未传 `recordId` 时，云函数兼容撤销最近一次未撤销的积分变更。
3. 撤销使用原记录 `beforeSnapshot` 与 `afterSnapshot` 的差值，对当前房间和成员积分执行反向增量更新；不会直接把当前积分覆盖为旧快照。
4. 撤销不会删除原记录，而是新增 `undo` 记录。
5. 新增 `undo` 记录会保存撤销前的当前状态和撤销后的状态，便于记录页展示真实反向流向。
6. 原记录会标记为 `isUndone: true`。

## 7. 发布前检查

1. 微信开发者工具当前项目已关联可用的云开发环境。
2. `scoreFunctions` 已上传并部署云端安装依赖。
3. `cleanupExpiredRooms` 定时触发器已创建，计划为每小时执行一次。
4. 云数据库集合存在：`rooms`、`room_members`、`score_records`。
5. 微信开发者工具中完成创建、加入、扫码加入、二维码展示、加扣分、批量、转移、撤销、关闭和分享验证。
6. 页面文案不出现 `docs/requirements.md` 第 12.4 节列出的高风险表达。
