# Audio Assets License Ledger

All runtime audio in LCW (Language Conversation World) is procedurally synthesized in-code via `packages/audio` (`tools/sfx-synth` parameters from `docs/12-audio-design.md` §6.4), uses Web Audio API / browser speech synthesis, or is speech synthesized from our own text by the neural voices below (docs/04 4.8). No recorded or third-party audio files are shipped; the synthesized lines are served from R2 (`tts/v1/<engine-speaker>/…`), not stored in this repository.

| File | Source | License | Verified Date |
|---|---|---|---|
| `procedural://sfx-synth/*` | Generated deterministically by `@lcw/audio` | CC0-1.0 / LCW First-Party | 2026-11-15 |
| `r2://tts/v1/kokoro-af_sarah/*` | Model-voice lines synthesized on the operator's GPU by Kokoro-82M (hexgrad/Kokoro-82M, voice af_sarah) from LCW's fixed lines; uploaded by the operator (R2625) | Apache-2.0 (model weights and voices); output from first-party text | 2026-11-18 |
| `r2://tts/v1/aura2-*/*`, `aura-*`, `melo-*` | NPC and stand-in lines synthesized by Cloudflare Workers AI (Deepgram Aura-1/Aura-2, MyShell MeloTTS) from LCW's text | Cloudflare Workers AI service terms (generated output for the account's use); MeloTTS MIT | 2026-11-18 |
| `browser://kokoro/*` (made on the player's device, never stored by LCW) | Browser fallback voice (R2627): Kokoro-82M ONNX weights (onnx-community/Kokoro-82M-v1.0-ONNX) and voices af_sarah, af_heart, af_kore, af_aoede, am_fenrir, run by kokoro-js 1.2.1 and transformers.js on ONNX Runtime Web | Apache-2.0 (Kokoro-82M, kokoro-js, transformers.js); MIT (ONNX Runtime) | 2026-11-19 |
