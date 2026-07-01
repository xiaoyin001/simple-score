const {
  DEFAULT_ROOM_NICKNAME,
  getRoomProfile,
  getStoredProfile,
  saveUserProfile,
} = require("../../utils/profile");
const { buildAvatarView } = require("../../utils/avatar");
const { callScoreFunction, showError } = require("../../utils/api");

const HOME_ROOM_PAGE_SIZE = 5;

function buildProfileView(profile) {
  const defaultName = String((profile && profile.defaultName) || "").trim();
  const generatedName = String((profile && profile.generatedName) || "").trim();
  const displayName = defaultName || generatedName || DEFAULT_ROOM_NICKNAME;
  return {
    userProfile: profile,
    profileFallbackName: displayName,
    profileDraftName: displayName,
    profileSavedName: defaultName,
    profileAvatar: buildAvatarView({
      nickname: displayName,
      seed: displayName,
    }),
  };
}

function getValidRecentRooms(rooms = []) {
  const sourceRooms = rooms;
  return sourceRooms.map((room) => ({
    roomId: room.roomId || room._id,
    roomCode: room.roomCode,
    name: room.name || "记分房间",
    status: room.status || "active",
    memberStatus: room.memberStatus || "",
  })).filter((room) => room && room.roomId);
}

// 从扫码结果或分享路径中读取指定查询参数。
function getQueryValue(text, key) {
  const match = String(text || "").match(new RegExp(`[?&]${key}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

Page({
  data: {
    // 已加入房间列表，来自云函数分页返回。
    recentRooms: [],
    // 当前用户资料保存在本地，用于创建或加入房间时默认带入。
    userProfile: getStoredProfile(),
    // 默认名草稿，点击保存后才写入本地缓存。
    profileDraftName: getRoomProfile().nickname,
    profileFallbackName: getRoomProfile().nickname,
    profileSavedName: "",
    profileAvatar: buildAvatarView({ nickname: getRoomProfile().nickname }),
    profileSaving: false,
    profileError: "",
    homeLoading: false,
    homeCursor: 0,
    homeHasMore: false,
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

  // 页面展示时刷新已加入房间列表。
  onShow() {
    getRoomProfile();
    const userProfile = getStoredProfile();
    this.setData({
      ...buildProfileView(userProfile),
    });
    this.loadHomeData({ reset: true });
  },

  loadHomeData(options = {}) {
    if (this.data.homeLoading) return;
    const reset = options.reset !== false;
    if (!reset && !this.data.homeHasMore) return;

    this.setData({ homeLoading: true });
    callScoreFunction("getHomeData", {
      pageSize: HOME_ROOM_PAGE_SIZE,
      cursor: reset ? 0 : this.data.homeCursor,
    })
      .then((result) => {
        const defaultName = String((result.user && result.user.defaultName) || "").trim();
        if (defaultName) {
          const userProfile = saveUserProfile({ defaultName });
          this.setData(buildProfileView(userProfile));
        }
        const pageRooms = getValidRecentRooms(result.rooms || []);
        this.setData({
          recentRooms: reset ? pageRooms : this.data.recentRooms.concat(pageRooms),
          homeCursor: Number(result.nextCursor || 0),
          homeHasMore: !!result.hasMore,
          homeLoading: false,
        });
      })
      .catch((error) => {
        this.setData({
          homeLoading: false,
        });
        showError(error);
      });
  },

  loadMoreRooms() {
    this.loadHomeData({ reset: false });
  },

  // 只更新草稿，不直接写入本地缓存。
  onProfileDraftInput(event) {
    const draftName = event.detail.value;
    const displayName =
      String(draftName || "").trim() ||
      this.data.profileFallbackName ||
      getRoomProfile().nickname ||
      DEFAULT_ROOM_NICKNAME;
    this.setData({
      profileDraftName: draftName,
      profileAvatar: buildAvatarView({
        nickname: displayName,
        seed: displayName,
      }),
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

    callScoreFunction("saveDefaultName", { defaultName })
      .then(() => {
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
      })
      .catch((error) => {
        this.setData({
          profileSaving: false,
          profileError: error.message || "保存失败",
        });
        showError(error);
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

  // 从已加入房间列表进入房间详情页。
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
