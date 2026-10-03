// SHA-256 e PBKDF2-HMAC-SHA256 em JS puro.
// Só é usado quando crypto.subtle não existe (página aberta por http:// fora do localhost,
// ex.: teste pela rede local). No GitHub Pages (https) o navegador usa o crypto nativo.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const W = new Uint32Array(64);

function compress(H, w) {
  for (let i = 0; i < 16; i++) W[i] = w[i];
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15], b = W[i - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let [a, b, c, d, e, f, g, h] = H;
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const mj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + mj) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
  H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
}

// continua um hash a partir de um estado, com `prefix` bytes já processados
function finish(state, bytes, prefix) {
  const H = Int32Array.from(state), total = prefix + bytes.length;
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor((total * 8) / 2 ** 32));
  dv.setUint32(padded.length - 4, (total * 8) >>> 0);
  const w = new Uint32Array(16);
  for (let o = 0; o < padded.length; o += 64) { for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4); compress(H, w); }
  return H;
}
const toBytes = (H) => { const o = new Uint8Array(32), dv = new DataView(o.buffer); H.forEach((v, i) => dv.setUint32(i * 4, v >>> 0)); return o; };

export function sha256(bytes) { return toBytes(finish(IV, bytes, 0)); }

export function pbkdf2Sha256(pass, salt, iterations, dkLen = 32) {
  let key = pass;
  if (key.length > 64) key = sha256(key);
  const ip = new Uint8Array(64).fill(0x36), op = new Uint8Array(64).fill(0x5c);
  key.forEach((b, i) => { ip[i] ^= b; op[i] ^= b; });
  const state = (block) => { const H = Int32Array.from(IV), w = new Uint32Array(16), dv = new DataView(block.buffer); for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4); compress(H, w); return H; };
  const iS = state(ip), oS = state(op);
  const out = new Uint8Array(Math.ceil(dkLen / 32) * 32);
  const w = new Uint32Array(16);
  for (let blk = 1; blk * 32 - 32 < dkLen; blk++) {
    const msg = new Uint8Array(salt.length + 4); msg.set(salt);
    new DataView(msg.buffer).setUint32(salt.length, blk);
    let U = finish(oS, toBytes(finish(iS, msg, 64)), 64);
    const T = Int32Array.from(U);
    for (let it = 1; it < iterations; it++) {
      // bloco interno: 8 palavras de U + padding (comprimento total = 64 + 32 bytes)
      w.fill(0); for (let i = 0; i < 8; i++) w[i] = U[i]; w[8] = 0x80000000; w[15] = 768;
      const I = Int32Array.from(iS); compress(I, w);
      w.fill(0); for (let i = 0; i < 8; i++) w[i] = I[i]; w[8] = 0x80000000; w[15] = 768;
      const O = Int32Array.from(oS); compress(O, w);
      U = O;
      for (let i = 0; i < 8; i++) T[i] ^= U[i];
    }
    out.set(toBytes(T), (blk - 1) * 32);
  }
  return out.slice(0, dkLen);
}
