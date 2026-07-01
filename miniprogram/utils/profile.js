const USER_PROFILE_STORAGE_KEY = "userProfile";
const DEFAULT_ROOM_NICKNAME = "2601010000";

function normalizeText(value) {
  return String(value || "").trim();
}

function padTimePart(value) {
  return String(value).padStart(2, "0");
}

function buildGeneratedNickname(date = new Date()) {
  return [
    padTimePart(date.getFullYear() % 100),
    padTimePart(date.getMonth() + 1),
    padTimePart(date.getDate()),
    padTimePart(date.getHours()),
    padTimePart(date.getMinutes()),
  ].join("");
}

function limitNickname(value) {
  return normalizeText(value).slice(0, 20);
}

function normalizeProfile(profile = {}) {
  const defaultName = limitNickname(
    profile.defaultName || profile.nickName || profile.nickname
  );
  const generatedName = limitNickname(profile.generatedName);
  return {
    defaultName,
    generatedName,
    updatedAt: Number(profile.updatedAt || 0),
  };
}

function getStoredProfile() {
  return normalizeProfile(wx.getStorageSync(USER_PROFILE_STORAGE_KEY) || {});
}

function getOrCreateGeneratedName() {
  const profile = getStoredProfile();
  if (profile.generatedName) return profile.generatedName;
  const generatedName = buildGeneratedNickname();
  wx.setStorageSync(USER_PROFILE_STORAGE_KEY, {
    ...profile,
    generatedName,
    updatedAt: Date.now(),
  });
  return generatedName;
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
  const generatedName = profile.defaultName ? profile.generatedName : getOrCreateGeneratedName();
  return {
    nickname: profile.defaultName || generatedName || DEFAULT_ROOM_NICKNAME,
  };
}

module.exports = {
  DEFAULT_ROOM_NICKNAME,
  buildGeneratedNickname,
  getRoomProfile,
  getStoredProfile,
  saveUserProfile,
};
