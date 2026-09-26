// Detect marked prices in ordinary text and in price widgets that split
// currency, whole units, and cents across different elements.
(() => {
  if (window.__cambixLoaded) return;
  window.__cambixLoaded = true;

  const { findPrices, barePrice, inferCurrency } = window.CambixPrice;
  const isTakealot = location.hostname === 'takealot.com' || location.hostname.endsWith('.takealot.com');
  const PRICE_ELEMENTS = '.a-price, [itemprop="price"], [data-testid*="price" i], [data-automation-id*="price" i], [data-ref*="price" i], [aria-label*="price" i], [class*="price" i], [id*="price" i]';
  const SKIP_ELEMENTS = 'script, style, noscript, textarea, input, select, option, code, pre, s, del, [contenteditable], [hidden], [aria-hidden="true"], .a-offscreen, #cambix-prompt, .cambix-badge, .cambix-inline';
  const OLD_PRICE_ELEMENTS = 's, del, [class*="old-price" i], [class*="list-price" i], [class*="was-price" i]';
  const format = new Intl.NumberFormat('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const badgeStyle = 'display:inline-block;margin-inline-start:6px;padding:2px 6px;border-radius:4px;font:600 14px CambixInter,Arial,sans-serif;white-space:nowrap;vertical-align:baseline';
  const fontStyle = document.createElement('style');
  fontStyle.textContent = `@font-face{font-family:CambixInter;src:url("${chrome.runtime.getURL('fonts/InterVariable.woff2')}") format("woff2");font-weight:100 900;font-display:swap}`;
  (document.head || document.documentElement).append(fontStyle);
  const textConversions = new Map();
  const badges = new Map();
  let oldPriceCache = new WeakMap();

  let observer;
  let refreshTimer;
  let busy = false;
  let autoDetect = true;
  let promptShown = false;
  let theme;
  let activeRates = null;
  let activeMode = null;
  let lastUrl = location.href;

  function pageCurrency() {
    const metadata = document.querySelector('[itemprop="priceCurrency"], meta[property="product:price:currency"]');
    const declared = metadata?.getAttribute('content') || metadata?.textContent?.trim() || '';
    return inferCurrency(location.hostname, document.documentElement.lang, declared);
  }

  function eligible(element) {
    return element.isConnected && !element.closest(SKIP_ELEMENTS) && (!isTakealot || !isOldPrice(element));
  }

  function isOldPrice(element) {
    if (!element) return false;
    if (oldPriceCache.has(element)) return oldPriceCache.get(element);
    const old = element.matches(OLD_PRICE_ELEMENTS)
      || getComputedStyle(element).textDecorationLine.includes('line-through')
      || isOldPrice(element.parentElement);
    oldPriceCache.set(element, old);
    return old;
  }

  function takealotPriceText(element) {
    const parts = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (isOldPrice(node.parentElement) || node.parentElement.closest('.cambix-badge, .cambix-inline')) continue;
      const part = node.nodeValue.trim();
      if (part) parts.push(part);
    }
    return parts.join(' ');
  }

  function priceFromElement(element, currency) {
    const sources = [
      element.querySelector('.a-offscreen')?.textContent,
      element.getAttribute('aria-label'),
      element.getAttribute('content'),
      isTakealot ? takealotPriceText(element) : element.textContent
    ];
    for (const source of sources) {
      if (!source || source.length > 80) continue;
      const normalized = isTakealot
        ? source.replace(/\bFrom(?=R\s*\d)/gi, 'From ')
          .replace(/\b(?:Price\s+from|Price|From)\s+([\d\s.,]+)\s+rand\b/gi, 'R $1')
        : source;
      const found = findPrices(normalized);
      if (found.length === 1) return { code: found[0].code, amount: found[0].amount };
      if (found.length === 0) {
        const bare = barePrice(source, currency);
        if (bare) return bare;
      }
    }
    return null;
  }

  function cleanStaleConversions() {
    for (const [element, entry] of textConversions) {
      if (!element.isConnected || element.textContent !== entry.rendered) textConversions.delete(element);
    }
    for (const [element, entry] of badges) {
      const current = element.isConnected ? priceFromElement(element, pageCurrency()) : null;
      if (!element.isConnected || !entry.badge.isConnected || !current || current.code !== entry.code || current.amount !== entry.amount) {
        entry.badge.remove();
        badges.delete(element);
      }
    }
  }

  function collect() {
    if (!document.body) return { elements: [], textNodes: [], count: 0 };
    oldPriceCache = new WeakMap();
    cleanStaleConversions();
    const currency = pageCurrency();
    const covered = new Set(badges.keys());
    const elements = [];

    if (isTakealot) {
      const splitWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = splitWalker.nextNode())) {
        if (!/\bFrom|^\s*R(?:\s*\d)?/i.test(node.nodeValue || '')) continue;
        let candidate = node.parentElement;
        for (let depth = 0; candidate && depth < 8; depth++, candidate = candidate.parentElement) {
          if (!eligible(candidate) || hasCoveredAncestor(candidate, covered)) break;
          if (hasCoveredDescendant(candidate, covered)) break;
          if (candidate.textContent.length > 80) break;
          const price = priceFromElement(candidate, currency);
          if (!price) continue;
          elements.push({ element: candidate, price });
          covered.add(candidate);
          break;
        }
      }
    }

    const priceElements = [...document.body.querySelectorAll(PRICE_ELEMENTS)];
    if (isTakealot) priceElements.sort((a, b) => depthOf(b) - depthOf(a));
    for (const element of priceElements) {
      if (!eligible(element) || hasCoveredAncestor(element, covered) || (isTakealot && hasCoveredDescendant(element, covered))) continue;
      if (isTakealot && element.textContent.length > 80) continue;
      const price = priceFromElement(element, currency);
      if (!price) continue;
      elements.push({ element, price });
      covered.add(element);
    }

    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue?.trim() || parent.closest(SKIP_ELEMENTS) || hasCoveredAncestor(parent, covered)) return NodeFilter.FILTER_REJECT;
        const matches = findPrices(node.nodeValue);
        if (!matches.length || (isTakealot && isOldPrice(parent))) return NodeFilter.FILTER_REJECT;
        textNodes.push({ node, matches });
        return NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode()) { /* collect in acceptNode */ }
    return { elements, textNodes, count: elements.length + textNodes.reduce((sum, item) => sum + item.matches.length, 0) };
  }

  function hasCoveredAncestor(element, covered) {
    for (let current = element; current; current = current.parentElement) {
      if (covered.has(current)) return true;
    }
    return false;
  }

  function hasCoveredDescendant(element, covered) {
    for (const selected of covered) {
      if (element !== selected && element.contains(selected)) return true;
    }
    return false;
  }

  function depthOf(element) {
    let depth = 0;
    for (let current = element; current; current = current.parentElement) depth++;
    return depth;
  }

  function convertedCount() {
    let count = badges.size;
    for (const entry of textConversions.values()) count += entry.count;
    return count;
  }

  function makeBadge(price, rate) {
    const badge = document.createElement('span');
    badge.className = 'cambix-badge';
    badge.textContent = `≈ ${format.format(price.amount * rate)} MZN`;
    badge.style.cssText = `${badgeStyle};background:#e8f0fe;color:#174ea6`;
    badge.title = `${price.code} para MZN via Cambix`;
    return badge;
  }

  function applyPending(rates, mode) {
    const pending = collect();
    let count = 0;
    for (const { element, price } of pending.elements) {
      const rate = rates[price.code]?.[mode];
      if (!Number.isFinite(rate)) continue;
      const badge = makeBadge(price, rate);
      element.after(badge);
      badges.set(element, { badge, code: price.code, amount: price.amount });
      count++;
    }
    for (const { node, matches } of pending.textNodes) {
      const original = node.nodeValue;
      const wrapper = document.createElement('span');
      wrapper.className = 'cambix-inline';
      let rendered = '';
      let cursor = 0;
      let applied = 0;
      for (const match of matches) {
        const rate = rates[match.code]?.[mode];
        if (!Number.isFinite(rate)) continue;
        const source = original.slice(cursor, match.index) + match.text;
        const converted = `≈ ${format.format(match.amount * rate)} MZN`;
        wrapper.append(document.createTextNode(source));
        const amount = document.createElement('span');
        amount.className = 'cambix-inline-amount';
        amount.style.cssText = `${badgeStyle};background:#ffe6df;color:#a82917`;
        amount.textContent = converted;
        wrapper.append(amount);
        rendered += source + converted;
        cursor = match.index + match.text.length;
        applied++;
      }
      if (!applied) continue;
      const remainder = original.slice(cursor);
      wrapper.append(document.createTextNode(remainder));
      rendered += remainder;
      textConversions.set(wrapper, { original, rendered, count: applied });
      node.replaceWith(wrapper);
      count += applied;
    }
    observer?.takeRecords();
    return count;
  }

  function restore() {
    let count = 0;
    for (const [element, entry] of textConversions) {
      if (element.isConnected && element.textContent === entry.rendered) {
        element.replaceWith(document.createTextNode(entry.original));
        count += entry.count;
      }
    }
    for (const entry of badges.values()) {
      entry.badge.remove();
      count++;
    }
    textConversions.clear();
    badges.clear();
    observer?.takeRecords();
    return count;
  }

  async function convert(mode) {
    if (busy) return { ok: false, error: 'Conversão em curso.' };
    busy = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'CAMBIX_GET_RATES' });
      if (!result?.ok) return { ok: false, error: 'Taxas indisponíveis. Tente novamente mais tarde.' };
      restore();
      activeRates = result.rates;
      activeMode = mode;
      const count = applyPending(activeRates, activeMode);
      dismissPrompt();
      return { ok: true, count, stale: result.stale };
    } finally {
      busy = false;
    }
  }

  function dismissPrompt() { document.getElementById('cambix-prompt')?.remove(); }

  function showPrompt(count) {
    if (!count || promptShown || document.getElementById('cambix-prompt')) return;
    promptShown = true;
    const light = theme === 'light' || (!theme && matchMedia('(prefers-color-scheme: light)').matches);
    const card = light ? '#fff' : '#292a2d';
    const ink = light ? '#202124' : '#e8eaed';
    const border = light ? '#dadce0' : '#3c4043';
    const blue = light ? '#1a73e8' : '#8ab4f8';
    const box = document.createElement('div');
    box.id = 'cambix-prompt';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Converter preços com Cambix');
    box.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:2147483647;width:300px;max-width:calc(100vw - 40px);padding:18px;background:${card};color:${ink};border:1px solid ${border};border-radius:12px;box-shadow:0 8px 24px #0004;font:14px CambixInter,Arial,sans-serif`;
    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL('icons/logo-blue.png');
    logo.alt = 'Cambix';
    logo.width = 60;
    logo.height = 60;
    logo.style.cssText = 'display:block;width:60px;height:60px;object-fit:contain;filter:hue-rotate(35deg) saturate(1.2)';
    const message = document.createElement('p');
    message.textContent = `${count} preço(s) detetado(s). Converter para MZN?`;
    message.style.cssText = `margin:9px 0 14px;color:${ink} !important;-webkit-text-fill-color:${ink} !important;opacity:1 !important;font:14px/1.4 CambixInter,Arial,sans-serif !important`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end;gap:9px';
    const dismiss = document.createElement('button');
    dismiss.textContent = 'Ignorar';
    dismiss.style.cssText = `border:1px solid ${blue};border-radius:20px;background:transparent;color:${blue};padding:8px 12px;font:600 14px CambixInter,Arial,sans-serif;cursor:pointer`;
    dismiss.addEventListener('click', dismissPrompt);
    const accept = document.createElement('button');
    accept.textContent = 'Converter';
    accept.style.cssText = `border:1px solid ${blue};border-radius:20px;background:${blue};color:${light ? '#fff' : '#202124'};padding:8px 12px;font:600 14px CambixInter,Arial,sans-serif;cursor:pointer`;
    accept.addEventListener('click', async () => {
      accept.disabled = true;
      const { cambix_mode } = await chrome.storage.local.get('cambix_mode');
      const result = await convert(validMode(cambix_mode));
      if (!result.ok) { message.textContent = result.error; accept.disabled = false; }
    });
    row.append(dismiss, accept);
    box.append(logo, message, row);
    document.body.append(box);
    observer?.takeRecords();
  }

  function validMode(mode) { return ['market', 'bim', 'bci'].includes(mode) ? mode : 'market'; }

  function refresh() {
    if (busy) return;
    if (lastUrl !== location.href) {
      lastUrl = location.href;
      promptShown = false;
    }
    if (activeRates) applyPending(activeRates, activeMode);
    else if (autoDetect) showPrompt(collect().count);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 700);
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'CAMBIX_STATUS') {
      reply({ ok: true, found: collect().count + convertedCount(), converted: convertedCount() > 0 });
    } else if (message?.type === 'CAMBIX_REVERT') {
      activeRates = null;
      activeMode = null;
      reply({ ok: true, count: restore() });
    } else if (message?.type === 'CAMBIX_CONVERT') {
      convert(validMode(message.mode)).then(reply).catch(() => reply({ ok: false, error: 'Não foi possível converter esta página.' }));
      return true;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.cambix_auto_detect) {
      autoDetect = changes.cambix_auto_detect.newValue !== false;
      if (autoDetect) scheduleRefresh();
      else dismissPrompt();
    }
    if (changes.cambix_theme) theme = changes.cambix_theme.newValue;
  });

  observer = new MutationObserver((records) => {
    if (busy) return;
    if (records.every((record) => {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      return target?.closest?.('#cambix-prompt, .cambix-badge');
    })) return;
    scheduleRefresh();
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });

  chrome.storage.local.get(['cambix_auto_detect', 'cambix_theme']).then((settings) => {
    autoDetect = settings.cambix_auto_detect !== false;
    theme = settings.cambix_theme;
    if (autoDetect) setTimeout(refresh, 1200);
  });
})();
