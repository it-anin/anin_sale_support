import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// โหลด pageAccess.tsx ตรง ๆ (เหมือน editprice/navigation.test.mjs) — ไม่ต้อง build
const compiled = ts.transpileModule(readFileSync(new URL('./pageAccess.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: createRequire(import.meta.url) });
const { HeroLinkRail, EXTERNAL_LINKS, PageNavRow, DEFAULT_VISIBILITY, PageVisibilityContext } = exports;

const rail = renderToStaticMarkup(createElement(HeroLinkRail));
const anchors = [...rail.matchAll(/<a [^>]*>/g)].map(match => match[0]);

test('ปุ่มลิงก์มี 2 ปุ่ม ชื่อและ URL ตรงตามที่กำหนด เรียงคืนเงิน → ขนส่ง', () => {
  // EXTERNAL_LINKS ถูกสร้างใน vm.runInNewContext (คนละ "โลก" JS) → .map() คืน Array ของโลกนั้น
  // assert/strict เทียบ prototype ด้วยจึงมองว่าไม่เท่ากัน — Array.from สร้างอาร์เรย์ฝั่งเทสให้ก่อนเทียบ
  assert.deepEqual(Array.from(EXTERNAL_LINKS, link => [link.label, link.href]), [
    ['แบบฟอร์มขออนุมัติคืนเงิน', 'https://it-anin.github.io/Refund_Request_Form/'],
    ['แบบฟอร์มขออนุมัติขนส่ง', 'https://it-anin.github.io/transport_request_form/'],
  ]);
  assert.equal(anchors.length, 2);
  assert.ok(anchors[0].includes('href="https://it-anin.github.io/Refund_Request_Form/"'));
  assert.ok(anchors[1].includes('href="https://it-anin.github.io/transport_request_form/"'));
});

test('ทุกลิงก์เปิดแท็บใหม่และกัน window.opener (noopener noreferrer)', () => {
  for (const anchor of anchors) {
    assert.ok(anchor.includes('target="_blank"'));
    assert.match(anchor, /rel="noopener noreferrer"/);
  }
});

test('ชื่อเต็มอยู่ใน title และ aria-label (มือถือไม่ขยายชื่อ ผู้ใช้โปรแกรมอ่านหน้าจอยังรู้ว่าเป็นปุ่มอะไร)', () => {
  for (const link of EXTERNAL_LINKS) {
    assert.ok(rail.includes(`title="${link.label} — เปิดในแท็บใหม่"`));
    assert.ok(rail.includes(`aria-label="${link.label} (เปิดในแท็บใหม่)"`));
  }
});

test('ปุ่มลิงก์ไม่ทำให้แถวเมนูเดิมเปลี่ยน — ยังมี 7 ปุ่มและไม่มีลิงก์ปน (ปุ่มส่งผ่าน portal เฉพาะบนเบราว์เซอร์)', () => {
  const handlers = Object.fromEntries(['pricetag', 'druglabel', 'stockcheck', 'customerhistory', 'outbound', 'salesupport', 'pendingdocs'].map(id => [id, () => {}]));
  const html = renderToStaticMarkup(createElement(PageVisibilityContext.Provider, { value: DEFAULT_VISIBILITY },
    createElement(PageNavRow, { current: 'pricetag', handlers })));
  assert.equal((html.match(/class="page-nav-card/g) ?? []).length, 7);
  assert.ok(!html.includes('hero-link'));
  assert.ok(html.startsWith('<div class="search-nav-row"'));
});
