import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAm1, encodeAm1, Am1Error } from "./am1.ts";

test("parses a soil packet with NA and NPK", () => {
  const p = parseAm1("AM1,ID=7c9e1a,T=SOIL,N=12,M1=41.5,M2=NA,NPK=55-48-61,BV=3.98");
  assert.equal(p.id, "7C9E1A");
  assert.equal(p.type, "SOIL");
  assert.equal(p.seq, 12);
  assert.equal(p.fields.M1, 41.5);
  assert.equal(p.fields.M2, null);
  assert.equal(p.fields.NI, 55);
  assert.equal(p.fields.KI, 61);
  assert.equal(p.fields.BV, 3.98);
});

test("keeps string keys as text (valve pattern keeps its leading zero)", () => {
  const p = parseAm1("AM1,ID=T4C5D6,T=TANK,N=1,VLV=010,PHASE=OK");
  assert.equal(p.fields.VLV, "010");
  assert.equal(p.fields.PHASE, "OK");
});

test("rejects malformed packets", () => {
  assert.throws(() => parseAm1("XX1,ID=7C9E1A,T=SOIL"), Am1Error);
  assert.throws(() => parseAm1("AM1,ID=12,T=SOIL"), Am1Error);
  assert.throws(() => parseAm1("AM1,ID=7C9E1A"), Am1Error);
  assert.throws(() => parseAm1("AM1,ID=7C9E1A,T=SOIL,N=abc"), Am1Error);
  assert.throws(() => parseAm1("AM1,ID=7C9E1A,T=SOIL,BROKEN"), Am1Error);
});

test("encode → parse round trip", () => {
  const s = encodeAm1("P1A2B3", "CMD", 7, { CMD: "PUMP", VAL: "ON", X: null, Y: true });
  assert.equal(s, "AM1,ID=P1A2B3,T=CMD,N=7,CMD=PUMP,VAL=ON,X=NA,Y=1");
  const p = parseAm1(s);
  assert.equal(p.fields.CMD, "PUMP");
  assert.equal(p.fields.Y, 1);
  assert.throws(() => encodeAm1("A1A2B3", "CMD", 1, { MSG: "a,b" }), Am1Error);
});
