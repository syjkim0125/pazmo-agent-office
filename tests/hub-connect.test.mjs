import test from "node:test";
import assert from "node:assert/strict";
import { parseConnection } from "../src/runtime/hub-connect.ts";

const CODE = "a".repeat(43);
const FP = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, "0").toUpperCase()).join(":");
test("a connection string from the hub start page parses, with or without a fingerprint, ignoring wrapping", () => {
  assert.deepEqual(parseConnection(`https://pazmo-hub.apps.example.com/connect#c=${CODE}`),
    { hub: "https://pazmo-hub.apps.example.com", code: CODE, fingerprint: null });
  assert.deepEqual(parseConnection(`  "https://192.168.0.2:8443/connect#c=${CODE}&fp=${FP}"\n`),
    { hub: "https://192.168.0.2:8443", code: CODE, fingerprint: FP });
});

test("an old terminal command pasted whole is understood too", () => {
  assert.deepEqual(parseConnection(`pazmo-office hub-link --project <이 레포의 로컬 경로> --hub https://h.example:8443 --code ${CODE} --fingerprint ${FP}`),
    { hub: "https://h.example:8443", code: CODE, fingerprint: FP });
  assert.deepEqual(parseConnection(`pazmo-office hub-link --project /p --hub https://h.example --code ${CODE}`),
    { hub: "https://h.example", code: CODE, fingerprint: null });
});

test("anything else is refused with a plain message", () => {
  for (const bad of ["", "hello", `http://h.example/connect#c=${CODE}`, `https://h.example/other#c=${CODE}`, "https://h.example/connect#c=short", `https://h.example/connect?c=${CODE}`,
    `https://h.example/connect#c=${CODE}&fp=zz`, `https://u:p@h.example/connect#c=${CODE}`, `pazmo-office hub-link --hub https://h.example --code short`, `pazmo-office hub-link --hub http://h.example --code ${CODE}`,
    `pazmo-office hub-link --hub https://h.example --code ${CODE} --fingerprint <지문>`, `pazmo-office hub-link --hub https://h.example --code ${CODE} --fingerprint zz`, `pazmo-office hub-link --hub https://h.example --code ${CODE} --fingerprint ${FP}.`,
    `https://h.example/connect#c=${CODE}&fp=AB:CD`, `https://h.example/connect#c=${CODE}&amp;fp=${FP}`, `https://h.example/connect#c=${CODE}&FP=${FP}`,
    `https://h.example/connect#c=${CODE}&fp=${FP}&fp=${FP}`, `https://h.example/connect#c=${CODE}&c=${CODE}`, `https://h.example/connect#c=${CODE}&evil=1`, `https://h.example/connect#c=${CODE}&fp=`,
    `https://h.example/connect#c=${CODE}&fp=:::`, `https://h.example/connect#c=${CODE}&fp=${FP.toLowerCase().replaceAll(":", "")}`, `https://h.example/connect#c=${CODE}&fp=${FP}:00`,
    `pazmo-office hub-link --hub https://h.example --code ${CODE} --fingerprint=${FP}`, `pazmo-office hub-link --hub https://h.example --code ${CODE} --fingerprint AB:CD`, `pazmo-office hub-link --hub https://h.example --code ${CODE} --fingerprint :::`])
    assert.throws(() => parseConnection(bad), { code: "HUB_CONNECT_INVALID", message: "연결 문자열 형식이 아닙니다. 허브의 내 Office 연결에서 복사해 주세요." }, bad);
});
