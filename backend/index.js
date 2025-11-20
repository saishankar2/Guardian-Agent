const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const PDFDocument = require('pdfkit');
const axios = require('axios');
const nlp = require('compromise');
const admin = require('firebase-admin');
require('dotenv').config();

admin.initializeApp();
const db = admin.firestore();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GPU_URL = process.env.GPU_SERVICE_URL || "http://localhost:8080";


function chunkText(text, maxLength = 12000) {
    const chunks = [];
    let currentChunk = "";
    const sentences = text.split(/(?<=[.?!])\s+/);
    
    sentences.forEach(sentence => {
        if ((currentChunk.length + sentence.length) > maxLength) {
            chunks.push(currentChunk);
            currentChunk = "";
        }
        currentChunk += sentence + " ";
    });
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
}

function deterministicScrub(text) {
    const patterns = {
        EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
        PHONE: /(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})/g
    };
    let clean = text;
    clean = clean.replace(patterns.EMAIL, '[REDACTED_EMAIL]');
    clean = clean.replace(patterns.SSN, '[REDACTED_SSN]');
    clean = clean.replace(patterns.PHONE, '[REDACTED_PHONE]');
    return clean;
}

app.get('/history', async (req, res) => {
    try {
        const snapshot = await db.collection('analysis_history')
            .orderBy('timestamp', 'desc')
            .limit(10)
            .get();
            
        const history = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/redact-document', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send("No file uploaded.");

        const pdfData = await pdfParse(req.file.buffer);
        const originalText = pdfData.text;
        const scrubbedText = deterministicScrub(originalText);

        const gpuResponse = await axios.post(`${GPU_URL}/api/generate`, {
            model: "gemma2",
            options: { temperature: 0.0, num_ctx: 4096 },
            prompt: `You are a Strict Privacy Compliance Engine.
Your goal is to redact PII (Personally Identifiable Information) from the text.

INSTRUCTIONS:
1. [NAME]: Redact names of people (Plaintiff, Defendant, Patient, Doctor).
2. [ID]: Redact SSNs, IDs, License Numbers.
3. [ADDRESS]: Redact physical addresses.
4. PRESERVE: Do not redact Dates, Case Numbers, or Dollar Amounts.

INPUT TEXT (Already partially scrubbed):
"${scrubbedText.substring(0, 15000)}" 

OUTPUT (Full text with redactions):`,
            stream: false
        });

        const finalText = gpuResponse.data.response || scrubbedText;

        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=SAFE_${req.file.originalname}`);
        doc.pipe(res);

        doc.fontSize(20).fillColor('#1a73e8').text('GUARDIAN REDACTION REPORT', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).fillColor('black').text(`File: ${req.file.originalname}`);
        doc.text(`Timestamp: ${new Date().toLocaleString()}`);
        doc.moveDown();
        doc.rect(50, doc.y, 500, 2).fill('#eee');
        doc.moveDown();
        
        doc.font('Courier').fontSize(11).text(finalText);
        
        doc.end();

    } catch (error) {
        console.error(error.message);
        res.status(500).send(error.message);
    }
});

app.post('/secure-analysis', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send("No file uploaded.");
        console.log(`[Zero-Trust] Processing: ${req.file.originalname}`);

        const pdfData = await pdfParse(req.file.buffer);
        const originalText = pdfData.text;
        const userPrompt = req.body.userPrompt || "Summarize the key risks and events.";

        console.log("⚡ STARTING LOCAL CPU EXTRACTION (True Zero-Trust)...");

        const doc = nlp(originalText);
        
        const people = doc.people().out('array');
        const orgs = doc.organizations().out('array');
        const titleMatches = originalText.match(/(?:Hon\.|Honorable|Judge|Justice|Mr\.|Ms\.|Dr\.|Prof\.)\s+[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+/g) || [];
        
        const allEntities = [...new Set([...people, ...orgs, ...titleMatches])].filter(e => e.length > 2);
        
        allEntities.sort((a, b) => b.length - a.length);

        let tokenizedText = originalText;
        let secretMap = {}; 

        allEntities.forEach((entity, index) => {
            const token = `[ENTITY_${index + 1}]`;
            secretMap[token] = entity;
            const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            tokenizedText = tokenizedText.replace(new RegExp(escaped, 'g'), token);
        });

        console.log(`[Zero-Trust] Locked ${Object.keys(secretMap).length} identities locally.`);

        const chunks = chunkText(tokenizedText);

        const analysisPromises = chunks.map(async (chunk, i) => {
            try {
                const gpuResponse = await axios.post(`${GPU_URL}/api/generate`, {
                    model: "gemma2",
                    options: { temperature: 0.1, num_ctx: 4096 },
                    prompt: `You are a Blind Logic Engine.
Analyze this segment of a larger document.
The text uses anonymous tokens like [ENTITY_1].
Answer the user's question for THIS segment only.

USER QUESTION: "${userPrompt}"

SEGMENT:
${chunk}

ANALYSIS:`,
                    stream: false
                });
                return gpuResponse.data.response;
            } catch (e) {
                return `[Error analyzing chunk ${i}]`;
            }
        });

        const chunkResults = await Promise.all(analysisPromises);
        const finalSummary = chunkResults.join("\n\n--- SEGMENT BREAK ---\n\n");
        
        let revealedAnalysis = finalSummary;
        Object.keys(secretMap).forEach(token => {
            const safeToken = token.replace('[','\\[').replace(']','\\]');
            revealedAnalysis = revealedAnalysis.replace(new RegExp(safeToken, 'g'), secretMap[token]);
        });

        await db.collection('analysis_history').add({
            timestamp: new Date().toISOString(),
            fileName: req.file.originalname,
            question: userPrompt,
            blind_analysis_snippet: finalSummary.substring(0, 200) + "...",
            full_analysis: revealedAnalysis,
            encrypted_entities: secretMap, 
            entities_protected: Object.keys(secretMap).length
        });
        console.log("[Database] Full analysis log saved.");

        res.json({
            success: true,
            blind_analysis: finalSummary,
            final_analysis: revealedAnalysis,
            encrypted_entities: secretMap, 
            stats: {
                entities_protected: Object.keys(secretMap).length,
                chunks_processed: chunks.length
            }
        });

    } catch (error) {
        console.error(error.message);
        res.status(500).send(error.message);
    }
});

app.listen(PORT, () => console.log(`Guardian Brain running on port ${PORT}`));