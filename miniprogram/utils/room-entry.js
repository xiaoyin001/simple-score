function safeDecode(value) {
  let text = String(value || "");
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch (error) {
      break;
    }
  }
  return text;
}

function normalizeRoomCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeRoomId(value) {
  return String(value || "").trim();
}

function parseQueryValue(text, key) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
  const pairs = query.replace(/^[?#&]+/, "").split("&");
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (!pair) continue;
    const equalIndex = pair.indexOf("=");
    const pairKey = safeDecode(equalIndex >= 0 ? pair.slice(0, equalIndex) : pair);
    if (pairKey !== key) continue;
    return safeDecode(equalIndex >= 0 ? pair.slice(equalIndex + 1) : "");
  }
  return "";
}

function parseScene(scene) {
  const decodedScene = safeDecode(scene);
  const rawRoomCode = /^[0-9A-Za-z]{4,12}$/.test(decodedScene)
    ? normalizeRoomCode(decodedScene)
    : "";
  return {
    roomId: normalizeRoomId(parseQueryValue(decodedScene, "roomId") || parseQueryValue(decodedScene, "id")),
    roomCode: normalizeRoomCode(
      parseQueryValue(decodedScene, "roomCode") ||
        parseQueryValue(decodedScene, "code") ||
        parseQueryValue(decodedScene, "r") ||
        rawRoomCode
    ),
  };
}

function parseTextEntry(text) {
  const raw = String(text || "").trim();
  const scene = parseQueryValue(raw, "scene");
  const sceneEntry = scene ? parseScene(scene) : {};
  const roomId = normalizeRoomId(parseQueryValue(raw, "roomId") || parseQueryValue(raw, "id"));
  const roomCode = normalizeRoomCode(
    parseQueryValue(raw, "roomCode") || parseQueryValue(raw, "code") || parseQueryValue(raw, "r")
  );
  const rawRoomCode = /^[0-9A-Za-z]{4,12}$/.test(raw) ? normalizeRoomCode(raw) : "";
  return {
    roomId: roomId || sceneEntry.roomId || "",
    roomCode: roomCode || sceneEntry.roomCode || rawRoomCode || "",
  };
}

function parseRoomEntry(source) {
  if (source && typeof source === "object") {
    const sceneEntry = parseScene(source.scene || "");
    return {
      roomId: normalizeRoomId(source.roomId) || sceneEntry.roomId || "",
      roomCode: normalizeRoomCode(source.roomCode) || sceneEntry.roomCode || "",
    };
  }
  return parseTextEntry(source);
}

function buildJoinRoomUrl(entry = {}) {
  const params = [];
  const roomId = normalizeRoomId(entry.roomId);
  const roomCode = normalizeRoomCode(entry.roomCode);
  if (roomId) params.push(`roomId=${encodeURIComponent(roomId)}`);
  if (roomCode) params.push(`roomCode=${encodeURIComponent(roomCode)}`);
  return `/pages/join-room/index${params.length ? `?${params.join("&")}` : ""}`;
}

module.exports = {
  buildJoinRoomUrl,
  parseRoomEntry,
};
