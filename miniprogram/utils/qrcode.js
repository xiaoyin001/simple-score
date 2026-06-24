const ALPHANUMERIC_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const VERSION_SIZE = 21;
const DATA_CODEWORDS = 19;
const ECC_CODEWORDS = 7;

function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) {
    bits.push((value >> i) & 1);
  }
}

function encodeAlphanumeric(text) {
  const value = String(text || "").toUpperCase();
  const bits = [];
  appendBits(bits, 0x2, 4);
  appendBits(bits, value.length, 9);

  for (let i = 0; i < value.length; i += 2) {
    const first = ALPHANUMERIC_CHARS.indexOf(value[i]);
    if (first < 0) throw new Error("Room code contains unsupported characters");
    if (i + 1 < value.length) {
      const second = ALPHANUMERIC_CHARS.indexOf(value[i + 1]);
      if (second < 0) throw new Error("Room code contains unsupported characters");
      appendBits(bits, first * 45 + second, 11);
    } else {
      appendBits(bits, first, 6);
    }
  }

  const capacityBits = DATA_CODEWORDS * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  appendBits(bits, 0, terminator);
  while (bits.length % 8) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let codeword = 0;
    for (let j = 0; j < 8; j += 1) {
      codeword = (codeword << 1) | bits[i + j];
    }
    codewords.push(codeword);
  }

  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < DATA_CODEWORDS) {
    codewords.push(pads[padIndex % pads.length]);
    padIndex += 1;
  }
  return codewords;
}

function createGaloisTables() {
  const exp = new Array(512);
  const log = new Array(256);
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    exp[i] = value;
    log[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255];
  return { exp, log };
}

const GF = createGaloisTables();

function gfMul(a, b) {
  if (!a || !b) return 0;
  return GF.exp[GF.log[a] + GF.log[b]];
}

function buildGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF.exp[i]);
    }
    poly = next;
  }
  return poly;
}

function reedSolomon(data, degree) {
  const generator = buildGenerator(degree);
  const result = new Array(degree).fill(0);
  data.forEach((codeword) => {
    const factor = codeword ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < degree; i += 1) {
      result[i] ^= gfMul(generator[i + 1], factor);
    }
  });
  return result;
}

function createMatrix(size) {
  return {
    modules: Array.from({ length: size }, () => new Array(size).fill(false)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
  };
}

function setModule(state, row, col, dark, reserve = true) {
  if (row < 0 || col < 0 || row >= VERSION_SIZE || col >= VERSION_SIZE) return;
  state.modules[row][col] = !!dark;
  if (reserve) state.reserved[row][col] = true;
}

function drawFinder(state, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || x < 0 || y >= VERSION_SIZE || x >= VERSION_SIZE) continue;
      const inPattern = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark =
        inPattern && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      setModule(state, y, x, dark);
    }
  }
}

function drawFunctionPatterns(state) {
  drawFinder(state, 0, 0);
  drawFinder(state, 0, VERSION_SIZE - 7);
  drawFinder(state, VERSION_SIZE - 7, 0);

  for (let i = 8; i < VERSION_SIZE - 8; i += 1) {
    setModule(state, 6, i, i % 2 === 0);
    setModule(state, i, 6, i % 2 === 0);
  }

  setModule(state, 13, 8, true);

  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      setModule(state, 8, i, false);
      setModule(state, i, 8, false);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    setModule(state, VERSION_SIZE - 1 - i, 8, false);
    setModule(state, 8, VERSION_SIZE - 1 - i, false);
  }
}

function calculateFormatBits(maskPattern) {
  const data = (1 << 3) | maskPattern;
  let value = data << 10;
  const generator = 0x537;
  for (let i = 14; i >= 10; i -= 1) {
    if ((value >> i) & 1) value ^= generator << (i - 10);
  }
  return ((data << 10) | value) ^ 0x5412;
}

function drawFormatBits(state, maskPattern) {
  const bits = calculateFormatBits(maskPattern);
  const bit = (index) => ((bits >> index) & 1) === 1;

  for (let i = 0; i < 15; i += 1) {
    if (i < 6) {
      setModule(state, i, 8, bit(i));
    } else if (i < 8) {
      setModule(state, i + 1, 8, bit(i));
    } else {
      setModule(state, VERSION_SIZE - 15 + i, 8, bit(i));
    }

    if (i < 8) {
      setModule(state, 8, VERSION_SIZE - i - 1, bit(i));
    } else if (i < 9) {
      setModule(state, 8, 7, bit(i));
    } else {
      setModule(state, 8, 14 - i, bit(i));
    }
  }

  setModule(state, VERSION_SIZE - 8, 8, true);
}

function drawData(state, codewords) {
  const bits = [];
  codewords.forEach((codeword) => appendBits(bits, codeword, 8));

  let bitIndex = 0;
  let upward = true;
  for (let col = VERSION_SIZE - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let i = 0; i < VERSION_SIZE; i += 1) {
      const row = upward ? VERSION_SIZE - 1 - i : i;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = col - offset;
        if (state.reserved[row][x]) continue;
        const rawBit = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
        const masked = rawBit !== ((row + x) % 2 === 0);
        setModule(state, row, x, masked, false);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function buildQrRows(text) {
  const normalized = String(text || "").trim().toUpperCase();
  if (!normalized) return [];
  const data = encodeAlphanumeric(normalized);
  const codewords = data.concat(reedSolomon(data, ECC_CODEWORDS));
  const state = createMatrix(VERSION_SIZE);
  drawFunctionPatterns(state);
  drawData(state, codewords);
  drawFormatBits(state, 0);
  return state.modules.map((row) => row.map((dark) => ({ dark })));
}

module.exports = {
  buildQrRows,
};
