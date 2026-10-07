const DEFAULTS = {
  enabled: true,
  targetLanguage: "ko",
  showOriginal: true,
  fontSize: 22,
};

const NATIVE_LABEL = "실시간 번역 자막";
const sessions = new Set();
const byVideo = new WeakMap();
let settings = { ...DEFAULTS };
let pendingYoutube = null;
let scanTimer = 0;

init();

async function init() {
  try {
    settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  } catch (error) {
    settings = { ...DEFAULTS };
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const languageChanged = Object.prototype.hasOwnProperty.call(changes, "targetLanguage");
    for (const [key, value] of Object.entries(changes)) settings[key] = value.newValue;
    if (Object.prototype.hasOwnProperty.call(changes, "enabled")) scan();
    for (const session of sessions) {
      if (languageChanged) {
        session.cache.clear();
        session.failures.clear();
        session.scheduleTranslate();
      }
      session.render();
    }
    syncYoutubeCaptionStyle();
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "status") sendResponse(statusSnapshot());
  });
  window.addEventListener("message", onPageMessage);
  window.addEventListener("scroll", layoutAll, true);
  window.addEventListener("resize", layoutAll);
  document.addEventListener("fullscreenchange", layoutAll);
  document.addEventListener("webkitfullscreenchange", layoutAll);
  document.addEventListener("enterpictureinpicture", layoutAll, true);
  document.addEventListener("leavepictureinpicture", layoutAll, true);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("yt-navigate-finish", () => {
    pendingYoutube = null;
    window.postMessage({ source: "lst-request" }, "*");
    scheduleScan();
  });
  if (isYouTube()) window.postMessage({ source: "lst-request" }, "*");
  scheduleScan();
}

function isYouTube() {
  return /(^|\.)youtube\.com$|(^|\.)youtube-nocookie\.com$/.test(location.hostname);
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, 250);
}

function scan() {
  if (!settings.enabled) {
    for (const session of [...sessions]) session.destroy();
    syncYoutubeCaptionStyle();
    return;
  }
  for (const video of document.querySelectorAll("video")) {
    if (byVideo.has(video)) continue;
    const session = new Session(video);
    byVideo.set(video, session);
    sessions.add(session);
    session.start();
  }
  for (const session of [...sessions]) {
    if (!session.video.isConnected) session.destroy();
  }
  applyYoutube();
  syncYoutubeCaptionStyle();
}

function layoutAll() {
  for (const session of sessions) session.place();
}

function onPageMessage(event) {
  if (event.source !== window || event.data?.source !== "lst-captions") return;
  const pageId = currentVideoId();
  if (event.data.videoId && pageId && event.data.videoId !== pageId) return;
  pendingYoutube = event.data;
  applyYoutube();
}

function applyYoutube() {
  if (!pendingYoutube || !settings.enabled) return;
  const video = playerVideo();
  if (!video) return;
  const session = byVideo.get(video) || null;
  if (!session) return;
  if (pendingYoutube.type === "ready") {
    session.liveMode = false;
    session.setCues(LSTCues.prepareCues(pendingYoutube.events || []), pendingYoutube.language || "auto", "youtube");
  } else if (pendingYoutube.type === "live") {
    session.pushLiveCue(pendingYoutube.text || "", pendingYoutube.language || "auto");
  } else if (pendingYoutube.type === "empty") {
    if (!session.cues.length) session.setCues([], "auto", "youtube");
  } else if (pendingYoutube.type === "error") {
    session.failLoad("자막을 불러오지 못했습니다");
  }
  syncYoutubeCaptionStyle();
}

function playerVideo() {
  const main = document.querySelector("#movie_player video, #shorts-player video, .html5-video-player video");
  if (main) return main;
  const videos = [...document.querySelectorAll("video")];
  videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  return videos[0] || null;
}

function currentVideoId() {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get("v")) return url.searchParams.get("v");
    const match = url.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/);
    return match ? match[1] : "";
  } catch (error) {
    return "";
  }
}

function syncYoutubeCaptionStyle() {
  const id = "lst-hide-yt-captions";
  const active = settings.enabled && [...sessions].some((session) => session.origin === "youtube" && session.cues.length);
  let style = document.getElementById(id);
  if (!active) {
    style?.remove();
    return;
  }
  if (style) return;
  style = document.createElement("style");
  style.id = id;
  style.textContent = ".ytp-caption-window-container{display:none!important}";
  document.documentElement.appendChild(style);
}

function statusSnapshot() {
  const list = [...sessions];
  const withCues = list.filter((session) => session.cues.length);
  const primary = withCues[0] || list[0];
  return {
    enabled: settings.enabled,
    videos: list.length,
    cues: withCues.reduce((sum, session) => sum + session.cues.length, 0),
    message: primary ? primary.statusMessage() : "이 페이지에서 영상을 찾지 못했습니다",
  };
}

class Session {
  constructor(video) {
    this.video = video;
    this.cues = [];
    this.language = "auto";
    this.origin = "";
    this.cache = new Map();
    this.failures = new Map();
    this.settled = false;
    this.loadError = "";
    this.translating = false;
    this.translateTimer = 0;
    this.trackTimer = 0;
    this.trackAttempts = 0;
    this.nativeTrack = null;
    this.lastNativeText = "";
    this.statusUntil = 0;
    this.host = document.createElement("div");
    this.host.className = "lst-root";
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = [
      ":host{pointer-events:none;display:flex;align-items:flex-end;justify-content:center;box-sizing:border-box;padding:0 8% 8%;font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;}",
      ".box{max-width:100%;text-align:center;color:#fff;background:rgba(0,0,0,.75);border-radius:8px;padding:6px 12px 8px;line-height:1.35;text-shadow:0 1px 2px rgba(0,0,0,.65);}",
      ".original{opacity:.88;font-weight:500;margin-bottom:2px;}",
      ".translated{font-weight:700;}",
      ".status{font-weight:600;}",
    ].join("");
    this.box = document.createElement("div");
    this.box.className = "box";
    this.original = document.createElement("div");
    this.original.className = "original";
    this.translated = document.createElement("div");
    this.translated.className = "translated";
    this.status = document.createElement("div");
    this.status.className = "status";
    this.box.append(this.original, this.translated, this.status);
    shadow.append(style, this.box);
    this.host.style.display = "none";
    document.documentElement.appendChild(this.host);
  }

  start() {
    this.onTime = () => this.render();
    this.video.addEventListener("timeupdate", this.onTime);
    this.video.addEventListener("seeked", this.onTime);
    this.video.addEventListener("play", this.onTime);
    this.video.addEventListener("loadeddata", this.onTime);
    this.loadTracks();
    this.place();
    this.render();
  }

  destroy() {
    clearTimeout(this.translateTimer);
    clearTimeout(this.trackTimer);
    this.video.removeEventListener("timeupdate", this.onTime);
    this.video.removeEventListener("seeked", this.onTime);
    this.video.removeEventListener("play", this.onTime);
    this.video.removeEventListener("loadeddata", this.onTime);
    this.clearNative();
    this.host.remove();
    sessions.delete(this);
    byVideo.delete(this.video);
  }

  pushLiveCue(text, language) {
    const clean = LSTCues.cleanText(text);
    if (!clean) return;
    const now = this.video.currentTime || 0;
    this.liveMode = true;
    this.origin = "youtube";
    this.language = language && language !== "auto" ? language : this.language || "auto";
    this.settled = true;
    this.loadError = "";
    const last = this.cues[this.cues.length - 1];
    if (last && (now < last.start - 0.4 || now > last.end + 1.5)) this.cues.length = 0;
    const current = this.cues[this.cues.length - 1];
    if (current && (clean === current.text || clean.startsWith(current.text) || current.text.startsWith(clean))) {
      if (clean.length >= current.text.length && clean !== current.text) {
        this.cache.delete(current.text);
        current.text = clean;
      }
      current.end = Math.max(current.end, now + 4);
    } else {
      if (current) current.end = Math.max(current.start + 0.3, now);
      this.cues.push({ start: Math.max(0, now - 0.15), end: now + 6, text: clean });
    }
    this.scheduleTranslate();
    this.render();
    syncYoutubeCaptionStyle();
  }

  setCues(cues, language, origin) {
    this.cues = cues;
    this.language = language || "auto";
    this.origin = origin;
    this.settled = true;
    this.loadError = "";
    this.cache.clear();
    this.failures.clear();
    this.scheduleTranslate();
    this.render();
  }

  failLoad(message) {
    if (this.cues.length) return;
    this.settled = true;
    this.loadError = message;
    this.render();
  }

  async loadTracks() {
    if (this.origin === "youtube") return;
    const loaded = await readTextTracks(this.video, settings.targetLanguage);
    if (!this.video.isConnected || this.origin === "youtube") return;
    if (loaded && loaded.cues.length) this.setCues(loaded.cues, loaded.language, "track");
    else if (!isYouTube() || this.trackAttempts >= 8) {
      this.settled = true;
      this.render();
    } else {
      this.trackAttempts += 1;
      this.trackTimer = setTimeout(() => this.loadTracks(), 1200);
    }
  }

  scheduleTranslate() {
    clearTimeout(this.translateTimer);
    this.translateTimer = setTimeout(() => this.translateAhead(), 40);
  }

  async translateAhead() {
    if (!settings.enabled || this.translating || !this.cues.length) return;
    if (LSTCues.sameLanguage(this.language, settings.targetLanguage)) {
      for (const cue of this.cues) this.cache.set(cue.text, cue.text);
      this.render();
      return;
    }
    const now = this.video.currentTime || 0;
    const pending = this.cues.filter((cue) => !this.cache.has(cue.text) && (this.failures.get(cue.text) || 0) < 2);
    if (!pending.length) return;
    pending.sort((a, b) => rank(a, now) - rank(b, now));
    const batch = [];
    for (const cue of pending) {
      if (!batch.includes(cue.text)) batch.push(cue.text);
      if (batch.length === 8) break;
    }
    this.translating = true;
    this.render();
    try {
      const response = await chrome.runtime.sendMessage({
        type: "translate",
        texts: batch,
        source: this.language,
        target: settings.targetLanguage,
      });
      if (!response?.ok) throw new Error(response?.error || "번역 실패");
      batch.forEach((text, index) => this.cache.set(text, response.texts[index] || text));
    } catch (error) {
      batch.forEach((text) => this.failures.set(text, (this.failures.get(text) || 0) + 1));
      this.loadError = "번역에 실패해 원문을 표시합니다";
    } finally {
      this.translating = false;
      this.render();
      if (this.cues.some((cue) => !this.cache.has(cue.text) && (this.failures.get(cue.text) || 0) < 2)) this.scheduleTranslate();
    }
  }

  render() {
    if (!settings.enabled || !this.video.isConnected) return;
    this.place();
    if (this.shouldStayQuiet()) {
      this.show("", "", "");
      return;
    }
    if (isAdPlaying(this.video)) {
      this.show("", "", "");
      return;
    }
    const cue = LSTCues.findCue(this.cues, this.video.currentTime || 0);
    if (!this.cues.length && !this.settled && isYouTube() && this.video === playerVideo()) {
      this.show("", "", "자막을 찾고 있습니다");
      return;
    }
    if (!this.cues.length && this.settled) {
      const notice = this.loadError || "번역할 자막이 없습니다";
      if (!this.statusUntil) this.statusUntil = Date.now() + 6000;
      this.show("", "", Date.now() < this.statusUntil ? notice : "");
      this.clearNative();
      return;
    }
    if (!cue) {
      this.show("", "", "");
      this.clearNative();
      return;
    }
    const translated = this.cache.get(cue.text) || "";
    const showOriginal = settings.showOriginal && !LSTCues.sameLanguage(this.language, settings.targetLanguage);
    const gaveUp = (this.failures.get(cue.text) || 0) >= 2;
    const line = translated || cue.text;
    if (!translated && !gaveUp) this.scheduleTranslate();
    if (this.useNativeCaption()) {
      this.show("", "", "");
      this.showNative(line);
      return;
    }
    this.clearNative();
    if (translated) this.show(showOriginal ? cue.text : "", translated, "");
    else if (gaveUp) this.show("", cue.text, "");
    else if (showOriginal) this.show(cue.text, "", "번역 중");
    else this.show("", cue.text, "번역 중");
  }

  show(original, translated, status) {
    this.original.textContent = original;
    this.translated.textContent = translated;
    this.status.textContent = status && !translated ? status : "";
    this.original.style.display = original ? "block" : "none";
    this.translated.style.display = translated ? "block" : "none";
    this.status.style.display = this.status.textContent ? "block" : "none";
    this.box.style.display = original || translated || this.status.textContent ? "inline-block" : "none";
    const width = this.host.getBoundingClientRect().width || this.video.clientWidth || 640;
    const scale = Math.max(0.72, Math.min(1.35, width / 720));
    const size = Math.max(14, Math.round((settings.fontSize || 22) * scale));
    this.translated.style.fontSize = size + "px";
    this.original.style.fontSize = Math.max(12, Math.round(size * 0.72)) + "px";
    this.status.style.fontSize = Math.max(12, Math.round(size * 0.68)) + "px";
  }

  shouldStayQuiet() {
    if (this.cues.length || this.loadError) return false;
    if (isYouTube() && this.video === playerVideo()) return false;
    return this.video.paused && this.video.currentTime < 0.2;
  }

  useNativeCaption() {
    const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    return fullscreen === this.video || document.pictureInPictureElement === this.video;
  }

  showNative(text) {
    if (!this.nativeTrack) {
      this.nativeTrack = [...this.video.textTracks].find((track) => track.label === NATIVE_LABEL) || this.video.addTextTrack("subtitles", NATIVE_LABEL, settings.targetLanguage || "ko");
    }
    this.nativeTrack.mode = "showing";
    if (this.lastNativeText === text) return;
    this.lastNativeText = text;
    while (this.nativeTrack.cues && this.nativeTrack.cues.length) this.nativeTrack.removeCue(this.nativeTrack.cues[0]);
    const start = Math.max(0, this.video.currentTime || 0);
    const end = Number.isFinite(this.video.duration) ? Math.min(this.video.duration, start + 4) : start + 4;
    if (text && end > start) this.nativeTrack.addCue(new VTTCue(start, Math.max(end, start + 0.4), text));
  }

  clearNative() {
    if (!this.nativeTrack) return;
    this.nativeTrack.mode = "disabled";
    while (this.nativeTrack.cues && this.nativeTrack.cues.length) this.nativeTrack.removeCue(this.nativeTrack.cues[0]);
    this.lastNativeText = "";
  }

  place() {
    const rect = this.video.getBoundingClientRect();
    const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (rect.width < 160 || rect.height < 90 || this.useNativeCaption()) {
      this.host.style.visibility = "hidden";
      return;
    }
    const parent = fullscreen && fullscreen.contains(this.video) ? fullscreen : document.documentElement;
    if (this.host.parentElement !== parent) parent.appendChild(this.host);
    this.host.style.position = "fixed";
    this.host.style.left = rect.left + "px";
    this.host.style.top = rect.top + "px";
    this.host.style.width = rect.width + "px";
    this.host.style.height = rect.height + "px";
    this.host.style.zIndex = "2147483646";
    this.host.style.visibility = "visible";
    this.host.style.display = "flex";
  }

  statusMessage() {
    if (!settings.enabled) return "자막이 꺼져 있습니다";
    if (this.loadError) return this.loadError;
    if (!this.settled) return "자막을 찾고 있습니다";
    if (!this.cues.length) return "번역할 자막이 없습니다";
    const done = this.cues.filter((cue) => this.cache.has(cue.text)).length;
    return "자막 " + this.cues.length + "개 중 " + done + "개 번역";
  }
}

function rank(cue, now) {
  if (now >= cue.start - 0.2 && now < cue.end + 0.2) return -1000;
  const delta = cue.start - now;
  return delta >= 0 ? delta : 100000 + Math.abs(delta);
}

function isAdPlaying(video) {
  const player = video.closest("#movie_player, .html5-video-player");
  return Boolean(player && player.classList.contains("ad-showing"));
}

async function readTextTracks(video, targetLanguage) {
  const elements = [...video.querySelectorAll("track")];
  const tracks = [...video.textTracks].filter((track) => track.label !== NATIVE_LABEL && track.kind !== "metadata" && track.kind !== "chapters");
  const previous = tracks.map((track) => track.mode);
  tracks.forEach((track) => {
    if (track.mode === "disabled") track.mode = "hidden";
  });
  await wait(350);
  const found = [];
  tracks.forEach((track, index) => {
    const cues = [];
    if (track.cues) {
      for (const cue of track.cues) {
        const text = LSTCues.cleanText(cue.text || "");
        if (text) cues.push({ start: cue.startTime, end: cue.endTime, text });
      }
    }
    const element = elements.find((item) => item.track === track);
    if (cues.length) {
      found.push({ language: track.language || element?.srclang || "auto", cues, isDefault: Boolean(element?.default) });
      track.mode = "hidden";
    } else {
      track.mode = previous[index];
    }
  });
  if (!found.length) {
    for (const element of elements) {
      if (!element.src) continue;
      try {
        const response = await chrome.runtime.sendMessage({ type: "fetchText", url: element.src });
        if (!response?.ok) continue;
        const cues = LSTCues.parseSubtitleFile(response.text);
        if (cues.length) found.push({ language: element.srclang || "auto", cues, isDefault: Boolean(element.default) });
      } catch (error) {
        /* try the next track */
      }
    }
  }
  if (!found.length) return null;
  return found.find((item) => item.isDefault) || found.find((item) => !LSTCues.sameLanguage(item.language, targetLanguage)) || found[0];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
