const { callScoreFunction, saveRecentRoom, showError } = require("../../utils/api");

Page({
  data: {
    name: "",
    memberLimit: 12,
    publicScore: 0,
    nickname: "",
    submitting: false,
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [field]: event.detail.value,
    });
  },

  submit() {
    if (this.data.submitting) return;
    const name = String(this.data.name || "").trim();
    if (!name) {
      wx.showToast({
        title: "请输入房间名称",
        icon: "none",
      });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "创建中" });
    callScoreFunction("createRoom", {
      name,
      memberLimit: Number(this.data.memberLimit),
      publicScore: Number(this.data.publicScore),
      nickname: this.data.nickname,
    })
      .then((result) => {
        saveRecentRoom({
          roomId: result.roomId,
          roomCode: result.roomCode,
          name,
        });
        wx.redirectTo({
          url: `/pages/room/index?roomId=${result.roomId}`,
        });
      })
      .catch(showError)
      .finally(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
      });
  },
});
