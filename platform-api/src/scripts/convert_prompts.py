#!/usr/bin/env python3
import argparse
import audioop
import json
import os
import shutil
import subprocess
import sys
import wave


def ffmpeg_available():
    return shutil.which("ffmpeg") is not None


def sox_available():
    return shutil.which("sox") is not None


def convert_with_ffmpeg(input_path, output_path):
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-ar",
        "8000",
        "-ac",
        "1",
        "-acodec",
        "pcm_mulaw",
        "-f",
        "mulaw",
        output_path,
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def convert_with_sox(input_path, output_path):
    cmd = ["sox", input_path, "-r", "8000", "-c", "1", "-e", "u-law", output_path]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def convert_wav_with_stdlib(input_path, output_path):
    with wave.open(input_path, "rb") as wf:
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        sample_rate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())

    if channels > 1:
        frames = audioop.tomono(frames, sample_width, 0.5, 0.5)
    if sample_rate != 8000:
        frames, _ = audioop.ratecv(frames, sample_width, 1, sample_rate, 8000, None)
    mulaw = audioop.lin2ulaw(frames, sample_width)
    with open(output_path, "wb") as out:
        out.write(mulaw)


def convert_one(input_path, output_path):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    if ffmpeg_available():
        convert_with_ffmpeg(input_path, output_path)
        return "ffmpeg"
    if sox_available():
        convert_with_sox(input_path, output_path)
        return "sox"
    if input_path.lower().endswith(".wav"):
        convert_wav_with_stdlib(input_path, output_path)
        return "python-wav-fallback"
    raise RuntimeError("No ffmpeg/sox available and non-WAV input cannot be converted")


def parse_args():
    parser = argparse.ArgumentParser(description="Convert audio prompts to 8kHz mono u-law")
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--manifest",
        required=True,
        help="JSON array: [{\"source\":\"in.wav\",\"output\":\"out.ulaw\"}]",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    manifest = json.loads(args.manifest)
    converted = []
    skipped = []
    failed = []

    for item in manifest:
        source_name = item["source"]
        output_name = item["output"]
        source_path = os.path.join(args.source_dir, source_name)
        output_path = os.path.join(args.output_dir, output_name)

        if not os.path.exists(source_path):
            skipped.append({"source": source_name, "reason": "source_missing"})
            continue

        if os.path.exists(output_path):
            skipped.append({"source": source_name, "reason": "already_exists"})
            continue

        try:
            backend = convert_one(source_path, output_path)
            converted.append(
                {"source": source_name, "output": output_name, "backend": backend}
            )
        except Exception as exc:
            failed.append({"source": source_name, "error": str(exc)})

    print(json.dumps({"converted": converted, "skipped": skipped, "failed": failed}))
    if failed:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
