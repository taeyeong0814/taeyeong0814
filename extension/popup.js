const DEFAULTS = {
  enabled: true,
  targetLanguage: "ko",
  showOriginal: true,
  fontSize: 22,
};

const LANGUAGES = [
  ["ko", "한국어"],
  ["en", "영어"],
  ["ja", "일본어"],
  ["zh-CN", "중국어(간체)"],
  ["zh-TW", "중국어(번체)"],
  ["es", "스페인어"],
  ["fr", "프랑스어"],
  ["de", "독일어"],
  ["vi", "베트남어"],
  ["th", "태국어"],
  ["id", "인도네시아어"],
  ["ru", "러시아어"],
];

const enabled = document.querySelector("#enabled");
const language = document.querySelector("#language");
const original = document.querySelector("#original");
const size = document.querySelector("#size");
const sizeLabel = document.querySelector("#size-label");
const status = document.querySelector("#status");

for (const [code, name] of LANGUAGES) {
  const option = document.createElement("option");
  option.value = code;
  option.textContent = name;
  language.appendChild(option);
}

init();

async function init() {
  const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  enabled.checked = Boolean(settings.enabled);
  language.value = settings.targetLanguage;
  original.checked = Boolean(settings.showOriginal);
  size.value = String(settings.fontSize);
  sizeLabel.textContent = String(settings.fontSize);
  enabled.addEventListener("change", save);
  language.addEventListener("change", save);
  original.addEventListener("change", save);
  size.addEventListener("input", () => {
    sizeLabel.textContent = size.value;
    save();
  });
  await refreshStatus();
}

async function save() {
  await chrome.storage.local.set({
    enabled: enabled.checked,
    targetLanguage: language.value,
    showOriginal: original.checked,
    fontSize: Number(size.value),
  });
  await refreshStatus();
}

async function refreshStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    status.textContent = "현재 탭을 찾지 못했습니다.";
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "status" });
    status.textContent = response?.message || "영상을 찾지 못했습니다.";
  } catch (error) {
    status.textContent = "이 페이지에서는 자막을 표시할 수 없습니다.";
  }
}
