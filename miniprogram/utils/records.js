const TYPE_LABELS = {
  member_add: "成员加分",
  member_subtract: "成员扣分",
  batch_add: "批量加分",
  batch_subtract: "批量扣分",
  public_to_member: "公共积分转出",
  member_to_public: "转回公共积分",
  member_to_member: "成员间转移",
  batch_transfer: "批量转移",
  undo: "撤销操作",
  room_created: "创建房间",
  member_joined: "加入房间",
  member_join_requested: "申请加入",
  member_join_rejected: "暂不加入",
  member_removed: "成员移出",
  room_closed: "关闭房间",
};

const POSITIVE_RECORD_TYPES = ["member_add", "batch_add"];
const NEGATIVE_RECORD_TYPES = ["member_subtract", "batch_subtract"];
const TRANSFER_RECORD_TYPES = [
  "public_to_member",
  "member_to_public",
  "member_to_member",
  "batch_transfer",
];
const UNDOABLE_RECORD_TYPES = [
  "member_add",
  "member_subtract",
  "batch_add",
  "batch_subtract",
  "public_to_member",
  "member_to_public",
  "member_to_member",
  "batch_transfer",
];

function formatTime(value, mode = "short") {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (mode === "full") return `${date.getFullYear()}-${monthDay} ${clock}`;
  return `${monthDay} ${clock}`;
}

function getTimeValue(value) {
  if (!value) return 0;
  if (typeof value.getTime === "function") return value.getTime();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value.$date) return new Date(value.$date).getTime() || 0;
  return new Date(value).getTime() || 0;
}

function compareRecordsBySequence(a, b) {
  const sequenceDelta = Number(b.sequence || 0) - Number(a.sequence || 0);
  if (sequenceDelta) return sequenceDelta;
  const timeDelta = getTimeValue(b.createdAt) - getTimeValue(a.createdAt);
  if (timeDelta) return timeDelta;
  return String(b._id || "").localeCompare(String(a._id || ""));
}

function sortRecordsForView(records, limit = 50) {
  return [...(records || [])].sort(compareRecordsBySequence).slice(0, limit);
}

function getRecordTone(record) {
  if (POSITIVE_RECORD_TYPES.includes(record.type)) return "record-positive";
  if (NEGATIVE_RECORD_TYPES.includes(record.type)) return "record-negative";
  if (TRANSFER_RECORD_TYPES.includes(record.type)) return "record-transfer";
  if (record.type === "undo") return "record-undo";
  return "record-neutral";
}

function getAmountText(record, options = {}) {
  if (!record.amount) return options.zeroText || "";
  if (POSITIVE_RECORD_TYPES.includes(record.type)) return `+${record.amount}`;
  if (NEGATIVE_RECORD_TYPES.includes(record.type)) return `-${record.amount}`;
  if (TRANSFER_RECORD_TYPES.includes(record.type)) return `±${record.amount}`;
  return `${record.amount}`;
}

function getTargetLabel(target, currentMemberId) {
  const targetType = target.targetType || target.type;
  const memberId = target.memberId || target.openid || "";
  if (targetType === "public") return "公共积分池";
  if (memberId && memberId === currentMemberId) return "我";
  return target.nickname || target.name || "成员";
}

function getTargetDelta(target) {
  if (target.delta !== undefined) return Number(target.delta || 0);
  const beforeScore = Number(target.beforeScore || 0);
  const afterScore = Number(target.afterScore || 0);
  return afterScore - beforeScore;
}

function getRecordTargets(record) {
  return record.targets || record.scoreChanges || [];
}

function formatChangedTargets(record, currentMemberId) {
  return getRecordTargets(record)
    .map((target) => getTargetLabel(target, currentMemberId))
    .join("、");
}

function formatFlowTargets(record, currentMemberId) {
  const targets = getRecordTargets(record);
  const sources = targets
    .filter((target) => getTargetDelta(target) < 0)
    .map((target) => getTargetLabel(target, currentMemberId));
  const destinations = targets
    .filter((target) => getTargetDelta(target) > 0)
    .map((target) => getTargetLabel(target, currentMemberId));

  if (sources.length && destinations.length) {
    return `${sources.join("、")} → ${destinations.join("、")}`;
  }
  return targets.map((target) => getTargetLabel(target, currentMemberId)).join("、");
}

function findRecordMemberTarget(record, memberId) {
  return getRecordTargets(record).find(
    (target) =>
      (target.targetType || target.type) === "member" &&
      (target.openid || target.memberId) === memberId
  );
}

function getSnapshotMemberLabel(record, memberId, currentMemberId) {
  const target = findRecordMemberTarget(record, memberId);
  if (target) return getTargetLabel(target, currentMemberId);
  if (memberId === currentMemberId) return "我";
  return "成员";
}

function formatSnapshotFlow(record, currentMemberId) {
  const beforeSnapshot = record.beforeSnapshot || {};
  const afterSnapshot = record.afterSnapshot || {};
  const flows = [];

  if (beforeSnapshot.room && afterSnapshot.room) {
    flows.push({
      label: "公共积分池",
      delta:
        Number(afterSnapshot.room.publicScore || 0) -
        Number(beforeSnapshot.room.publicScore || 0),
    });
  }

  const beforeMemberMap = (beforeSnapshot.members || []).reduce((map, member) => {
    map[member.memberId] = Number(member.score || 0);
    return map;
  }, {});
  const afterMemberMap = (afterSnapshot.members || []).reduce((map, member) => {
    map[member.memberId] = Number(member.score || 0);
    return map;
  }, {});
  const memberIds = [
    ...new Set([...Object.keys(beforeMemberMap), ...Object.keys(afterMemberMap)]),
  ];

  memberIds.forEach((memberId) => {
    flows.push({
      label: getSnapshotMemberLabel(record, memberId, currentMemberId),
      delta: Number(afterMemberMap[memberId] || 0) - Number(beforeMemberMap[memberId] || 0),
    });
  });

  const sources = flows.filter((flow) => flow.delta < 0).map((flow) => flow.label);
  const destinations = flows.filter((flow) => flow.delta > 0).map((flow) => flow.label);
  if (sources.length && destinations.length) {
    return `${sources.join("、")} → ${destinations.join("、")}`;
  }
  return "";
}

function getRecordTargetsText(record, currentMemberId) {
  if (POSITIVE_RECORD_TYPES.includes(record.type) || NEGATIVE_RECORD_TYPES.includes(record.type)) {
    return formatChangedTargets(record, currentMemberId);
  }
  if (TRANSFER_RECORD_TYPES.includes(record.type)) {
    return formatFlowTargets(record, currentMemberId);
  }
  if (record.type === "undo") {
    const flowText =
      formatSnapshotFlow(record, currentMemberId) || formatFlowTargets(record, currentMemberId);
    return flowText ? `撤销：${flowText}` : "撤销操作";
  }
  const targets = getRecordTargets(record)
    .map((target) => getTargetLabel(target, currentMemberId))
    .join("、");
  return targets || "房间";
}

function formatRecord(record, currentMemberId, options = {}) {
  return {
    ...record,
    displayType: TYPE_LABELS[record.type] || record.type,
    displayOperator: record.operatorNickname || "成员",
    displayTargets: getRecordTargetsText(record, currentMemberId),
    displayTime: formatTime(record.createdAt, options.timeMode || "short"),
    amountText: getAmountText(record, options),
    toneClass: getRecordTone(record),
    canUndo: UNDOABLE_RECORD_TYPES.includes(record.type) && !record.isUndone,
  };
}

module.exports = {
  formatRecord,
  sortRecordsForView,
};
