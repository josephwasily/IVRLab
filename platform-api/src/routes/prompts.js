const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const https = require('https');

const execPromise = util.promisify(exec);

const PROMPTS_PATH = process.env.PROMPTS_PATH || '/app/prompts';
const UPLOADS_PATH = '/app/uploads';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const PROMPT_UPLOAD_ENABLED = process.env.PROMPT_UPLOAD_ENABLED === 'true';

// ElevenLabs voice IDs - common voices
const ELEVENLABS_VOICES = {
    // Multilingual voices (support Arabic)
    'rachel': 'EXAVITQu4vr4xnSDxMaL',      // Rachel - Female, calm
    'drew': '29vD33N1CtxCmqQRPOHJ',         // Drew - Male, well-rounded
    'clyde': '2EiwWnXFnvU5JabPnv8n',        // Clyde - Male, war veteran
    'paul': '5Q0t7uMcjvnagumLfvZi',         // Paul - Male, news
    'domi': 'AZnzlk1XvdvUeBnXmlld',         // Domi - Female, strong
    'dave': 'CYw3kZ02Hs0563khs1Fj',         // Dave - Male, British
    'fin': 'D38z5RcWu1voky8WS1ja',          // Fin - Male, Irish
    'sarah': 'EXAVITQu4vr4xnSDxMaL',        // Sarah - Female, soft
    'antoni': 'ErXwobaYiN019PkySvjV',       // Antoni - Male, well-rounded
    'thomas': 'GBv7mTt0atIp3Br8iCZE',       // Thomas - Male, calm
    'charlie': 'IKne3meq5aSn9XLyUdCD',      // Charlie - Male, Australian
    'emily': 'LcfcDJNUP1GQjkzn1xUU',        // Emily - Female, calm
    'elli': 'MF3mGyEYCl7XYWbV9V6O',         // Elli - Female, emotional
    'callum': 'N2lVS1w4EtoT3dr4eOWO',       // Callum - Male, transatlantic
    'patrick': 'ODq5zmih8GrVes37Dizd',      // Patrick - Male, shouty
    'harry': 'SOYHLrjzK2X1ezoPC6cr',        // Harry - Male, anxious
    'liam': 'TX3LPaxmHKxFdv7VOQHJ',         // Liam - Male, neutral
    'dorothy': 'ThT5KcBeYPX3keUQqHPh',      // Dorothy - Female, British
    'josh': 'TxGEqnHWrfWFTfGW9XjX',         // Josh - Male, deep
    'arnold': 'VR6AewLTigWG4xSOukaG',       // Arnold - Male, crisp
    'charlotte': 'XB0fDUnXU5powFXDhCwa',    // Charlotte - Female, Swedish
    'matilda': 'XrExE9yKIg1WjnnlVkGX',      // Matilda - Female, warm
    'matthew': 'Yko7PKHZNXotIFUBG7I9',      // Matthew - Male, audiobook
    'james': 'ZQe5CZNOzWyzPSCn5a3c',        // James - Male, Australian
    'joseph': 'Zlb1dXrM653N07WRdFW3',       // Joseph - Male, British
    'jeremy': 'bVMeCyTHy58xNoL34h3p',       // Jeremy - Male, Irish
    'michael': 'flq6f7yk4E4fJM5XTYuZ',      // Michael - Male, obnoxious
    'ethan': 'g5CIjZEefAph4nQFvHAz',        // Ethan - Male, ASMR
    'gigi': 'jBpfuIE2acCO8z3wKNLl',         // Gigi - Female, childish
    'freya': 'jsCqWAovK2LkecY7zXl4',        // Freya - Female, overcast
    'grace': 'oWAxZDx7w5VEj9dCyTzz',        // Grace - Female, Southern
    'daniel': 'onwK4e9ZLuTAKqWW03F9',       // Daniel - Male, deep British
    'serena': 'pMsXgVXv3BLzUgSXRplE',       // Serena - Female, pleasant
    'adam': 'pNInz6obpgDQGcFmaJgB',         // Adam - Male, deep
    'nicole': 'piTKgcLEGmPE4e6mEKli',       // Nicole - Female, whisper
    'jessie': 't0jbNlBVZ17f02VDIeMI',       // Jessie - Male, raspy
    'ryan': 'wViXBPUzp2ZZixB1xQuM',         // Ryan - Male, soldier
    'sam': 'yoZ06aMxZJJ28mfd3POQ',          // Sam - Male, raspy
    'glinda': 'z9fAnlkpzviPz146aGWa',       // Glinda - Female, witch
    'giovanni': 'zcAOhNBS3c14rBihAFp1',     // Giovanni - Male, Italian
    'mimi': 'zrHiDhphv9ZnVXBqCLjz',         // Mimi - Female, Swedish
};

// Ensure directories exist
if (!fs.existsSync(UPLOADS_PATH)) fs.mkdirSync(UPLOADS_PATH, { recursive: true });

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_PATH),
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'audio/mpeg', 'audio/x-mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
            'audio/ogg', 'audio/flac', 'audio/aac', 'audio/m4a', 'audio/x-m4a',
            'audio/webm', 'audio/basic', 'audio/x-aiff'
        ];
        const allowedExtensions = ['.mp3', '.mpeg', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.webm', '.aiff', '.ulaw', '.alaw'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`));
        }
    }
});

router.use(authMiddleware);

// Convert audio file to Asterisk-compatible ulaw format
async function convertToUlaw(inputPath, outputPath) {
    // Use sox for high-quality conversion to ulaw (8kHz, mono, 8-bit μ-law)
    // sox is better for telephony audio than ffmpeg
    const soxCmd = `sox "${inputPath}" -r 8000 -c 1 -e u-law "${outputPath}"`;
    
    try {
        await execPromise(soxCmd);
        return true;
    } catch (soxError) {
        console.log('sox failed, trying ffmpeg:', soxError.message);
        
        // Fallback to ffmpeg
        const ffmpegCmd = `ffmpeg -y -i "${inputPath}" -ar 8000 -ac 1 -acodec pcm_mulaw -f mulaw "${outputPath}"`;
        await execPromise(ffmpegCmd);
        return true;
    }
}

// Generate speech using ElevenLabs API
async function generateSpeechElevenLabs(text, voiceId, outputPath) {
    return new Promise((resolve, reject) => {
        if (!ELEVENLABS_API_KEY) {
            return reject(new Error('ElevenLabs API key not configured'));
        }

        const postData = JSON.stringify({
            text: text,
            model_id: 'eleven_multilingual_v2', // Supports Arabic, English, and many languages
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0.0,
                use_speaker_boost: true
            }
        });

        const options = {
            hostname: 'api.elevenlabs.io',
            port: 443,
            path: `/v1/text-to-speech/${voiceId}`,
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': ELEVENLABS_API_KEY,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            if (res.statusCode !== 200) {
                let errorBody = '';
                res.on('data', chunk => errorBody += chunk);
                res.on('end', () => {
                    console.error('ElevenLabs API error:', res.statusCode, errorBody);
                    reject(new Error(`ElevenLabs API error: ${res.statusCode} - ${errorBody}`));
                });
                return;
            }

            const fileStream = fs.createWriteStream(outputPath);
            res.pipe(fileStream);
            
            fileStream.on('finish', () => {
                fileStream.close();
                resolve(outputPath);
            });
            
            fileStream.on('error', (err) => {
                fs.unlink(outputPath, () => {});
                reject(err);
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.write(postData);
        req.end();
    });
}

// Get available TTS voices
router.get('/voices', (req, res) => {
    if (!PROMPT_UPLOAD_ENABLED) {
        return res.json({
            available: false,
            voices: [],
            reason: 'Prompt upload/TTS generation is disabled'
        });
    }

    const voices = Object.entries(ELEVENLABS_VOICES).map(([name, id]) => ({
        id,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        key: name
    }));
    
    res.json({
        available: !!ELEVENLABS_API_KEY,
        voices
    });
});

// Generate prompt from text using TTS
router.post('/generate', requireRole('admin', 'editor'), async (req, res) => {
    if (!PROMPT_UPLOAD_ENABLED) {
        return res.status(503).json({
            error: 'Prompt upload and TTS generation are disabled'
        });
    }

    try {
        const { text, name, description, language = 'ar', category = 'custom', voice = 'adam' } = req.body;
        
        if (!ELEVENLABS_API_KEY) {
            return res.status(400).json({ 
                error: 'Text-to-speech is not configured. Please set ELEVENLABS_API_KEY environment variable.' 
            });
        }
        
        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Text is required' });
        }
        
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Prompt name is required' });
        }
        
        // Get voice ID
        const voiceId = ELEVENLABS_VOICES[voice.toLowerCase()] || ELEVENLABS_VOICES['adam'];
        
        // Sanitize filename
        const safeName = name.toLowerCase()
            .replace(/[^a-z0-9_-]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        
        if (!safeName) {
            return res.status(400).json({ error: 'Invalid prompt name' });
        }
        
        // Determine output paths
        const langDir = language === 'ar' ? path.join(PROMPTS_PATH, 'ar') : PROMPTS_PATH;
        if (!fs.existsSync(langDir)) {
            fs.mkdirSync(langDir, { recursive: true });
        }
        
        const outputFilename = `${safeName}.ulaw`;
        const outputPath = path.join(langDir, outputFilename);
        const tempMp3Path = path.join(UPLOADS_PATH, `${safeName}-${Date.now()}.mp3`);
        
        // Check if file already exists
        if (fs.existsSync(outputPath)) {
            return res.status(409).json({ error: 'A prompt with this name already exists' });
        }
        
        console.log(`Generating TTS for "${name}" with voice ${voice} (${voiceId})`);
        console.log(`Text: ${text.substring(0, 100)}...`);
        
        // Generate speech with ElevenLabs
        await generateSpeechElevenLabs(text, voiceId, tempMp3Path);
        
        // Convert MP3 to ulaw
        await convertToUlaw(tempMp3Path, outputPath);
        
        // Clean up temp file
        fs.unlinkSync(tempMp3Path);
        
        // Get file stats
        const stats = fs.statSync(outputPath);
        const durationSecs = Math.round(stats.size / 8000);
        
        // Create database record
        const id = uuidv4();
        const relativePath = language === 'ar' ? `ar/${outputFilename}` : outputFilename;
        
        db.prepare(`
            INSERT INTO prompts (id, tenant_id, name, filename, language, category, description, duration_ms, file_size, original_filename, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            req.user.tenantId,
            name,
            relativePath,
            language,
            category,
            description || `Generated from text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`,
            durationSecs * 1000,
            stats.size,
            `tts-${voice}.mp3`,
            req.user.userId
        );
        
        const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id);
        
        console.log(`TTS prompt created: ${name} (${relativePath}), duration: ${durationSecs}s`);
        res.status(201).json(prompt);
        
    } catch (error) {
        console.error('Error generating TTS prompt:', error);
        res.status(500).json({ error: error.message || 'Failed to generate prompt' });
    }
});

// List all prompts
router.get('/', (req, res) => {
    try {
        const { language, category } = req.query;
        
        let query = 'SELECT * FROM prompts WHERE tenant_id = ?';
        const params = [req.user.tenantId];
        
        if (language) {
            query += ' AND language = ?';
            params.push(language);
        }
        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }
        
        query += ' ORDER BY created_at DESC';
        
        const prompts = db.prepare(query).all(...params);
        res.json(prompts);
    } catch (error) {
        console.error('Error listing prompts:', error);
        res.status(500).json({ error: 'Failed to list prompts' });
    }
});

// Get prompt by ID
router.get('/:id', (req, res) => {
    try {
        const prompt = db.prepare(
            'SELECT * FROM prompts WHERE id = ? AND tenant_id = ?'
        ).get(req.params.id, req.user.tenantId);
        
        if (!prompt) {
            return res.status(404).json({ error: 'Prompt not found' });
        }
        
        res.json(prompt);
    } catch (error) {
        console.error('Error getting prompt:', error);
        res.status(500).json({ error: 'Failed to get prompt' });
    }
});

// Upload and convert a new prompt
router.post('/', requireRole('admin', 'editor'), upload.single('audio'), async (req, res) => {
    if (!PROMPT_UPLOAD_ENABLED) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(503).json({
            error: 'Prompt upload and conversion are disabled'
        });
    }

    const uploadedFile = req.file;
    
    try {
        if (!uploadedFile) {
            return res.status(400).json({ error: 'No audio file uploaded' });
        }
        
        const { name, description, language = 'ar', category = 'custom' } = req.body;
        
        if (!name) {
            fs.unlinkSync(uploadedFile.path);
            return res.status(400).json({ error: 'Prompt name is required' });
        }
        
        // Sanitize filename (alphanumeric, underscore, hyphen only)
        const safeName = name.toLowerCase()
            .replace(/[^a-z0-9_-]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        
        if (!safeName) {
            fs.unlinkSync(uploadedFile.path);
            return res.status(400).json({ error: 'Invalid prompt name' });
        }
        
        // Determine output path based on language
        const langDir = language === 'ar' ? path.join(PROMPTS_PATH, 'ar') : PROMPTS_PATH;
        if (!fs.existsSync(langDir)) {
            fs.mkdirSync(langDir, { recursive: true });
        }
        
        const outputFilename = `${safeName}.ulaw`;
        const outputPath = path.join(langDir, outputFilename);
        
        // Check if file already exists
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(uploadedFile.path);
            return res.status(409).json({ error: 'A prompt with this name already exists' });
        }
        
        // Convert to ulaw format
        console.log(`Converting ${uploadedFile.path} to ${outputPath}`);
        await convertToUlaw(uploadedFile.path, outputPath);
        
        // Get file stats
        const stats = fs.statSync(outputPath);
        const durationSecs = Math.round(stats.size / 8000); // ulaw is 8000 bytes per second
        
        // Create database record
        const id = uuidv4();
        const relativePath = language === 'ar' ? `ar/${outputFilename}` : outputFilename;
        
        db.prepare(`
            INSERT INTO prompts (id, tenant_id, name, filename, language, category, description, duration_ms, file_size, original_filename, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            req.user.tenantId,
            name,
            relativePath,
            language,
            category,
            description || null,
            durationSecs * 1000,
            stats.size,
            uploadedFile.originalname,
            req.user.userId
        );
        
        // Clean up uploaded file
        fs.unlinkSync(uploadedFile.path);
        
        const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id);
        
        console.log(`Prompt created: ${name} (${relativePath}), duration: ${durationSecs}s`);
        res.status(201).json(prompt);
        
    } catch (error) {
        console.error('Error creating prompt:', error);
        
        // Clean up on error
        if (uploadedFile && fs.existsSync(uploadedFile.path)) {
            fs.unlinkSync(uploadedFile.path);
        }
        
        res.status(500).json({ error: error.message || 'Failed to create prompt' });
    }
});

// Update prompt metadata
router.put('/:id', requireRole('admin', 'editor'), (req, res) => {
    try {
        const { name, description, category } = req.body;
        
        const prompt = db.prepare(
            'SELECT * FROM prompts WHERE id = ? AND tenant_id = ?'
        ).get(req.params.id, req.user.tenantId);
        
        if (!prompt) {
            return res.status(404).json({ error: 'Prompt not found' });
        }
        
        db.prepare(`
            UPDATE prompts 
            SET name = COALESCE(?, name),
                description = COALESCE(?, description),
                category = COALESCE(?, category),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(name, description, category, req.params.id);
        
        const updated = db.prepare('SELECT * FROM prompts WHERE id = ?').get(req.params.id);
        res.json(updated);
    } catch (error) {
        console.error('Error updating prompt:', error);
        res.status(500).json({ error: 'Failed to update prompt' });
    }
});

// Delete a prompt
router.delete('/:id', requireRole('admin', 'editor'), (req, res) => {
    try {
        const prompt = db.prepare(
            'SELECT * FROM prompts WHERE id = ? AND tenant_id = ?'
        ).get(req.params.id, req.user.tenantId);
        
        if (!prompt) {
            return res.status(404).json({ error: 'Prompt not found' });
        }
        
        // Don't delete system prompts
        if (prompt.is_system) {
            return res.status(403).json({ error: 'Cannot delete system prompts' });
        }
        
        // Delete the file
        const filePath = path.join(PROMPTS_PATH, prompt.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        // Delete database record
        db.prepare('DELETE FROM prompts WHERE id = ?').run(req.params.id);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting prompt:', error);
        res.status(500).json({ error: 'Failed to delete prompt' });
    }
});

// List available prompts in file system (for discovering existing prompts)
router.get('/filesystem/list', (req, res) => {
    try {
        const { language = 'ar' } = req.query;
        const langDir = language === 'ar' ? path.join(PROMPTS_PATH, 'ar') : PROMPTS_PATH;
        
        if (!fs.existsSync(langDir)) {
            return res.json([]);
        }
        
        const files = fs.readdirSync(langDir)
            .filter(f => f.endsWith('.ulaw') || f.endsWith('.wav') || f.endsWith('.gsm'))
            .map(f => {
                const stats = fs.statSync(path.join(langDir, f));
                const ext = path.extname(f);
                const name = path.basename(f, ext);
                return {
                    filename: f,
                    name,
                    size: stats.size,
                    duration_ms: ext === '.ulaw' ? Math.round(stats.size / 8) : null, // 8000 bytes/sec
                    modified: stats.mtime
                };
            });
        
        res.json(files);
    } catch (error) {
        console.error('Error listing filesystem prompts:', error);
        res.status(500).json({ error: 'Failed to list prompts' });
    }
});

// Preview/download a prompt audio file
router.get('/:id/audio', (req, res) => {
    try {
        const prompt = db.prepare(
            'SELECT * FROM prompts WHERE id = ? AND tenant_id = ?'
        ).get(req.params.id, req.user.tenantId);
        
        if (!prompt) {
            return res.status(404).json({ error: 'Prompt not found' });
        }
        
        const filePath = path.join(PROMPTS_PATH, prompt.filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Audio file not found' });
        }
        
        // Check if browser requests playable format
        const format = req.query.format || 'original';
        
        if (format === 'wav' && prompt.filename.endsWith('.ulaw')) {
            // Convert ulaw to wav for browser playback using sox
            const tempWavPath = path.join('/tmp', `${prompt.id}_preview.wav`);
            
            // Check if we have a cached conversion
            if (fs.existsSync(tempWavPath)) {
                const stats = fs.statSync(tempWavPath);
                const ageMs = Date.now() - stats.mtimeMs;
                // Use cache if less than 1 hour old
                if (ageMs < 3600000) {
                    res.setHeader('Content-Type', 'audio/wav');
                    res.setHeader('Content-Disposition', `inline; filename="${prompt.filename.replace('.ulaw', '.wav')}"`);
                    return res.sendFile(tempWavPath);
                }
            }
            
            // Convert ulaw to wav using sox
            const soxCmd = `sox -t ul -r 8000 -c 1 "${filePath}" -t wav -r 8000 "${tempWavPath}"`;
            exec(soxCmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('Sox conversion error:', error);
                    // Fallback to original file
                    res.setHeader('Content-Type', 'audio/basic');
                    res.setHeader('Content-Disposition', `attachment; filename="${prompt.filename}"`);
                    return res.sendFile(filePath);
                }
                
                res.setHeader('Content-Type', 'audio/wav');
                res.setHeader('Content-Disposition', `inline; filename="${prompt.filename.replace('.ulaw', '.wav')}"`);
                res.sendFile(tempWavPath);
            });
        } else {
            // Serve original file
            res.setHeader('Content-Type', 'audio/basic');
            res.setHeader('Content-Disposition', `attachment; filename="${prompt.filename}"`);
            res.sendFile(filePath);
        }
    } catch (error) {
        console.error('Error serving prompt audio:', error);
        res.status(500).json({ error: 'Failed to serve audio' });
    }
});

// Stream filesystem audio file for preview (no database record needed)
router.get('/filesystem/audio', (req, res) => {
    try {
        const { filename, language = 'ar' } = req.query;
        
        if (!filename) {
            return res.status(400).json({ error: 'Filename required' });
        }
        
        // Sanitize filename to prevent path traversal
        const sanitizedFilename = path.basename(filename);
        const filePath = path.join(PROMPTS_PATH, language, sanitizedFilename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Audio file not found' });
        }
        
        // Check if browser requests playable format
        const format = req.query.format || 'original';
        
        if (format === 'wav' && sanitizedFilename.endsWith('.ulaw')) {
            // Convert ulaw to wav for browser playback using sox
            const tempWavPath = path.join('/tmp', `fs_${language}_${sanitizedFilename.replace('.ulaw', '.wav')}`);
            
            // Check if we have a cached conversion
            if (fs.existsSync(tempWavPath)) {
                const stats = fs.statSync(tempWavPath);
                const ageMs = Date.now() - stats.mtimeMs;
                // Use cache if less than 1 hour old
                if (ageMs < 3600000) {
                    res.setHeader('Content-Type', 'audio/wav');
                    res.setHeader('Content-Disposition', `inline; filename="${sanitizedFilename.replace('.ulaw', '.wav')}"`);
                    return res.sendFile(tempWavPath);
                }
            }
            
            // Convert ulaw to wav using sox
            const soxCmd = `sox -t ul -r 8000 -c 1 "${filePath}" -t wav -r 8000 "${tempWavPath}"`;
            exec(soxCmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('Sox conversion error:', error);
                    res.setHeader('Content-Type', 'audio/basic');
                    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
                    return res.sendFile(filePath);
                }
                
                res.setHeader('Content-Type', 'audio/wav');
                res.setHeader('Content-Disposition', `inline; filename="${sanitizedFilename.replace('.ulaw', '.wav')}"`);
                res.sendFile(tempWavPath);
            });
        } else {
            res.setHeader('Content-Type', 'audio/basic');
            res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
            res.sendFile(filePath);
        }
    } catch (error) {
        console.error('Error serving filesystem audio:', error);
        res.status(500).json({ error: 'Failed to serve audio' });
    }
});

module.exports = router;
