# Guardian Agent: Zero-Trust AI Pipeline

**Guardian Agent** is an enterprise-grade AI security platform designed to perform deep analysis on sensitive documents (PDFs) without exposing Personally Identifiable Information (PII) to external or cloud-based AI models. It employs a "Zero-Trust" architecture where data is sanitized locally before processing and re-identified only within the secure client environment.

## 🛡️ Core Features

  * **Zero-Trust Analysis**: PII (names, SSNs, emails, phone numbers) is detected and tokenized locally on the CPU using NLP and Regex *before* leaving the secure boundary.
  * **Blind Logic Engine**: The AI model (Gemma 2 running via Ollama) reasons over tokenized data (e.g., `[ENTITY_1]`), ensuring it never "sees" the real sensitive information.
  * **Local Re-Identification**: The backend decrypts the AI's response, swapping tokens back to their original values only for the authenticated user.
  * **Redaction & Compliance**:
      * Generate "Safe" copies of documents with PII permanently redacted.
      * Download "Redacted Reports" for audit trails.
  * **Audit Logging**: All analysis events are securely logged to Google Firestore.
  * **Containerized AI**: Uses a dedicated Dockerized GPU service running Ollama.

## 🏗️ Architecture

1.  **Frontend**: A lightweight HTML/Tailwind interface for uploading documents and viewing results.
2.  **Backend (Node.js)**:
      * Parses PDFs.
      * Performs PII extraction using `compromise` (NLP) and Regex.
      * Manages the "Secret Map" (Tokens \<-\> Real Data).
      * Communicates with the GPU Service.
      * Stores metadata in Firestore.
3.  **GPU Service (Docker)**: Hosts the `gemma:2` LLM via Ollama to process the sanitized text.

## 🚀 Getting Started

### Prerequisites

  * **Node.js** (v18 or higher)
  * **Docker** (for the GPU service)
  * **Firebase Project** (Firestore database) & Service Account Key

### 1\. GPU Service Setup

The AI engine runs in a Docker container. It uses Ollama to serve the Gemma 2 model.

```bash
cd gpu-service

# Build the image
docker build -Tt guardian-gpu .

# Run the container (exposes port 8080)
docker run -d -p 8080:8080 --name guardian-gpu guardian-gpu
```

### 2\. Backend Setup

Configure the Node.js server.

1.  **Navigate to the backend:**

    ```bash
    cd backend
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Environment Configuration:**
    Create a `.env` file in the `backend/` directory:

    ```env
    PORT=3000
    GPU_SERVICE_URL=http://localhost:8080
    # Firebase credentials are handled via service-key.json
    ```

4.  **Firebase Setup:**

      * Download your Firebase Service Account key from the Google Cloud Console.
      * Rename it to `service-key.json` and place it in the root of the `backend/` folder.

5.  **Start the Server:**

    ```bash
    npm start
    ```

    *Server runs on `http://localhost:3000`*

### 3\. Frontend Setup

The frontend is a static HTML file.

1.  Open `frontend/index.html`.
2.  **Configuration**:
    Locate the `BACKEND_URL` constant in the `<script>` tag (around line 250) and update it to your local backend:
    ```javascript
    // Change this from the production URL to localhost
    const BACKEND_URL = 'http://localhost:3000';
    ```
3.  Open `index.html` in your browser.

-----

## 📖 Usage Guide

1.  **Upload**: Drag and drop a PDF file containing sensitive text (legal contracts, medical records, etc.).
2.  **Prompt**: Enter a question for the AI (e.g., "Summarize the liability clauses").
3.  **Analyze**:
      * The system will **Tokenize** identities locally.
      * It sends the **Blind** text to the GPU service.
      * The response is **Decrypted** and displayed.
4.  **Verify**: Click the **Privacy Vault** accordion in the report modal to see exactly what data was hidden from the AI.
5.  **Download**: Generate a PDF report of the analysis or a redacted version of the original document.

## 🔧 Configuration Details

### PII Scrubbing Logic

The system uses a "Deterministic Scrub" approach found in `backend/index.js`. It targets:

  * **Patterns**: SSN, Email, Phone formats.
  * **NLP**: Uses `compromise` to detect People and Organizations.
  * **Heuristics**: Looks for titled names (Hon., Dr., Mr.) and capitalized entity chains.

### API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/secure-analysis` | Main pipeline: Upload PDF, scrub PII, query AI, re-identify. |
| `POST` | `/redact-document` | Generates a permanently redacted PDF file. |
| `GET` | `/history` | Fetches the last 10 analysis logs from Firestore. |
| `GET` | `/download-redacted/:id` | Downloads a proof-of-redaction PDF for a specific scan. |

## 📦 Tech Stack

  * **Backend**: Node.js, Express, Multer, PDFKit, Axios.
  * **AI/NLP**: Ollama (Gemma 2 model), Compromise.js.
  * **Database**: Google Firestore (via `firebase-admin`).
  * **Frontend**: Vanilla JS, Tailwind CSS, FontAwesome.

## 🔒 Security Notes

  * **Identity Locking**: The "Secret Map" (mapping tokens to real names) exists **only** in the backend memory during the request processing or within the secure database record. It is never sent to the Model API.
  * **.gitignore**: Ensures `service-key.json`, `.env`, and logs are not committed.
