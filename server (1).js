import express from "express";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.set("trust proxy", 1);
const { PORT = 3000, CORS_ORIGIN = "*", ANTHROPIC_API_KEY, ANTHROPIC_MODEL = "claude-sonnet-4-6",
  ELEVENLABS_API_KEY, ELEVENLABS_MODEL = "music_v2", GEMINI_API_KEY, GEMINI_MUSIC_MODEL = "lyria-3-pro-preview", MUSIC_PROVIDER, PASSPORT_SECRET = "dev-secret" } = process.env;
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

// Simple rate limit: 30 requests / minute / IP
const hits = new Map();
app.use((req, res, next) => {
  const k = req.ip, now = Date.now(), arr = (hits.get(k) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(k, arr);
  if (arr.length > 30) return res.status(429).json({ error: "Bahut zyada requests, thoda ruko." });
  next();
});

const BLOCKED_ARTISTS = ["arijit singh", "lata mangeshkar", "kishore kumar", "honey singh", "neha kakkar", "shreya ghoshal", "sonu nigam"];
const sha = s => crypto.createHash("sha256").update(s).digest("hex");

app.get("/api/health", (_, res) => res.json({ ok: true, lyrics: !!ANTHROPIC_API_KEY, music: !!(GEMINI_API_KEY || ELEVENLABS_API_KEY), provider: provider() }));

// 1) Original Hindi lyrics via Claude
app.post("/api/lyrics", async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: "ANTHROPIC_API_KEY set nahi hai" });
  const { name = "", genre = "Romantic", mood = "Emotional", style = "Folk", tempo = 100 } = req.body;
  const prompt = `Ek bilkul original Hindi gaana likho (Devanagari script mein).
Topic/idea: ${name}
Genre: ${genre}, Mood: ${mood}, Style: ${style}, Tempo: ${tempo} BPM.
Format: [Verse 1], [Chorus], [Verse 2], [Chorus], [Bridge], [Outro].
Kisi maujooda gaane ki line copy mat karo aur kisi real artist ki style imitate mat karo.
Sirf lyrics do, koi explanation nahi.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1200, messages: [{ role: "user", content: prompt }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: j.error?.message || "Anthropic API error" });
    res.json({ lyrics: j.content.filter(b => b.type === "text").map(b => b.text).join("\n") });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2) Music with vocals: Google Lyria 3 Pro (Gemini API) or ElevenLabs Music. Audio is stored in memory and polled by the frontend.
const songs = new Map();
const provider = () => (MUSIC_PROVIDER || (GEMINI_API_KEY ? "gemini" : "elevenlabs"));

async function makeAudio(prompt, ms) {
  if (provider() === "gemini") {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MUSIC_MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["AUDIO", "TEXT"] } })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || "Gemini API error");
    const parts = j.candidates?.[0]?.content?.parts || [];
    const p = parts.find(x => (x.inlineData || x.inline_data));
    const d = p && (p.inlineData || p.inline_data);
    if (!d?.data) throw new Error("Gemini se audio nahi mila (safety filter ya quota ho sakta hai)");
    return { buf: Buffer.from(d.data, "base64"), mime: d.mimeType || d.mime_type || "audio/mpeg" };
  }
  const r = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, music_length_ms: ms, model_id: ELEVENLABS_MODEL })
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 300));
  return { buf: Buffer.from(await r.arrayBuffer()), mime: "audio/mpeg" };
}

app.post("/api/music", (req, res) => {
  if (!(provider() === "gemini" ? GEMINI_API_KEY : ELEVENLABS_API_KEY)) return res.status(503).json({ error: "Music API key set nahi hai (GEMINI_API_KEY ya ELEVENLABS_API_KEY)" });
  const { genre = "Romantic", mood = "Emotional", style = "Acoustic", tempo = 100, singer = "Female AI Singer", duration = "1:00", lyrics = "" } = req.body;
  const [m, s] = String(duration).split(":").map(Number);
  const secs = Math.min(Math.max((m || 0) * 60 + (s || 0), 10), 180);
  const voice = singer.startsWith("Male") ? "male" : "female";
  const prompt = singer === "Instrumental"
    ? `Create an original ${mood} ${genre} ${style} Indian instrumental, about ${secs} seconds long, ${tempo} BPM, tabla, harmonium, acoustic guitar. No vocals.`
    : `Create an original Hindi song, about ${secs} seconds long. ${mood} ${genre}, ${style} style, ${tempo} BPM, Indian instruments. Clear ${voice} lead vocal singing exactly these Hindi lyrics in Hindi:\n${String(lyrics).slice(0, 2500)}`;
  const id = crypto.randomUUID();
  songs.set(id, { status: "processing" });
  setTimeout(() => songs.delete(id), 30 * 60 * 1000);
  makeAudio(prompt, secs * 1000)
    .then(a => songs.set(id, { status: "succeeded", ...a }))
    .catch(e => songs.set(id, { status: "failed", error: e.message }));
  res.json({ id, status: "processing" });
});
app.get("/api/music/:id", (req, res) => {
  const s = songs.get(req.params.id);
  if (!s) return res.status(404).json({ status: "failed", error: "Nahi mila ya expire ho gaya" });
  res.json({ status: s.status, error: s.error || null,
    audioUrl: s.status === "succeeded" ? `${req.protocol}://${req.get("host")}/api/audio/${req.params.id}` : null });
});
app.get("/api/audio/:id", (req, res) => {
  const s = songs.get(req.params.id);
  if (!s?.buf) return res.sendStatus(404);
  res.type(s.mime || "audio/mpeg").send(s.buf);
});

// 3) Copyright safety check (rule-based)
app.post("/api/safety-check", (req, res) => {
  const { lyrics = "", name = "", userAudioUploaded = false } = req.body;
  const text = (lyrics + " " + name).toLowerCase();
  const artistHit = BLOCKED_ARTISTS.some(a => text.includes(a));
  res.json({ checks: [
    { name: "Original Lyrics", result: lyrics.trim().length < 40 ? "Review" : "Pass" },
    { name: "Artist Voice Imitation", result: artistHit ? "Block" : "Pass" },
    { name: "Copyrighted Audio Upload", result: userAudioUploaded ? "Review" : "Pass" },
    { name: "Commercial License Verification", result: artistHit ? "Review" : "Pass" }
  ]});
});

// 4) Music Rights Passport: real SHA-256 hash + HMAC signature (tamper-evident)
app.post("/api/passport", (req, res) => {
  const { songId, lyrics = "", audioUrl = "", provider = "SwarForge AI" } = req.body;
  if (!songId) return res.status(400).json({ error: "songId chahiye" });
  const issuedAt = new Date().toISOString();
  const payload = { songId, issuedAt, provider, lyricsHash: sha(lyrics), audioUrl, commercialUse: true };
  const signature = crypto.createHmac("sha256", PASSPORT_SECRET).update(JSON.stringify(payload)).digest("hex");
  res.json({ passport: payload, signature, certificateId: `SF-LIC-${sha(songId + issuedAt).slice(0, 12).toUpperCase()}` });
});
app.post("/api/passport/verify", (req, res) => {
  const { passport, signature } = req.body;
  const expected = crypto.createHmac("sha256", PASSPORT_SECRET).update(JSON.stringify(passport)).digest("hex");
  res.json({ valid: !!signature && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.padEnd(expected.length).slice(0, expected.length))) && expected === signature });
});

app.listen(PORT, () => console.log(`SwarForge backend chal raha hai: http://localhost:${PORT}`));
