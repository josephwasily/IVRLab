# Arabic IVR Prompts

This folder contains Arabic audio prompts for the IVR system.

## Required Prompt Files

Create `.ulaw` audio files for each of the following prompts:

### Main IVR Prompts

| Filename | Arabic Text | Transliteration |
|----------|-------------|-----------------|
| `enter_account.ulaw` | من فضلك أدخل رقم الحساب | Min fadlak adkhel raqam el-hesab |
| `you_entered.ulaw` | لقد أدخلت | Laqad adkhalt |
| `press_1_confirm_2_reenter.ulaw` | اضغط واحد للتأكيد أو اثنين لإعادة الإدخال | Edghat wahed lel-ta'keed aw ethnein le-e'adet el-edkhal |
| `invalid_account.ulaw` | رقم الحساب غير صحيح | Raqam el-hesab ghair saheeh |
| `retrieving_balance.ulaw` | جاري استرجاع الرصيد | Jari esterja' el-raseed |
| `balance_is.ulaw` | رصيدك هو | Raseedak howa |
| `currency_egp.ulaw` | جنيه مصري | Geneih masri |
| `goodbye.ulaw` | شكراً لاتصالك، مع السلامة | Shukran le-etesalak, ma'a el-salama |
| `could_not_retrieve.ulaw` | عذراً، لا يمكن استرجاع الرصيد | Uzran, la yumken esterja' el-raseed |

### Arabic Digit Files (for saying numbers)

Place these in `digits/` subfolder:

| Filename | Arabic Text | Transliteration |
|----------|-------------|-----------------|
| `0.ulaw` | صفر | Sifr |
| `1.ulaw` | واحد | Wahed |
| `2.ulaw` | اثنين | Ethnein |
| `3.ulaw` | ثلاثة | Thalatha |
| `4.ulaw` | أربعة | Arba'a |
| `5.ulaw` | خمسة | Khamsa |
| `6.ulaw` | ستة | Sitta |
| `7.ulaw` | سبعة | Sab'a |
| `8.ulaw` | ثمانية | Thamania |
| `9.ulaw` | تسعة | Tis'a |

## Audio Format Requirements

- **Format**: μ-law (ulaw) - 8-bit, 8000 Hz, mono
- **Alternative**: You can also use `.wav` files (16-bit, 8000 Hz, mono)

## Converting Audio Files

### Using FFmpeg to convert from WAV to ulaw:

```bash
ffmpeg -i input.wav -ar 8000 -ac 1 -acodec pcm_mulaw -f mulaw output.ulaw
```

### Using SoX to convert:

```bash
sox input.wav -r 8000 -c 1 -e u-law output.ulaw
```

## Text-to-Speech Options for Arabic

### 1. Google Cloud Text-to-Speech
```bash
# Install gcloud and authenticate, then:
gcloud text-to-speech synthesize 'من فضلك أدخل رقم الحساب' \
  --voice=ar-XA-Standard-A \
  --audio-encoding=LINEAR16 \
  output.wav
```

### 2. Amazon Polly
```bash
aws polly synthesize-speech \
  --output-format pcm \
  --voice-id Zeina \
  --text 'من فضلك أدخل رقم الحساب' \
  output.wav
```

### 3. Microsoft Azure TTS
Use the Arabic voices like `ar-EG-SalmaNeural` (Egyptian Arabic)

### 4. Free Options
- **espeak-ng**: Open source TTS with Arabic support
  ```bash
  espeak-ng -v ar -w output.wav "من فضلك أدخل رقم الحساب"
  ```
