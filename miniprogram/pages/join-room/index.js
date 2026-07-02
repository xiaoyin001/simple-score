const { callScoreFunction, saveRecentRoom, showError } = require("../../utils/api");
const { getRoomProfile } = require("../../utils/profile");
const {
  buildAppShareMessage,
  buildAppTimelineShare,
  buildRoomShareMessage,
  buildRoomTimelineShare,
  enablePageShare,
} = require("../../utils/share");
const { parseRoomEntry } = require("../../utils/room-entry");

function enterRoom(roomId) {
  if (!roomId) {
    wx.showToast({
      title: "缺少房间信息",
      icon: "none",
    });
    return;
  }
  wx.redirectTo({
    url: `/pages/room/index?roomId=${roomId}`,
    fail: () => {
      wx.showToast({
        title: "进入房间失败，请重试",
        icon: "none",
      });
    },
  });
}

Page({
  data: {
    // 分享路径携带的房间 ID。
    roomId: "",
    // 用户输入或扫码得到的房间码。
    roomCode: "",
    // 加入房间时使用的显示昵称。
    nickname: "",
    // 提交中状态，防止重复加入。
    submitting: false,
  },

  // 接收首页、扫码或分享路径传入的房间参数。
  onLoad(options) {
    enablePageShare();
    const profile = getRoomProfile();
    const entry = parseRoomEntry(options);
    this.setData({
      roomId: entry.roomId,
      roomCode: entry.roomCode,
      nickname: profile.nickname,
    });
  },

  onShow() {
    enablePageShare();
  },

  // 根据输入框绑定的 field 更新对应表单字段。
  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [field]: event.detail.value,
    });
  },

  // 提交加入房间请求，成功后进入房间详情页。
  submit() {
    if (this.data.submitting) return;
    const roomCode = String(this.data.roomCode || "").trim().toUpperCase();
    const roomId = String(this.data.roomId || "").trim();
    if (!roomCode && !roomId) {
      wx.showToast({
        title: "请输入房间码",
        icon: "none",
      });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "加入中" });
    let loadingVisible = true;
    const profile = getRoomProfile();
    callScoreFunction("joinRoom", {
      roomId,
      roomCode,
      nickname: String(this.data.nickname || "").trim() || profile.nickname,
    })
      .then((result) => {
        const room = (result.roomView && result.roomView.room) || {};
        const targetRoomId = result.roomId || room._id;
        saveRecentRoom({
          roomId: targetRoomId,
          roomCode: result.roomCode || roomCode,
          name: room.name || "记分房间",
        });
        wx.hideLoading();
        loadingVisible = false;
        if (result.pending) {
          wx.showToast({
            title: result.alreadyJoined ? "正在等待房主确认" : "已申请，等待房主确认",
            icon: "none",
          });
        }
        enterRoom(targetRoomId);
      })
      .catch((error) => {
        wx.hideLoading();
        loadingVisible = false;
        showError(error);
      })
      .finally(() => {
        if (loadingVisible) wx.hideLoading();
        this.setData({ submitting: false });
      });
  },

  onShareAppMessage() {
    if (this.data.roomId || this.data.roomCode) {
      return buildRoomShareMessage({
        _id: this.data.roomId,
        roomCode: this.data.roomCode,
      });
    }
    return buildAppShareMessage();
  },

  onShareTimeline() {
    if (this.data.roomId || this.data.roomCode) {
      return buildRoomTimelineShare({
        _id: this.data.roomId,
        roomCode: this.data.roomCode,
      });
    }
    return buildAppTimelineShare();
  },
});
