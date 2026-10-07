(function () {
  const SOURCE = "lst-captions";
  let lastKey = "";
  let timer = 0;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "lst-request") return;
    schedule(true);
  });
  document.addEventListener("yt-navigate-finish", () => schedule(true));
  schedule(false);

  function schedule(force) {
    clearTimeout(timer);
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      publish(force).then((done) => {
        if (!done && attempts < 12) timer = setTimeout(tick, 700);
      });
    };
    timer = setTimeout(tick, 200);
  }

  async function publish(force) {
    const id = currentVideoId();
    const response = playerResponse();
    const tracks = captionTracks(response);
    if (!id || !tracks.length) {
      if (force && id && response) {
        post({ type: "empty", videoId: id });
        return true;
      }
      return false;
    }
    const track = tracks.find((item) => item.kind !== "asr" && item.baseUrl) || tracks.find((item) => item.baseUrl);
    if (!track) return false;
    const key = id + "|" + track.baseUrl;
    if (!force && key === lastKey) return true;
    try {
      const endpoint = new URL(track.baseUrl, location.origin);
      endpoint.searchParams.set("fmt", "json3");
      const result = await fetch(endpoint.toString(), { credentials: "include" });
      if (!result.ok) throw new Error("caption http " + result.status);
      const payload = await result.json();
      lastKey = key;
      post({
        type: "ready",
        videoId: id,
        language: track.languageCode || "auto",
        events: payload.events || [],
      });
      return true;
    } catch (error) {
      post({ type: "error", videoId: id, message: String(error && error.message ? error.message : error) });
      return true;
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
