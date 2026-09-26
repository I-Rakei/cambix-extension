const money = new Intl.NumberFormat("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const modeSelect = document.getElementById("mode");
const amount = document.getElementById("amount");
const currency = document.getElementById("currency");
const converted = document.getElementById("converted");
const rateLine = document.getElementById("rate-line");
const rateStatus = document.getElementById("rate-status");
const pageCount = document.getElementById("page-count");
const pageStatus = document.getElementById("page-status");
const convertButton = document.getElementById("convert");
const revertButton = document.getElementById("revert");
const autoDetect = document.getElementById("auto-detect");
const themeToggle = document.getElementById("theme-toggle");

let mode = "market";
let rates = null;
let theme = "dark";

function setTheme(nextTheme) {
  theme = nextTheme;
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === "dark" ? "☀" : "☾";
  themeToggle.setAttribute("aria-label", theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro");
}

function setMode(nextMode) {
  mode = nextMode;
  modeSelect.value = mode;
  renderConversion();
}

function renderConversion() {
  const rate = rates?.[currency.value]?.[mode];
  const value = Number(amount.value);
  converted.textContent = Number.isFinite(rate) && Number.isFinite(value) && value >= 0
    ? `${money.format(value * rate)} MZN` : "A calcular";
  rateLine.textContent = Number.isFinite(rate)
    ? `1 ${currency.value} = ${money.format(rate)} MZN · ${mode === "market" ? "Mercado" : mode.toUpperCase()}`
    : "Taxa indisponível";
}

async function sendToPage(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try { return await chrome.tabs.sendMessage(tab.id, message); }
  catch { return null; }
}

async function refreshPage() {
  const status = await sendToPage({ type: "CAMBIX_STATUS" });
  pageCount.textContent = status ? `${status.found} preço(s) detetado(s)` : "Página indisponível";
  convertButton.disabled = !status;
  revertButton.disabled = !status?.converted;
  if (!status) pageStatus.textContent = "Abra uma página web para converter preços.";
  else if (pageStatus.textContent === "Abra uma página web para converter preços.") pageStatus.textContent = "";
}

async function refreshRates(force = false) {
  const result = await chrome.runtime.sendMessage({ type: "CAMBIX_GET_RATES", force });
  if (!result?.ok) {
    rateStatus.textContent = result?.error || "Não foi possível carregar as taxas.";
    rateStatus.classList.add("error");
    return;
  }
  rates = result.rates;
  rateStatus.classList.toggle("error", false);
  rateStatus.textContent = result.stale
    ? "A usar a última taxa guardada. O servidor está indisponível."
    : "Taxas atualizadas pelo Cambix.";
  renderConversion();
}

modeSelect.addEventListener("change", async () => {
  setMode(modeSelect.value);
  const selectedMode = mode;
  modeSelect.disabled = true;
  try {
    await chrome.storage.local.set({ cambix_mode: selectedMode });
    const status = await sendToPage({ type: "CAMBIX_STATUS" });
    if (!status?.converted) return;

    pageStatus.classList.remove("error");
    pageStatus.textContent = "A atualizar preços…";
    const result = await sendToPage({ type: "CAMBIX_CONVERT", mode: selectedMode });
    if (!result?.ok) {
      pageStatus.textContent = result?.error || "Não foi possível atualizar os preços desta página.";
      pageStatus.classList.add("error");
    } else {
      pageStatus.textContent = result.stale
        ? `${result.count} preço(s) atualizado(s) com a última taxa guardada.`
        : `${result.count} preço(s) atualizado(s).`;
    }
    await refreshPage();
  } catch {
    pageStatus.textContent = "Não foi possível atualizar a taxa.";
    pageStatus.classList.add("error");
  } finally {
    modeSelect.disabled = false;
  }
});
amount.addEventListener("input", renderConversion);
currency.addEventListener("change", renderConversion);
autoDetect.addEventListener("change", () => chrome.storage.local.set({ cambix_auto_detect: autoDetect.checked }));
themeToggle.addEventListener("click", async () => {
  setTheme(theme === "dark" ? "light" : "dark");
  await chrome.storage.local.set({ cambix_theme: theme });
});

chrome.tabs.onActivated.addListener(refreshPage);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete") refreshPage();
});

convertButton.addEventListener("click", async () => {
  convertButton.disabled = true;
  pageStatus.textContent = "A converter preços…";
  const result = await sendToPage({ type: "CAMBIX_CONVERT", mode });
  if (!result?.ok) {
    pageStatus.textContent = result?.error || "Não foi possível converter esta página.";
    pageStatus.classList.add("error");
  } else {
    pageStatus.classList.remove("error");
    pageStatus.textContent = result.stale
      ? `${result.count} preço(s) convertido(s) com a última taxa guardada.`
      : `${result.count} preço(s) convertido(s).`;
  }
  await refreshPage();
});

revertButton.addEventListener("click", async () => {
  const result = await sendToPage({ type: "CAMBIX_REVERT" });
  pageStatus.textContent = result?.ok ? `${result.count} preço(s) restaurado(s).` : "Não foi possível reverter.";
  await refreshPage();
});

(async () => {
  const preferences = await chrome.storage.local.get(["cambix_mode", "cambix_auto_detect", "cambix_theme"]);
  setTheme(["light", "dark"].includes(preferences.cambix_theme)
    ? preferences.cambix_theme : (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  setMode(["market", "bim", "bci"].includes(preferences.cambix_mode) ? preferences.cambix_mode : "market");
  autoDetect.checked = preferences.cambix_auto_detect !== false;
  await Promise.all([refreshRates(), refreshPage()]);
})();
