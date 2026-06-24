const {
  getAvatarInitial,
  getStoredProfile,
  saveUserProfile,
} = require("../../utils/profile");

function buildProfileView(profile) {
  const defaultName = String((profile && profile.defaultName) || "").trim();
  return {
    userProfile: profile,
    avatarInitial: getAvatarInitial(defaultName),
    profileDisplayName: defaultName || "默认名",
    profileAuthed: Boolean(profile && profile.avatarUrl),
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
    // 没有头像时展示默认名首字。
    avatarInitial: getAvatarInitial(""),
    // 身份胶囊中展示的名称，未设置时显示默认占位文案。
    profileDisplayName: "默认名",
    // 是否已获取头像，影响授权入口展示。
    profileAuthed: false,
    // 默认名编辑态。
    profileEditing: false,
    profileDraftName: "",
    profileOriginalName: "",
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

  // 通过微信授权读取头像昵称，用户也可以继续手动调整默认名。
  getWechatProfile() {
    if (!wx.getUserProfile) {
      wx.showToast({
        title: "当前微信版本不支持",
        icon: "none",
      });
      return;
    }

    wx.getUserProfile({
      desc: "用于展示当前用户信息",
      success: (result) => {
        const userInfo = result.userInfo || {};
        const userProfile = saveUserProfile({
          defaultName: userInfo.nickName,
          avatarUrl: userInfo.avatarUrl,
        });
        this.setData({
          ...buildProfileView(userProfile),
          profileDraftName: this.data.profileEditing
            ? userProfile.defaultName
            : this.data.profileDraftName,
        });
      },
      fail: () => {
        wx.showToast({
          title: "未获取用户信息",
          icon: "none",
        });
      },
    });
  },

  // 使用微信头像选择能力更新当前用户头像。
  onChooseAvatar(event) {
    const userProfile = saveUserProfile({
      avatarUrl: event.detail.avatarUrl,
    });
    this.setData({
      ...buildProfileView(userProfile),
    });
  },

  // 进入默认名编辑态，先复制当前名称到草稿。
  startProfileEdit() {
    const currentName = String(this.data.userProfile.defaultName || "");
    this.setData({
      profileEditing: true,
      profileDraftName: currentName,
      profileOriginalName: currentName,
      profileSaving: false,
      profileError: "",
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

  // 取消编辑，恢复进入编辑态前的名称。
  cancelProfileEdit() {
    this.setData({
      profileEditing: false,
      profileDraftName: this.data.profileOriginalName,
      profileOriginalName: "",
      profileSaving: false,
      profileError: "",
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
      profileEditing: false,
      profileDraftName: "",
      profileOriginalName: "",
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
