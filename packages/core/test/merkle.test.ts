import { describe, it, expect } from 'vitest';

import {
  hashLeaf,
  hashPair,
  verifyInclusion,
  verifyConsistency,
} from '../src/merkle.js';

// Build a deterministic Merkle tree from leaf data so tests have a
// trusted source for roots and proofs.
function leafFor(n: number): Uint8Array {
  return hashLeaf(new TextEncoder().encode(`leaf-${n}`));
}

function buildTree(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) {
    const empty = new Uint8Array(32);
    return new Uint8Array(require('node:crypto').createHash('sha256').update(empty).digest());
  }
  if (leaves.length === 1) return leaves[0]!;
  // Largest power of 2 < n
  let k = 1;
  while (k < leaves.length) k *= 2;
  k = k / 2;
  return hashPair(buildTree(leaves.slice(0, k)), buildTree(leaves.slice(k)));
}

function inclusionProof(leaves: Uint8Array[], index: number): Uint8Array[] {
  if (leaves.length <= 1) return [];
  let k = 1;
  while (k < leaves.length) k *= 2;
  k = k / 2;
  if (index < k) {
    // Recurse into left subtree; sibling is right subtree's root
    return [...inclusionProof(leaves.slice(0, k), index), buildTree(leaves.slice(k))];
  } else {
    return [...inclusionProof(leaves.slice(k), index - k), buildTree(leaves.slice(0, k))];
  }
}

describe('hashLeaf and hashPair', () => {
  it('hashLeaf prepends 0x00 (RFC 6962 leaf domain separation)', () => {
    const a = hashLeaf(new Uint8Array([1, 2, 3]));
    const b = hashLeaf(new Uint8Array([1, 2, 3]));
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
    // Distinct from sha256(data) and from sha256(0x01 || data)
    const raw = require('node:crypto').createHash('sha256').update(Uint8Array.from([1, 2, 3])).digest();
    expect(Buffer.from(a)).not.toEqual(raw);
  });

  it('hashPair prepends 0x01 (inner node domain separation)', () => {
    const a = hashPair(new Uint8Array([1]), new Uint8Array([2]));
    const b = hashPair(new Uint8Array([1]), new Uint8Array([2]));
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
    // Asymmetric: hashPair(L, R) != hashPair(R, L)
    const swapped = hashPair(new Uint8Array([2]), new Uint8Array([1]));
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(swapped).toString('hex'));
  });
});

describe('verifyInclusion', () => {
  it.each([1, 2, 3, 4, 5, 7, 8, 11, 23])('tree size %i, every index verifies', (n) => {
    const leaves = Array.from({ length: n }, (_, i) => leafFor(i));
    const root = buildTree(leaves);
    for (let i = 0; i < n; i++) {
      const proof = inclusionProof(leaves, i);
      expect(verifyInclusion(leaves[i]!, i, n, proof, root), `n=${n} i=${i}`).toBe(true);
    }
  });

  it('rejects when leaf hash is wrong', () => {
    const leaves = Array.from({ length: 7 }, (_, i) => leafFor(i));
    const root = buildTree(leaves);
    const proof = inclusionProof(leaves, 3);
    const tampered = new Uint8Array(32); // all zeros
    expect(verifyInclusion(tampered, 3, 7, proof, root)).toBe(false);
  });

  it('rejects when root is wrong', () => {
    const leaves = Array.from({ length: 7 }, (_, i) => leafFor(i));
    const proof = inclusionProof(leaves, 3);
    const wrongRoot = new Uint8Array(32);
    expect(verifyInclusion(leaves[3]!, 3, 7, proof, wrongRoot)).toBe(false);
  });

  it('rejects when proof length is wrong', () => {
    const leaves = Array.from({ length: 7 }, (_, i) => leafFor(i));
    const root = buildTree(leaves);
    const proof = inclusionProof(leaves, 3);
    expect(verifyInclusion(leaves[3]!, 3, 7, proof.slice(0, -1), root)).toBe(false);
    expect(
      verifyInclusion(leaves[3]!, 3, 7, [...proof, new Uint8Array(32)], root),
    ).toBe(false);
  });

  it('rejects out-of-range indices', () => {
    const leaves = Array.from({ length: 7 }, (_, i) => leafFor(i));
    const root = buildTree(leaves);
    expect(verifyInclusion(leaves[0]!, 7, 7, [], root)).toBe(false);
    expect(verifyInclusion(leaves[0]!, -1, 7, [], root)).toBe(false);
  });
});

describe('verifyConsistency', () => {
  // Helper: build a consistency proof for old size → new size.
  function consistencyProof(leaves: Uint8Array[], firstSize: number): Uint8Array[] {
    // Reference: RFC 6962 §2.1.2. Iterative computation via SUBPROOF(m, D[n], true).
    function subProof(m: number, leavesSlice: Uint8Array[], complete: boolean): Uint8Array[] {
      const n = leavesSlice.length;
      if (m === n) {
        return complete ? [] : [buildTree(leavesSlice)];
      }
      if (m === 0) return [];
      let k = 1;
      while (k < n) k *= 2;
      k = k / 2;
      if (m <= k) {
        return [...subProof(m, leavesSlice.slice(0, k), complete), buildTree(leavesSlice.slice(k))];
      } else {
        return [...subProof(m - k, leavesSlice.slice(k), false), buildTree(leavesSlice.slice(0, k))];
      }
    }
    return subProof(firstSize, leaves, true);
  }

  it.each([
    [1, 4], [1, 7], [3, 7], [4, 7], [7, 8], [4, 8], [4, 9], [6, 10], [5, 12], [11, 23],
  ])('verifies (first=%i, second=%i)', (first, second) => {
    const leaves = Array.from({ length: second }, (_, i) => leafFor(i));
    const firstRoot = buildTree(leaves.slice(0, first));
    const secondRoot = buildTree(leaves);
    const proof = consistencyProof(leaves, first);
    expect(verifyConsistency(first, second, firstRoot, secondRoot, proof)).toBe(true);
  });

  it('accepts empty proof when sizes are equal', () => {
    const leaves = Array.from({ length: 5 }, (_, i) => leafFor(i));
    const root = buildTree(leaves);
    expect(verifyConsistency(5, 5, root, root, [])).toBe(true);
  });

  it('rejects empty proof when sizes differ', () => {
    const leaves = Array.from({ length: 5 }, (_, i) => leafFor(i));
    const r3 = buildTree(leaves.slice(0, 3));
    const r5 = buildTree(leaves);
    expect(verifyConsistency(3, 5, r3, r5, [])).toBe(false);
  });

  it('rejects when secondRoot is wrong (tampered)', () => {
    const leaves = Array.from({ length: 7 }, (_, i) => leafFor(i));
    const r3 = buildTree(leaves.slice(0, 3));
    const wrong = new Uint8Array(32);
    const proof = consistencyProof(leaves, 3);
    expect(verifyConsistency(3, 7, r3, wrong, proof)).toBe(false);
  });

  it('rejects when secondSize < firstSize', () => {
    const leaves = Array.from({ length: 5 }, (_, i) => leafFor(i));
    const root = buildTree(leaves);
    expect(verifyConsistency(5, 3, root, root, [])).toBe(false);
  });
});
