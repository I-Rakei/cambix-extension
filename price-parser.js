// Currency parsing shared by the content script and its fixture checks.
// Prices must carry a currency marker unless they come from a price-specific element.
(function (root) {
  const NUMBER = "(?:\\d{1,3}(?:[\\s.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
  const PREFIX = "(?:US\\s*\\$|CA\\s*\\$|C\\s*\\$|USD|ZAR|EUR|GBP|CAD|R|\\$|€|£)";
  const SUFFIX = "(?:US\\s*\\$|CA\\s*\\$|C\\s*\\$|USD|ZAR|EUR|GBP|CAD|\\$|€|£)";
  const BEFORE = "(?<![\\p{L}\\p{N}])";
  const AFTER = "(?![\\p{L}\\p{N}])";
  const prefixPattern = new RegExp(`${BEFORE}(${PREFIX})\\s*(${NUMBER})${AFTER}`, "giu");
  const suffixPattern = new RegExp(`${BEFORE}(${NUMBER})\\s*(${SUFFIX})${AFTER}`, "giu");
  const CODES = { "US$": "USD", "$": "USD", "CA$": "CAD", "C$": "CAD", "€": "EUR", "£": "GBP", R: "ZAR" };

  function parseAmount(raw) {
    let value = raw.replace(/\s/g, "");
    const comma = value.lastIndexOf(",");
    const dot = value.lastIndexOf(".");
    const last = Math.max(comma, dot);
    if (last >= 0) {
      const decimals = value.length - last - 1;
      const separator = value[last];
      if (decimals === 1 || decimals === 2) {
        value = value.slice(0, last).replace(/[.,]/g, "") + "." + value.slice(last + 1);
      } else {
        value = value.replace(/[.,]/g, "");
      }
      if (separator !== "," && separator !== ".") return null;
    }
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  function currencyCode(token) {
    const normalized = token.replace(/\s/g, "").toUpperCase();
    return CODES[normalized] || normalized;
  }

  function findPrices(text) {
    if (!text) return [];
    const found = [];
    for (const [pattern, tokenGroup, amountGroup] of [
      [prefixPattern, 1, 2],
      [suffixPattern, 2, 1]
    ]) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const amount = parseAmount(match[amountGroup]);
        if (amount === null) continue;
        found.push({ index: match.index, text: match[0], code: currencyCode(match[tokenGroup]), amount });
      }
    }
    found.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
    const unique = [];
    for (const entry of found) {
      const previous = unique[unique.length - 1];
      if (!previous || entry.index >= previous.index + previous.text.length) unique.push(entry);
    }
    return unique;
  }

  function barePrice(text, code) {
    if (!code || !text || text.trim().length > 25 || !/^\s*[\d\s.,]+\s*$/.test(text)) return null;
    const amount = parseAmount(text);
    return amount === null ? null : { code, amount, text: text.trim() };
  }

  function inferCurrency(hostname, language = "", metadata = "") {
    const declared = metadata.toUpperCase();
    if (["ZAR", "USD", "EUR", "GBP", "CAD"].includes(declared)) return declared;
    const host = hostname.toLowerCase();
    if (host.endsWith(".co.za") || host.endsWith(".za") || host === "mrp.com" || host.endsWith(".mrp.com") || host === "takealot.com" || host.endsWith(".takealot.com")) return "ZAR";
    if (host.endsWith(".pt") || host.endsWith(".vinted.pt")) return "EUR";
    if (host.endsWith(".co.uk")) return "GBP";
    if (["amazon.com", "www.amazon.com", "ebay.com", "www.ebay.com"].includes(host)) return "USD";
    const lang = language.toLowerCase();
    if (lang === "pt-pt") return "EUR";
    if (lang === "en-za") return "ZAR";
    if (lang === "en-us") return "USD";
    return null;
  }

  root.CambixPrice = { findPrices, barePrice, inferCurrency, parseAmount };
})(typeof window !== "undefined" ? window : globalThis);
