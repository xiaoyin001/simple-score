const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

/**
 * 房间集合字段：
 * roomCode 房间码；name 房间名称；ownerOpenid 房主标识；ownerNickname 房主昵称；
 * memberLimit 成员上限；publicScore 公共积分；status 房间状态；
 * createdAt/updatedAt/expireAt/closedAt 生命周期时间；version 数据版本。
 */
/**
 * 成员集合字段：
 * roomId 所属房间；openid 用户标识；nickname 显示昵称；avatarUrl 头像；
 * score 当前积分；role 成员角色；joinedAt/updatedAt/leftAt 成员时间；status 成员状态。
 */
/**
 * 记录集合字段：
 * roomId 所属房间；operatorOpenid/operatorNickname 操作人；type 操作类型；
 * targets 影响对象；amount 分值；beforeSnapshot/afterSnapshot 前后快照；
 * remark 备注；isUndone 撤销标记；undoRecordId 撤销关联；createdAt 操作时间。
 */

// 业务集合名称，云函数启动后会按需确保集合存在。
const COLLECTIONS = ["rooms", "room_members", "score_records"];

// 房间状态枚举，控制房间是否允许继续记分。
const ROOM_STATUS = {
  // 可加入、可记分的正常状态。
  ACTIVE: "active",
  // 房主主动关闭后的只读状态。
  CLOSED: "closed",
  // 超过有效期后的只读状态。
  EXPIRED: "expired",
};

// 成员状态枚举，当前版本只对 active 成员开放房间能力。
const MEMBER_STATUS = {
  // 正常参与房间的成员。
  ACTIVE: "active",
  // 预留的离开状态。
  LEFT: "left",
};

// 成员角色枚举，用于区分房主和普通成员权限。
const MEMBER_ROLE = {
  // 房间创建者，拥有完整记分管理权限。
  OWNER: "owner",
  // 普通成员，只能查看和发起受限积分转移。
  MEMBER: "member",
};

// 操作记录类型枚举，所有积分变化和房间关键动作都会落库。
const RECORD_TYPE = {
  // 单个成员加分。
  MEMBER_ADD: "member_add",
  // 单个成员扣分。
  MEMBER_SUBTRACT: "member_subtract",
  // 多个成员批量加分。
  BATCH_ADD: "batch_add",
  // 多个成员批量扣分。
  BATCH_SUBTRACT: "batch_subtract",
  // 公共积分转给成员。
  PUBLIC_TO_MEMBER: "public_to_member",
  // 成员积分转回公共积分。
  MEMBER_TO_PUBLIC: "member_to_public",
  // 成员之间转移积分。
  MEMBER_TO_MEMBER: "member_to_member",
  // 撤销上一条可撤销积分记录。
  UNDO: "undo",
  // 创建房间记录。
  ROOM_CREATED: "room_created",
  // 加入房间记录。
  MEMBER_JOINED: "member_joined",
  // 关闭房间记录。
  ROOM_CLOSED: "room_closed",
};

// 可撤销的积分变更类型，创建、加入和关闭房间不参与撤销。
const UNDOABLE_TYPES = [
  RECORD_TYPE.MEMBER_ADD,
  RECORD_TYPE.MEMBER_SUBTRACT,
  RECORD_TYPE.BATCH_ADD,
  RECORD_TYPE.BATCH_SUBTRACT,
  RECORD_TYPE.PUBLIC_TO_MEMBER,
  RECORD_TYPE.MEMBER_TO_PUBLIC,
  RECORD_TYPE.MEMBER_TO_MEMBER,
];

// 统一成功响应结构，前端依赖 success 字段判断调用结果。
function success(data = {}) {
  return {
    success: true,
    ...data,
  };
}

// 统一失败响应结构，保留错误码便于前端或调试工具判断原因。
function fail(message, code = "BAD_REQUEST") {
  return {
    success: false,
    code,
    message,
  };
}

// 返回当前时间，统一所有写入记录的时间来源。
function now() {
  return new Date();
}

// 清洗文本输入，避免空值和多余空白进入业务校验。
function normalizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

// 将输入转换为整数，非法输入返回 NaN 交给业务校验处理。
function parseInteger(value) {
  if (value === "" || value === null || value === undefined) return NaN;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue)) return NaN;
  return numberValue;
}

// 校验单次分值，限制为 1 到 9999 的整数。
function parsePositiveAmount(value) {
  const amount = parseInteger(value);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 9999) {
    throw new Error("分值必须是 1 到 9999 的整数");
  }
  return amount;
}

// 构造成员昵称，未填写时使用成员序号兜底。
function buildNickname(input, fallbackIndex) {
  const nickname = normalizeText(input);
  if (nickname) return nickname.slice(0, 20);
  return `成员${fallbackIndex || ""}`;
}

// 确保核心集合存在，方便新云环境首次运行。
async function ensureCollections() {
  await Promise.all(
    COLLECTIONS.map(async (name) => {
      try {
        await db.createCollection(name);
      } catch (error) {
        // 集合已存在时忽略，保持初始化过程幂等。
      }
    })
  );
}

// 获取微信调用上下文，集中读取 openid 等身份信息。
function getWxContext() {
  return cloud.getWXContext();
}

// 返回当前调用用户的微信身份信息。
async function getOpenId() {
  const wxContext = getWxContext();
  return success({
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  });
}

// 按房间 ID 或房间码查找房间，支持分享和手动输入两种入口。
async function findRoomByCodeOrId({ roomId, roomCode }) {
  if (roomId) {
    const roomResult = await db.collection("rooms").doc(roomId).get();
    return roomResult.data || null;
  }

  const code = normalizeText(roomCode).toUpperCase();
  if (!code) return null;
  const roomResult = await db
    .collection("rooms")
    .where({ roomCode: code })
    .limit(1)
    .get();
  return roomResult.data[0] || null;
}

// 判断房间是否已经超过有效期。
function isExpired(room) {
  return room.expireAt && new Date(room.expireAt).getTime() <= Date.now();
}

// 房间过期时即时标记为 expired，避免继续发生记分操作。
async function markExpiredIfNeeded(room) {
  if (!room || room.status !== ROOM_STATUS.ACTIVE || !isExpired(room)) return room;
  await db.collection("rooms").doc(room._id).update({
    data: {
      status: ROOM_STATUS.EXPIRED,
      updatedAt: now(),
    },
  });
  return {
    ...room,
    status: ROOM_STATUS.EXPIRED,
  };
}

// 生成不易混淆的 6 位房间码，并检查唯一性。
async function generateRoomCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const existing = await db
      .collection("rooms")
      .where({ roomCode: code })
      .count();
    if (!existing.total) return code;
  }
  throw new Error("房间码生成失败，请重试");
}

// 创建房间，同时创建房主成员记录和创建房间操作记录。
async function createRoom(event) {
  await ensureCollections();

  const wxContext = getWxContext();
  const name = normalizeText(event.name);
  const memberLimit = parseInteger(event.memberLimit || 12);
  const publicScore = parseInteger(event.publicScore || 0);
  const ownerNickname = buildNickname(event.nickname, 1);
  const avatarUrl = normalizeText(event.avatarUrl);

  if (!name) return fail("房间名称不能为空");
  if (name.length > 20) return fail("房间名称最多 20 个字符");
  if (!Number.isInteger(memberLimit) || memberLimit < 2 || memberLimit > 12) {
    return fail("人数上限必须在 2 到 12 之间");
  }
  if (!Number.isInteger(publicScore)) return fail("公共积分必须是整数");

  try {
    const createdAt = now();
    const expireAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
    const roomCode = await generateRoomCode();
    const roomResult = await db.collection("rooms").add({
      data: {
        roomCode,
        name,
        ownerOpenid: wxContext.OPENID,
        ownerNickname,
        memberLimit,
        publicScore,
        status: ROOM_STATUS.ACTIVE,
        createdAt,
        updatedAt: createdAt,
        expireAt,
        closedAt: null,
        version: 1,
      },
    });

    const roomId = roomResult._id;
    const memberResult = await db.collection("room_members").add({
      data: {
        roomId,
        openid: wxContext.OPENID,
        nickname: ownerNickname,
        avatarUrl,
        score: 0,
        role: MEMBER_ROLE.OWNER,
        joinedAt: createdAt,
        updatedAt: createdAt,
        leftAt: null,
        status: MEMBER_STATUS.ACTIVE,
      },
    });

    await db.collection("score_records").add({
      data: {
        roomId,
        operatorOpenid: wxContext.OPENID,
        operatorNickname: ownerNickname,
        type: RECORD_TYPE.ROOM_CREATED,
        targets: [{ type: "room", roomId, name }],
        amount: 0,
        beforeSnapshot: {},
        afterSnapshot: {
          room: { publicScore },
          members: [{ memberId: memberResult._id, score: 0 }],
        },
        remark: "创建房间",
        isUndone: false,
        undoRecordId: null,
        createdAt,
      },
    });

    return success({
      roomId,
      roomCode,
      memberId: memberResult._id,
    });
  } catch (error) {
    return fail(error.message || "创建房间失败");
  }
}

// 加入房间，重复加入时返回已有成员，不重复占用名额。
async function joinRoom(event) {
  await ensureCollections();

  const wxContext = getWxContext();
  const room = await markExpiredIfNeeded(
    await findRoomByCodeOrId({
      roomId: normalizeText(event.roomId),
      roomCode: normalizeText(event.roomCode),
    })
  );

  if (!room) return fail("房间不存在", "ROOM_NOT_FOUND");
  if (room.status === ROOM_STATUS.CLOSED) return fail("房间已关闭", "ROOM_CLOSED");
  if (room.status !== ROOM_STATUS.ACTIVE) return fail("房间已过期", "ROOM_EXPIRED");

  const existing = await db
    .collection("room_members")
    .where({
      roomId: room._id,
      openid: wxContext.OPENID,
      status: MEMBER_STATUS.ACTIVE,
    })
    .limit(1)
    .get();

  if (existing.data.length) {
    return success({
      roomId: room._id,
      roomCode: room.roomCode,
      member: existing.data[0],
      alreadyJoined: true,
    });
  }

  const activeCount = await db
    .collection("room_members")
    .where({
      roomId: room._id,
      status: MEMBER_STATUS.ACTIVE,
    })
    .count();

  if (activeCount.total >= room.memberLimit) {
    return fail("房间人数已满", "ROOM_FULL");
  }

  const joinedAt = now();
  const nickname = buildNickname(event.nickname, activeCount.total + 1);
  const avatarUrl = normalizeText(event.avatarUrl);
  const memberResult = await db.collection("room_members").add({
    data: {
      roomId: room._id,
      openid: wxContext.OPENID,
      nickname,
      avatarUrl,
      score: 0,
      role: MEMBER_ROLE.MEMBER,
      joinedAt,
      updatedAt: joinedAt,
      leftAt: null,
      status: MEMBER_STATUS.ACTIVE,
    },
  });

  await db.collection("score_records").add({
    data: {
      roomId: room._id,
      operatorOpenid: wxContext.OPENID,
      operatorNickname: nickname,
      type: RECORD_TYPE.MEMBER_JOINED,
      targets: [{ type: "member", memberId: memberResult._id, nickname }],
      amount: 0,
      beforeSnapshot: {},
      afterSnapshot: { members: [{ memberId: memberResult._id, score: 0 }] },
      remark: "加入房间",
      isUndone: false,
      undoRecordId: null,
      createdAt: joinedAt,
    },
  });

  return success({
    roomId: room._id,
    roomCode: room.roomCode,
    memberId: memberResult._id,
    alreadyJoined: false,
  });
}

// 获取房间详情、成员列表、最近记录和当前用户角色。
async function getRoom(event) {
  await ensureCollections();

  const wxContext = getWxContext();
  const roomId = normalizeText(event.roomId);
  if (!roomId) return fail("缺少房间 ID");

  let room;
  try {
    const roomResult = await db.collection("rooms").doc(roomId).get();
    room = await markExpiredIfNeeded(roomResult.data);
  } catch (error) {
    return fail("房间不存在", "ROOM_NOT_FOUND");
  }

  const [membersResult, recordsResult] = await Promise.all([
    db
      .collection("room_members")
      .where({
        roomId,
        status: MEMBER_STATUS.ACTIVE,
      })
      .get(),
    db
      .collection("score_records")
      .where({ roomId })
      .orderBy("createdAt", "desc")
      .limit(50)
      .get(),
  ]);

  const currentMember = membersResult.data.find(
    (member) => member.openid === wxContext.OPENID
  );
  const currentUserRole = currentMember
    ? currentMember.role
    : room.ownerOpenid === wxContext.OPENID
      ? MEMBER_ROLE.OWNER
      : "";

  const members = membersResult.data.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
  });

  return success({
    room,
    members,
    recentRecords: recordsResult.data,
    currentUserRole,
    currentMember,
  });
}

// 获取可操作房间并校验房主权限。
async function getActiveRoomForOwner(roomId, openid) {
  const roomResult = await db.collection("rooms").doc(roomId).get();
  const room = await markExpiredIfNeeded(roomResult.data);

  if (!room) throw new Error("房间不存在");
  if (room.ownerOpenid !== openid) throw new Error("只有房主可以操作");
  if (room.status === ROOM_STATUS.CLOSED) throw new Error("房间已关闭");
  if (room.status !== ROOM_STATUS.ACTIVE) throw new Error("房间已过期");

  return room;
}

// 获取可操作房间并校验调用者是否为房主或当前房间成员。
async function getActiveRoomForParticipant(roomId, openid) {
  const roomResult = await db.collection("rooms").doc(roomId).get();
  const room = await markExpiredIfNeeded(roomResult.data);

  if (!room) throw new Error("房间不存在");
  if (room.status === ROOM_STATUS.CLOSED) throw new Error("房间已关闭");
  if (room.status !== ROOM_STATUS.ACTIVE) throw new Error("房间已过期");

  const memberResult = await db
    .collection("room_members")
    .where({
      roomId,
      openid,
      status: MEMBER_STATUS.ACTIVE,
    })
    .limit(1)
    .get();
  const currentMember = memberResult.data[0] || null;
  const isOwner = room.ownerOpenid === openid;

  if (!isOwner && !currentMember) throw new Error("请先加入房间");

  return { room, currentMember, isOwner };
}

// 查询操作人昵称，记录展示时优先使用房间内昵称。
async function getOperatorNickname(roomId, openid, fallback) {
  const result = await db
    .collection("room_members")
    .where({
      roomId,
      openid,
      status: MEMBER_STATUS.ACTIVE,
    })
    .limit(1)
    .get();
  return (result.data[0] && result.data[0].nickname) || fallback || "房主";
}

// 房主为单个成员加分或扣分，事务内同步写入积分记录。
async function updateScore(event) {
  await ensureCollections();

  const wxContext = getWxContext();
  const roomId = normalizeText(event.roomId);
  const memberId = normalizeText(event.memberId);
  const action = normalizeText(event.action);

  try {
    const amount = parsePositiveAmount(event.amount);
    const delta = action === "subtract" ? -amount : amount;
    const recordType =
      action === "subtract" ? RECORD_TYPE.MEMBER_SUBTRACT : RECORD_TYPE.MEMBER_ADD;
    const room = await getActiveRoomForOwner(roomId, wxContext.OPENID);
    const operatorNickname = await getOperatorNickname(
      roomId,
      wxContext.OPENID,
      room.ownerNickname
    );

    await db.runTransaction(async (transaction) => {
      const memberResult = await transaction
        .collection("room_members")
        .doc(memberId)
        .get();
      const member = memberResult.data;
      if (
        !member ||
        member.roomId !== roomId ||
        member.status !== MEMBER_STATUS.ACTIVE
      ) {
        throw new Error("成员不存在");
      }

      const beforeScore = member.score || 0;
      const afterScore = beforeScore + delta;
      const changedAt = now();
      await transaction.collection("room_members").doc(memberId).update({
        data: {
          score: afterScore,
          updatedAt: changedAt,
        },
      });
      await transaction.collection("rooms").doc(roomId).update({
        data: { updatedAt: changedAt },
      });
      await transaction.collection("score_records").add({
        data: {
          roomId,
          operatorOpenid: wxContext.OPENID,
          operatorNickname,
          type: recordType,
          targets: [
            {
              type: "member",
              memberId,
              nickname: member.nickname,
              beforeScore,
              afterScore,
            },
          ],
          amount,
          beforeSnapshot: {
            members: [{ memberId, score: beforeScore }],
          },
          afterSnapshot: {
            members: [{ memberId, score: afterScore }],
          },
          remark: action === "subtract" ? "成员扣分" : "成员加分",
          isUndone: false,
          undoRecordId: null,
          createdAt: changedAt,
        },
      });
    });

    return success();
  } catch (error) {
    return fail(error.message || "积分操作失败");
  }
}

// 房主批量调整成员积分，事务内逐个更新并写入一条批量记录。
async function batchUpdateScore(event) {
  await ensureCollections();

  const wxContext = getWxContext();
  const roomId = normalizeText(event.roomId);
  const action = normalizeText(event.action);
  const memberIds = Array.isArray(event.memberIds)
    ? [...new Set(event.memberIds.map((id) => normalizeText(id)).filter(Boolean))]
    : [];

  try {
    const amount = parsePositiveAmount(event.amount);
    if (!memberIds.length) throw new Error("至少选择 1 名成员");
    const delta = action === "subtract" ? -amount : amount;
    const recordType =
      action === "subtract" ? RECORD_TYPE.BATCH_SUBTRACT : RECORD_TYPE.BATCH_ADD;
    const room = await getActiveRoomForOwner(roomId, wxContext.OPENID);
    const operatorNickname = await getOperatorNickname(
      roomId,
      wxContext.OPENID,
      room.ownerNickname
    );

    await db.runTransaction(async (transaction) => {
      const membersResult = await transaction
        .collection("room_members")
        .where({
          _id: _.in(memberIds),
          roomId,
          status: MEMBER_STATUS.ACTIVE,
        })
        .get();
      if (membersResult.data.length !== memberIds.length) {
        throw new Error("部分成员不存在");
      }

      const changedAt = now();
      const beforeMembers = [];
      const afterMembers = [];
      const targets = [];

      for (const member of membersResult.data) {
        const beforeScore = member.score || 0;
        const afterScore = beforeScore + delta;
        beforeMembers.push({ memberId: member._id, score: beforeScore });
        afterMembers.push({ memberId: member._id, score: afterScore });
        targets.push({
          type: "member",
          memberId: member._id,
          nickname: member.nickname,
          beforeScore,
          afterScore,
        });
        await transaction.collection("room_members").doc(member._id).update({
          data: {
            score: afterScore,
            updatedAt: changedAt,
          },
        });
      }

      await transaction.collection("rooms").doc(roomId).update({
        data: { updatedAt: changedAt },
      });
      await transaction.collection("score_records").add({
        data: {
          roomId,
          operatorOpenid: wxContext.OPENID,
          operatorNickname,
          type: recordType,
          targets,
          amount,
          beforeSnapshot: { members: beforeMembers },
          afterSnapshot: { members: afterMembers },
          remark: action === "subtract" ? "批量扣分" : "批量加分",
          isUndone: false,
          undoRecordId: null,
          createdAt: changedAt,
        },
      });
    });

    return success();
  } catch (error) {
    return fail(error.message || "批量操作失败");
  }
}

// 根据转出和转入对象类型确定积分转移记录类型。
function getTransferType(fromType, toType) {
  if (fromType === "public" && toType === "member") return RECORD_TYPE.PUBLIC_TO_MEMBER;
  if (fromType === "member" && toType === "public") return RECORD_TYPE.MEMBER_TO_PUBLIC;
  if (fromType === "member" && toType === "member") return RECORD_TYPE.MEMBER_TO_MEMBER;
  throw new Error("暂不支持该转移方式");
}

// 校验积分转移权限，普通成员只能转出自己或从公共积分转给自己。
function assertTransferPermission({ isOwner, currentMember, fromType, fromMemberId, toType, toMemberId }) {
  if (isOwner) return;

  if (!currentMember) throw new Error("请先加入房间");

  const currentMemberId = currentMember._id;
  if (fromType === "member") {
    if (fromMemberId !== currentMemberId) {
      throw new Error("成员只能转出自己的积分");
    }
    return;
  }

  if (fromType === "public" && toType === "member") {
    if (toMemberId !== currentMemberId) {
      throw new Error("成员只能从公共积分池转给自己");
    }
    return;
  }

  throw new Error("成员只能转移自己的积分或从公共积分池转给自己");
}

// 执行公共积分与成员、成员与成员之间的积分转移。
async function transferScore(event) {
  await ensureCollections();

  const wxContext = getWxContext();
  const roomId = normalizeText(event.roomId);
  const fromType = normalizeText(event.fromType);
  const toType = normalizeText(event.toType);
  const fromMemberId = normalizeText(event.fromMemberId);
  const toMemberId = normalizeText(event.toMemberId);

  try {
    const amount = parsePositiveAmount(event.amount);
    if (fromType === toType && fromMemberId && fromMemberId === toMemberId) {
      throw new Error("来源和目标不能相同");
    }
    const recordType = getTransferType(fromType, toType);
    const { room, currentMember, isOwner } = await getActiveRoomForParticipant(
      roomId,
      wxContext.OPENID
    );
    assertTransferPermission({
      isOwner,
      currentMember,
      fromType,
      fromMemberId,
      toType,
      toMemberId,
    });
    const operatorNickname = await getOperatorNickname(
      roomId,
      wxContext.OPENID,
      room.ownerNickname
    );

    await db.runTransaction(async (transaction) => {
      const changedAt = now();
      const targets = [];
      const beforeSnapshot = {};
      const afterSnapshot = {};
      const memberIds = [fromMemberId, toMemberId].filter(Boolean);
      const memberMap = {};

      if (memberIds.length) {
        const membersResult = await transaction
          .collection("room_members")
          .where({
            _id: _.in([...new Set(memberIds)]),
            roomId,
            status: MEMBER_STATUS.ACTIVE,
          })
          .get();
        membersResult.data.forEach((member) => {
          memberMap[member._id] = member;
        });
      }

      if (fromType === "member" && !memberMap[fromMemberId]) {
        throw new Error("转出成员不存在");
      }
      if (toType === "member" && !memberMap[toMemberId]) {
        throw new Error("转入成员不存在");
      }
      if (fromType === "member" && toType === "member" && fromMemberId === toMemberId) {
        throw new Error("转出和转入成员不能相同");
      }

      let nextPublicScore = room.publicScore || 0;
      const beforeMembers = [];
      const afterMembers = [];

      if (fromType === "public") {
        if (nextPublicScore < amount) throw new Error("公共积分不足");
        nextPublicScore -= amount;
      }
      if (toType === "public") {
        nextPublicScore += amount;
      }

      if (fromType === "public" || toType === "public") {
        beforeSnapshot.room = { publicScore: room.publicScore || 0 };
        afterSnapshot.room = { publicScore: nextPublicScore };
        await transaction.collection("rooms").doc(roomId).update({
          data: {
            publicScore: nextPublicScore,
            updatedAt: changedAt,
          },
        });
        targets.push({
          type: "public",
          beforeScore: room.publicScore || 0,
          afterScore: nextPublicScore,
        });
      } else {
        await transaction.collection("rooms").doc(roomId).update({
          data: { updatedAt: changedAt },
        });
      }

      if (fromType === "member") {
        const member = memberMap[fromMemberId];
        const beforeScore = member.score || 0;
        const afterScore = beforeScore - amount;
        beforeMembers.push({ memberId: member._id, score: beforeScore });
        afterMembers.push({ memberId: member._id, score: afterScore });
        targets.push({
          type: "member",
          memberId: member._id,
          nickname: member.nickname,
          beforeScore,
          afterScore,
        });
        await transaction.collection("room_members").doc(member._id).update({
          data: {
            score: afterScore,
            updatedAt: changedAt,
          },
        });
      }

      if (toType === "member") {
        const member = memberMap[toMemberId];
        const beforeScore = member.score || 0;
        const afterScore = beforeScore + amount;
        beforeMembers.push({ memberId: member._id, score: beforeScore });
        afterMembers.push({ memberId: member._id, score: afterScore });
        targets.push({
          type: "member",
          memberId: member._id,
          nickname: member.nickname,
          beforeScore,
          afterScore,
        });
        await transaction.collection("room_members").doc(member._id).update({
          data: {
            score: afterScore,
            updatedAt: changedAt,
          },
        });
      }

      beforeSnapshot.members = beforeMembers;
      afterSnapshot.members = afterMembers;

      await transaction.collection("score_records").add({
        data: {
          roomId,
          operatorOpenid: wxContext.OPENID,
          operatorNickname,
          type: recordType,
          targets,
          amount,
          beforeSnapshot,
          afterSnapshot,
          remark: "积分转移",
          isUndone: false,
          undoRecordId: null,
          createdAt: changedAt,
        },
      });
    });

    return success();
  } catch (error) {
    return fail(error.message || "转移失败");
  }
}

// 撤销最近一次或指定的一次可撤销积分变更。
async function undoLastAction(event) {
  await ensureCollections();

  const wxContext = getWxContext();
  const roomId = normalizeText(event.roomId);
  const recordId = normalizeText(event.recordId);

  try {
    const room = await getActiveRoomForOwner(roomId, wxContext.OPENID);
    const operatorNickname = await getOperatorNickname(
      roomId,
      wxContext.OPENID,
      room.ownerNickname
    );

    let record;
    if (recordId) {
      const recordResult = await db.collection("score_records").doc(recordId).get();
      record = recordResult.data;
    } else {
      const recordResult = await db
        .collection("score_records")
        .where({
          roomId,
          type: _.in(UNDOABLE_TYPES),
          isUndone: false,
        })
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
      record = recordResult.data[0];
    }

    if (!record || record.roomId !== roomId) throw new Error("没有可撤销的操作");
    if (record.isUndone) throw new Error("该操作已撤销");
    if (!UNDOABLE_TYPES.includes(record.type)) throw new Error("该操作不可撤销");

    await db.runTransaction(async (transaction) => {
      const changedAt = now();
      const beforeSnapshot = record.afterSnapshot || {};
      const afterSnapshot = record.beforeSnapshot || {};
      const beforeMembers = beforeSnapshot.members || [];
      const afterMembers = afterSnapshot.members || [];

      if (afterSnapshot.room) {
        await transaction.collection("rooms").doc(roomId).update({
          data: {
            publicScore: afterSnapshot.room.publicScore || 0,
            updatedAt: changedAt,
          },
        });
      } else {
        await transaction.collection("rooms").doc(roomId).update({
          data: { updatedAt: changedAt },
        });
      }

      for (const member of afterMembers) {
        await transaction.collection("room_members").doc(member.memberId).update({
          data: {
            score: member.score || 0,
            updatedAt: changedAt,
          },
        });
      }

      const undoResult = await transaction.collection("score_records").add({
        data: {
          roomId,
          operatorOpenid: wxContext.OPENID,
          operatorNickname,
          type: RECORD_TYPE.UNDO,
          targets: record.targets || [],
          amount: record.amount || 0,
          beforeSnapshot: {
            room: beforeSnapshot.room,
            members: beforeMembers,
          },
          afterSnapshot,
          remark: "撤销操作",
          isUndone: false,
          undoRecordId: record._id,
          createdAt: changedAt,
        },
      });

      await transaction.collection("score_records").doc(record._id).update({
        data: {
          isUndone: true,
          undoRecordId: undoResult._id || null,
        },
      });
    });

    return success();
  } catch (error) {
    return fail(error.message || "撤销失败");
  }
}

// 房主关闭房间，关闭后不再允许继续修改积分。
async function closeRoom(event) {
  await ensureCollections();

  const wxContext = getWxContext();
  const roomId = normalizeText(event.roomId);

  try {
    const room = await getActiveRoomForOwner(roomId, wxContext.OPENID);
    const operatorNickname = await getOperatorNickname(
      roomId,
      wxContext.OPENID,
      room.ownerNickname
    );
    const closedAt = now();

    await db.collection("rooms").doc(roomId).update({
      data: {
        status: ROOM_STATUS.CLOSED,
        closedAt,
        updatedAt: closedAt,
      },
    });
    await db.collection("score_records").add({
      data: {
        roomId,
        operatorOpenid: wxContext.OPENID,
        operatorNickname,
        type: RECORD_TYPE.ROOM_CLOSED,
        targets: [{ type: "room", roomId, name: room.name }],
        amount: 0,
        beforeSnapshot: { room: { status: ROOM_STATUS.ACTIVE } },
        afterSnapshot: { room: { status: ROOM_STATUS.CLOSED } },
        remark: "关闭房间",
        isUndone: false,
        undoRecordId: null,
        createdAt: closedAt,
      },
    });

    return success();
  } catch (error) {
    return fail(error.message || "关闭房间失败");
  }
}

// 云函数入口，根据 type 分发到具体业务 action。
exports.main = async (event) => {
  switch (event.type) {
    case "getOpenId":
    case "login":
      return getOpenId();
    case "createRoom":
      return createRoom(event);
    case "joinRoom":
      return joinRoom(event);
    case "getRoom":
      return getRoom(event);
    case "updateScore":
      return updateScore(event);
    case "batchUpdateScore":
      return batchUpdateScore(event);
    case "transferScore":
      return transferScore(event);
    case "undoLastAction":
      return undoLastAction(event);
    case "closeRoom":
      return closeRoom(event);
    default:
      return fail("未知操作类型", "UNKNOWN_TYPE");
  }
};
