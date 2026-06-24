const USER_PROFILE_STORAGE_KEY = "userProfile";
const DEFAULT_ROOM_NICKNAME = "我";

function normalizeText(value) {
  return String(value || "").trim();
}

function limitNickname(value) {
  return normalizeText(value).slice(0, 20);
}

function normalizeProfile(profile = {}) {
  const defaultName = limitNickname(
    profile.defaultName || profile.nickName || profile.nickname
  );
  return {
    defaultName,
    updatedAt: Number(profile.updatedAt || 0),
  };
}

function getStoredProfile() {
  return normalizeProfile(wx.getStorageSync(USER_PROFILE_STORAGE_KEY) || {});
}

function saveUserProfile(profile = {}) {
  const current = getStoredProfile();
  const next = normalizeProfile({
    ...current,
    ...profile,
    updatedAt: Date.now(),
  });
  wx.setStorageSync(USER_PROFILE_STORAGE_KEY, next);
  return next;
}

function getRoomProfile() {
  const profile = getStoredProfile();
  return {
    nickname: profile.defaultName || DEFAULT_ROOM_NICKNAME,
  };
}

module.exports = {
  DEFAULT_ROOM_NICKNAME,
  getRoomProfile,
  getStoredProfile,
  saveUserProfile,
};
