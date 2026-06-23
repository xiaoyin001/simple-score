const { callScoreFunction, showError } = require("../../utils/api");

const TYPE_LABELS = {
  member_add: "成员加分",
  member_subtract: "成员扣分",
  batch_add: "批量加分",
  batch_subtract: "批量扣分",
  public_to_member: "公共积分转出",
  member_to_public: "转回公共积分",
  member_to_member: "成员间转移",
  undo: "撤销操作",
  room_created: "创建房间",
  member_joined: "加入房间",
  room_closed: "关闭房间",
};

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRecord(record) {
  const targets = (record.targets || [])
    .map((target) => target.nickname || target.name || (target.type === "public" ? "公共积分池" : "成员"))
    .join("、");
  return {
    ...record,
    displayType: TYPE_LABELS[record.type] || record.type,
    displayTargets: targets || "房间",
    displayTime: formatTime(record.createdAt),
    amountText: record.amount ? `${record.amount}` : "0",
  };
}

Page({
  data: {
    roomId: "",
    room: null,
    records: [],
    loading: true,
  },

  onLoad(options) {
    this.setData({
      roomId: options.roomId || "",
    });
    this.loadRecords();
  },

  onPullDownRefresh() {
    this.loadRecords().finally(() => wx.stopPullDownRefresh());
  },

  loadRecords() {
    this.setData({ loading: true });
    return callScoreFunction("getRoom", { roomId: this.data.roomId })
      .then((result) => {
        this.setData({
          room: result.room,
          records: (result.recentRecords || []).map(formatRecord),
          loading: false,
        });
      })
      .catch((error) => {
        this.setData({ loading: false });
        showError(error);
      });
  },
});
