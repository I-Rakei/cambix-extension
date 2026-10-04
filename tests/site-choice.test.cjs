const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

require('../price-parser.js');

const contentScript = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const rates = { ZAR: { market: 4, bim: 4.2, bci: 4.1 } };

function openPage(stored, href = 'https://shop.example.com/product') {
  const timers = new Map();
  const storageListeners = [];
  let nextTimer = 0;
  let messageListener;
  let mutationListener;

  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.nodeType = 1;
      this.isConnected = false;
      this.children = [];
      this.style = {};
      this.listeners = {};
      this.textContent = '';
      this.parentElement = null;
    }
    append(...children) {
      for (const child of children) {
        child.isConnected = true;
        child.parentElement = this;
        this.children.push(child);
      }
    }
    after(element) { this.parentElement.append(element); }
    remove() { this.isConnected = false; }
    closest() { return null; }
    querySelector() { return null; }
    getAttribute(name) { return name === 'aria-label' ? this.ariaLabel : null; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    click() { return this.listeners.click(); }
  }

  const body = new Element('body');
  body.isConnected = true;
  const price = new Element('span');
  price.isConnected = true;
  price.ariaLabel = 'R 100';
  price.textContent = 'R 100';
  body.append(price);
  body.querySelectorAll = () => [price];

  const document = {
    body,
    head: new Element('head'),
    documentElement: { lang: 'en-ZA' },
    createElement: (tag) => new Element(tag),
    createTreeWalker: () => ({ nextNode: () => null }),
    querySelector: () => null,
    getElementById: (id) => body.children.find((item) => item.id === id && item.isConnected) || null
  };
  const location = { hostname: new URL(href).hostname, href };
  const chrome = {
    runtime: {
      getURL: (file) => `chrome-extension://test/${file}`,
      sendMessage: async () => ({ ok: true, rates, stale: false }),
      onMessage: { addListener: (listener) => { messageListener = listener; } }
    },
    storage: {
      local: {
        get: async () => ({ ...stored }),
        set: async (changes) => {
          for (const [key, value] of Object.entries(changes)) {
            const oldValue = stored[key];
            stored[key] = value;
            for (const listener of storageListeners) listener({ [key]: { oldValue, newValue: value } });
          }
        }
      },
      onChanged: { addListener: (listener) => storageListeners.push(listener) }
    }
  };

  class MutationObserver {
    constructor(listener) { mutationListener = listener; }
    observe() {}
    takeRecords() { return []; }
  }

  vm.runInNewContext(contentScript, {
    window: { CambixPrice: globalThis.CambixPrice }, document, location, chrome,
    MutationObserver, NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2 }, Node: { ELEMENT_NODE: 1 },
    matchMedia: () => ({ matches: true }),
    setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    Intl
  });

  return {
    location,
    get prompt() { return document.getElementById('cambix-prompt'); },
    get badges() { return body.children.filter((item) => item.className === 'cambix-badge' && item.isConnected); },
    async runTimers() {
      await Promise.resolve();
      while (timers.size) {
        const pending = [...timers.values()];
        timers.clear();
        for (const callback of pending) callback();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
    send(type, extra = {}) {
      return new Promise((resolve) => messageListener({ type, ...extra }, null, resolve));
    },
    mutate() { mutationListener([{ target: price }]); }
  };
}

test('side-panel conversion is immediate and remembered on later visits', async () => {
  const stored = {};
  const first = openPage(stored);
  const result = await first.send('CAMBIX_CONVERT', { mode: 'market' });
  assert.equal(result.ok, true);
  assert.equal(first.badges.length, 1);
  assert.equal(stored['cambix_site_choice:shop.example.com'], 'convert');
  await first.runTimers();
  assert.equal(first.prompt, null);

  const later = openPage(stored, 'https://shop.example.com/another-product');
  await later.runTimers();
  assert.equal(later.badges.length, 1);
  assert.equal(later.prompt, null);
});

test('ignoring a prompt suppresses it until the user converts manually', async () => {
  const stored = {};
  const first = openPage(stored);
  await first.runTimers();
  assert.ok(first.prompt);
  await first.prompt.children[2].children[0].click();
  assert.equal(stored['cambix_site_choice:shop.example.com'], 'ignore');

  const later = openPage(stored);
  await later.runTimers();
  assert.equal(later.prompt, null);
  assert.equal(later.badges.length, 0);
  assert.equal((await later.send('CAMBIX_CONVERT', { mode: 'market' })).ok, true);
  assert.equal(stored['cambix_site_choice:shop.example.com'], 'convert');
});

test('accepting the in-page prompt converts and remembers the site', async () => {
  const stored = {};
  const first = openPage(stored, 'https://www.shop.example.com/product');
  await first.runTimers();
  await first.prompt.children[2].children[1].click();
  assert.equal(first.badges.length, 1);
  assert.equal(first.prompt, null);
  assert.equal(stored['cambix_site_choice:shop.example.com'], 'convert');

  const later = openPage(stored, 'https://shop.example.com/other-product');
  await later.runTimers();
  assert.equal(later.badges.length, 1);
  assert.equal(later.prompt, null);
});

test('automatic detection can be disabled without blocking the Convert button', async () => {
  const stored = { cambix_auto_detect: false, 'cambix_site_choice:shop.example.com': 'convert' };
  const page = openPage(stored);
  await page.runTimers();
  assert.equal(page.badges.length, 0);
  assert.equal(page.prompt, null);
  assert.equal((await page.send('CAMBIX_CONVERT', { mode: 'market' })).ok, true);
  assert.equal(page.badges.length, 1);
});

test('revert keeps the current page restored, then converts the next page', async () => {
  const stored = { 'cambix_site_choice:shop.example.com': 'convert' };
  const page = openPage(stored);
  await page.runTimers();
  assert.equal(page.badges.length, 1);

  assert.equal((await page.send('CAMBIX_REVERT')).count, 1);
  page.mutate();
  await page.runTimers();
  assert.equal(page.badges.length, 0);

  page.location.href = 'https://shop.example.com/next-product';
  page.mutate();
  await page.runTimers();
  assert.equal(page.badges.length, 1);
});
