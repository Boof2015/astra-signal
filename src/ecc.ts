// Reed–Solomon error correction over GF(2^8).
//
// Primitive polynomial 0x11d, generator alpha = 2 (the QR / DVD convention).
// Ported from "Reed–Solomon codes for coders" (Wikiversity), error-only path
// (no erasure locations). This is what turns "a couple of bars misread by
// glare/moire" into "still the right song" instead of a wrong resolve.

const PRIM = 0x11d;
const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= PRIM;
  }
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return gfExp[gfLog[a]! + gfLog[b]!]!;
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error("GF division by zero");
  if (a === 0) return 0;
  let d = gfLog[a]! - gfLog[b]!;
  if (d < 0) d += 255;
  return gfExp[d]!;
}

function gfPow(x: number, power: number): number {
  let l = (gfLog[x]! * power) % 255;
  if (l < 0) l += 255;
  return gfExp[l]!;
}

function gfInverse(x: number): number {
  return gfExp[255 - gfLog[x]!]!;
}

function gfPolyScale(p: number[], x: number): number[] {
  return p.map((c) => gfMul(c, x));
}

function gfPolyAdd(p: number[], q: number[]): number[] {
  const r = new Array<number>(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i++) r[i + r.length - p.length] = p[i]!;
  for (let i = 0; i < q.length; i++) {
    const k = i + r.length - q.length;
    r[k] = r[k]! ^ q[i]!;
  }
  return r;
}

function gfPolyMul(p: number[], q: number[]): number[] {
  const r = new Array<number>(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++) {
    for (let i = 0; i < p.length; i++) r[i + j] = r[i + j]! ^ gfMul(p[i]!, q[j]!);
  }
  return r;
}

function gfPolyEval(p: number[], x: number): number {
  let y = p[0]!;
  for (let i = 1; i < p.length; i++) y = gfMul(y, x) ^ p[i]!;
  return y;
}

function gfPolyDiv(dividend: number[], divisor: number[]): [number[], number[]] {
  const out = dividend.slice();
  for (let i = 0; i < dividend.length - (divisor.length - 1); i++) {
    const coef = out[i]!;
    if (coef !== 0) {
      for (let j = 1; j < divisor.length; j++) {
        if (divisor[j] !== 0) out[i + j] = out[i + j]! ^ gfMul(divisor[j]!, coef);
      }
    }
  }
  const sep = out.length - (divisor.length - 1);
  return [out.slice(0, sep), out.slice(sep)];
}

function rsGeneratorPoly(nsym: number): number[] {
  let g = [1];
  for (let i = 0; i < nsym; i++) g = gfPolyMul(g, [1, gfPow(2, i)]);
  return g;
}

/** Systematic RS encode: returns `msg` followed by `nsym` parity bytes. */
export function rsEncode(msg: number[], nsym: number): number[] {
  const gen = rsGeneratorPoly(nsym);
  const out = msg.concat(new Array<number>(gen.length - 1).fill(0));
  for (let i = 0; i < msg.length; i++) {
    const coef = out[i]!;
    if (coef !== 0) {
      for (let j = 1; j < gen.length; j++) out[i + j] = out[i + j]! ^ gfMul(gen[j]!, coef);
    }
  }
  for (let i = 0; i < msg.length; i++) out[i] = msg[i]!;
  return out;
}

function rsCalcSyndromes(msg: number[], nsym: number): number[] {
  const synd = [0];
  for (let i = 0; i < nsym; i++) synd.push(gfPolyEval(msg, gfPow(2, i)));
  return synd;
}

function rsFindErrorLocator(synd: number[], nsym: number, eraseCount = 0): number[] {
  let errLoc = [1];
  let oldLoc = [1];
  const syndShift = synd.length > nsym ? synd.length - nsym : 0;
  for (let i = 0; i < nsym - eraseCount; i++) {
    const K = i + syndShift;
    let delta = synd[K]!;
    for (let j = 1; j < errLoc.length; j++) {
      delta ^= gfMul(errLoc[errLoc.length - 1 - j]!, synd[K - j]!);
    }
    oldLoc = oldLoc.concat([0]);
    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = gfPolyScale(oldLoc, delta);
        oldLoc = gfPolyScale(errLoc, gfInverse(delta));
        errLoc = newLoc;
      }
      errLoc = gfPolyAdd(errLoc, gfPolyScale(oldLoc, delta));
    }
  }
  while (errLoc.length && errLoc[0] === 0) errLoc.shift();
  const errs = errLoc.length - 1;
  if (errs * 2 + eraseCount > nsym) throw new Error("too many errors to correct");
  return errLoc;
}

function rsFindErrors(errLoc: number[], nmess: number): number[] {
  const errs = errLoc.length - 1;
  const errPos: number[] = [];
  for (let i = 0; i < nmess; i++) {
    if (gfPolyEval(errLoc, gfPow(2, i)) === 0) errPos.push(nmess - 1 - i);
  }
  if (errPos.length !== errs) throw new Error("could not locate all errors");
  return errPos;
}

function rsFindErrataLocator(coefPos: number[]): number[] {
  let eLoc = [1];
  for (const i of coefPos) eLoc = gfPolyMul(eLoc, gfPolyAdd([1], [gfPow(2, i), 0]));
  return eLoc;
}

function rsFindErrorEvaluator(synd: number[], errLoc: number[], nsym: number): number[] {
  const [, remainder] = gfPolyDiv(
    gfPolyMul(synd, errLoc),
    [1].concat(new Array<number>(nsym + 1).fill(0))
  );
  return remainder;
}

function rsCorrectErrata(msg: number[], synd: number[], errPos: number[]): number[] {
  const coefPos = errPos.map((p) => msg.length - 1 - p);
  const errLoc = rsFindErrataLocator(coefPos);
  const errEval = rsFindErrorEvaluator(
    synd.slice().reverse(),
    errLoc,
    errLoc.length - 1
  ).reverse();

  const X: number[] = [];
  for (let i = 0; i < coefPos.length; i++) X.push(gfPow(2, -(255 - coefPos[i]!)));

  const E = new Array<number>(msg.length).fill(0);
  for (let i = 0; i < X.length; i++) {
    const Xi = X[i]!;
    const XiInv = gfInverse(Xi);
    let errLocPrime = 1;
    for (let j = 0; j < X.length; j++) {
      if (j !== i) errLocPrime = gfMul(errLocPrime, 1 ^ gfMul(XiInv, X[j]!));
    }
    if (errLocPrime === 0) throw new Error("could not solve error magnitude");
    let y = gfPolyEval(errEval.slice().reverse(), XiInv);
    y = gfMul(Xi, y);
    E[errPos[i]!] = gfDiv(y, errLocPrime);
  }
  return gfPolyAdd(msg, E);
}

export interface RsDecodeResult {
  /** The recovered message bytes (parity stripped). */
  msg: number[];
  /** Number of byte errors that were corrected. */
  corrected: number;
  /** Number of supplied erasures included in the correction. */
  erasures: number;
}

function rsForneySyndromes(synd: number[], erasePos: number[], nmess: number): number[] {
  const fsynd = synd.slice(1);
  for (const position of erasePos) {
    const x = gfPow(2, nmess - 1 - position);
    for (let j = 0; j < fsynd.length - 1; j++) {
      fsynd[j] = gfMul(fsynd[j]!, x) ^ fsynd[j + 1]!;
    }
    fsynd.pop();
  }
  return [0, ...fsynd];
}

/**
 * Decode a systematic RS codeword, correcting up to `floor(nsym / 2)` byte
 * errors. Throws if the codeword has more errors than can be corrected.
 */
export function rsDecode(codeword: number[], nsym: number, erasurePositions: ReadonlyArray<number> = []): RsDecodeResult {
  const msgOut = codeword.slice();
  const erasePos = [...new Set(erasurePositions)].sort((a, b) => a - b);
  if (erasePos.length > nsym) throw new Error("too many erasures to correct");
  for (const position of erasePos) {
    if (!Number.isInteger(position) || position < 0 || position >= msgOut.length) {
      throw new Error("invalid erasure position");
    }
    msgOut[position] = 0;
  }
  const synd = rsCalcSyndromes(msgOut, nsym);
  if (Math.max(...synd) === 0) {
    return { msg: msgOut.slice(0, msgOut.length - nsym), corrected: 0, erasures: 0 };
  }
  const fsynd = rsForneySyndromes(synd, erasePos, msgOut.length);
  const errLoc = rsFindErrorLocator(fsynd, nsym, erasePos.length);
  const foundErrors = rsFindErrors(errLoc.slice().reverse(), msgOut.length);
  const errPos = [...new Set([...erasePos, ...foundErrors])].sort((a, b) => a - b);
  if ((errPos.length - erasePos.length) * 2 + erasePos.length > nsym) {
    throw new Error("too many errors to correct");
  }
  const corrected = rsCorrectErrata(msgOut, synd, errPos);
  const synd2 = rsCalcSyndromes(corrected, nsym);
  if (Math.max(...synd2) > 0) throw new Error("message is too corrupted to correct");
  return {
    msg: corrected.slice(0, corrected.length - nsym),
    corrected: errPos.length,
    erasures: erasePos.length,
  };
}
