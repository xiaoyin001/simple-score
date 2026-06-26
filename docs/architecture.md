# 简单记分鸭当前架构

本文档描述当前代码实现。小程序采用微信原生小程序 + 云开发，核心业务集中在 `scoreFunctions` 云函数中。

## 1. 架构目标

当前架构收敛为两张业务表：

```text
users
rooms
```

核心原则：

1. `rooms` 是房间事实源，保存房间、成员、积分和最近记录。
2. `users` 只保存用户基本资料和关联房间 ID。
3. 前端不直接修改积分、成员关系或房间状态。
4. 所有写操作都通过 `cloudfunctions/scoreFunctions/index.js` 事务处理。
5. 房间页只监听当前 `rooms/{roomId}` 文档。
6. 每次成功业务操作都写入 `rooms.records`。
7. 撤销按原记录 `scoreChanges` 反向计算，不用旧快照覆盖当前分数。
8. 房间 24 小时后只读，7 天后从玩家视角隐藏，不物理删除房间文档。

## 2. 小程序目录

```text
miniprogram/
  pages/index/        首页、默认名、最近房间
  pages/create-room/  创建房间
  pages/join-room/    输入房间码或分享路径加入
  pages/room/         房间详情、记分、转移、审批、撤销
  pages/records/      最近记录
  utils/api.js        云函数调用封装
  utils/records.js    记录展示格式化

cloudfunctions/
  scoreFunctions/
    index.js          业务 action 分发和事务写入
```

## 3. 数据集合

### 3.1 users

用户表只保存用户自己的资料和关联房间索引。

```js
{
  _id: "用户 openid",
  openid: "用户 openid",
  defaultName: "首页默认名",
  roomIds: ["用户创建、加入或申请过的房间 ID"],
  createdAt: Date,
  updatedAt: Date
}
```

`users` 不保存房间名、房间码、角色、成员状态、积分、房间关闭状态或过期状态。这些信息都从 `rooms` 读取并派生。

### 3.2 rooms

房间表保存完整房间事实。

```js
{
  _id: "房间 ID，当前等于 roomCode",
  roomCode: "房间码",
  name: "房间名称",
  ownerOpenid: "房主 openid",
  memberLimit: 12,
  requireApproval: false,
  status: "active",
  publicScore: 0,
  sequence: 1,
  members: [],
  records: [],
  createdAt: Date,
  updatedAt: Date,
  expireAt: Date,
  hiddenAt: Date,
  closedAt: null,
  version: 1
}
```

`status` 只保存 `active` 或 `closed`。超过 `expireAt` 后由云函数和前端视图判定为只读，不再把房间状态物理改成 expired。

### 3.3 members

成员直接内嵌在 `rooms.members` 中。

```js
{
  openid: "成员 openid",
  nickname: "房间内昵称",
  role: "owner 或 member",
  status: "active / pending / removed / rejected",
  score: 0,
  joinOrder: 1,
  nicknameEdited: false,
  joinedAt: Date,
  updatedAt: Date,
  leftAt: null
}
```

状态规则：

1. `active` 计入人数，可参与记分或转移。
2. `pending` 不计入人数，房主可见审批卡。
3. `removed` 不计入人数，保留历史结果，只能查看。
4. `rejected` 不计入人数，保留申请结果，只能查看提示。

### 3.4 records

记录直接内嵌在 `rooms.records` 中，当前保留最近 50 条。

```js
{
  recordId: "记录 ID",
  sequence: 1,
  type: "member_add",
  operatorOpenid: "操作人 openid",
  operatorNickname: "操作人昵称",
  amount: 5,
  scoreChanges: [],
  isUndone: false,
  undoOfRecordId: "",
  undoneByRecordId: "",
  createdAt: Date
}
```

积分变化结构：

```js
{
  targetType: "member 或 public",
  openid: "成员 openid",
  nickname: "成员昵称",
  delta: 5
}
```

前端兼容展示时会把记录补充为 `_id`、`targets` 等视图字段，但事实字段是 `recordId` 和 `scoreChanges`。

## 4. 云函数 action

`scoreFunctions` 支持以下 action：

```text
getOpenId
getHomeData
saveDefaultName
getRoom
getRoomPreview
createRoom
joinRoom
updateNickname
updateScore
batchUpdateScore
batchTransferScore
transferScore
undoLastAction
reviewJoinRequest
removeMember
closeRoom
```

写操作统一流程：

1. 读取当前用户 openid。
2. 在事务内读取最新 `rooms/{roomId}`。
3. 校验房间存在、未关闭、未超过 `expireAt`。
4. 校验操作者权限、成员状态、人数上限、昵称重名和公共积分余额。
5. 基于最新 room 计算成员积分和公共积分。
6. `sequence + 1` 并生成记录。
7. 写回整个 room 文档。
8. 创建或加入房间后，把 `roomId` 写入 `users.roomIds`。

当前阶段不维护复杂请求幂等表。前端通过 `submitting` 禁用按钮减少重复提交；如果重复请求实际成功，房主可撤销多余记录。

## 5. 权限

房主可以审批、加扣分、批量记分、任意合法转移、撤销、移出成员和关闭房间。

普通 active 成员可以查看、分享、修改自己昵称一次、将自己的积分转给其他 active 成员或公共积分池，也可以从公共积分池转给自己。

pending、removed、rejected 成员只能查看对应状态和历史结果，不能记分、转移或改名。

## 6. 同步

房间页同步只监听当前房间文档：

```js
wx.cloud.database()
  .collection("rooms")
  .where({ _id: roomId })
  .watch(...)
```

进入房间页时先调用 `getRoom` 获取权威快照。写操作成功后云函数返回最新 `roomView`，操作端立即应用。其他在线端通过 `rooms` watcher 收到同一房间文档变化后重新派生成员列表、待确认列表和记录列表。

页面隐藏或卸载时关闭 watcher。watch 短暂空快照时保留当前页面，并静默调用一次 `getRoom` 兜底。

## 7. 生命周期

```text
expireAt：创建时间 + 24 小时，超过后只读。
hiddenAt：创建时间 + 7 天，超过后首页不展示并从 users.roomIds 懒清理。
closedAt：房主主动关闭时间。
```

超过 `expireAt` 后可以查看，但不能加入、审批、改名、加扣分、批量记分、转移、撤销或关闭。

超过 `hiddenAt` 后首页不展示；旧链接进入时提示房间已归档；`rooms` 文档仍保留。

## 8. 自动检查

每次非简单变更至少运行：

```text
node --check cloudfunctions/scoreFunctions/index.js
node --check miniprogram/utils/api.js
node --check miniprogram/pages/index/index.js
node --check miniprogram/pages/create-room/index.js
node --check miniprogram/pages/join-room/index.js
node --check miniprogram/pages/room/index.js
node --check miniprogram/pages/records/index.js
模板残留关键词扫描
高风险文案扫描
```

人工仍需在微信开发者工具中验证创建、加入、分享加入、审批、记分、转移、撤销、关闭和权限限制。
