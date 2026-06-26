const AVATAR_TONES = ["yellow", "green", "blue", "red"];

function getAvatarText(nickname) {
  const text = String(nickname || "").trim();
  return text ? text.slice(0, 1) : "我";
}

function getAvatarTone(seed) {
  const text = String(seed || "default");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 9973;
  }
  return `avatar-${AVATAR_TONES[hash % AVATAR_TONES.length]}`;
}

function buildAvatarView({ nickname, seed, muted = false }) {
  return {
    avatarText: getAvatarText(nickname),
    avatarTone: muted ? "avatar-muted" : getAvatarTone(seed || nickname),
  };
}

module.exports = {
  buildAvatarView,
};
