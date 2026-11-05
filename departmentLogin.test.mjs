import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync(new URL("./departmentLogin.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports }, { filename: "departmentLogin.ts" });
const { findDepartmentProfile } = exports;

const fixture = (id, group, password, branch = null) =>
  Object.freeze({ id, label: id, group, password, branch, icon: "" });
const profiles = Object.freeze([
  fixture("SRC", "สาขา", "src-example", "SRC"),
  fixture("KKL", "สาขา", "kkl-example", "KKL"),
  fixture("SSS", "สาขา", "sss-example", "SSS"),
  fixture("SALE_ADMIN", "สาขา", "admin-example", "SALE_ADMIN"),
  fixture("PURCHASING", "จัดซื้อ", "purchase-example"),
  fixture("WAREHOUSE", "คลังสินค้า", "warehouse-example"),
]);

test("sales accepts all existing branch and Sale Admin profile types", () => {
  for (const profile of profiles.filter((item) => item.group === "สาขา")) {
    assert.equal(
      findDepartmentProfile(profiles, "sales", profile.password)?.id,
      profile.id,
    );
  }
});

test("purchasing and warehouse keep their existing profile identity and branch", () => {
  for (const [department, id] of [
    ["purchasing", "PURCHASING"],
    ["warehouse", "WAREHOUSE"],
  ]) {
    const profile = profiles.find((item) => item.id === id);
    assert.ok(
      findDepartmentProfile(profiles, department, profile.password) === profile,
    );
  }
});

test("a valid password for another department cannot sign in to the selected department", () => {
  for (const [department, allowedGroup] of [
    ["sales", "สาขา"],
    ["purchasing", "จัดซื้อ"],
    ["warehouse", "คลังสินค้า"],
  ]) {
    for (const profile of profiles.filter(
      (item) => item.group !== allowedGroup,
    )) {
      assert.equal(
        findDepartmentProfile(profiles, department, profile.password),
        null,
      );
    }
  }
});

test("unknown departments, empty passwords, and incorrect passwords do not authenticate", () => {
  assert.equal(findDepartmentProfile(profiles, "unknown", "src-example"), null);
  assert.equal(findDepartmentProfile(profiles, "sales", ""), null);
  assert.equal(findDepartmentProfile(profiles, "sales", "incorrect"), null);
  assert.equal(
    findDepartmentProfile([fixture("EMPTY", "สาขา", "")], "sales", ""),
    null,
  );
});

test("password matching remains exact, including case and whitespace", () => {
  const exact = [fixture("EXACT", "สาขา", " Sample-Case ")];
  assert.equal(
    findDepartmentProfile(exact, "sales", " Sample-Case ")?.id,
    "EXACT",
  );
  for (const password of ["Sample-Case", " sample-case ", " SAMPLE-CASE "]) {
    assert.equal(findDepartmentProfile(exact, "sales", password), null);
  }
});

test("shared passwords resolve only within the selected department without mutating profiles", () => {
  const shared = Object.freeze([
    fixture("SALES", "สาขา", "shared-example", "SRC"),
    fixture("PURCHASING", "จัดซื้อ", "shared-example"),
    fixture("WAREHOUSE", "คลังสินค้า", "shared-example"),
  ]);
  assert.equal(
    findDepartmentProfile(shared, "sales", "shared-example")?.id,
    "SALES",
  );
  assert.equal(
    findDepartmentProfile(shared, "purchasing", "shared-example")?.id,
    "PURCHASING",
  );
  assert.equal(
    findDepartmentProfile(shared, "warehouse", "shared-example")?.id,
    "WAREHOUSE",
  );
  assert.equal(shared.length, 3);
  assert.ok(shared.every(Object.isFrozen));
});
