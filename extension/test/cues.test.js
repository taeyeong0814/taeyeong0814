const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = { console, globalThis: {} };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "cues.js"), "utf8"), context);
const { prepareCues, parseSubtitleFile, findCue, unwrapTranslations, sameLanguage, cleanText } = context.LSTCues;

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error("FAIL", message);
  }
}

const sentences = prepareCues([
  { tStartMs: 0, dDurationMs: 2500, segs: [{ utf8: "Hello, this is a full sentence." }] },
  { tStartMs: 3000, dDurationMs: 2500, segs: [{ utf8: "Here is another one." }] },
]);
assert(sentences.length === 2, "sentence cues stay separate");
assert(findCue(sentences, 1).text.startsWith("Hello"), "finds the active sentence");
assert(findCue(sentences, 2.7) === null, "gap has no cue");

const words = prepareCues([
  { tStartMs: 0, dDurationMs: 300, segs: [{ utf8: "Hello" }] },
  { tStartMs: 300, dDurationMs: 300, segs: [{ utf8: "there," }] },
  { tStartMs: 700, dDurationMs: 400, segs: [{ utf8: "friend." }] },
  { tStartMs: 2000, dDurationMs: 400, segs: [{ utf8: "Next" }] },
  { tStartMs: 2400, dDurationMs: 400, segs: [{ utf8: "line" }] },
  { tStartMs: 2800, dDurationMs: 400, segs: [{ utf8: "starts" }] },
]);
assert(words.length === 2, "word cues group into phrases");
assert(words[0].text === "Hello there, friend.", "first phrase keeps punctuation");
assert(words[1].start === 2, "second phrase starts at the next word");

const appended = prepareCues([
  { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hello" }] },
  { tStartMs: 1000, dDurationMs: 1000, aAppend: 1, segs: [{ utf8: "world" }] },
]);
assert(appended.length === 1 && appended[0].text === "Hello world", "append events join text");

const vtt = parseSubtitleFile("WEBVTT\n\n00:00:00.500 --> 00:00:03.000\nHello <b>there</b>\n\n");
assert(vtt.length === 1 && vtt[0].text === "Hello there" && vtt[0].start === 0.5, "vtt parses and strips tags");
assert(cleanText("&amp; hello") === "& hello", "decodes entities");
assert(sameLanguage("en-US", "en"), "matches language families");
assert(!sameLanguage("zh-CN", "zh-TW"), "keeps Chinese variants apart");
assert(unwrapTranslations([["안녕", "en"]], ["Hello"])[0] === "안녕", "unwraps detected language pairs");
assert(unwrapTranslations(["안녕"], ["Hello"])[0] === "안녕", "unwraps plain strings");

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("cues ok");
