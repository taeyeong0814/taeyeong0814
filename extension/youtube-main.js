(function () {
  const SOURCE = "lst-captions";
  let lastKey = "";
  let timer = 0;
  let sawLiveCaption = false;
  let lastLiveText = "";
  let watchedPlayer = null;
  let captionToggleFor = "";

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "lst-request") return;
    schedule();
  });
  document.addEventListener("yt-navigate-finish", () => {
    lastKey = "";
    lastLiveText = "";
    sawLiveCaption = false;
    captionToggleFor = "";
    schedule();
  });
  schedule();

  function schedule() {
    clearTimeout(timer);
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      publish(attempts >= 12).then((done) => {
        if (!done && attempts < 12) timer = setTimeout(tick, 700);
      });
    };
    timer = setTimeout(tick, 200);
  }

  async function publish(force) {
    const id = currentVideoId();
    const response = playerResponse();
    const tracks = captionTracks(response);
    const domLanguage = watchCaptions();
    if (tracks.length) {
      const track = tracks.find((item) => item.kind !== "asr" && item.baseUrl) || tracks.find((item) => item.baseUrl);
      const key = id + "|" + (track?.baseUrl || "");
      if (track && (force || key !== lastKey)) {
        const events = await fetchEvents(track.baseUrl);
        if (events && events.length) {
          lastKey = key;
          post({ type: "ready", videoId: id, language: track.languageCode || domLanguage || "auto", events });
          return true;
        }
      }
    }
    if (sawLiveCaption) return true;
    if (force && id && (response || domLanguage)) post({ type: "empty", videoId: id });
    return Boolean(force && id && (response || domLanguage));
  }

  async function fetchEvents(baseUrl) {
    try {
      const endpoint = new URL(baseUrl, location.origin);
      endpoint.searchParams.set("fmt", "json3");
      const result = await fetch(endpoint.toString(), { credentials: "include" });
      const body = (await result.text()).trim().replace(/^\)\]\}'/, "");
      if (!body.startsWith("{") && !body.startsWith("[")) return null;
      const payload = JSON.parse(body);
      return payload.events || [];
    } catch (error) {
      return null;
    }
  }

  function watchCaptions() {
    const player = document.querySelector("#movie_player, #shorts-player, .html5-video-player");
    if (!player) return "";
    const language = enableCaptionTrack(player);
    if (watchedPlayer === player) return language;
    watchedPlayer = player;
    const read = () => {
      const text = [...player.querySelectorAll(".ytp-caption-segment")].map((node) => node.textContent || "").join(" ").replace(/\s+/g, " ").trim();
      if (!text || text === lastLiveText) return;
      lastLiveText = text;
      sawLiveCaption = true;
      post({ type: "live", videoId: currentVideoId(), language: enableCaptionTrack(player) || language || "auto", text });
    };
    const observer = new MutationObserver(read);
    observer.observe(player, { subtree: true, childList: true, characterData: true });
    const video = player.querySelector("video");
    video?.addEventListener("seeked", () => {
      lastLiveText = "";
      read();
    });
    read();
    return language;
  }

  function enableCaptionTrack(player) {
    try {
      if (typeof player.loadModule === "function") player.loadModule("captions");
      if (typeof player.getOption !== "function") return "";
      const tracks = player.getOption("captions", "tracklist") || [];
      if (!tracks.length) return "";
      const current = player.getOption("captions", "track") || {};
      const button = player.querySelector(".ytp-subtitles-button");
      const id = currentVideoId();
      if (button && captionToggleFor !== id && button.getAttribute("aria-pressed") !== "true") {
        button.click();
        captionToggleFor = id;
      }
      if (current.languageCode || current.languageName) return current.languageCode || "auto";
      const preferred = tracks.find((track) => track.kind !== "asr" && !track.translationLanguage) || tracks.find((track) => !track.translationLanguage) || tracks[0];
      player.setOption("captions", "track", preferred);
      return preferred.languageCode || "auto";
    } catch (error) {
      return "";
    }
  }

  function post(payload) {
    window.postMessage({ source: SOURCE, ...payload }, "*");
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

  function playerResponse() {
    const player = document.querySelector("#movie_player, #shorts-player, .html5-video-player");
    try {
      const response = player && typeof player.getPlayerResponse === "function" ? player.getPlayerResponse() : null;
      if (response && (response.captions || response.videoDetails)) return response;
    } catch (error) {
      /* player not ready */
    }
    return window.ytInitialPlayerResponse || null;
  }

  function captionTracks(response) {
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return Array.isArray(tracks) ? tracks : [];
  }
})();
