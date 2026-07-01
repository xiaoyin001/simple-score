const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = ["users", "rooms"];

const ROOM_STATUS = {
  ACTIVE: "active",
  CLOSED: "closed",
};

const VIEW_STATUS = {
  EXPIRED: "expired",
};

const MEMBER_STATUS = {
  ACTIVE: "active",
  PENDING: "pending",
  REMOVED: "removed",
  REJECTED: "rejected",
};

const MEMBER_ROLE = {
  OWNER: "owner",
  MEMBER: "member",
};

const RECORD_TYPE = {
  ROOM_CREATED: "room_created",
  MEMBER_JOIN_REQUESTED: "member_join_requested",
  MEMBER_JOINED: "member_joined",
  MEMBER_JOIN_REJECTED: "member_join_rejected",
  MEMBER_REMOVED: "member_removed",
  MEMBER_ADD: "member_add",
  MEMBER_SUBTRACT: "member_subtract",
  BATCH_ADD: "batch_add",
  BATCH_SUBTRACT: "batch_subtract",
  MEMBER_TO_MEMBER: "member_to_member",
  MEMBER_TO_PUBLIC: "member_to_public",
  PUBLIC_TO_MEMBER: "public_to_member",
  BATCH_TRANSFER: "batch_transfer",
  UNDO: "undo",
  ROOM_CLOSED: "room_closed",
};

const UNDOABLE_TYPES = [
  RECORD_TYPE.MEMBER_ADD,
  RECORD_TYPE.MEMBER_SUBTRACT,
  RECORD_TYPE.BATCH_ADD,
  RECORD_TYPE.BATCH_SUBTRACT,
  RECORD_TYPE.MEMBER_TO_MEMBER,
  RECORD_TYPE.MEMBER_TO_PUBLIC,
  RECORD_TYPE.PUBLIC_TO_MEMBER,
  RECORD_TYPE.BATCH_TRANSFER,
];

const ACTIVE_ROOM_DURATION_MS = 24 * 60 * 60 * 1000;
const ROOM_VISIBLE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 50;
const MAX_TRANSACTION_RETRY = 3;
const DEFAULT_HOME_ROOM_PAGE_SIZE = 5;
const MAX_HOME_ROOM_PAGE_SIZE = 20;
const DEFAULT_NICKNAME = "2601010000";

function success(data = {}) {
  return {
    success: true,
    ...data,
  };
}

function fail(message, code = "BAD_REQUEST") {
  return {
    success: false,
    code,
    message,
  };
}

function now() {
  return new Date();
}

function normalizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function padTimePart(value) {
  return String(value).padStart(2, "0");
}

function buildGeneratedNickname(date = now()) {
  return [
    padTimePart(date.getFullYear() % 100),
    padTimePart(date.getMonth() + 1),
    padTimePart(date.getDate()),
    padTimePart(date.getHours()),
    padTimePart(date.getMinutes()),
  ].join("");
}

function normalizeNicknameKey(value) {
  return normalizeText(value).toLowerCase();
}

function parseInteger(value) {
  if (value === "" || value === null || value === undefined) return NaN;
  const numberValue = Number(value);
  return Number.isInteger(numberValue) ? numberValue : NaN;
}

function parsePositiveAmount(value) {
  const amount = parseInteger(value);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 9999) {
    throw new Error("分值必须是 1 到 9999 的整数");
  }
  return amount;
}

function toTime(value) {
  if (!value) return 0;
  if (typeof value.getTime === "function") return value.getTime();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value.$date) return new Date(value.$date).getTime() || 0;
  return new Date(value).getTime() || 0;
}

function isExpired(room) {
  return !!(room && room.expireAt && toTime(room.expireAt) <= Date.now());
}

function isHidden(room) {
  return !!(room && room.hiddenAt && toTime(room.hiddenAt) <= Date.now());
}

function isRoomWritable(room) {
  return room && room.status === ROOM_STATUS.ACTIVE && !isExpired(room);
}

function normalizeHomeCursor(input) {
  const cursor = Number(input);
  if (!Number.isFinite(cursor) || cursor < 0) return 0;
  return Math.floor(cursor);
}

function normalizeHomePageSize(input) {
  const pageSize = Number(input);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return DEFAULT_HOME_ROOM_PAGE_SIZE;
  return Math.min(Math.floor(pageSize), MAX_HOME_ROOM_PAGE_SIZE);
}

function buildNickname(input, fallback = buildGeneratedNickname()) {
  const nickname = normalizeText(input, fallback).slice(0, 20);
  return nickname || fallback || DEFAULT_NICKNAME;
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getWxContext() {
  return cloud.getWXContext();
}

async function ensureCollections() {
  await Promise.all(
    COLLECTIONS.map(async (name) => {
      try {
        await db.createCollection(name);
      } catch (error) {
        // 集合已存在时忽略。
      }
    })
  );
}

async function ensureUser(openid, patch = {}) {
  const current = now();
  let existing = null;
  try {
    const result = await db.collection("users").doc(openid).get();
    existing = result.data || null;
  } catch (error) {
    existing = null;
  }

  if (existing) {
    const nextUser = {
      ...existing,
      ...patch,
      updatedAt: current,
    };
    await db.collection("users").doc(openid).update({
      data: {
        ...patch,
        updatedAt: current,
      },
    });
    return nextUser;
  }

  const createdUser = {
    _id: openid,
    openid,
    defaultName: normalizeText(patch.defaultName),
    roomIds: Array.isArray(patch.roomIds) ? patch.roomIds : [],
    createdAt: current,
    updatedAt: current,
    ...patch,
  };
  const { _id, ...docData } = createdUser;

  try {
    await db.collection("users").doc(openid).set({
      data: docData,
    });
  } catch (setError) {
    try {
      await db.collection("users").add({
        data: createdUser,
      });
    } catch (addError) {
      try {
        await db.collection("users").doc(openid).update({
          data: {
            ...patch,
            updatedAt: current,
          },
        });
      } catch (updateError) {
        // 首页不能因为用户索引补写短暂失败而不可用，后续写操作会再次补偿。
      }
    }
  }

  return createdUser;
}

async function getUser(openid) {
  try {
    const result = await db.collection("users").doc(openid).get();
    if (result.data) return result.data;
  } catch (error) {
    // 缺失时按新用户创建。
  }
  return ensureUser(openid);
}

async function addRoomIdToUser(openid, roomId) {
  const user = await getUser(openid);
  const roomIds = Array.isArray(user.roomIds) ? user.roomIds : [];
  const nextRoomIds = roomIds.includes(roomId) ? roomIds : [...roomIds, roomId];
  try {
    await db.collection("users").doc(openid).update({
      data: {
        roomIds: _.addToSet(roomId),
        updatedAt: now(),
      },
    });
  } catch (error) {
    await ensureUser(openid, { roomIds: nextRoomIds });
  }
}

function sortMembers(members = []) {
  return [...members].sort((a, b) => {
    const orderDelta = Number(a.joinOrder || 0) - Number(b.joinOrder || 0);
    if (orderDelta) return orderDelta;
    return toTime(a.joinedAt) - toTime(b.joinedAt);
  });
}

function sortRecords(records = [], limit = MAX_RECORDS) {
  return [...records]
    .sort((a, b) => {
      const sequenceDelta = Number(b.sequence || 0) - Number(a.sequence || 0);
      if (sequenceDelta) return sequenceDelta;
      return toTime(b.createdAt) - toTime(a.createdAt);
    })
    .slice(0, limit);
}

function getActiveMembers(room) {
  return (room.members || []).filter((member) => member.status === MEMBER_STATUS.ACTIVE);
}

function findMember(room, openid) {
  return (room.members || []).find((member) => member.openid === openid) || null;
}

function findActiveMember(room, openid) {
  const member = findMember(room, openid);
  return member && member.status === MEMBER_STATUS.ACTIVE ? member : null;
}

function findMemberById(room, memberId) {
  return findMember(room, memberId);
}

function getOperatorNickname(room, openid) {
  const member = findMember(room, openid);
  return (member && member.nickname) || "成员";
}

function getNextJoinOrder(room) {
  return (room.members || []).reduce((max, member) => {
    return Math.max(max, Number(member.joinOrder || 0));
  }, 0) + 1;
}

function isNicknameDuplicated(room, nickname, excludeOpenid = "") {
  const key = normalizeNicknameKey(nickname);
  return (room.members || []).some((member) => {
    if (member.openid === excludeOpenid) return false;
    if (![MEMBER_STATUS.ACTIVE, MEMBER_STATUS.PENDING].includes(member.status)) return false;
    return member.nickname === nickname || normalizeNicknameKey(member.nickname) === key;
  });
}

function assertRoomWritable(room) {
  if (!room) throw new Error("房间不存在");
  if (room.status === ROOM_STATUS.CLOSED) throw new Error("房间已关闭");
  if (!isRoomWritable(room)) throw new Error("房间已过期");
}

function assertOwner(room, openid) {
  if (!room || room.ownerOpenid !== openid) throw new Error("只有房主可以操作");
}

function assertActiveMember(room, openid) {
  const member = findActiveMember(room, openid);
  if (!member) throw new Error("当前成员状态不可操作");
  return member;
}

function assertMemberActive(member) {
  if (!member || member.status !== MEMBER_STATUS.ACTIVE) {
    throw new Error("成员状态不可操作");
  }
}

function buildClientMember(member) {
  return {
    ...member,
    _id: member.openid,
    memberId: member.openid,
  };
}

function buildClientRecord(record) {
  const recordId = record.recordId || record._id;
  const scoreChanges = record.scoreChanges || [];
  const targets = (record.targets || scoreChanges).map((change) => {
    const type = change.targetType || change.type;
    const memberId = change.openid || change.memberId || "";
    return {
      type: type === "public" ? "public" : "member",
      targetType: type === "public" ? "public" : "member",
      openid: memberId,
      memberId,
      nickname: change.nickname || "",
      delta: Number(change.delta || 0),
      beforeScore: Number(change.beforeScore || 0),
      afterScore: Number(change.afterScore || 0),
    };
  });
  return {
    ...record,
    _id: recordId,
    recordId,
    scoreChanges,
    targets,
  };
}

function buildRoomView(room, openid) {
  const members = sortMembers(room.members || []).map(buildClientMember);
  const currentMember = members.find((member) => member.openid === openid) || null;
  const activeMemberCount = members.filter(
    (member) => member.status === MEMBER_STATUS.ACTIVE
  ).length;
  const pendingMembers = members.filter(
    (member) => member.status === MEMBER_STATUS.PENDING
  );
  const viewRoom = {
    ...room,
    status: room.status === ROOM_STATUS.ACTIVE && isExpired(room) ? VIEW_STATUS.EXPIRED : room.status,
    activeMemberCount,
    pendingMemberCount: pendingMembers.length,
  };
  const recentRecords = sortRecords(room.records || []).map(buildClientRecord);
  const roomView = {
    room: viewRoom,
    members,
    pendingMembers,
    recentRecords,
    version: Number(room.version || 1),
    sequence: Number(room.sequence || 0),
    updatedAt: room.updatedAt,
    schemaVersion: 3,
  };
  return {
    room: viewRoom,
    members,
    pendingMembers,
    recentRecords,
    currentMember,
    currentUserRole:
      room.ownerOpenid === openid || (currentMember && currentMember.role === MEMBER_ROLE.OWNER)
        ? MEMBER_ROLE.OWNER
        : currentMember
          ? MEMBER_ROLE.MEMBER
          : "",
    roomView,
  };
}

function assertRoomVisible(room, openid) {
  if (!room) {
    const error = new Error("房间不存在");
    error.code = "ROOM_NOT_FOUND";
    throw error;
  }
  if (isHidden(room)) {
    const error = new Error("房间已归档");
    error.code = "ROOM_ARCHIVED";
    throw error;
  }
  if (room.ownerOpenid === openid) return;
  if (findMember(room, openid)) return;
  const error = new Error("你当前不在该房间内");
  error.code = "ROOM_ACCESS_DENIED";
  throw error;
}

async function getRoomById(roomId) {
  if (!roomId) return null;
  try {
    const result = await db.collection("rooms").doc(roomId).get();
    return result.data || null;
  } catch (error) {
    return null;
  }
}

async function findRoomByCodeOrId({ roomId, roomCode }) {
  const directRoomId = normalizeText(roomId);
  if (directRoomId) return getRoomById(directRoomId);
  const code = normalizeText(roomCode).toUpperCase();
  if (!code) return null;
  const result = await db.collection("rooms").where({ roomCode: code }).limit(1).get();
  return (result.data || [])[0] || null;
}

async function generateRoomCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let code = "";
    for (let index = 0; index < 6; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const existing = await getRoomById(code);
    if (!existing) return code;
  }
  throw new Error("房间码生成失败，请重试");
}

function applyScoreChanges(room, scoreChanges) {
  const members = [...(room.members || [])];
  const nextRoom = {
    ...room,
    members,
    publicScore: Number(room.publicScore || 0),
  };
  scoreChanges.forEach((change) => {
    const delta = Number(change.delta || 0);
    if (change.targetType === "public") {
      nextRoom.publicScore += delta;
      return;
    }
    const index = members.findIndex((member) => member.openid === change.openid);
    if (index < 0) throw new Error("成员不存在");
    assertMemberActive(members[index]);
    members[index] = {
      ...members[index],
      score: Number(members[index].score || 0) + delta,
      updatedAt: now(),
    };
  });
  return nextRoom;
}

function buildRecord(room, openid, type, amount, scoreChanges, extra = {}) {
  const sequence = Number(room.sequence || 0) + 1;
  const recordId = createId("rec");
  const changesWithSnapshot = scoreChanges.map((change) => {
    if (change.targetType === "public") {
      const beforeScore = Number(room.publicScore || 0);
      return {
        ...change,
        beforeScore,
        afterScore: beforeScore + Number(change.delta || 0),
      };
    }
    const member = findMember(room, change.openid);
    const beforeScore = Number((member && member.score) || 0);
    return {
      ...change,
      nickname: change.nickname || (member && member.nickname) || "成员",
      beforeScore,
      afterScore: beforeScore + Number(change.delta || 0),
    };
  });
  return {
    recordId,
    _id: recordId,
    sequence,
    type,
    operatorOpenid: openid,
    operatorNickname: getOperatorNickname(room, openid),
    amount: Number(amount || 0),
    scoreChanges: changesWithSnapshot,
    targets: changesWithSnapshot.map((change) => ({
      type: change.targetType,
      targetType: change.targetType,
      openid: change.openid || "",
      memberId: change.openid || "",
      nickname: change.nickname || "",
      delta: Number(change.delta || 0),
      beforeScore: Number(change.beforeScore || 0),
      afterScore: Number(change.afterScore || 0),
    })),
    isUndone: false,
    undoOfRecordId: "",
    undoneByRecordId: "",
    createdAt: now(),
    ...extra,
  };
}

function appendRecord(room, record) {
  const records = sortRecords([record, ...(room.records || [])], MAX_RECORDS);
  return {
    ...room,
    sequence: record.sequence,
    records,
    updatedAt: now(),
    version: Number(room.version || 1) + 1,
  };
}

async function saveRoom(transaction, room) {
  const { _id, ...data } = room;
  await transaction.collection("rooms").doc(room._id).set({
    data,
  });
}

async function runRoomTransaction(handler) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRY; attempt += 1) {
    try {
      return await db.runTransaction(handler);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_TRANSACTION_RETRY - 1) break;
    }
  }
  throw lastError;
}

async function getOpenId() {
  const wxContext = getWxContext();
  await ensureCollections();
  await getUser(wxContext.OPENID);
  return success({
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  });
}

async function getHomeData(event = {}) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  const user = await getUser(openid);
  const roomIds = Array.isArray(user.roomIds) ? user.roomIds : [];
  const orderedRoomIds = [...roomIds].reverse();
  const pageSize = normalizeHomePageSize(event.pageSize);
  const startCursor = Math.min(normalizeHomeCursor(event.cursor), orderedRoomIds.length);
  const rooms = [];
  const invalidRoomIds = new Set();
  let scanIndex = startCursor;

  for (; scanIndex < orderedRoomIds.length && rooms.length < pageSize; scanIndex += 1) {
    const roomId = orderedRoomIds[scanIndex];
    const room = await getRoomById(roomId);
    if (!room || isHidden(room)) {
      invalidRoomIds.add(roomId);
      continue;
    }
    const member = findMember(room, openid);
    if (!member && room.ownerOpenid !== openid) {
      invalidRoomIds.add(roomId);
      continue;
    }
    rooms.push({
      roomId: room._id,
      roomCode: room.roomCode,
      name: room.name,
      status: room.status === ROOM_STATUS.ACTIVE && isExpired(room) ? VIEW_STATUS.EXPIRED : room.status,
      memberStatus: member ? member.status : MEMBER_STATUS.ACTIVE,
      activeMemberCount: getActiveMembers(room).length,
      memberLimit: room.memberLimit,
      updatedAt: room.updatedAt,
    });
  }

  const keptRoomIds = invalidRoomIds.size
    ? roomIds.filter((roomId) => !invalidRoomIds.has(roomId))
    : roomIds;
  const removedBeforeNextCursor = orderedRoomIds
    .slice(0, scanIndex)
    .filter((roomId) => invalidRoomIds.has(roomId)).length;
  const nextCursor = Math.max(0, scanIndex - removedBeforeNextCursor);

  if (invalidRoomIds.size) {
    await db.collection("users").doc(openid).update({
      data: {
        roomIds: keptRoomIds,
        updatedAt: now(),
      },
    });
  }

  return success({
    user: {
      ...user,
      roomIds: keptRoomIds,
    },
    rooms,
    nextCursor,
    hasMore: nextCursor < keptRoomIds.length,
    pageSize,
  });
}

async function saveDefaultName(event) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  const defaultName = buildNickname(event.defaultName);
  await ensureUser(openid, { defaultName });
  return success({
    defaultName,
  });
}

async function getRoom(event) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  const roomId = normalizeText(event.roomId);
  const room = await getRoomById(roomId);
  assertRoomVisible(room, openid);
  return success(buildRoomView(room, openid));
}

async function getRoomPreview(event) {
  await ensureCollections();
  const room = await findRoomByCodeOrId(event);
  if (!room) return fail("房间不存在", "ROOM_NOT_FOUND");
  if (isHidden(room)) return fail("房间已归档", "ROOM_ARCHIVED");
  return success({
    room: {
      _id: room._id,
      roomId: room._id,
      roomCode: room.roomCode,
      name: room.name,
      status: room.status === ROOM_STATUS.ACTIVE && isExpired(room) ? VIEW_STATUS.EXPIRED : room.status,
      activeMemberCount: getActiveMembers(room).length,
      memberLimit: room.memberLimit,
      requireApproval: !!room.requireApproval,
      expireAt: room.expireAt,
      hiddenAt: room.hiddenAt,
    },
  });
}

async function createRoom(event) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  await getUser(openid);

  const name = normalizeText(event.name);
  const memberLimit = parseInteger(event.memberLimit || 12);
  const publicScore = parseInteger(event.publicScore || 0);
  const ownerNickname = buildNickname(event.nickname);
  const requireApproval = !!event.requireApproval;

  if (!name) return fail("房间名称不能为空");
  if (name.length > 20) return fail("房间名称最多 20 个字符");
  if (!Number.isInteger(memberLimit) || memberLimit < 2 || memberLimit > 12) {
    return fail("人数上限必须在 2 到 12 之间");
  }
  if (!Number.isInteger(publicScore)) return fail("公共积分必须是整数");

  try {
    const roomCode = await generateRoomCode();
    const current = now();
    let createdRoom = null;
    await runRoomTransaction(async (transaction) => {
      const roomId = roomCode;
      const owner = {
        openid,
        nickname: ownerNickname,
        role: MEMBER_ROLE.OWNER,
        status: MEMBER_STATUS.ACTIVE,
        score: 0,
        joinOrder: 1,
        nicknameEdited: false,
        joinedAt: current,
        updatedAt: current,
        leftAt: null,
      };
      const baseRoom = {
        _id: roomId,
        roomCode,
        name,
        ownerOpenid: openid,
        memberLimit,
        requireApproval,
        status: ROOM_STATUS.ACTIVE,
        publicScore,
        sequence: 0,
        members: [owner],
        records: [],
        createdAt: current,
        updatedAt: current,
        expireAt: new Date(current.getTime() + ACTIVE_ROOM_DURATION_MS),
        hiddenAt: new Date(current.getTime() + ROOM_VISIBLE_DURATION_MS),
        closedAt: null,
        version: 1,
      };
      const record = buildRecord(baseRoom, openid, RECORD_TYPE.ROOM_CREATED, 0, []);
      const room = appendRecord(baseRoom, record);
      await saveRoom(transaction, room);
      createdRoom = room;
    });
    await addRoomIdToUser(openid, createdRoom._id);
    return success({
      roomId: createdRoom._id,
      roomCode: createdRoom.roomCode,
      roomView: buildRoomView(createdRoom, openid).roomView,
    });
  } catch (error) {
    return fail(error.message || "创建房间失败");
  }
}

async function joinRoom(event) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  await getUser(openid);
  const nickname = buildNickname(event.nickname);

  try {
    const room = await findRoomByCodeOrId(event);
    if (!room) return fail("房间不存在", "ROOM_NOT_FOUND");
    let nextRoom = null;
    let pending = false;
    await runRoomTransaction(async (transaction) => {
      const roomResult = await transaction.collection("rooms").doc(room._id).get();
      const currentRoom = roomResult.data;
      assertRoomWritable(currentRoom);
      if (isHidden(currentRoom)) throw new Error("房间已归档");

      const members = [...(currentRoom.members || [])];
      const existingIndex = members.findIndex((member) => member.openid === openid);
      if (existingIndex >= 0) {
        const existing = members[existingIndex];
        if (existing.status === MEMBER_STATUS.REMOVED) throw new Error("你已被移出该房间");
        if (existing.status === MEMBER_STATUS.REJECTED) throw new Error("申请未通过，无法继续加入");
        nextRoom = currentRoom;
        pending = existing.status === MEMBER_STATUS.PENDING;
        return;
      }

      if (isNicknameDuplicated(currentRoom, nickname)) throw new Error("房间内已有同名成员");
      if (getActiveMembers(currentRoom).length >= Number(currentRoom.memberLimit || 12)) {
        throw new Error("房间人数已满");
      }

      const status = currentRoom.requireApproval
        ? MEMBER_STATUS.PENDING
        : MEMBER_STATUS.ACTIVE;
      pending = status === MEMBER_STATUS.PENDING;
      const member = {
        openid,
        nickname,
        role: MEMBER_ROLE.MEMBER,
        status,
        score: 0,
        joinOrder: getNextJoinOrder(currentRoom),
        nicknameEdited: false,
        joinedAt: now(),
        updatedAt: now(),
        leftAt: null,
      };
      const roomWithMember = {
        ...currentRoom,
        members: [...members, member],
      };
      const record = buildRecord(
        roomWithMember,
        openid,
        pending ? RECORD_TYPE.MEMBER_JOIN_REQUESTED : RECORD_TYPE.MEMBER_JOINED,
        0,
        []
      );
      nextRoom = appendRecord(roomWithMember, record);
      await saveRoom(transaction, nextRoom);
    });
    await addRoomIdToUser(openid, room._id);
    return success({
      roomId: room._id,
      roomCode: room.roomCode,
      pending,
      roomView: buildRoomView(nextRoom || room, openid).roomView,
    });
  } catch (error) {
    return fail(error.message || "加入房间失败");
  }
}

async function updateNickname(event) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  const roomId = normalizeText(event.roomId);
  const nickname = buildNickname(event.nickname);
  try {
    let nextRoom = null;
    await runRoomTransaction(async (transaction) => {
      const roomResult = await transaction.collection("rooms").doc(roomId).get();
      const room = roomResult.data;
      assertRoomWritable(room);
      const members = [...(room.members || [])];
      const index = members.findIndex((member) => member.openid === openid);
      const member = members[index];
      assertMemberActive(member);
      if (member.nicknameEdited) throw new Error("昵称只能修改一次");
      if (isNicknameDuplicated(room, nickname, openid)) throw new Error("房间内已有同名成员");
      members[index] = {
        ...member,
        nickname,
        nicknameEdited: true,
        updatedAt: now(),
      };
      nextRoom = {
        ...room,
        members,
        updatedAt: now(),
        version: Number(room.version || 1) + 1,
      };
      await saveRoom(transaction, nextRoom);
    });
    return success({ roomView: buildRoomView(nextRoom, openid).roomView });
  } catch (error) {
    return fail(error.message || "修改昵称失败");
  }
}

async function updateScore(event) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  const roomId = normalizeText(event.roomId);
  const memberId = normalizeText(event.memberId);
  const action = normalizeText(event.action);
  try {
    const amount = parsePositiveAmount(event.amount);
    if (action !== "add" && action !== "subtract") throw new Error("操作类型不正确");
    let nextRoom = null;
    let recordId = "";
    await runRoomTransaction(async (transaction) => {
      const roomResult = await transaction.collection("rooms").doc(roomId).get();
      const room = roomResult.data;
      assertRoomWritable(room);
      assertOwner(room, openid);
      const member = findMemberById(room, memberId);
      assertMemberActive(member);
      const delta = action === "subtract" ? -amount : amount;
      const scoreChanges = [
        {
          targetType: "member",
          openid: member.openid,
          nickname: member.nickname,
          delta,
        },
      ];
      const record = buildRecord(
        room,
        openid,
        delta > 0 ? RECORD_TYPE.MEMBER_ADD : RECORD_TYPE.MEMBER_SUBTRACT,
        amount,
        scoreChanges
      );
      recordId = record.recordId;
      nextRoom = appendRecord(applyScoreChanges(room, scoreChanges), record);
      await saveRoom(transaction, nextRoom);
    });
    return success({ recordId, roomView: buildRoomView(nextRoom, openid).roomView });
  } catch (error) {
    return fail(error.message || "更新积分失败");
  }
}

async function batchUpdateScore(event) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  const roomId = normalizeText(event.roomId);
  const action = normalizeText(event.action);
  const memberIds = Array.isArray(event.memberIds) ? event.memberIds.map(normalizeText) : [];
  try {
    const amount = parsePositiveAmount(event.amount);
    if (!memberIds.length) throw new Error("请选择成员");
    if (action !== "add" && action !== "subtract") throw new Error("操作类型不正确");
    let nextRoom = null;
    let recordId = "";
    await runRoomTransaction(async (transaction) => {
      const roomResult = await transaction.collection("rooms").doc(roomId).get();
      const room = roomResult.data;
      assertRoomWritable(room);
      assertOwner(room, openid);
      const delta = action === "subtract" ? -amount : amount;
      const uniqueMemberIds = [...new Set(memberIds)];
      const scoreChanges = uniqueMemberIds.map((memberId) => {
        const member = findMemberById(room, memberId);
        assertMemberActive(member);
        return {
          targetType: "member",
          openid: member.openid,
          nickname: member.nickname,
          delta,
        };
      });
      const record = buildRecord(
        room,
        openid,
        delta > 0 ? RECORD_TYPE.BATCH_ADD : RECORD_TYPE.BATCH_SUBTRACT,
        amount,
        scoreChanges
      );
      recordId = record.recordId;
      nextRoom = appendRecord(applyScoreChanges(room, scoreChanges), record);
      await saveRoom(transaction, nextRoom);
    });
    return success({ recordId, roomView: buildRoomView(nextRoom, openid).roomView });
  } catch (error) {
    return fail(error.message || "批量记分失败");
  }
}

function buildTransferScoreChanges(room, fromType, fromMemberId, targets, amount) {
  if (fromType !== "public" && fromType !== "member") throw new Error("转出来源不正确");
  if (!Array.isArray(targets) || !targets.length) throw new Error("请选择转入目标");

  const changesByKey = {};
  const addChange = (targetType, openid, delta) => {
    const key = targetType === "public" ? "public" : `member:${openid}`;
    const member = targetType === "member" ? findMemberById(room, openid) : null;
    if (targetType === "member") assertMemberActive(member);
    if (!changesByKey[key]) {
      changesByKey[key] = {
        targetType,
        openid: targetType === "member" ? openid : "",
        nickname: member ? member.nickname : "",
        delta: 0,
      };
    }
    changesByKey[key].delta += delta;
  };

  const seenTargets = {};
  targets.forEach((target) => {
    const toType = target.toType;
    const toMemberId = normalizeText(target.toMemberId);
    if (toType !== "public" && toType !== "member") throw new Error("转入目标不正确");
    if (toType === "member" && !toMemberId) throw new Error("转入成员不能为空");
    if (fromType === "public" && toType === "public") throw new Error("来源和目标不能相同");
    if (fromType === "member" && toType === "member" && fromMemberId === toMemberId) {
      throw new Error("转出和转入成员不能相同");
    }
    const key = `${toType}:${toMemberId || "public"}`;
    if (seenTargets[key]) throw new Error("转入目标重复");
    seenTargets[key] = true;
  });

  if (fromType === "public") {
    addChange("public", "", -amount * targets.length);
  } else {
    const fromMember = findMemberById(room, fromMemberId);
    assertMemberActive(fromMember);
    addChange("member", fromMember.openid, -amount * targets.length);
  }

  targets.forEach((target) => {
    if (target.toType === "public") {
      addChange("public", "", amount);
      return;
    }
    const toMember = findMemberById(room, normalizeText(target.toMemberId));
    assertMemberActive(toMember);
    addChange("member", toMember.openid, amount);
  });

  return Object.values(changesByKey).filter((change) => change.delta !== 0);
}

function assertTransferPermission(room, openid, fromType, fromMemberId, targets) {
  if (room.ownerOpenid === openid) return;
  const currentMember = assertActiveMember(room, openid);
  if (fromType === "member" && fromMemberId !== currentMember.openid) {
    throw new Error("成员只能转出自己的积分");
  }
  if (fromType === "public") {
    const onlyToSelf =
      targets.length === 1 &&
      targets[0].toType === "member" &&
      normalizeText(targets[0].toMemberId) === currentMember.openid;
    if (!onlyToSelf) throw new Error("成员只能从公共积分池转给自己");
  }
}

async function batchTransferScore(event) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  const roomId = normalizeText(event.roomId);
  const fromType = normalizeText(event.fromType || "member");
  const fromMemberId = normalizeText(event.fromMemberId);
  const targets = Array.isArray(event.targets) ? event.targets : [];
  try {
    const amount = parsePositiveAmount(event.amount);
    let nextRoom = null;
    let recordId = "";
    await runRoomTransaction(async (transaction) => {
      const roomResult = await transaction.collection("rooms").doc(roomId).get();
      const room = roomResult.data;
      assertRoomWritable(room);
      assertTransferPermission(room, openid, fromType, fromMemberId, targets);
      const scoreChanges = buildTransferScoreChanges(
        room,
        fromType,
        fromMemberId,
        targets,
        amount
      );
      const publicChange = scoreChanges.find((change) => change.targetType === "public");
      if (publicChange && Number(room.publicScore || 0) + publicChange.delta < 0) {
        throw new Error("公共积分不足");
      }
      const type =
        targets.length > 1
          ? RECORD_TYPE.BATCH_TRANSFER
          : fromType === "public"
            ? RECORD_TYPE.PUBLIC_TO_MEMBER
            : targets[0].toType === "public"
              ? RECORD_TYPE.MEMBER_TO_PUBLIC
              : RECORD_TYPE.MEMBER_TO_MEMBER;
      const record = buildRecord(room, openid, type, amount, scoreChanges);
      recordId = record.recordId;
      nextRoom = appendRecord(applyScoreChanges(room, scoreChanges), record);
      await saveRoom(transaction, nextRoom);
    });
    return success({ recordId, roomView: buildRoomView(nextRoom, openid).roomView });
  } catch (error) {
    return fail(error.message || "积分转移失败");
  }
}

async function undoLastAction(event) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  const roomId = normalizeText(event.roomId);
  const recordId = normalizeText(event.recordId);
  try {
    let nextRoom = null;
    let undoRecordId = "";
    await runRoomTransaction(async (transaction) => {
      const roomResult = await transaction.collection("rooms").doc(roomId).get();
      const room = roomResult.data;
      assertRoomWritable(room);
      assertOwner(room, openid);
      const records = [...(room.records || [])];
      const recordIndex = records.findIndex(
        (record) => record.recordId === recordId || record._id === recordId
      );
      const original = records[recordIndex];
      if (!original) throw new Error("记录不存在");
      if (original.isUndone) throw new Error("该记录已撤销");
      if (!UNDOABLE_TYPES.includes(original.type)) throw new Error("该记录不可撤销");
      const reverseChanges = (original.scoreChanges || []).map((change) => ({
        targetType: change.targetType,
        openid: change.openid || "",
        nickname: change.nickname || "",
        delta: -Number(change.delta || 0),
      }));
      const undoRecord = buildRecord(room, openid, RECORD_TYPE.UNDO, original.amount || 0, reverseChanges, {
        undoOfRecordId: original.recordId || original._id,
      });
      undoRecordId = undoRecord.recordId;
      records[recordIndex] = {
        ...original,
        isUndone: true,
        undoneByRecordId: undoRecord.recordId,
      };
      const roomWithMarkedRecord = {
        ...room,
        records,
      };
      nextRoom = appendRecord(applyScoreChanges(roomWithMarkedRecord, reverseChanges), undoRecord);
      await saveRoom(transaction, nextRoom);
    });
    return success({ recordId: undoRecordId, roomView: buildRoomView(nextRoom, openid).roomView });
  } catch (error) {
    return fail(error.message || "撤销失败");
  }
}

async function reviewJoinRequest(event) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  const roomId = normalizeText(event.roomId);
  const memberId = normalizeText(event.memberId);
  const approved = normalizeText(event.action) === "approve";
  try {
    let nextRoom = null;
    await runRoomTransaction(async (transaction) => {
      const roomResult = await transaction.collection("rooms").doc(roomId).get();
      const room = roomResult.data;
      assertRoomWritable(room);
      assertOwner(room, openid);
      const members = [...(room.members || [])];
      const index = members.findIndex((member) => member.openid === memberId);
      const member = members[index];
      if (!member || member.status !== MEMBER_STATUS.PENDING) throw new Error("申请不存在");
      if (approved && getActiveMembers(room).length >= Number(room.memberLimit || 12)) {
        throw new Error("房间人数已满");
      }
      members[index] = {
        ...member,
        status: approved ? MEMBER_STATUS.ACTIVE : MEMBER_STATUS.REJECTED,
        updatedAt: now(),
        leftAt: approved ? null : now(),
      };
      const roomWithMember = {
        ...room,
        members,
      };
      const record = buildRecord(
        roomWithMember,
        openid,
        approved ? RECORD_TYPE.MEMBER_JOINED : RECORD_TYPE.MEMBER_JOIN_REJECTED,
        0,
        []
      );
      nextRoom = appendRecord(roomWithMember, record);
      await saveRoom(transaction, nextRoom);
    });
    return success({ memberId, approved, roomView: buildRoomView(nextRoom, openid).roomView });
  } catch (error) {
    return fail(error.message || "处理申请失败");
  }
}

async function removeMember(event) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  const roomId = normalizeText(event.roomId);
  const memberId = normalizeText(event.memberId);
  try {
    let nextRoom = null;
    await runRoomTransaction(async (transaction) => {
      const roomResult = await transaction.collection("rooms").doc(roomId).get();
      const room = roomResult.data;
      assertRoomWritable(room);
      assertOwner(room, openid);
      if (memberId === room.ownerOpenid) throw new Error("不能移出房主");
      const members = [...(room.members || [])];
      const index = members.findIndex((member) => member.openid === memberId);
      const member = members[index];
      if (!member || member.status !== MEMBER_STATUS.ACTIVE) throw new Error("成员状态不可移出");
      members[index] = {
        ...member,
        status: MEMBER_STATUS.REMOVED,
        updatedAt: now(),
        leftAt: now(),
      };
      const roomWithMember = {
        ...room,
        members,
      };
      const record = buildRecord(roomWithMember, openid, RECORD_TYPE.MEMBER_REMOVED, 0, []);
      nextRoom = appendRecord(roomWithMember, record);
      await saveRoom(transaction, nextRoom);
    });
    return success({ memberId, roomView: buildRoomView(nextRoom, openid).roomView });
  } catch (error) {
    return fail(error.message || "移出成员失败");
  }
}

async function closeRoom(event) {
  await ensureCollections();
  const openid = getWxContext().OPENID;
  const roomId = normalizeText(event.roomId);
  try {
    let nextRoom = null;
    await runRoomTransaction(async (transaction) => {
      const roomResult = await transaction.collection("rooms").doc(roomId).get();
      const room = roomResult.data;
      assertRoomWritable(room);
      assertOwner(room, openid);
      const closedRoom = {
        ...room,
        status: ROOM_STATUS.CLOSED,
        closedAt: now(),
      };
      const record = buildRecord(closedRoom, openid, RECORD_TYPE.ROOM_CLOSED, 0, []);
      nextRoom = appendRecord(closedRoom, record);
      await saveRoom(transaction, nextRoom);
    });
    return success({ roomView: buildRoomView(nextRoom, openid).roomView });
  } catch (error) {
    return fail(error.message || "关闭房间失败");
  }
}

exports.main = async (event = {}) => {
  const type = event.type || event.action || "";
  try {
    switch (type) {
      case "getOpenId":
        return getOpenId();
      case "getHomeData":
        return getHomeData(event);
      case "saveDefaultName":
        return saveDefaultName(event);
      case "getRoom":
        return getRoom(event);
      case "getRoomPreview":
        return getRoomPreview(event);
      case "createRoom":
        return createRoom(event);
      case "joinRoom":
        return joinRoom(event);
      case "updateNickname":
        return updateNickname(event);
      case "updateScore":
        return updateScore(event);
      case "batchUpdateScore":
        return batchUpdateScore(event);
      case "transferScore":
      case "batchTransferScore":
        return batchTransferScore(event);
      case "undoLastAction":
        return undoLastAction(event);
      case "reviewJoinRequest":
        return reviewJoinRequest(event);
      case "removeMember":
        return removeMember(event);
      case "closeRoom":
        return closeRoom(event);
      default:
        return fail("未知操作类型", "UNKNOWN_ACTION");
    }
  } catch (error) {
    return fail(error.message || "操作失败", error.code || "SERVER_ERROR");
  }
};
