var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../../node_modules/.pnpm/@truestamp+canonify@1.0.3/node_modules/@truestamp/canonify/dist/canonify.module.js
function t(t2) {
  return 0 === t2 ? "" : ",";
}
__name(t, "t");
function n(e) {
  if (null == e || "boolean" == typeof e || "number" == typeof e || "string" == typeof e) return JSON.stringify(e);
  if ("bigint" == typeof e) throw new TypeError("BigInt value can't be serialized in JSON");
  return "function" == typeof e || "symbol" == typeof e ? n(void 0) : e.toJSON instanceof Function ? n(e.toJSON()) : Array.isArray(e) ? "[" + e.reduce(function(e2, o, r) {
    var i = void 0 === o || "symbol" == typeof o || "function" == typeof o ? null : o;
    return "" + e2 + t(r) + n(i);
  }, "") + "]" : "{" + Object.keys(e).sort().reduce(function(o, r) {
    return void 0 === e[r] || "symbol" == typeof e[r] || "function" == typeof e[r] ? o : "" + o + t(o.length) + n(r) + ":" + n(e[r]);
  }, "") + "}";
}
__name(n, "n");

// ../../node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
__name(isBytes, "isBytes");
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
__name(abytes, "abytes");
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
__name(aexists, "aexists");
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
__name(aoutput, "aoutput");
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
__name(clean, "clean");
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
__name(createView, "createView");
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
__name(rotr, "rotr");
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
__name(utf8ToBytes, "utf8ToBytes");
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
__name(toBytes, "toBytes");
var Hash = class {
  static {
    __name(this, "Hash");
  }
};
function createHasher(hashCons) {
  const hashC = /* @__PURE__ */ __name((msg) => hashCons().update(toBytes(msg)).digest(), "hashC");
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
__name(createHasher, "createHasher");

// ../../node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value, isLE) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE);
  const _32n = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE ? 4 : 0;
  const l = isLE ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE);
  view.setUint32(byteOffset + l, wl, isLE);
}
__name(setBigUint64, "setBigUint64");
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
__name(Chi, "Chi");
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
__name(Maj, "Maj");
var HashMD = class extends Hash {
  static {
    __name(this, "HashMD");
  }
  constructor(blockLen, outputLen, padOffset, isLE) {
    super();
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// ../../node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA256 = class extends HashMD {
  static {
    __name(this, "SHA256");
  }
  constructor(outputLen = 32) {
    super(64, outputLen, 8, false);
    this.A = SHA256_IV[0] | 0;
    this.B = SHA256_IV[1] | 0;
    this.C = SHA256_IV[2] | 0;
    this.D = SHA256_IV[3] | 0;
    this.E = SHA256_IV[4] | 0;
    this.F = SHA256_IV[5] | 0;
    this.G = SHA256_IV[6] | 0;
    this.H = SHA256_IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var sha256 = /* @__PURE__ */ createHasher(() => new SHA256());

// ../../node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/sha256.js
var sha2562 = sha256;

// ../core/dist/encoding.js
var HEX_CHARS = "0123456789abcdef";
function bytesToHex(bytes) {
  let out = "";
  for (const b of bytes) {
    out += HEX_CHARS[b >> 4] + HEX_CHARS[b & 15];
  }
  return out;
}
__name(bytesToHex, "bytesToHex");
function hexToBytes(hex) {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new TypeError(`hexToBytes: invalid hex string (length ${hex.length})`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}
__name(hexToBytes, "hexToBytes");
var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var B64_LOOKUP = {};
for (let i = 0; i < B64_ALPHABET.length; i++)
  B64_LOOKUP[B64_ALPHABET[i]] = i;
function bytesToBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[(b0 & 3) << 4 | b1 >> 4];
    out += i + 1 < bytes.length ? B64_ALPHABET[(b1 & 15) << 2 | b2 >> 6] : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 63] : "=";
  }
  return out;
}
__name(bytesToBase64, "bytesToBase64");
function base64ToBytes(b64) {
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new TypeError("base64ToBytes: invalid base64 string");
  }
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const byteLength = b64.length / 4 * 3 - padding;
  const out = new Uint8Array(byteLength);
  let outIdx = 0;
  for (let i = 0; i < b64.length; i += 4) {
    const c0 = B64_LOOKUP[b64[i]];
    const c1 = B64_LOOKUP[b64[i + 1]];
    const c2 = b64[i + 2] === "=" ? 0 : B64_LOOKUP[b64[i + 2]];
    const c3 = b64[i + 3] === "=" ? 0 : B64_LOOKUP[b64[i + 3]];
    if (outIdx < byteLength)
      out[outIdx++] = c0 << 2 | c1 >> 4;
    if (outIdx < byteLength)
      out[outIdx++] = (c1 & 15) << 4 | c2 >> 2;
    if (outIdx < byteLength)
      out[outIdx++] = (c2 & 3) << 6 | c3;
  }
  return out;
}
__name(base64ToBytes, "base64ToBytes");
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder();
function utf8ToBytes2(s) {
  return textEncoder.encode(s);
}
__name(utf8ToBytes2, "utf8ToBytes");
function bytesToUtf8(bytes) {
  return textDecoder.decode(bytes);
}
__name(bytesToUtf8, "bytesToUtf8");
function sha256Bytes(bytes) {
  return sha2562(bytes);
}
__name(sha256Bytes, "sha256Bytes");
function sha256Hex(bytes) {
  return bytesToHex(sha2562(bytes));
}
__name(sha256Hex, "sha256Hex");

// ../core/dist/canonical.js
function canonicalize(value) {
  const canonical = n(value);
  if (canonical === void 0) {
    throw new TypeError("canonicalize: value cannot be JCS-canonicalized (undefined / cycle / non-JSON)");
  }
  return utf8ToBytes2(canonical);
}
__name(canonicalize, "canonicalize");

// ../core/dist/statement.js
var IN_TOTO_STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
var PASSPORTSIGN_PREDICATE_TYPE = "https://passportsign.dev/personhood/v1";
var PASSPORTSIGN_REVOCATION_PREDICATE_TYPE = "https://passportsign.dev/personhood/v1#revocation";

// ../core/dist/errors.js
var PassportsignError = class extends Error {
  static {
    __name(this, "PassportsignError");
  }
  code;
  cause;
  constructor(code, message, cause) {
    super(message);
    this.name = "PassportsignError";
    this.code = code;
    this.cause = cause;
  }
};

// ../core/dist/log/rekor.js
var DEFAULT_REKOR_BASE_URL = "https://rekor.sigstore.dev";
var PublicSigstoreRekorClient = class {
  static {
    __name(this, "PublicSigstoreRekorClient");
  }
  baseUrl;
  fetchImpl;
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_REKOR_BASE_URL;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }
  async submitIntoto(envelope) {
    const body = buildIntotoEntryBody(envelope);
    return this.postEntry(body);
  }
  async getEntry(uuid) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/log/entries/${uuid}`);
    } catch (err) {
      throw new PassportsignError("log_submission_failed", `Rekor get-entry request failed: ${err instanceof Error ? err.message : String(err)}`, err);
    }
    if (!response.ok) {
      let errBody = "";
      try {
        errBody = await response.text();
      } catch {
      }
      throw new PassportsignError("log_submission_failed", `Rekor get-entry returned ${response.status}: ${errBody}`);
    }
    return parseEntryResponse(await response.json().catch(() => null));
  }
  async getLogInfo() {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/log`);
    } catch (err) {
      throw new PassportsignError("log_submission_failed", `Rekor log-info request failed: ${err instanceof Error ? err.message : String(err)}`, err);
    }
    if (!response.ok) {
      throw new PassportsignError("log_submission_failed", `Rekor log-info returned ${response.status}`);
    }
    const body = await response.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new PassportsignError("log_submission_failed", "Rekor log-info returned non-object");
    }
    const rootHash = body["rootHash"];
    const treeSize = body["treeSize"];
    const signedTreeHead = body["signedTreeHead"];
    const treeID = body["treeID"];
    if (typeof rootHash !== "string" || typeof treeSize !== "number" || typeof signedTreeHead !== "string" || typeof treeID !== "string") {
      throw new PassportsignError("log_submission_failed", "Rekor log-info missing required fields");
    }
    return { rootHash, treeSize, signedTreeHead, treeID };
  }
  async getConsistencyProof(firstSize, lastSize) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/log/proof?firstSize=${firstSize}&lastSize=${lastSize}`);
    } catch (err) {
      throw new PassportsignError("log_submission_failed", `Rekor consistency-proof request failed: ${err instanceof Error ? err.message : String(err)}`, err);
    }
    if (!response.ok) {
      throw new PassportsignError("log_submission_failed", `Rekor consistency-proof returned ${response.status}`);
    }
    const body = await response.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new PassportsignError("log_submission_failed", "Rekor consistency-proof returned non-object");
    }
    const hashes = body["hashes"];
    const rootHash = body["rootHash"];
    if (!Array.isArray(hashes) || !hashes.every((h) => typeof h === "string")) {
      throw new PassportsignError("log_submission_failed", "Rekor consistency-proof has no hashes array");
    }
    if (typeof rootHash !== "string") {
      throw new PassportsignError("log_submission_failed", "Rekor consistency-proof has no rootHash");
    }
    return { hashes, rootHash };
  }
  async postEntry(body) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/log/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      });
    } catch (err) {
      throw new PassportsignError("log_submission_failed", `Rekor submit request failed: ${err instanceof Error ? err.message : String(err)}`, err);
    }
    if (!response.ok) {
      let errBody = "";
      try {
        errBody = await response.text();
      } catch {
      }
      throw new PassportsignError("log_submission_failed", `Rekor submit returned ${response.status}: ${errBody}`);
    }
    return parseEntryResponse(await response.json().catch(() => null));
  }
};
function buildIntotoEntryBody(envelope) {
  if (envelope.signatures.length === 0) {
    throw new PassportsignError("log_submission_failed", "envelope must have at least one signature");
  }
  const sig0 = envelope.signatures[0];
  const payloadHashHex = sha256Hex(base64ToBytes(envelope.payload));
  const sigForHash = {
    sig: sig0.sig,
    publicKey: sig0.publicKey
  };
  if (sig0.keyid && sig0.keyid.length > 0) {
    sigForHash["keyid"] = sig0.keyid;
  }
  const envelopeForHash = {
    payloadType: envelope.payloadType,
    payload: envelope.payload,
    signatures: [sigForHash]
  };
  const envelopeHashHex = sha256Hex(canonicalize(envelopeForHash));
  const sigItem = {
    sig: bytesToBase64(utf8ToBytes2(sig0.sig)),
    publicKey: bytesToBase64(utf8ToBytes2(sig0.publicKey))
  };
  if (sig0.keyid && sig0.keyid.length > 0) {
    sigItem["keyid"] = sig0.keyid;
  }
  return {
    apiVersion: "0.0.2",
    kind: "intoto",
    spec: {
      content: {
        envelope: {
          payloadType: envelope.payloadType,
          payload: bytesToBase64(utf8ToBytes2(envelope.payload)),
          signatures: [sigItem]
        },
        hash: { algorithm: "sha256", value: envelopeHashHex },
        payloadHash: { algorithm: "sha256", value: payloadHashHex }
      }
    }
  };
}
__name(buildIntotoEntryBody, "buildIntotoEntryBody");
function parseEntryResponse(raw) {
  if (typeof raw !== "object" || raw === null) {
    throw new PassportsignError("log_submission_failed", "malformed Rekor response (not a JSON object)");
  }
  const entries = Object.entries(raw);
  if (entries.length !== 1) {
    throw new PassportsignError("log_submission_failed", `expected exactly one UUID in Rekor response, got ${entries.length}`);
  }
  const [uuid, entryRaw] = entries[0];
  const entry = entryRaw;
  const verification = entry["verification"];
  if (!verification) {
    throw new PassportsignError("log_submission_failed", "Rekor response missing verification block");
  }
  const inclusionProof = verification["inclusionProof"];
  const signedEntryTimestamp = verification["signedEntryTimestamp"];
  if (!inclusionProof || typeof signedEntryTimestamp !== "string") {
    throw new PassportsignError("log_submission_failed", "Rekor response missing inclusionProof or signedEntryTimestamp");
  }
  return {
    uuid,
    logIndex: entry["logIndex"],
    integratedTime: entry["integratedTime"],
    logID: entry["logID"],
    body: entry["body"],
    ...entry["attestation"] ? { attestation: entry["attestation"] } : {},
    verification: { inclusionProof, signedEntryTimestamp }
  };
}
__name(parseEntryResponse, "parseEntryResponse");

// ../core/dist/merkle.js
function hashLeaf(data) {
  const buf = new Uint8Array(1 + data.length);
  buf[0] = 0;
  buf.set(data, 1);
  return sha256Bytes(buf);
}
__name(hashLeaf, "hashLeaf");
function hashPair(left, right) {
  const buf = new Uint8Array(1 + left.length + right.length);
  buf[0] = 1;
  buf.set(left, 1);
  buf.set(right, 1 + left.length);
  return sha256Bytes(buf);
}
__name(hashPair, "hashPair");
function bytesEqual(a, b) {
  if (a.length !== b.length)
    return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i])
      return false;
  }
  return true;
}
__name(bytesEqual, "bytesEqual");
function bitLength(n2) {
  let len = 0;
  while (n2 > 0) {
    len++;
    n2 = Math.floor(n2 / 2);
  }
  return len;
}
__name(bitLength, "bitLength");
function popcount(n2) {
  let count = 0;
  while (n2 > 0) {
    count += n2 & 1;
    n2 = Math.floor(n2 / 2);
  }
  return count;
}
__name(popcount, "popcount");
function decompInclProof(leafIndex, treeSize) {
  const inner = bitLength(leafIndex ^ treeSize - 1);
  const border = popcount(Math.floor(leafIndex / Math.pow(2, inner)));
  return { inner, border };
}
__name(decompInclProof, "decompInclProof");
function chainInner(seed, proof, leafIndex) {
  let res = seed;
  for (let i = 0; i < proof.length; i++) {
    const bit = Math.floor(leafIndex / Math.pow(2, i)) & 1;
    res = bit === 0 ? hashPair(res, proof[i]) : hashPair(proof[i], res);
  }
  return res;
}
__name(chainInner, "chainInner");
function chainBorderRight(seed, proof) {
  let res = seed;
  for (const p of proof) {
    res = hashPair(p, res);
  }
  return res;
}
__name(chainBorderRight, "chainBorderRight");
function verifyInclusion(leafHash, leafIndex, treeSize, proof, rootHash) {
  if (leafIndex < 0 || treeSize < 0 || leafIndex >= treeSize)
    return false;
  const { inner, border } = decompInclProof(leafIndex, treeSize);
  if (proof.length !== inner + border)
    return false;
  let res = chainInner(leafHash, proof.slice(0, inner), leafIndex);
  res = chainBorderRight(res, proof.slice(inner));
  return bytesEqual(res, rootHash);
}
__name(verifyInclusion, "verifyInclusion");

// ../core/dist/badge.js
var LABEL = "passportsign";
var STATE_COLORS = {
  active: "#4c1",
  stale: "#dfb317",
  revoked: "#e05d44"
};
var CHAR_WIDTH_PX = 7;
var SIDE_PADDING_PX = 8;
function escapeXml(s) {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return c;
    }
  });
}
__name(escapeXml, "escapeXml");
function dateStringFor(isoTimestamp) {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime()))
    return isoTimestamp.slice(0, 10);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
__name(dateStringFor, "dateStringFor");
function renderBadgeSvg(input) {
  const state = input.state ?? "active";
  const date = dateStringFor(input.bound_at);
  const valueParts = [state === "revoked" ? "revoked" : "verified human"];
  if (input.issuing_country)
    valueParts.push(input.issuing_country);
  valueParts.push(date);
  const valueText = valueParts.join(" \xB7 ");
  const labelEsc = escapeXml(LABEL);
  const valueEsc = escapeXml(valueText);
  const labelW = LABEL.length * CHAR_WIDTH_PX + 2 * SIDE_PADDING_PX;
  const valueW = valueText.length * CHAR_WIDTH_PX + 2 * SIDE_PADDING_PX;
  const totalW = labelW + valueW;
  const labelCx10 = labelW * 5;
  const valueCx10 = (labelW + valueW / 2) * 10;
  const ariaLabel = `${labelEsc}: ${valueEsc}`;
  const tooltipExtra = input.log_entry_hash ? ` (rekor entry ${escapeXml(input.log_entry_hash.slice(0, 16))}\u2026)` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${ariaLabel}">`,
    `<title>${ariaLabel}${tooltipExtra}</title>`,
    `<linearGradient id="s" x2="0" y2="100%">`,
    `<stop offset="0" stop-color="#bbb" stop-opacity=".1"/>`,
    `<stop offset="1" stop-opacity=".1"/>`,
    `</linearGradient>`,
    `<clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${labelW}" height="20" fill="#555"/>`,
    `<rect x="${labelW}" width="${valueW}" height="20" fill="${STATE_COLORS[state]}"/>`,
    `<rect width="${totalW}" height="20" fill="url(#s)"/>`,
    `</g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">`,
    `<text x="${labelCx10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${labelEsc}</text>`,
    `<text x="${labelCx10}" y="140" transform="scale(.1)">${labelEsc}</text>`,
    `<text x="${valueCx10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${valueEsc}</text>`,
    `<text x="${valueCx10}" y="140" transform="scale(.1)">${valueEsc}</text>`,
    `</g>`,
    `</svg>`
  ].join("");
}
__name(renderBadgeSvg, "renderBadgeSvg");

// ../core/dist/profile-index.js
var PROFILE_INDEX_VERSION = 1;
var PROFILE_INDEX_FILENAME = "passportsign-index.json";
var REKOR_UUID = /^[0-9a-f]{80}$/;
var ProfileIndexValidationError = class extends Error {
  static {
    __name(this, "ProfileIndexValidationError");
  }
  constructor(message) {
    super(message);
    this.name = "ProfileIndexValidationError";
  }
};
function fail(message) {
  throw new ProfileIndexValidationError(message);
}
__name(fail, "fail");
function assertRekorUuid(value, field) {
  if (typeof value !== "string" || !REKOR_UUID.test(value)) {
    fail(`${field}: expected 80-char lowercase hex Rekor entry UUID, got ${JSON.stringify(value)}`);
  }
  return value;
}
__name(assertRekorUuid, "assertRekorUuid");
function assertIsoDate(value, field) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    fail(`${field}: expected ISO 8601 timestamp, got ${JSON.stringify(value)}`);
  }
  return value;
}
__name(assertIsoDate, "assertIsoDate");
function validateProfileIndex(raw) {
  if (typeof raw !== "object" || raw === null) {
    fail("index must be a JSON object");
  }
  const obj = raw;
  if (obj["version"] !== PROFILE_INDEX_VERSION) {
    fail(`version: expected ${PROFILE_INDEX_VERSION}, got ${JSON.stringify(obj["version"])}`);
  }
  const username = obj["github_username"];
  if (typeof username !== "string" || username.length === 0) {
    fail("github_username: must be a non-empty string");
  }
  const bindingsRaw = obj["bindings"];
  if (!Array.isArray(bindingsRaw)) {
    fail("bindings: must be an array");
  }
  const revocationsRaw = obj["revocations"];
  if (!Array.isArray(revocationsRaw)) {
    fail("revocations: must be an array");
  }
  const bindings = bindingsRaw.map((b, i) => {
    if (typeof b !== "object" || b === null)
      fail(`bindings[${i}]: must be an object`);
    const rec = b;
    return {
      rekor_entry_hash: assertRekorUuid(rec["rekor_entry_hash"], `bindings[${i}].rekor_entry_hash`),
      bound_at: assertIsoDate(rec["bound_at"], `bindings[${i}].bound_at`)
    };
  });
  const revocations = revocationsRaw.map((r, i) => {
    if (typeof r !== "object" || r === null)
      fail(`revocations[${i}]: must be an object`);
    const rec = r;
    const out = {
      rekor_entry_hash: assertRekorUuid(rec["rekor_entry_hash"], `revocations[${i}].rekor_entry_hash`),
      revoked_at: assertIsoDate(rec["revoked_at"], `revocations[${i}].revoked_at`)
    };
    if (rec["revokes_rekor_entry_hash"] !== void 0) {
      out.revokes_rekor_entry_hash = assertRekorUuid(rec["revokes_rekor_entry_hash"], `revocations[${i}].revokes_rekor_entry_hash`);
    }
    return out;
  });
  return { version: PROFILE_INDEX_VERSION, github_username: username, bindings, revocations };
}
__name(validateProfileIndex, "validateProfileIndex");
function addBinding(index, binding) {
  if (index.bindings.some((b) => b.rekor_entry_hash === binding.rekor_entry_hash)) {
    return index;
  }
  return { ...index, bindings: [...index.bindings, binding] };
}
__name(addBinding, "addBinding");
function addRevocation(index, revocation) {
  if (index.revocations.some((r) => r.rekor_entry_hash === revocation.rekor_entry_hash)) {
    return index;
  }
  return { ...index, revocations: [...index.revocations, revocation] };
}
__name(addRevocation, "addRevocation");
function mergeProfileIndexes(a, b) {
  if (a.github_username.toLowerCase() !== b.github_username.toLowerCase()) {
    fail(`cannot merge indexes for different users: ${a.github_username} vs ${b.github_username}`);
  }
  let merged = a;
  for (const binding of b.bindings)
    merged = addBinding(merged, binding);
  for (const revocation of b.revocations)
    merged = addRevocation(merged, revocation);
  return merged;
}
__name(mergeProfileIndexes, "mergeProfileIndexes");
function profileIndexUrl(githubUsername) {
  return `https://raw.githubusercontent.com/${githubUsername}/${githubUsername}/main/${PROFILE_INDEX_FILENAME}`;
}
__name(profileIndexUrl, "profileIndexUrl");
async function fetchProfileIndex(githubUsername, opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const url = opts.url ?? profileIndexUrl(githubUsername);
  let response;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    throw new PassportsignError("internal_error", `profile-index fetch failed: ${err instanceof Error ? err.message : String(err)}`, err);
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new PassportsignError("internal_error", `profile-index fetch returned ${response.status} for ${url}`);
  }
  let body;
  try {
    body = await response.json();
  } catch (err) {
    throw new ProfileIndexValidationError(`profile-index at ${url} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return validateProfileIndex(body);
}
__name(fetchProfileIndex, "fetchProfileIndex");

// ../core/dist/classify.js
var STALENESS_WINDOW_MS = 365 * 24 * 60 * 60 * 1e3;
var EntryParseError = class extends Error {
  static {
    __name(this, "EntryParseError");
  }
  constructor(message) {
    super(message);
    this.name = "EntryParseError";
  }
};
function fail2(message) {
  throw new EntryParseError(message);
}
__name(fail2, "fail");
function parseIntotoEntry(entry) {
  const data = entry.attestation?.data;
  if (typeof data !== "string" || data.length === 0) {
    fail2(`entry ${entry.uuid}: no stored attestation`);
  }
  const decoded = (() => {
    try {
      return {
        attestationBytes: base64ToBytes(data),
        bodyObj: JSON.parse(bytesToUtf8(base64ToBytes(entry.body)))
      };
    } catch {
      fail2(`entry ${entry.uuid}: attestation/body is not base64 JSON`);
    }
  })();
  const { attestationBytes, bodyObj } = decoded;
  const payloadHash = bodyObj?.spec?.content?.payloadHash;
  if (payloadHash?.algorithm !== "sha256" || typeof payloadHash.value !== "string") {
    fail2(`entry ${entry.uuid}: body has no sha256 payloadHash`);
  }
  const computed = sha256Hex(attestationBytes);
  if (computed !== payloadHash.value) {
    fail2(`entry ${entry.uuid}: attestation hash mismatch (computed ${computed}, recorded ${payloadHash.value})`);
  }
  let statement;
  try {
    statement = JSON.parse(bytesToUtf8(attestationBytes));
  } catch {
    fail2(`entry ${entry.uuid}: attestation is not JSON`);
  }
  const s = statement;
  if (s?._type !== IN_TOTO_STATEMENT_TYPE || !Array.isArray(s.subject) || typeof s.predicateType !== "string") {
    fail2(`entry ${entry.uuid}: attestation is not an in-toto Statement v1`);
  }
  return {
    uuid: entry.uuid,
    integratedTime: entry.integratedTime,
    predicateType: s.predicateType,
    statement: s
  };
}
__name(parseIntotoEntry, "parseIntotoEntry");
function predicateField(entry, field) {
  const predicate = entry.statement.predicate;
  if (typeof predicate !== "object" || predicate === null)
    return void 0;
  const value = predicate[field];
  return typeof value === "string" ? value : void 0;
}
__name(predicateField, "predicateField");
function classifyBindings(input) {
  const now = input.now ?? Date.now();
  const revocations = input.revocations.filter((r) => r.predicateType.endsWith("#revocation"));
  return input.bindings.map((entry) => {
    const uid = predicateField(entry, "unique_identifier");
    const revokedBy = revocations.find((r) => {
      if (predicateField(r, "unique_identifier") !== uid || uid === void 0)
        return false;
      const target = predicateField(r, "revokes_rekor_entry_hash");
      return target === void 0 || target === entry.uuid;
    });
    if (revokedBy) {
      return { entry, state: "revoked", revokedBy: revokedBy.uuid };
    }
    if (now - entry.integratedTime * 1e3 > STALENESS_WINDOW_MS) {
      return { entry, state: "stale" };
    }
    return { entry, state: "active" };
  });
}
__name(classifyBindings, "classifyBindings");

// ../core/dist/lookup.js
function verifyEntryInclusion(entry) {
  const proof = entry.verification.inclusionProof;
  const leaf = hashLeaf(base64ToBytes(entry.body));
  return verifyInclusion(leaf, proof.logIndex, proof.treeSize, proof.hashes.map(hexToBytes), hexToBytes(proof.rootHash));
}
__name(verifyEntryInclusion, "verifyEntryInclusion");
async function fetchAndCheck(uuids, expectedPredicateType, githubUsername, rekor) {
  const out = { parsed: [], unreachable: [], invalid: [] };
  const results = await Promise.allSettled(uuids.map((uuid) => rekor.getEntry(uuid)));
  results.forEach((result, i) => {
    const uuid = uuids[i];
    if (result.status === "rejected") {
      const reason = result.reason;
      out.unreachable.push({
        uuid,
        error: reason instanceof Error ? reason.message : String(reason)
      });
      return;
    }
    try {
      const entry = result.value;
      if (!verifyEntryInclusion(entry)) {
        out.invalid.push({ uuid, error: "inclusion proof does not verify" });
        return;
      }
      const parsed = parseIntotoEntry(entry);
      if (parsed.predicateType !== expectedPredicateType) {
        out.invalid.push({
          uuid,
          error: `predicateType ${parsed.predicateType} != expected ${expectedPredicateType}`
        });
        return;
      }
      const subject = parsed.statement.subject[0]?.name ?? "";
      if (subject.toLowerCase() !== `github.com/${githubUsername}`.toLowerCase()) {
        out.invalid.push({
          uuid,
          error: `subject ${subject} does not match github.com/${githubUsername}`
        });
        return;
      }
      out.parsed.push(parsed);
    } catch (err) {
      out.invalid.push({ uuid, error: err instanceof Error ? err.message : String(err) });
    }
  });
  return out;
}
__name(fetchAndCheck, "fetchAndCheck");
async function lookupFromIndex(index, deps) {
  const username = index.github_username;
  const [bindings, revocations] = await Promise.all([
    fetchAndCheck(index.bindings.map((b) => b.rekor_entry_hash), PASSPORTSIGN_PREDICATE_TYPE, username, deps.rekor),
    fetchAndCheck(index.revocations.map((r) => r.rekor_entry_hash), PASSPORTSIGN_REVOCATION_PREDICATE_TYPE, username, deps.rekor)
  ]);
  const classified = classifyBindings({
    bindings: bindings.parsed,
    revocations: revocations.parsed,
    ...deps.now !== void 0 ? { now: deps.now } : {}
  });
  return {
    index,
    classified,
    unreachable: [...bindings.unreachable, ...revocations.unreachable],
    invalid: [...bindings.invalid, ...revocations.invalid]
  };
}
__name(lookupFromIndex, "lookupFromIndex");
async function lookupBindings(githubUsername, deps) {
  const index = await fetchProfileIndex(githubUsername, {
    ...deps.fetch ? { fetch: deps.fetch } : {}
  });
  if (index === null) {
    return { index: null, classified: [], unreachable: [], invalid: [] };
  }
  return lookupFromIndex(index, deps);
}
__name(lookupBindings, "lookupBindings");

// src/badge-handler.ts
var GITHUB_USERNAME = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
var ACTIVE_CACHE = "public, max-age=300, s-maxage=300, stale-while-revalidate=600";
var UNKNOWN_CACHE = "public, max-age=60";
function unknownBadge() {
  const label = "passportsign";
  const value = "unknown";
  const labelW = label.length * 7 + 16;
  const valueW = value.length * 7 + 16;
  const totalW = labelW + valueW;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${label}: ${value}">`,
    `<title>${label}: ${value}</title>`,
    `<clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${labelW}" height="20" fill="#555"/>`,
    `<rect x="${labelW}" width="${valueW}" height="20" fill="#9f9f9f"/>`,
    `</g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110" text-rendering="geometricPrecision">`,
    `<text x="${labelW * 5}" y="140" transform="scale(.1)">${label}</text>`,
    `<text x="${(labelW + valueW / 2) * 10}" y="140" transform="scale(.1)">${value}</text>`,
    `</g>`,
    `</svg>`
  ].join("");
}
__name(unknownBadge, "unknownBadge");
function pickPrimary(classified) {
  for (const state of ["active", "stale", "revoked"]) {
    const group = classified.filter((c) => c.state === state);
    if (group.length > 0) {
      return group.reduce((a, b) => b.entry.integratedTime > a.entry.integratedTime ? b : a);
    }
  }
  return null;
}
__name(pickPrimary, "pickPrimary");
async function buildBadge(usernameRaw, deps) {
  const username = usernameRaw.toLowerCase();
  if (!GITHUB_USERNAME.test(username)) {
    return { svg: unknownBadge(), status: 200, cacheControl: UNKNOWN_CACHE };
  }
  const overlayBase = deps.operatorIndexBase ?? "https://passportsign.dev/index";
  let userIndex = null;
  let overlay = null;
  try {
    [userIndex, overlay] = await Promise.all([
      fetchProfileIndex(username, { fetch: deps.fetch }),
      fetchProfileIndex(username, {
        fetch: deps.fetch,
        url: `${overlayBase}/${username}.json`
      })
    ]);
  } catch {
    return { svg: unknownBadge(), status: 200, cacheControl: UNKNOWN_CACHE };
  }
  let index = userIndex;
  if (userIndex && overlay) {
    try {
      index = mergeProfileIndexes(userIndex, overlay);
    } catch {
      index = userIndex;
    }
  } else if (overlay) {
    index = overlay;
  }
  if (!index || index.bindings.length === 0) {
    return { svg: unknownBadge(), status: 200, cacheControl: UNKNOWN_CACHE };
  }
  const result = await lookupFromIndex(index, {
    rekor: deps.rekor,
    ...deps.now !== void 0 ? { now: deps.now } : {}
  });
  const primary = pickPrimary(result.classified);
  if (!primary) {
    return { svg: unknownBadge(), status: 200, cacheControl: UNKNOWN_CACHE };
  }
  const predicate = primary.entry.statement.predicate;
  const svg = renderBadgeSvg({
    github_username: username,
    issuing_country: typeof predicate["issuing_country"] === "string" ? predicate["issuing_country"] : null,
    bound_at: new Date(primary.entry.integratedTime * 1e3).toISOString(),
    log_entry_hash: primary.entry.uuid,
    state: primary.state
  });
  return { svg, status: 200, cacheControl: ACTIVE_CACHE };
}
__name(buildBadge, "buildBadge");

// src/verify-page.ts
function esc(s) {
  return s.replace(
    /[<>&"]/g,
    (c) => c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;"
  );
}
__name(esc, "esc");
var STATE_BADGES = {
  active: '<span style="color:#2da44e">&#10003; active</span>',
  stale: '<span style="color:#bf8700">~ stale (older than 12 months)</span>',
  revoked: '<span style="color:#cf222e">&#10007; revoked</span>'
};
function renderVerifyPage(username, result) {
  const u = esc(username);
  const rows = result.classified.map(({ entry, state, revokedBy }) => {
    const predicate = entry.statement.predicate;
    const date = new Date(entry.integratedTime * 1e3).toISOString().slice(0, 10);
    const country = typeof predicate["issuing_country"] === "string" ? esc(predicate["issuing_country"]) : "<em>undisclosed</em>";
    const rekorUrl = `https://rekor.sigstore.dev/api/v1/log/entries/${esc(entry.uuid)}`;
    return `<tr>
        <td>${STATE_BADGES[state] ?? esc(state)}</td>
        <td>${date}</td>
        <td>${country}</td>
        <td><a href="${rekorUrl}"><code>${esc(entry.uuid.slice(0, 16))}&hellip;</code></a>${revokedBy ? `<br><small>revoked by <code>${esc(revokedBy.slice(0, 16))}&hellip;</code></small>` : ""}</td>
      </tr>`;
  }).join("\n");
  const problems = [...result.unreachable, ...result.invalid].map((p) => `<li><code>${esc(p.uuid.slice(0, 16))}&hellip;</code> \u2014 ${esc(p.error)}</li>`).join("\n");
  const body = result.index === null ? `<p><strong>@${u}</strong> has not published a <code>passportsign-index.json</code> \u2014
         no bindings can be discovered. (Expected at
         <code>github.com/${u}/${u}</code>, branch <code>main</code>.)</p>` : `<table>
          <thead><tr><th>state</th><th>bound</th><th>country</th><th>rekor entry</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${problems ? `<h2>Problems</h2><ul>${problems}</ul>` : ""}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>passportsign \u2014 verify @${u}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1f2328; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #d1d9e0; }
  code { background: #f6f8fa; padding: .1rem .3rem; border-radius: 4px; }
  .note { background: #fff8c5; border: 1px solid #d4a72c66; border-radius: 6px; padding: .75rem 1rem; margin: 1.25rem 0; }
  footer { margin-top: 2rem; font-size: .85rem; color: #59636e; }
</style>
</head>
<body>
<h1>passportsign &mdash; @${u}</h1>
<p>Bindings between <a href="https://github.com/${u}">github.com/${u}</a> and a
passport-holding human, published on the public
<a href="https://rekor.sigstore.dev">Sigstore Rekor</a> transparency log.</p>
${body}
<div class="note">
<strong>What this page checked:</strong> each entry's stored attestation hashes to
what Rekor recorded, its Merkle inclusion proof verifies, and its subject matches
this username. It did <strong>not</strong> re-run the zero-knowledge passport proof,
and it was rendered by the operator &mdash; a skeptic should not take its word.
For operator-independent verification, run
<code>npx @passportsign/cli verify &lt;bundle&gt;</code> against the user's
<code>binding.passportsign.json</code>, or fetch the Rekor entries yourself.
</div>
<footer>
<a href="https://passportsign.dev">passportsign.dev</a> &middot;
<a href="https://github.com/debugmcp/passportsign">source</a> &middot;
The badge asserts accountability evidence, not identity, skill, or good faith.
</footer>
</body>
</html>`;
}
__name(renderVerifyPage, "renderVerifyPage");

// src/router.ts
var BADGE_PATH = /^\/badge\/([^/]+)\.svg$/;
var VERIFY_PATH = /^\/verify\/([^/]+)$/;
async function route(request, deps) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  const badgeMatch = BADGE_PATH.exec(url.pathname);
  if (badgeMatch) {
    const result = await buildBadge(decodeURIComponent(badgeMatch[1]), deps);
    return new Response(result.svg, {
      status: result.status,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": result.cacheControl,
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  const verifyMatch = VERIFY_PATH.exec(url.pathname);
  if (verifyMatch) {
    const username = decodeURIComponent(verifyMatch[1]).toLowerCase();
    const result = await lookupBindings(username, {
      rekor: deps.rekor,
      fetch: deps.fetch,
      ...deps.now !== void 0 ? { now: deps.now } : {}
    });
    return new Response(renderVerifyPage(username, result), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300"
      }
    });
  }
  return new Response("not found", { status: 404 });
}
__name(route, "route");

// src/index.ts
function cachingFetch(cacheTtlSeconds) {
  return ((input, init) => fetch(input, {
    ...init,
    cf: { cacheTtl: cacheTtlSeconds, cacheEverything: true }
  }));
}
__name(cachingFetch, "cachingFetch");
var src_default = {
  async fetch(request) {
    return route(request, {
      // Index files: users push updates; keep the lag within the badge's own cache window.
      fetch: cachingFetch(120),
      // Entries are immutable; cache hard.
      rekor: new PublicSigstoreRekorClient({ fetch: cachingFetch(86400) })
    });
  }
};

// ../../node_modules/.pnpm/wrangler@4.100.0_@cloudflare+workers-types@4.20260611.1/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/.pnpm/wrangler@4.100.0_@cloudflare+workers-types@4.20260611.1/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-6ToyWF/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../node_modules/.pnpm/wrangler@4.100.0_@cloudflare+workers-types@4.20260611.1/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-6ToyWF/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
//# sourceMappingURL=index.js.map
