(function () {
  function cleanText(value) {
    return String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function langKey(code) {
    const value = String(code || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
    if (!value || value === "auto" || value === "und") return "auto";
    if (value.startsWith("zh")) {
      if (/(hant|tw|hk|mo)/.test(value)) return "zh-tw";
      return "zh-cn";
    }
    return value.split("-")[0];
  }

  function sameLanguage(a, b) {
    const left = langKey(a);
    const right = langKey(b);
    return left !== "auto" && left === right;
  }

  function googleLang(code) {
    const key = langKey(code);
    if (key === "auto") return "auto";
    if (key === "zh-cn") return "zh-CN";
    if (key === "zh-tw") return "zh-TW";
    if (key === "he") return "iw";
    return key;
  }

  function parseEvents(events) {
    const cues = [];
    for (const event of events || []) {
      if (!event || !event.segs) continue;
      const text = cleanText(event.segs.map((seg) => seg.utf8 || "").join(" "));
      const start = (event.tStartMs || 0) / 1000;
      const duration = event.dDurationMs == null ? null : event.dDurationMs / 1000;
      if (event.aAppend && cues.length) {
        const previous = cues[cues.length - 1];
        if (text) previous.text = cleanText(previous.text + " " + text);
        previous.end = Math.max(previous.end, duration == null ? start : start + duration);
        continue;
      }
      if (!text) continue;
      const end = duration == null ? start + 2 : start + duration;
      cues.push({ start, end: Math.max(end, start + 0.2), text });
    }
    return cues;
  }

  function looksWordLevel(cues) {
    if (cues.length < 4) return false;
    const sample = cues.slice(0, 24);
    const words = sample.reduce((sum, cue) => sum + cue.text.split(/\s+/).filter(Boolean).length, 0) / sample.length;
    const duration = sample.reduce((sum, cue) => sum + (cue.end - cue.start), 0) / sample.length;
    return words <= 2.2 && duration < 1.25;
  }

  function groupWordCues(cues) {
    const groups = [];
    let buffer = [];
    const flush = () => {
      if (!buffer.length) return;
      const text = cleanText(buffer.map((cue) => cue.text).join(" "));
      if (text) {
        groups.push({
          start: buffer[0].start,
          end: Math.max(buffer[buffer.length - 1].end, buffer[0].start + 0.4),
          text,
        });
      }
      buffer = [];
    };
    for (const cue of cues) {
      if (buffer.length) {
        const previous = buffer[buffer.length - 1];
        const gap = cue.start - previous.end;
        const words = buffer.reduce((sum, item) => sum + item.text.split(/\s+/).filter(Boolean).length, 0);
        const chars = buffer.reduce((sum, item) => sum + item.text.length, 0);
        if (gap > 0.7 || words >= 14 || chars >= 84) flush();
      }
      buffer.push(cue);
      if (/[.!?。！？…]$/.test(cue.text)) flush();
    }
    flush();
    return groups;
  }

  function prepareCues(events) {
    const parsed = parseEvents(events);
    const cues = looksWordLevel(parsed) ? groupWordCues(parsed) : parsed;
    return cues.filter((cue) => cue.text && cue.end > cue.start);
  }

  function timestampToSeconds(value) {
    const match = String(value).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
    if (!match) return null;
    const hours = match[1] ? parseInt(match[1], 10) : 0;
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const millis = parseInt(match[4].padEnd(3, "0").slice(0, 3), 10);
    return hours * 3600 + minutes * 60 + seconds + millis / 1000;
  }

  function parseSubtitleFile(source) {
    const lines = String(source || "").replace(/\r/g, "").split("\n");
    const cues = [];
    let index = 0;
    while (index < lines.length) {
      if (!lines[index].includes("-->")) {
        index += 1;
        continue;
      }
      const [rawStart, rawEnd] = lines[index].split("-->");
      const start = timestampToSeconds(rawStart);
      const end = timestampToSeconds(String(rawEnd || "").trim().split(/\s+/)[0]);
      index += 1;
      const textLines = [];
      while (index < lines.length && lines[index].trim() !== "") {
        textLines.push(lines[index]);
        index += 1;
      }
      const text = cleanText(textLines.join(" "));
      if (start != null && end != null && text && end > start) cues.push({ start, end, text });
    }
    return cues;
  }

  function findCue(cues, time) {
    if (!cues || !cues.length) return null;
    let low = 0;
    let high = cues.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (cues[mid].start <= time + 0.08) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (found < 0) return null;
    const lower = Math.max(0, found - 4);
    for (let i = found; i >= lower; i -= 1) {
      const cue = cues[i];
      if (time >= cue.start - 0.08 && time < cue.end + 0.08) return cue;
    }
    return null;
  }

  function unwrapTranslations(payload, originals) {
    if (typeof payload === "string") return [payload || originals[0] || ""];
    const rows = Array.isArray(payload) ? payload : [];
    return originals.map((original, index) => {
      const item = rows[index];
      const value = Array.isArray(item) ? item[0] : item;
      return typeof value === "string" && value.trim() ? value.trim() : original;
    });
  }

  globalThis.LSTCues = {
    cleanText,
    langKey,
    sameLanguage,
    googleLang,
    parseEvents,
    prepareCues,
    parseSubtitleFile,
    findCue,
    unwrapTranslations,
  };
})();
