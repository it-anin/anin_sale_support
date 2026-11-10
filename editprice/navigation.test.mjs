import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const compiled = ts.transpileModule(readFileSync(new URL('../pageAccess.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: createRequire(import.meta.url) });
const { PageNavRow, DEFAULT_VISIBILITY, PageVisibilityContext, PurchasingNavigationContext, PageNotificationContext } = exports;
const handlers = Object.fromEntries(['pricetag', 'druglabel', 'stockcheck', 'customerhistory', 'outbound', 'salesupport', 'pendingdocs'].map(id => [id, () => {}]));

function navigation(purchasing, current = 'pricetag', visibility = {}) {
  return renderToStaticMarkup(createElement(PageVisibilityContext.Provider, { value: { ...DEFAULT_VISIBILITY, ...visibility } },
    createElement(PurchasingNavigationContext.Provider, { value: purchasing ? () => {} : null },
      createElement(PageNotificationContext.Provider, { value: { salesupport: 2 } }, createElement(PageNavRow, { current, handlers })))));
}

test('purchasing sees Edit Price in exactly the Label slot on every allowed page, with seven buttons', () => {
  for (const current of ['pricetag', 'stockcheck', 'salesupport', 'editprice']) {
    const html = navigation(true, current, { editprice: true, druglabel: false });
    const labels = [...html.matchAll(/class="page-nav-label">([^<]+)/g)].map(match => match[1]);
    assert.deepEqual(labels, ['Price', 'Edit Price', 'Stock', 'Customer', 'Outbound', 'Support', 'Pending']);
    const editButton = html.match(/<button[^>]+title="เปรียบเทียบและปรับราคา"[^>]*>/)?.[0];
    assert.ok(editButton);
    assert.ok(!editButton.includes('disabled'));
    assert.equal(editButton.includes('aria-current="page"'), current === 'editprice');
  }
});

test('other profiles keep Label and its existing enabled or disabled state', () => {
  for (const labelVisible of [true, false]) {
    const html = navigation(false, 'pricetag', { druglabel: labelVisible, editprice: true });
    assert.ok(html.includes('>Label</span>'));
    assert.ok(!html.includes('>Edit Price</span>'));
    const labelButton = html.match(/<button[^>]+title="ฉลากยา[^"<]*"[^>]*>/)?.[0];
    assert.ok(labelButton);
    assert.equal(labelButton.includes('disabled'), !labelVisible);
  }
});

test('replacement preserves other navigation permissions and notifications', () => {
  const html = navigation(true, 'editprice', { editprice: true, customerhistory: false });
  assert.match(html, /disabled=""[^>]*title="ประวัติลูกค้า/);
  assert.equal((html.match(/page-nav-notification-dot/g) ?? []).length, 1);
});
