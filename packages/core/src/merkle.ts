/**
 * RFC 6962 Merkle tree primitives — the math underneath Rekor's
 * inclusion and consistency proofs.
 *
 * Algorithm ported from
 * https://github.com/google/certificate-transparency-go/blob/master/merkle/log_verifier.go
 * (the canonical reference implementation Sigstore tracks).
 *
 * Leaf hash:  sha256(0x00 || leaf-bytes)
 * Inner hash: sha256(0x01 || left-hash || right-hash)
 *
 * A proof of length n+m has n "inner" hashes (siblings along the path
 * from leaf up to the highest common ancestor with the rightmost
 * leaf) followed by m "border" hashes (always left-leaning siblings
 * above that ancestor). The split is determined by bit-decomposition
 * of leafIndex against treeSize - 1.
 */

import { createHash } from 'node:crypto';

export function hashLeaf(data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(1 + data.length);
  buf[0] = 0x00;
  buf.set(data, 1);
  return new Uint8Array(createHash('sha256').update(buf).digest());
}

export function hashPair(left: Uint8Array, right: Uint8Array): Uint8Array {
  const buf = new Uint8Array(1 + left.length + right.length);
  buf[0] = 0x01;
  buf.set(left, 1);
  buf.set(right, 1 + left.length);
  return new Uint8Array(createHash('sha256').update(buf).digest());
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function bitLength(n: number): number {
  let len = 0;
  while (n > 0) {
    len++;
    n = Math.floor(n / 2);
  }
  return len;
}

function popcount(n: number): number {
  let count = 0;
  while (n > 0) {
    count += n & 1;
    n = Math.floor(n / 2);
  }
  return count;
}

function trailingZeros(n: number): number {
  if (n === 0) return 64;
  let count = 0;
  while ((n & 1) === 0) {
    count++;
    n = Math.floor(n / 2);
  }
  return count;
}

interface ProofDecomposition {
  inner: number;
  border: number;
}

function decompInclProof(leafIndex: number, treeSize: number): ProofDecomposition {
  const inner = bitLength(leafIndex ^ (treeSize - 1));
  const border = popcount(Math.floor(leafIndex / Math.pow(2, inner)));
  return { inner, border };
}

function chainInner(seed: Uint8Array, proof: Uint8Array[], leafIndex: number): Uint8Array {
  let res = seed;
  for (let i = 0; i < proof.length; i++) {
    const bit = (Math.floor(leafIndex / Math.pow(2, i))) & 1;
    res = bit === 0 ? hashPair(res, proof[i]!) : hashPair(proof[i]!, res);
  }
  return res;
}

function chainInnerRight(seed: Uint8Array, proof: Uint8Array[], leafIndex: number): Uint8Array {
  let res = seed;
  for (let i = 0; i < proof.length; i++) {
    const bit = (Math.floor(leafIndex / Math.pow(2, i))) & 1;
    if (bit === 1) {
      res = hashPair(proof[i]!, res);
    }
  }
  return res;
}

function chainBorderRight(seed: Uint8Array, proof: Uint8Array[]): Uint8Array {
  let res = seed;
  for (const p of proof) {
    res = hashPair(p, res);
  }
  return res;
}

/**
 * Verify an RFC 6962 inclusion proof: prove that a leaf with hash
 * `leafHash` at position `leafIndex` is included in a tree of size
 * `treeSize` with root `rootHash`, using the supplied path of
 * sibling hashes.
 */
export function verifyInclusion(
  leafHash: Uint8Array,
  leafIndex: number,
  treeSize: number,
  proof: Uint8Array[],
  rootHash: Uint8Array,
): boolean {
  if (leafIndex < 0 || treeSize < 0 || leafIndex >= treeSize) return false;

  const { inner, border } = decompInclProof(leafIndex, treeSize);
  if (proof.length !== inner + border) return false;

  let res = chainInner(leafHash, proof.slice(0, inner), leafIndex);
  res = chainBorderRight(res, proof.slice(inner));
  return bytesEqual(res, rootHash);
}

/**
 * Verify an RFC 6962 consistency proof: prove that the tree of size
 * `firstSize` with root `firstRoot` is a prefix of the tree of size
 * `secondSize` with root `secondRoot`. Used to detect log rewrites —
 * if our captured root is no longer an ancestor of the current root,
 * the log has been tampered with.
 *
 * Algorithm port of certificate-transparency-go's `VerifyConsistencyProof`.
 */
export function verifyConsistency(
  firstSize: number,
  secondSize: number,
  firstRoot: Uint8Array,
  secondRoot: Uint8Array,
  proof: Uint8Array[],
): boolean {
  if (firstSize < 0 || secondSize < firstSize) return false;
  if (firstSize === secondSize) {
    return proof.length === 0 && bytesEqual(firstRoot, secondRoot);
  }
  if (firstSize === 0) {
    return proof.length === 0;
  }

  let { inner, border } = decompInclProof(firstSize - 1, secondSize);
  const shift = trailingZeros(firstSize);
  inner -= shift;

  let seed: Uint8Array;
  let start: number;
  if ((firstSize & (firstSize - 1)) !== 0) {
    if (proof.length === 0) return false;
    seed = proof[0]!;
    start = 1;
  } else {
    seed = firstRoot;
    start = 0;
  }

  if (proof.length !== start + inner + border) return false;
  const subProof = proof.slice(start);

  const mask = Math.floor((firstSize - 1) / Math.pow(2, shift));

  let hash1 = chainInnerRight(seed, subProof.slice(0, inner), mask);
  hash1 = chainBorderRight(hash1, subProof.slice(inner));
  if (!bytesEqual(hash1, firstRoot)) return false;

  let hash2 = chainInner(seed, subProof.slice(0, inner), mask);
  hash2 = chainBorderRight(hash2, subProof.slice(inner));
  if (!bytesEqual(hash2, secondRoot)) return false;

  return true;
}
