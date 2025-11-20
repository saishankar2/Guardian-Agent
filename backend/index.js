if (typeof global.DOMMatrix === 'undefined') {
    global.DOMMatrix = class DOMMatrix {
        constructor() {
            this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
        }
        toString() { return "matrix(1, 0, 0, 1, 0, 0)"; }
    };
}

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const PDFDocument = require('pdfkit');
const axios = require('axios');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() }); 

app.use(cors({ origin: '*' }));

app.post('/redact-document', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send("No file uploaded.");

        console.log(`Processing: ${req.file.originalname}`);
        const pdfData = await pdfParse(req.file.buffer);
        const originalText = pdfData.text;
        const GPU_URL = process.env.GPU_SERVICE_URL || "http://localhost:8080"; 
        
        console.log("Sending to GPU...");
        const gpuResponse = await axios.post(`${GPU_URL}/api/generate`, {
            model: "gemma:2b",
            prompt: `Task: Redact all names, emails, and phone numbers. Replace with [REDACTED]. Output ONLY the text.\n\nText: ${originalText}`,
            stream: false
        });

        const redactedText = gpuResponse.data.response;

        const doc = new PDFDocument();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=SAFE_${req.file.originalname}`);

        doc.pipe(res); 

        doc.fontSize(20).text('CONFIDENTIAL REDACTED REPORT', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Original File: ${req.file.originalname}`);
        doc.text(`Processed By: GuardianAgent (Gemma-2b Powered)`);
        doc.text(`Date: ${new Date().toLocaleString()}`);
        doc.moveDown();
        doc.lineWidth(2).moveTo(50, 150).lineTo(550, 150).stroke(); 
        doc.moveDown();
        
        doc.fontSize(12).font('Courier').text(redactedText);

        doc.end(); 
        console.log("PDF Generated and sent.");

    } catch (error) {
        console.error("Error:", error.message);
        res.status(500).send("Processing failed: " + error.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Brain running on ${PORT}`));