const ENDPOINT = "https://cambix-server.rakei.co.za/api/bancomoc/exchangerates-weekly";
const CACHE_KEY = "cambix_rates_v3";
const CACHE_TTL = 60 * 60 * 1000;
const MARKUPS = { market: 1, bim: 1.065207, bci: 1.044415 };
const SUPPORTED = ["USD", "ZAR", "EUR", "GBP", "CAD"];

let inFlight = null;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

async function getRates(force = false) {
  const { [CACHE_KEY]: cached } = await chrome.storage.local.get(CACHE_KEY);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return { ...cached, stale: false };
  }

  if (!inFlight) {
    inFlight = (async () => {
      const response = await fetch(ENDPOINT, { cache: "no-store" });
      if (!response.ok) throw new Error(`Servidor indisponível (${response.status})`);
      const payload = await response.json();
      const values = payload?.rates?.[0]?.values;
      if (!Array.isArray(values)) throw new Error("Resposta de taxas inválida");

      const rates = {};
      for (const row of values) {
        if (!SUPPORTED.includes(row.currency) || !Number.isFinite(row.buy) || !Number.isFinite(row.sell)) continue;
        const market = (row.buy + row.sell) / 2;
        if (market <= 0) continue;
        rates[row.currency] = Object.fromEntries(
          Object.entries(MARKUPS).map(([mode, factor]) => [mode, market * factor])
        );
      }
      if (Object.keys(rates).length !== SUPPORTED.length) throw new Error("Faltam moedas na resposta do servidor");

      const entry = { rates, fetchedAt: Date.now() };
      await chrome.storage.local.set({ [CACHE_KEY]: entry });
      return { ...entry, stale: false };
    })().finally(() => { inFlight = null; });
  }

  try {
    return await inFlight;
  } catch (error) {
    if (cached?.rates) return { ...cached, stale: true };
    throw error;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["cambix_mode", "cambix_auto_detect"]);
  await chrome.storage.local.set({
    cambix_mode: ["market", "bim", "bci"].includes(current.cambix_mode) ? current.cambix_mode : "market",
    cambix_auto_detect: current.cambix_auto_detect ?? true
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "CAMBIX_GET_RATES") return false;
  getRates(Boolean(message.force))
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
