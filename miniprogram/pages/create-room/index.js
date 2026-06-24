const { callScoreFunction, saveRecentRoom, showError } = require("../../utils/api");
const { getRoomProfile } = require("../../utils/profile");

Page({
  data: {
    // 房间名称，提交前会去除首尾空白。
    name: "",
    // 房间人数上限，云函数再次校验 2 到 12。
    memberLimit: 12,
    // 公共积分初始值。
    publicScore: 0,
    // 创建者在房间内展示的昵称。
    nickname: "",
    // 提交中状态，防止重复创建。
    submitting: false,
  },

  // 进入页面时默认使用首页设置的名称。
  onLoad() {
    const profile = getRoomProfile();
    this.setData({
      nickname: profile.nickname,
    });
  },

  // 根据输入框绑定的 field 更新对应表单字段。
  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [field]: event.detail.value,
    });
  },

  // 提交创建房间请求，成功后进入房间详情页。
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
    const profile = getRoomProfile();
    callScoreFunction("createRoom", {
      name,
      memberLimit: Number(this.data.memberLimit),
      publicScore: Number(this.data.publicScore),
      nickname: String(this.data.nickname || "").trim() || profile.nickname,
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
