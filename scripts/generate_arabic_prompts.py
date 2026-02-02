#!/usr/bin/env python3
"""
Arabic IVR Prompt Generator using Google Cloud Text-to-Speech

This script generates Arabic audio prompts for the IVR system.
It uses Google Cloud TTS or falls back to gTTS (free Google TTS).

Requirements:
  pip install gtts pydub

Usage:
  python generate_arabic_prompts.py

Output files will be in ../prompts/ar/ directory
"""

import os
import subprocess
from pathlib import Path

# Try to use gTTS (free Google TTS)
try:
    from gtts import gTTS
    HAS_GTTS = True
except ImportError:
    HAS_GTTS = False
    print("Warning: gTTS not installed. Install with: pip install gtts")

# Arabic prompts configuration
PROMPTS = {
    "enter_account": "من فضلك أدخل رقم الحساب",
    "you_entered": "لقد أدخلت",
    "press_1_confirm_2_reenter": "اضغط واحد للتأكيد أو اثنين لإعادة الإدخال",
    "invalid_account": "رقم الحساب غير صحيح",
    "retrieving_balance": "جاري استرجاع الرصيد",
    "balance_is": "رصيدك هو",
    "currency_egp": "جنيه مصري",
    "goodbye": "شكراً لاتصالك، مع السلامة",
    "could_not_retrieve": "عذراً، لا يمكن استرجاع الرصيد",
}

# Arabic digits
DIGITS = {
    "0": "صفر",
    "1": "واحد",
    "2": "اثنين",
    "3": "ثلاثة",
    "4": "أربعة",
    "5": "خمسة",
    "6": "ستة",
    "7": "سبعة",
    "8": "ثمانية",
    "9": "تسعة",
}


def convert_to_ulaw(input_file: str, output_file: str):
    """Convert audio file to ulaw format using ffmpeg"""
    cmd = [
        "ffmpeg", "-y",
        "-i", input_file,
        "-ar", "8000",
        "-ac", "1",
        "-acodec", "pcm_mulaw",
        "-f", "mulaw",
        output_file
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        print(f"  Converted to ulaw: {output_file}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"  Error converting to ulaw: {e}")
        return False
    except FileNotFoundError:
        print("  Warning: ffmpeg not found, skipping ulaw conversion")
        return False


def generate_with_gtts(text: str, output_path: str, lang: str = "ar"):
    """Generate audio using gTTS (free Google TTS)"""
    try:
        tts = gTTS(text=text, lang=lang)
        mp3_path = output_path.replace('.wav', '.mp3')
        tts.save(mp3_path)
        
        # Convert MP3 to WAV using ffmpeg
        wav_path = output_path
        cmd = ["ffmpeg", "-y", "-i", mp3_path, "-ar", "8000", "-ac", "1", wav_path]
        subprocess.run(cmd, check=True, capture_output=True)
        os.remove(mp3_path)
        
        print(f"  Generated: {wav_path}")
        return True
    except Exception as e:
        print(f"  Error generating audio: {e}")
        return False


def main():
    # Setup output directories
    script_dir = Path(__file__).parent
    prompts_dir = script_dir.parent / "prompts" / "ar"
    digits_dir = prompts_dir / "digits"
    
    prompts_dir.mkdir(parents=True, exist_ok=True)
    digits_dir.mkdir(parents=True, exist_ok=True)
    
    if not HAS_GTTS:
        print("ERROR: gTTS is required. Install with: pip install gtts")
        print("Then run this script again.")
        return
    
    print("=" * 60)
    print("Generating Arabic IVR Prompts")
    print("=" * 60)
    
    # Generate main prompts
    print("\n--- Main Prompts ---")
    for name, text in PROMPTS.items():
        print(f"\nGenerating: {name}")
        print(f"  Arabic: {text}")
        
        wav_file = prompts_dir / f"{name}.wav"
        ulaw_file = prompts_dir / f"{name}.ulaw"
        
        if generate_with_gtts(text, str(wav_file)):
            convert_to_ulaw(str(wav_file), str(ulaw_file))
    
    # Generate digit prompts
    print("\n--- Digit Prompts ---")
    for digit, text in DIGITS.items():
        print(f"\nGenerating digit: {digit}")
        print(f"  Arabic: {text}")
        
        wav_file = digits_dir / f"{digit}.wav"
        ulaw_file = digits_dir / f"{digit}.ulaw"
        
        if generate_with_gtts(text, str(wav_file)):
            convert_to_ulaw(str(wav_file), str(ulaw_file))
    
    print("\n" + "=" * 60)
    print("Done! Arabic prompts generated in:", prompts_dir)
    print("=" * 60)
    print("\nNext steps:")
    print("1. Review the generated audio files")
    print("2. Update docker-compose.yml to mount the Arabic prompts")
    print("3. Update ivr-node/index.js to use Arabic prompts and digits")


if __name__ == "__main__":
    main()
