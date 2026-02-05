#!/usr/bin/env python3
"""
Generate Arabic number pronunciation sound files for IVR
Uses ElevenLabs TTS API
"""

import os
import requests
import subprocess
from pathlib import Path

# ElevenLabs API configuration
ELEVENLABS_API_KEY = os.environ.get('ELEVENLABS_API_KEY', 'sk_09d0cc298b338bb94a4c36bcae48dc0c1a8beeae7747f21c')
VOICE_ID = "IKne3meq5aSn9XLyUdCD"  # Arabic voice

SCRIPT_DIR = Path(__file__).parent.absolute()
OUTPUT_DIR = SCRIPT_DIR.parent / "prompts" / "ar" / "digits"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Arabic number words for TTS
ARABIC_NUMBERS = {
    # Units (1-19)
    '0': 'صفر',
    '1': 'واحد',
    '2': 'اثنان',
    '3': 'ثلاثة',
    '4': 'أربعة',
    '5': 'خمسة',
    '6': 'ستة',
    '7': 'سبعة',
    '8': 'ثمانية',
    '9': 'تسعة',
    '10': 'عشرة',
    '11': 'أحد عشر',
    '12': 'اثنا عشر',
    '13': 'ثلاثة عشر',
    '14': 'أربعة عشر',
    '15': 'خمسة عشر',
    '16': 'ستة عشر',
    '17': 'سبعة عشر',
    '18': 'ثمانية عشر',
    '19': 'تسعة عشر',
    
    # Tens (20-90)
    '20': 'عشرون',
    '30': 'ثلاثون',
    '40': 'أربعون',
    '50': 'خمسون',
    '60': 'ستون',
    '70': 'سبعون',
    '80': 'ثمانون',
    '90': 'تسعون',
    
    # Hundreds
    '100': 'مائة',
    '200': 'مائتان',
    '300': 'ثلاثمائة',
    '400': 'أربعمائة',
    '500': 'خمسمائة',
    '600': 'ستمائة',
    '700': 'سبعمائة',
    '800': 'ثمانمائة',
    '900': 'تسعمائة',
    
    # Thousands
    '1000': 'ألف',
    '2000': 'ألفان',
    '3000': 'ثلاثة آلاف',
    '4000': 'أربعة آلاف',
    '5000': 'خمسة آلاف',
    '6000': 'ستة آلاف',
    '7000': 'سبعة آلاف',
    '8000': 'ثمانية آلاف',
    '9000': 'تسعة آلاف',
    
    # Connector
    'wa': 'و',  # "and" connector
}

def generate_audio(text, output_filename):
    """Generate audio using ElevenLabs API"""
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY
    }
    
    data = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75
        }
    }
    
    print(f"Generating: {output_filename} -> '{text}'")
    
    response = requests.post(url, json=data, headers=headers)
    
    if response.status_code == 200:
        mp3_path = OUTPUT_DIR / f"{output_filename}.mp3"
        with open(mp3_path, 'wb') as f:
            f.write(response.content)
        
        # Convert to ulaw
        ulaw_path = OUTPUT_DIR / f"{output_filename}.ulaw"
        subprocess.run([
            'ffmpeg', '-y', '-i', str(mp3_path),
            '-ar', '8000', '-ac', '1',
            '-f', 'mulaw', str(ulaw_path)
        ], capture_output=True)
        
        print(f"  ✓ Generated {output_filename}.ulaw")
        return True
    else:
        print(f"  ✗ Error: {response.status_code} - {response.text}")
        return False

def main():
    print("Generating Arabic number sound files...")
    
    for key, text in ARABIC_NUMBERS.items():
        generate_audio(text, key)
    
    print("\nDone! Copy the .ulaw files to asterisk:/var/lib/asterisk/sounds/ar/numbers/")

if __name__ == "__main__":
    main()
