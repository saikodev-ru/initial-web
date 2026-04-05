#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════
#  stt_vosk.py — Speech-to-Text via Vosk (offline, free)
#
#  Usage:
#    python3 stt_vosk.py <audio_file> [model_path]
#
#  Args:
#    audio_file  — path to audio file (ogg, webm, mp3, wav, m4a, opus)
#    model_path  — path to Vosk model directory
#                  default: ./vosk-model-ru-small
#
#  Output (stdout):
#    JSON: {"ok": true, "text": "..."} or {"ok": false, "error": "..."}
#
#  Dependencies:
#    pip install vosk
#    ffmpeg (static binary — no root needed, see below)
#
#  Setup:
#    wget https://alphacephei.com/vosk/models/vosk-model-ru-small-0.22.zip
#    unzip vosk-model-ru-small-0.22.zip
#    # move to api-deploy/vosk-model-ru-small/
#
#    # Static ffmpeg (no root needed):
#    cd api-deploy/
#    wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
#    tar xf ffmpeg-release-amd64-static.tar.xz
#    cp ffmpeg-*-static/ffmpeg .   # → api-deploy/ffmpeg
#    chmod +x ffmpeg
#    rm -rf ffmpeg-*-static ffmpeg-release-amd64-static.tar.xz
# ═══════════════════════════════════════════════════════════════

import sys
import os
import json
import subprocess
import wave

def _find_ffmpeg():
    """Find ffmpeg binary: env var > local ./ffmpeg > system PATH."""
    # 1) Explicit env var
    env_bin = os.environ.get('FFMPEG_BIN')
    if env_bin and os.path.isfile(env_bin) and os.access(env_bin, os.X_OK):
        return env_bin

    # 2) Static binary next to this script (no root needed)
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ffmpeg')
    if os.path.isfile(local) and os.access(local, os.X_OK):
        return local

    # 3) Try system PATH
    for cmd in ('ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg',
                '/opt/ffmpeg/ffmpeg'):
        if os.path.isfile(cmd):
            return cmd

    return None


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: stt_vosk.py <audio_file> [model_path]"}, ensure_ascii=False))
        sys.exit(1)

    audio_file = sys.argv[1]
    model_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        'vosk-model-ru-small'
    )

    # Validate audio file exists
    if not os.path.isfile(audio_file):
        print(json.dumps({"ok": False, "error": "Audio file not found"}, ensure_ascii=False))
        sys.exit(1)

    # Validate model directory
    if not os.path.isdir(model_path):
        print(json.dumps({"ok": False, "error": f"Vosk model not found at {model_path}"}, ensure_ascii=False))
        sys.exit(1)

    # Find ffmpeg binary
    ffmpeg_bin = _find_ffmpeg()
    if not ffmpeg_bin:
        print(json.dumps({"ok": False, "error": "ffmpeg not found — download static binary: wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"}, ensure_ascii=False))
        sys.exit(1)

    # Convert to WAV mono 16kHz using ffmpeg (Vosk requirement)
    wav_file = audio_file + '.stt.wav'
    try:
        subprocess.run([
            ffmpeg_bin, '-y', '-i', audio_file,
            '-ar', '16000',       # 16kHz sample rate (Vosk optimal)
            '-ac', '1',           # mono
            '-sample_fmt', 's16', # 16-bit PCM
            wav_file
        ], capture_output=True, timeout=30, check=True)
    except subprocess.TimeoutExpired:
        _cleanup(wav_file)
        print(json.dumps({"ok": False, "error": "ffmpeg conversion timed out"}, ensure_ascii=False))
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode('utf-8', errors='replace') if e.stderr else ''
        _cleanup(wav_file)
        print(json.dumps({"ok": False, "error": f"ffmpeg failed: {stderr[:300]}"}, ensure_ascii=False))
        sys.exit(1)
    except FileNotFoundError:
        _cleanup(wav_file)
        print(json.dumps({"ok": False, "error": "ffmpeg binary disappeared during execution"}, ensure_ascii=False))
        sys.exit(1)

    if not os.path.isfile(wav_file):
        print(json.dumps({"ok": False, "error": "WAV conversion failed"}, ensure_ascii=False))
        sys.exit(1)

    # Run Vosk transcription
    try:
        from vosk import Model, KaldiRecognizer

        model = Model(model_path)

        with wave.open(wav_file, 'rb') as wf:
            # Vosk requires mono 16kHz — validate
            if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != 16000:
                print(json.dumps({"ok": False, "error": f"Audio format mismatch: ch={wf.getnchannels()} sw={wf.getsampwidth()} rate={wf.getframerate()}"}, ensure_ascii=False))
                _cleanup(wav_file)
                sys.exit(1)

            rec = KaldiRecognizer(model, wf.getframerate())
            rec.SetWords(True)   # Return word-level timestamps
            rec.SetPartialWords(True)

            results = []

            while True:
                data = wf.readframes(4000)
                if len(data) == 0:
                    break
                if rec.AcceptWaveform(data):
                    result = json.loads(rec.Result())
                    if result.get('text'):
                        results.append(result['text'])

            # Final result (remaining audio)
            final = json.loads(rec.FinalResult())
            if final.get('text'):
                results.append(final['text'])

            text = ' '.join(results).strip()

    except Exception as e:
        _cleanup(wav_file)
        print(json.dumps({"ok": False, "error": f"Vosk error: {str(e)}"}, ensure_ascii=False))
        sys.exit(1)

    _cleanup(wav_file)

    if text:
        # Basic punctuation cleanup
        text = _clean_text(text)
        print(json.dumps({"ok": True, "text": text}, ensure_ascii=False))
    else:
        print(json.dumps({"ok": False, "error": "no_speech"}, ensure_ascii=False))


def _clean_text(text):
    """Minor cleanup: capitalize first letter, add period if missing."""
    text = text.strip()
    if not text:
        return text
    # Remove extra spaces from Vosk concatenation
    while '  ' in text:
        text = text.replace('  ', ' ')
    # Capitalize first letter
    text = text[0].upper() + text[1:] if len(text) > 1 else text.upper()
    # Add trailing period if no ending punctuation
    if text[-1] not in '.!?…,;:':
        text += '.'
    return text


def _cleanup(*paths):
    """Remove temp files silently."""
    for p in paths:
        try:
            if p and os.path.isfile(p):
                os.unlink(p)
        except OSError:
            pass


if __name__ == '__main__':
    main()
