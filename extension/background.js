importScripts("cues.js");

const DEFAULTS = {
  enabled: true,
  targetLanguage: "ko",
  showOriginal: true,
  fontSize: 22,
};

const cache = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(null);
  const next = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (Object.prototype.hasOwnProperty.call(current, key)) next[key] = current[key];
  }
  await chrome.storage.local.set(next);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "translate") {
    translateAll(message.texts || [], message.source, message.target)
      .then((texts) => sendResponse({ ok: true, texts }))
      .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));
    return true;
  }
  if (message?.type === "fetchText") {
    fetchRemoteText(message.url)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));
    return true;
  }
  return false;
});

async function translateAll(texts, source, target) {
  const sourceLang = LSTCues.googleLang(source || "auto");
  const targetLang = LSTCues.googleLang(target || "ko");
  const results = texts.map((text) => LSTCues.cleanText(text));
  if (!results.length) return results;
  if (sourceLang !== "auto" && LSTCues.sameLanguage(sourceLang, targetLang)) return results;

  const missing = [];
  results.forEach((text, index) => {
    const key = sourceLang + "|" + targetLang + "|" + text;
    if (cache.has(key)) results[index] = cache.get(key);
    else missing.push({ index, text, key });
  });
  if (!missing.length) return results;

  for (let offset = 0; offset < missing.length; offset += 8) {
    const batch = missing.slice(offset, offset + 8);
    const translated = await requestTranslation(batch.map((item) => item.text), sourceLang, targetLang);
    batch.forEach((item, index) => {
      const value = translated[index] || item.text;
      cache.set(item.key, value);
      results[item.index] = value;
    });
  }
  return results;
}

async function requestTranslation(texts, source, target) {
  const params = new URLSearchParams();
  texts.forEach((text) => params.append("q", text));
  const url = "https://translate.googleapis.com/translate_a/t?client=gtx&sl=" + encodeURIComponent(source) + "&tl=" + encodeURIComponent(target);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: params.toString(),
  });
  if (!response.ok) throw new Error("번역 요청이 거절되었습니다 (" + response.status + ")");
  const payload = await response.json();
  return LSTCues.unwrapTranslations(payload, texts);
}

async function fetchRemoteText(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("지원하지 않는 주소입니다");
  const response = await fetch(parsed.toString());
  if (!response.ok) throw new Error("자막 파일을 읽지 못했습니다");
  return response.text();
}
