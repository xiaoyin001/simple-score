const {
  DEFAULT_ROOM_NICKNAME,
  getStoredProfile,
  saveUserProfile,
} = require("../../utils/profile");

function buildProfileView(profile) {
  const defaultName = String((profile && profile.defaultName) || "").trim();
  return {
    userProfile: profile,
    profileDraftName: defaultName || DEFAULT_ROOM_NICKNAME,
    profileSavedName: defaultName,
  };
}

function getValidRecentRooms() {
  const rooms = wx.getStorageSync("recentRooms") || [];
  return rooms.filter((room) => room && room.roomId);
}

// 从扫码结果或分享路径中读取指定查询参数。
function getQueryValue(text, key) {
  const match = String(text || "").match(new RegExp(`[?&]${key}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

Page({
  data: {
    // 最近进入过的房间列表，来自本地缓存。
    recentRooms: [],
    // 当前用户资料保存在本地，用于创建或加入房间时默认带入。
    userProfile: getStoredProfile(),
    // 默认名草稿，点击保存后才写入本地缓存。
    profileDraftName: DEFAULT_ROOM_NICKNAME,
    profileSavedName: "",
    profileSaving: false,
    profileError: "",
  },

  // 处理分享路径携带的房间参数，直接进入加入流程。
  onLoad(options) {
    const roomId = options.roomId || "";
    const roomCode = options.roomCode || "";
    if (roomId || roomCode) {
      wx.navigateTo({
        url: `/pages/join-room/index?roomId=${roomId}&roomCode=${roomCode}`,
      });
    }
  },

  // 页面展示时刷新最近房间列表。
  onShow() {
    const userProfile = getStoredProfile();
    this.setData({
      ...buildProfileView(userProfile),
      recentRooms: getValidRecentRooms(),
    });
  },

  // 只更新草稿，不直接写入本地缓存。
  onProfileDraftInput(event) {
    const draftName = event.detail.value;
    this.setData({
      profileDraftName: draftName,
      profileError: String(draftName || "").trim() ? "" : "默认名不能为空",
    });
  },

  // 点击保存后才写入首页默认名。
  saveProfileName() {
    if (this.data.profileSaving) return;
    const defaultName = String(this.data.profileDraftName || "").trim();
    if (!defaultName) {
      this.setData({ profileError: "默认名不能为空" });
      return;
    }
    if (defaultName.length > 20) {
      this.setData({ profileError: "默认名最多 20 个字符" });
      return;
    }

    this.setData({
      profileSaving: true,
      profileError: "",
    });

    const userProfile = saveUserProfile({ defaultName });
    this.setData({
      ...buildProfileView(userProfile),
      profileSaving: false,
      profileError: "",
    });
    wx.showToast({
      title: "默认名已保存",
      icon: "none",
    });
  },

  // 跳转到创建房间页。
  goCreate() {
    wx.navigateTo({
      url: "/pages/create-room/index",
    });
  },

  // 跳转到手动加入房间页。
  goJoin() {
    wx.navigateTo({
      url: "/pages/join-room/index",
    });
  },

  // 从最近房间列表进入房间详情页。
  goRoom(event) {
    const { roomId } = event.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/room/index?roomId=${roomId}`,
    });
  },

  // 扫描二维码或条码并解析房间码。
  scanJoin() {
    wx.scanCode({
      scanType: ["qrCode", "barCode"],
      success: (result) => {
        const raw = result.result || "";
        const roomId = getQueryValue(raw, "roomId");
        const roomCode = getQueryValue(raw, "roomCode") || raw.trim();
        wx.navigateTo({
          url: `/pages/join-room/index?roomId=${roomId}&roomCode=${roomCode}`,
        });
      },
      fail: () => {
        wx.showToast({
          title: "未识别到房间码",
          icon: "none",
        });
      },
    });
  },
});
