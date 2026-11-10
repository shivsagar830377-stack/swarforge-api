# SwarForge AI — Backend

## Local chalane ke liye
1. `npm install`
2. `.env.example` ko copy karke `.env` banao aur keys bharo
3. `node --env-file=.env server.js` (Node 20+)

## Online deploy (Render.com, free)
1. Is folder ko GitHub repo mein daalo (alag repo: `swarforge-api`)
2. Render → New → Web Service → repo chuno
3. Build: `npm install`, Start: `npm start`
4. Environment mein `.env.example` wale variables daalo (`CORS_ORIGIN` = tumhara GitHub Pages URL)
5. Mila hua URL `index.html` ke top mein `window.SF_API=""` ke andar daalo, commit karo

## Endpoints
- GET  /api/health
- POST /api/lyrics        (Claude se original Hindi lyrics)
- POST /api/music         (Google Lyria 3 Pro ya ElevenLabs se Hindi vocals wala gaana)
- GET  /api/music/:id     (status + audio URL)
- POST /api/safety-check
- POST /api/passport, /api/passport/verify

## Dhyan do
- Gaana Google Lyria (Gemini API) ya ElevenLabs se banta hai. Lyria ke har gaane par SynthID watermark lagta hai. Hindi uchcharan kabhi-kabhi galat ho sakta hai, pehle 2-3 gaane sunke check karo. Commercial use ke liye paid plan lo aur unki current terms padho.
- Gaana server ki memory mein 30 minute rehta hai; lamba store karne ke liye database/storage jodo.
- Safety check abhi rule-based hai; commercial release se pehle legal review karwao.
- Keys kabhi frontend ya GitHub mein mat daalo.
