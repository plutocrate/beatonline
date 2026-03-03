# Music Folder

Drop your music files here (MP3, WAV, OGG, AAC supported).

Then update `manifest.json` to add them to the in-game library:

```json
{
  "tracks": [
    { "name": "Display Name", "file": "filename.mp3" },
    { "name": "Another Song", "file": "song2.wav" }
  ]
}
```

The game will show these tracks in the **Music Library** panel on the
start screen. Click any track to load it instantly — no file picker needed.

### Serving locally

You need an HTTP server for the music library to work (browser security
blocks `fetch()` on `file://`). The easiest way:

```bash
# from the project root
npx serve .
# or
python3 -m http.server 8080
```

Then open http://localhost:3000 (or whichever port is shown).

### BPM Detection

BPM is detected automatically from the audio signal using offline FFT
analysis. For best results use tracks with a clear beat (120–180 BPM).
