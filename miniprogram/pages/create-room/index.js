const { callScoreFunction, saveRecentRoom, showError } = require("../../utils/api");
const { getRoomProfile } = require("../../utils/profile");

function buildDefaultRoomName(nickname) {
  const prefix = String(nickname || "").trim().slice(0, 6) || "我的";
  return `${prefix}的房间`.slice(0, 20);
}

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
    // 用户是否已经手动编辑房间名称。
    roomNameTouched: false,
    // 是否需要房主确认后才能加入。
    requireApproval: false,
    // 提交中状态，防止重复创建。
    submitting: false,
  },

  // 进入页面时默认使用首页设置的名称。
  onLoad() {
    const profile = getRoomProfile();
    this.setData({
      name: buildDefaultRoomName(profile.nickname),
      nickname: profile.nickname,
    });
  },

  // 根据输入框绑定的 field 更新对应表单字段。
  onInput(event) {
    const { field } = event.currentTarget.dataset;
    const value = event.detail.value;
    if (field === "name") {
      this.setData({
        name: value,
        roomNameTouched: true,
      });
      return;
    }
    if (field === "nickname") {
      const nextData = { nickname: value };
      if (!this.data.roomNameTouched) {
        nextData.name = buildDefaultRoomName(value || getRoomProfile().nickname);
      }
      this.setData(nextData);
      return;
    }
    this.setData({
      [field]: value,
    });
  },

  onRequireApprovalChange(event) {
    this.setData({
      requireApproval: !!event.detail.value,
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
      requireApproval: this.data.requireApproval,
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
