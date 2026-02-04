#!/usr/bin/env python3
"""
Audio Conversion Script for IVR Prompts

Converts audio files from various formats (.mp3, .mpeg, .aac, .wav, .m4a) 
to Asterisk-compatible ulaw format (8kHz mono).

Requirements:
    ffmpeg installed on the system:
    - Windows: choco install ffmpeg  OR download from https://ffmpeg.org/download.html
    - Linux: apt-get install ffmpeg
    - macOS: brew install ffmpeg
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path


# Configuration
SCRIPT_DIR = Path(__file__).parent.absolute()
PROJECT_ROOT = SCRIPT_DIR.parent
NEW_SOUNDS_DIR = PROJECT_ROOT / "new sounds"
PROMPTS_DIR = PROJECT_ROOT / "prompts"

# Folder mappings: source folder -> target subfolder
FOLDER_MAPPINGS = {
    "billing": "billing",
    "surveys": "survey"
}

# Name mappings for cleaner filenames
NAME_MAPPINGS = {
    # Billing prompts
    "welcome": "billing_welcome",
    "enter the account number": "billing_enter_account",
    "to confirm press 1": "billing_confirm_press_1",
    "to change the number enter 2": "billing_change_press_2",
    "incorrect number try to call again": "billing_incorrect_number",
    "thanks for using monthly invoice inquiry service": "billing_thank_you",
    
    # Survey prompts  
    "0 welcome": "survey_welcome",
    "1- how much you are satisifed 1-5": "survey_q1_satisfaction",
    "2- how much you evaluate the employees 1-5": "survey_q2_employees",
    "3 - how much accurate is survey": "survey_q3_accuracy",
    "4 - speed of call": "survey_q4_speed",
    "5 - overall satisifaction": "survey_q5_overall"
}


def clean_filename(filename: str) -> str:
    """Convert filename to clean prompt name."""
    # Remove extension
    name = Path(filename).stem
    
    # Check if we have a mapping
    if name in NAME_MAPPINGS:
        return NAME_MAPPINGS[name]
    
    # Clean up the name
    clean = name.lower()
    clean = clean.replace(" ", "_")
    clean = clean.replace("-", "_")
    clean = "".join(c for c in clean if c.isalnum() or c == "_")
    return clean


def convert_to_ulaw(input_path: Path, output_path: Path) -> bool:
    """Convert audio file to 8kHz mono ulaw format using ffmpeg."""
    try:
        print(f"  Converting: {input_path.name} -> {output_path.name}")
        
        # Find ffmpeg
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            # Try common Windows locations
            possible_paths = [
                r"C:\ffmpeg\bin\ffmpeg.exe",
                r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
                os.path.expanduser("~\\scoop\\apps\\ffmpeg\\current\\bin\\ffmpeg.exe"),
            ]
            for p in possible_paths:
                if os.path.exists(p):
                    ffmpeg = p
                    break
        
        if not ffmpeg:
            print("    ✗ Error: ffmpeg not found. Please install ffmpeg.")
            return False
        
        # Run ffmpeg conversion
        result = subprocess.run([
            ffmpeg,
            "-y",  # Overwrite output
            "-i", str(input_path),  # Input file
            "-ar", "8000",  # Sample rate 8kHz
            "-ac", "1",  # Mono
            "-f", "mulaw",  # Output format
            str(output_path)
        ], capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"    ✗ Error: {result.stderr[:200]}")
            return False
        
        print(f"    ✓ Converted successfully ({output_path.stat().st_size} bytes)")
        return True
        
    except Exception as e:
        print(f"    ✗ Error: {e}")
        return False


def main():
    print("=" * 60)
    print("IVR Audio Conversion Script")
    print("=" * 60)
    
    if not NEW_SOUNDS_DIR.exists():
        print(f"\nError: Source folder not found: {NEW_SOUNDS_DIR}")
        print("Please ensure the 'new sounds' folder exists with the audio files.")
        sys.exit(1)
    
    print(f"\nSource folder: {NEW_SOUNDS_DIR}")
    print(f"Target folder: {PROMPTS_DIR}")
    
    total_converted = 0
    total_failed = 0
    
    for source_folder, target_subfolder in FOLDER_MAPPINGS.items():
        source_path = NEW_SOUNDS_DIR / source_folder
        target_path = PROMPTS_DIR / target_subfolder
        
        if not source_path.exists():
            print(f"\nWarning: Source folder not found: {source_path}")
            continue
        
        print(f"\n{'─' * 50}")
        print(f"Processing: {source_folder} -> {target_subfolder}")
        print(f"{'─' * 50}")
        
        # Create target folder
        target_path.mkdir(parents=True, exist_ok=True)
        
        # Get all audio files
        audio_extensions = [".mp3", ".mpeg", ".aac", ".m4a", ".wav", ".ogg"]
        audio_files = [
            f for f in source_path.iterdir() 
            if f.suffix.lower() in audio_extensions
        ]
        
        print(f"Found {len(audio_files)} audio files")
        
        for audio_file in sorted(audio_files):
            clean_name = clean_filename(audio_file.name)
            output_file = target_path / f"{clean_name}.ulaw"
            
            if convert_to_ulaw(audio_file, output_file):
                total_converted += 1
            else:
                total_failed += 1
    
    print(f"\n{'=' * 60}")
    print("Conversion Complete!")
    print(f"{'=' * 60}")
    print(f"  ✓ Successfully converted: {total_converted}")
    if total_failed > 0:
        print(f"  ✗ Failed: {total_failed}")
    
    print(f"\nConverted files are in: {PROMPTS_DIR}")
    print("You can now run the seed script to add them to the database.")


if __name__ == "__main__":
    main()
