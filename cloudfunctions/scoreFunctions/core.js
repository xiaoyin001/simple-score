function normalizeNicknameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function assertScoreAction(action) {
  if (action !== "add" && action !== "subtract") {
    throw new Error("操作类型不正确");
  }
}

function buildTransferDeltas({ fromType, fromMemberId, targets, amount }) {
  if (fromType !== "public" && fromType !== "member") {
    throw new Error("转出来源不正确");
  }
  if (!Array.isArray(targets) || !targets.length) {
    throw new Error("请选择转入目标");
  }
  const memberDeltas = {};
  let publicDelta = 0;
  const seenTargets = {};

  targets.forEach((target) => {
    const toType = target.toType;
    const toMemberId = target.toMemberId || "";
    if (toType !== "public" && toType !== "member") {
      throw new Error("转入目标不正确");
    }
    if (toType === "member" && !toMemberId) {
      throw new Error("转入成员不能为空");
    }
    if (fromType === "public" && toType === "public") {
      throw new Error("来源和目标不能相同");
    }
    if (fromType === "member" && toType === "member" && fromMemberId === toMemberId) {
      throw new Error("转出和转入成员不能相同");
    }
    const key = `${toType}:${toMemberId || "public"}`;
    if (seenTargets[key]) {
      throw new Error("转入目标重复");
    }
    seenTargets[key] = true;
  });

  if (fromType === "public") {
    publicDelta -= amount * targets.length;
  } else {
    memberDeltas[fromMemberId] = (memberDeltas[fromMemberId] || 0) - amount * targets.length;
  }

  targets.forEach((target) => {
    if (target.toType === "public") {
      publicDelta += amount;
      return;
    }
    memberDeltas[target.toMemberId] = (memberDeltas[target.toMemberId] || 0) + amount;
  });

  return {
    publicDelta,
    memberDeltas,
  };
}

function mapScores(items) {
  return (items || []).reduce((map, item) => {
    if (item && item.memberId) {
      map[item.memberId] = Number(item.score || 0);
    }
    return map;
  }, {});
}

function buildUndoDeltas(beforeSnapshot = {}, afterSnapshot = {}) {
  const memberDeltas = {};
  let publicDelta = 0;

  if (beforeSnapshot.room && afterSnapshot.room) {
    publicDelta =
      Number(beforeSnapshot.room.publicScore || 0) -
      Number(afterSnapshot.room.publicScore || 0);
  }

  const beforeMemberMap = mapScores(beforeSnapshot.members || []);
  const afterMemberMap = mapScores(afterSnapshot.members || []);
  const memberIds = [
    ...new Set([...Object.keys(beforeMemberMap), ...Object.keys(afterMemberMap)]),
  ];

  memberIds.forEach((memberId) => {
    memberDeltas[memberId] =
      Number(beforeMemberMap[memberId] || 0) - Number(afterMemberMap[memberId] || 0);
  });

  return {
    publicDelta,
    memberDeltas,
  };
}

module.exports = {
  assertScoreAction,
  buildTransferDeltas,
  buildUndoDeltas,
  normalizeNicknameKey,
};
