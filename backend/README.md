# STUDYWISE AI - Backend

Backend API for **STUDYWISE AI**, an AI-powered semester examination preparation platform for college students.

**Current status:** Express server is configured (dotenv, CORS, Helmet, JSON parsing, health endpoint, 404 and centralized error handling). MongoDB Atlas connectivity (Mongoose) is configured and the server only starts once the database is connected. Student authentication (register, login, JWT-protected profile) is implemented, with email verification: a student gets a 6-digit code by email and can log in (and receives a JWT) only after verifying it. Admins are exempt. Question papers and other study materials (PDF, JPG, JPEG, PNG) can be uploaded, listed, viewed, edited and deleted (students manage their own materials, admins manage all of them; see `docs/STUDY_MATERIALS_API.md`), and their text is extracted (PDF text layer or local OCR for images). Students can also type a question and get an AI-generated answer from Gemini.

## Tech stack

- Node.js (20.19 or newer) and Express.js 5
- Security and tooling: helmet, cors, express-rate-limit, morgan, dotenv, cross-env, nodemon
- MongoDB Atlas with Mongoose
- Auth: jsonwebtoken, bcryptjs
- Uploads: multer
- Email: nodemailer with Brevo SMTP (verification codes)
- Text extraction: pdfjs-dist (PDF text), Tesseract.js (local OCR, no paid API), sharp (image clean-up)
- AI answers: Google Gemini REST API (called with Node's built-in `fetch`, no extra package)

## Prerequisites (Windows 11)

1. Node.js 20.19 or newer (LTS recommended) - check with `node -v`
2. Visual Studio Code
3. A MongoDB Atlas account with a cluster (the free M0 tier is enough)

## Installation (Windows PowerShell)

### 1. Open the project in VS Code

If you downloaded the ZIP, extract it and open the extracted folder:

```powershell
Expand-Archive -Path .\STUDYWISE-AI-Day1-Backend.zip -DestinationPath . -Force
cd .\studywise-ai-backend
code .
```

In VS Code, open the built-in terminal with `Ctrl + ~` (PowerShell).

### 2. Install dependencies

```powershell
npm install
```

### 3. Create your `.env` file

```powershell
Copy-Item .env.example .env
```

Open `.env` and set `MONGO_URI` (see the next step). The other defaults work as they are (port 5000).

### 4. Set up MongoDB Atlas

1. In Atlas, go to **Database Access** and create a database user (username + password).
2. Go to **Network Access** and add your current IP address (for local testing you can also add `0.0.0.0/0`, but remove it before going live).
3. Click **Connect** on your cluster, choose **Drivers**, and copy the connection string.
4. Paste it into `MONGO_URI` in `.env`. Replace `<username>`, `<password>` and `<cluster-url>`, and keep `/studywise_ai` as the database name. If your password contains special characters (`@ : / ? # %`), URL-encode them.

### 5. Start the server

Development (auto-restarts on file changes):

```powershell
npm run dev
```

Production mode:

```powershell
npm run start:prod
```

`npm start` also runs the server with plain Node and uses whatever `NODE_ENV` is set in `.env`.

You should see `MongoDB connected: ...` followed by `StudyWise AI API running in development mode at http://localhost:5000/api`. If the database connection fails, the server does not start and the terminal explains why.

### 6. Test the health endpoint

In a second PowerShell window:

```powershell
Invoke-RestMethod http://localhost:5000/api/health
```

Expected response:

```
success message                     data
------- -------                     ----
   True STUDYWISE AI API is running @{status=ok; service=studywise-ai-backend; ...}
```

To see the full JSON:

```powershell
Invoke-RestMethod http://localhost:5000/api/health | ConvertTo-Json -Depth 5
```

You can also open `http://localhost:5000/api/health` in your browser.

Test the 404 handler (returns HTTP 404 with a JSON error):

```powershell
Invoke-WebRequest http://localhost:5000/api/does-not-exist -SkipHttpErrorCheck | Select-Object -ExpandProperty Content
```

(`-SkipHttpErrorCheck` needs PowerShell 7. In Windows PowerShell 5.1 use your browser or Postman instead.)

## Project structure

```
studywise-ai-backend/
  server.js                  Entry point: loads env, validates config, starts HTTP server, graceful shutdown
  app.js                     Express app: Helmet, CORS, logging, parsers, routes, 404 + error handling
  package.json
  .env.example               Template for environment variables (copy to .env)
  .gitignore
  docs/
    AI_GENERATION_API.md     Phase 2E API reference: formats, difficulty, marks, answer keys, examples
  config/
    env.js                   Loads .env with dotenv, exposes config values, validates them
    academicPortal.js        Fixed official University of Madras question paper portal link
    db.js                    MongoDB Atlas connection (connectDB / disconnectDB), single shared connection
  controllers/
    systemController.js      Handlers for API info and health check
    authController.js        register (sends the email verification code, no JWT), verifyEmail, login (verified students and admins only), getProfile, resendOtp
    adminController.js       getAccessCheck (Phase 0 admin verification endpoint)
    academicController.js    Admin CRUD handlers for University, Department, Regulation, Semester and Subject
    academicImportController.js  Admin subject bulk import handler (dry run by default)
    studentAcademicController.js  Read-only academic handlers for students/admins and the official portal link
    paperController.js       uploadPaper (validates file content, saves metadata, cleans up on failure), extractPaper
    questionController.js    askQuestion (JSON answer) and askQuestionStream (SSE answer) for typed questions
    importantQuestionController.js  Important exam question generator (POST /api/questions/important, POST /api/questions/important/:generationId/answers)
    savedQuestionSetController.js   Saved question sets: save, list, get one, delete (own sets only), share / revoke / public view
  middleware/
    authMiddleware.js        protect: verifies the Bearer JWT, rejects unverified students (admins exempt), sets req.user
    uploadMiddleware.js      Multer setup: PDF/JPG/JPEG/PNG, 10 MB, UUID filenames, private uploads/papers folder
    errorHandler.js          Central error handler (consistent JSON errors)
    notFound.js              404 handler
    roleMiddleware.js        authorizeRoles(...roles) and requireAdmin: role check after protect (401 / 403)
    rateLimiter.js           Per-IP rate limiting + per-user limiter for the extract endpoint + per-IP limiters for resend-otp and verify-email
  models/
    User.js                  Student account (bcrypt hashing, comparePassword)
    Paper.js                 Uploaded question paper metadata + extraction result (text, status, error, pages, timestamp)
    SavedQuestionSet.js      Saved question set of a student (references to subject/semester/regulation + embedded questions)
    GeneratedQuestionSet.js  Stage 1 result of the important-question generator (questions without answers, per student; answers added by stage 2; auto-deleted after 30 days)
    EmailOtp.js              Pending email verification code of a student (keyed hash only, expiry, last sent time, wrong-attempt counter)
    University.js            Academic level 1: university (own collection)
    Department.js            Academic level 2: department (level UG/PG), references University
    Regulation.js            Academic level 3: regulation (syllabus year), references Department
    Semester.js              Academic level 4: semester 1-8, references Regulation
    Subject.js               Academic level 5: subject (type, category, optional code), references Semester
    index.js                 Exports all models
  routes/
    index.js                 Mounts all routers under /api
    systemRoutes.js          GET /api and GET /api/health
    authRoutes.js            /api/auth/register, /login, /profile
    paperRoutes.js           /api/papers/upload, /api/papers/:paperId/extract
    questionRoutes.js        /api/questions/ask, /api/questions/important, /api/questions/important/:generationId/answers
    sharedRoutes.js          GET /api/shared/question-sets/:token (public, read-only; Phase 2C)
  services/
    healthService.js         Business logic for API info and health status
    extractionService.js     Chooses PDF text extraction or image OCR for a verified file
    pdfExtractionService.js  Page-by-page PDF text extraction (pdfjs-dist), scanned/corrupt/locked PDF detection
    ocrService.js            Image OCR (Tesseract.js + sharp), rotation retry, time and queue limits
    emailService.js          Brevo SMTP sender (Nodemailer) for the verification email; never logs the code or credentials
    otpService.js            Generates the 6-digit code, stores its keyed hash, enforces the resend cooldown, sends the email; verifyEmailOtp checks it (expiry, single use, attempt limit)
    academicService.js       Academic admin rules: parent checks, duplicates, safe deactivation, listing
    academicImportService.js Subject bulk import: validation, duplicate detection, dry run, non-destructive insert
    academicMigrationService.js  Migration of pre-Phase-1C academic data to regulations (dry run by default, never deletes)
    studentAcademicService.js  Read-only academic lists (active records only, parent chain checked)
    importantQuestionService.js  Stage 1: academic checks, uploaded-paper prompt, questions-only validation, storage of the generated set
    answerGenerationService.js   Stage 2: ownership checks, answers for the selected questions from the same uploaded papers
    geminiService.js         Gemini client: generateAnswer (JSON) and streamAnswer (SSE), maps failures to safe errors
  utils/
    ApiError.js              Error class with HTTP status helpers
    generateToken.js         Signs the JWT ({ id })
    emailVerification.js     Who must have a verified email (everyone except admins) and the 403 EMAIL_NOT_VERIFIED error
    apiResponse.js           Consistent success response helper
    logger.js                Small timestamped logger
    fileSignature.js         Allowed file types and magic-byte (file signature) detection
  validators/
    commonValidators.js      Reusable validators (ObjectId param, pagination)
    academicValidators.js    Body and query validation for the academic admin APIs
    academicImportValidators.js  Request and per-record validation for the subject bulk import
```

## Available endpoints

| Method | Path          | Description                         |
| ------ | ------------- | ----------------------------------- |
| GET    | `/api`        | API name, version and endpoint list |
| GET    | `/api/health` | Service status, uptime, environment |
| POST   | `/api/auth/register` | Register a student; returns the user and `emailVerification` info, **no JWT**; emails a 6-digit code |
| POST   | `/api/auth/verify-email` | Verify the emailed code (public, JSON body `{ "email": "...", "otp": "123456" }`); on success returns user + JWT. `400` wrong/expired/used code, `429` too many wrong attempts |
| POST   | `/api/auth/login`    | Log in, returns user + JWT. Students must be verified (`403` + `"code": "EMAIL_NOT_VERIFIED"` otherwise); admins are never blocked |
| POST   | `/api/auth/resend-otp` | Send a NEW email verification code (public, JSON body `{ "email": "..." }`); the previous code stops working; `429` during the resend cooldown |
| GET    | `/api/auth/profile`  | Own profile (header `Authorization: Bearer <token>`) |
| POST   | `/api/papers/upload` | Upload a question paper: PDF, JPG, JPEG or PNG (JWT required, `multipart/form-data`, field `file`, max 10 MB) |
| POST   | `/api/papers/:paperId/extract` | Extract text from your own uploaded paper: PDF text or image OCR (JWT required) |
| POST   | `/api/papers/:paperId/share` | Create a secure public link for a study material; shown only once (JWT, owner or admin; `409` if already shared, `?replace=true` issues a new link). See `docs/STUDY_MATERIALS_API.md` |
| GET    | `/api/papers/:paperId/share` | Is the material shared, and since when (JWT, owner or admin; never returns the link) |
| DELETE | `/api/papers/:paperId/share` | Revoke the link; it stops working at once (JWT, owner or admin) |
| GET    | `/api/shared/materials/:token` | Public metadata of a shared material (no login) |
| GET    | `/api/shared/materials/:token/file` | Public file of a shared material (no login; `?download=true`) |
| POST   | `/api/questions/ask` | Ask a typed question and get a Gemini-generated answer (JWT required, JSON body `{ "question": "..." }`) |
| POST   | `/api/questions/important` | Stage 1: generate exam practice QUESTIONS ONLY (no answers) from the uploaded papers: MCQ / short answer / essay, difficulty, marks 2 / 5 / 10 / 15, quality report. Returns `generationId` and a `questionId` per question (JWT required, see *Important question generator* and `docs/AI_GENERATION_API.md`) |
| POST   | `/api/questions/important/:generationId/answers` | Stage 2: generate answers for the selected `questionIds` of your own generated set, from the same uploaded papers (JWT required) |
| POST   | `/api/saved-question-sets` | Save a generated question set (JWT required, see *Saved question sets*) |
| GET    | `/api/saved-question-sets` | Your history: `page`, `limit`, `q`, `subjectId`, `semesterId`, `departmentId`, `shared`, `sort` (JWT required) |
| GET    | `/api/saved-question-sets/:id` | One of your saved sets with all its questions (JWT required) |
| DELETE | `/api/saved-question-sets/:id` | Delete one of your saved sets (JWT required) |
| POST   | `/api/saved-question-sets/:id/share` | Enable public sharing of your set; returns the share URL (JWT, owner only) |
| DELETE | `/api/saved-question-sets/:id/share` | Revoke sharing; the link stops working at once (JWT, owner only) |
| GET    | `/api/shared/question-sets/:token` | Public, read-only view of a shared set (no login) |
| POST   | `/api/questions/ask/stream` | Same question, but the answer is streamed as Server-Sent Events while Gemini writes it (JWT required) |
| GET    | `/api/admin/access-check` | Admin-only check (JWT + `admin` role required): `401` without a valid token, `403` for students |
| POST / GET | `/api/admin/universities`, `/departments`, `/regulations`, `/semesters`, `/subjects` | Create / list academic records (admin only, see below) |
| GET / PUT / DELETE | `/api/admin/<resource>/:id` | Read / update / deactivate one record (admin only) |

Success responses: `{ "success": true, "message": "...", "data": { ... } }`

Auth endpoints (`/api/auth/*`) return `{ "success": true, "message": "...", "user": { ... }, "token": "..." }` (`token` only for verify-email and login; register returns no token).

Every endpoint that needs a JWT also refuses a student whose email is not verified (`403`, `"code": "EMAIL_NOT_VERIFIED"`), even with a still-valid older token. Admins are never affected.

Error responses: `{ "success": false, "message": "...", "errors": [ ... ] }` (expected errors never include a stack trace; a `stack` field is added only for unexpected server errors when `NODE_ENV` is not `production`).

### Question paper upload

`POST /api/papers/upload` requires `Authorization: Bearer <token>` and a `multipart/form-data` body with one file in the field named `file`.
Accepted: **PDF** (`.pdf`) and **images** (`.jpg`, `.jpeg`, `.png`), up to 10 MB each. Three checks must all agree: the file extension, the MIME type (`application/pdf`, `image/jpeg`, `image/png`) and the real file signature (magic bytes: `%PDF-`, JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`).
Files are stored under a server-generated UUID name in `uploads/papers/`, which is **not** served publicly and is ignored by Git. The original filename is kept only as metadata in MongoDB. Uploaded images are kept unchanged (OCR works on a temporary processed copy in memory).

Status codes: `201` uploaded, `400` missing/empty file or content that does not match its type (for example a text file renamed `.jpg`), `401` missing/invalid/expired token, `413` file over 10 MB, `415` unsupported extension/MIME type.

### Text extraction

`POST /api/papers/:paperId/extract` (JWT required, no request body). Only the student who uploaded the paper can extract it; anyone else gets `404 Paper not found`.

- **PDF**: the text layer is read page by page with `pdfjs-dist`, in page order. In the saved text, pages are separated by a form feed character (`\f`). A PDF with no readable text is reported as a scan, password-protected and corrupted PDFs return clear `422` errors, and PDFs over `MAX_PDF_PAGES` (default 200) are refused.
- **JPG / JPEG / PNG**: OCR runs **locally** with `Tesseract.js` (WebAssembly, no external or paid API). `sharp` first applies EXIF rotation, greyscale, contrast stretch, sharpening and resizing (small images are enlarged, huge ones reduced). If the first pass reads poorly, the image is also tried rotated 90/270/180 degrees and the best result is kept. If no readable text is found, the API returns `422 No readable text was found in this image`.
- **Limits**: OCR jobs run one at a time (a worker is shared, memory is released after 60 s idle); at most `OCR_MAX_QUEUE` jobs may wait (then `503`); each OCR job is stopped after `OCR_TIMEOUT_MS` (default 90 s) and each PDF after `PDF_TIMEOUT_MS` (default 60 s); images over about 40 megapixels are refused; each student may call this endpoint `EXTRACT_LIMIT_MAX` times (default 20) per 15 minutes.
- **Result saved on the Paper**: `extractedText`, `extractionStatus` (`pending`, `processing`, `completed`, `failed`), `extractionError`, `pageCount`, `extractedAt`, plus `extractionMethod` (`pdf-text` or `ocr`) and `ocrConfidence`.
- Calling it again for a completed paper returns the saved text (`"cached": true`). Add `?force=true` to run the extraction again.

Response: `{ success, message, data: { paper, extractedText, truncated, warnings } }` (the text is returned separately from `paper`).

Status codes: `200` done, `401` no/invalid token, `404` paper not found / not yours / stored file missing, `409` extraction already running, `422` corrupted, password-protected or scanned PDF, unreadable or corrupted image, no readable text, `429` too many extraction requests, `503` OCR busy or the OCR engine could not start.

#### OCR system requirements

- No system packages or paid services are needed: Tesseract.js is pure JavaScript/WebAssembly, and `sharp` and `pdfjs-dist` install prebuilt binaries on Windows with `npm install`.
- **First OCR run needs internet once**: Tesseract.js downloads the English language file (`eng.traineddata`, about 5-15 MB) and caches it in `.ocr-cache/`. After that OCR works offline.
- **Fully offline setup**: put an uncompressed `eng.traineddata` file in a folder (for example `ocr-data/`) and set `OCR_LANG_PATH=ocr-data` in `.env`. Set `OCR_LANG` for another language (the matching `.traineddata` file is needed).
- OCR is CPU-heavy: expect a few seconds per page photo on a typical laptop.

### Text question search (Gemini)

`POST /api/questions/ask` (JWT required, `Content-Type: application/json`). It does not use uploaded papers or files: the typed question is sent straight to Gemini.

Request: `{ "question": "What is normalization in DBMS?" }`

Response `200`: `{ "success": true, "message": "Answer generated successfully", "data": { "question": "...", "answer": "..." } }`. The question is returned trimmed; the answer is Markdown (headings, bullets, examples).

Rules: `question` is required, must be a string, is trimmed, must not be empty and may be at most 10,000 characters.

Status codes: `200` answer generated, `400` missing / empty / non-text / too long question, `401` missing, invalid or expired token, `422` Gemini refused or returned no answer, `502` Gemini failed or could not be reached, `503` AI service not configured (no `GEMINI_API_KEY`) or rate limited by Gemini, `504` Gemini timed out. Error messages are generic: the API key, Gemini's raw error text and stack traces are never sent to the client (details go to the server log only).

Setup: set `GEMINI_API_KEY` in `.env` (create a key at https://aistudio.google.com/apikey). `GEMINI_MODEL` defaults to `gemini-3.8-flash`; only set it in `.env` if you need another model (and remove any old `GEMINI_MODEL=gemini-3.6-flash` line, which Google lists as the previous generation). Invalid keys, quota limits and timeouts return generic `503`/`502`/`504` errors to the client; the real cause and a fix hint appear only in the server log.

### Streaming answers (Server-Sent Events)

`POST /api/questions/ask/stream` takes the same request as `/api/questions/ask` (JWT required, `Content-Type: application/json`, body `{ "question": "..." }`, same validation) but returns the answer progressively as it is generated, using Gemini's `streamGenerateContent` endpoint with `alt=sse`. The JSON endpoint is unchanged. Both use the same `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_THINKING_LEVEL`, `GEMINI_MAX_OUTPUT_TOKENS` and `GEMINI_TIMEOUT_MS` settings. For streaming, `GEMINI_TIMEOUT_MS` is the maximum total time of the whole stream.

Response headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.

Events (`event:` name, then one `data:` line of JSON, then a blank line):

```
event: start
data: {"question":"What is normalization in DBMS?"}

event: chunk
data: {"text":"## Normalization\n"}

event: chunk
data: {"text":"Normalization is the process of ..."}

event: done
data: {"success":true,"message":"Answer generated successfully","data":{"finishReason":"STOP","chunks":2,"characters":57,"truncated":false}}
```

Concatenating the `text` of all `chunk` events in order gives the full Markdown answer. `truncated` is `true` when Gemini stopped at the output token limit. A line starting with `:` (a keep-alive comment, sent every 15 seconds) must be ignored by clients.

Errors:
- Anything that goes wrong before Gemini starts answering (missing or invalid token `401`, invalid question `400`, key problem or quota `503`, Gemini failure or unreachable `502`, timeout `504`, blocked or empty answer `422`) is a normal JSON error response with that HTTP status, exactly like `/api/questions/ask`. No event stream is opened.
- If generation fails after the stream has started, the HTTP status is already `200`, so the failure arrives as a final event and the stream then closes: `event: error` with `data: {"success":false,"message":"The AI service could not answer right now. Please try again later.","status":502}`.
- If the client disconnects, the request to Gemini is cancelled and nothing is logged as an error.

Postman: create a `POST` request to `http://localhost:5000/api/questions/ask/stream`, set Authorization to Bearer Token (a token from `/api/auth/login`), set Body to raw JSON `{ "question": "What is DBMS?" }` and click Send. Postman shows the response as an event stream with one entry per event while it arrives (you need a Postman version with Server-Sent Events support; the response `Content-Type` is `text/event-stream`). In PowerShell, the same with curl (the `-N` switch turns off buffering so you see chunks live; use `curl.exe`, not the `curl` alias):

```powershell
curl.exe -N -X POST http://localhost:5000/api/questions/ask/stream -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" -d "{\"question\":\"What is DBMS?\"}"
```

Diagnosing slow or failing answers (for example HTTP 504): run `npm run check:gemini` (add `-- --compare` to compare thinking settings, or `-- --timeout=120000` to wait longer). It prints the effective settings (never the key), checks that `GEMINI_MODEL` exists and supports `generateContent`, asks "What is DBMS?" and reports the real response time. The server also logs every Gemini call's duration, model, thinking level and token counts (no key, no question text), and on a timeout logs the limit and settings that were in effect. If you copied an older `.env.example`, remove any `GEMINI_TIMEOUT_MS`, `GEMINI_MODEL` and `GEMINI_MAX_OUTPUT_TOKENS` lines so the current defaults apply.

Troubleshooting `502` from `/api/questions/ask`: the client message tells you the family ("could not be reached" = network failure before Gemini replied; "could not answer right now" = Gemini or a proxy returned an HTTP error). The server log has the details: Gemini's HTTP status, error status, reason codes, host, API version and model, plus a `CAUSE:` hint. With `NODE_ENV=development` it also shows Gemini's error message, sanitized (API key, tokens and the student's question are removed); with `NODE_ENV=production` the message is omitted. Typical causes: `404 NOT_FOUND` = wrong `GEMINI_MODEL` or API version; `400 INVALID_ARGUMENT` = a request setting the model does not support (a rejected `thinkingLevel` is retried once without it); `5xx` or non-JSON/HTML = Gemini overloaded or a proxy in between; `ENOTFOUND` / `ECONNREFUSED` / certificate codes = DNS, firewall, VPN, proxy or antivirus problems.

Tests: `npm test` runs `tests/questions.test.js` (Gemini and the user lookup are mocked, so no key, database or internet is needed).

## Important question generator (Phase 2A)

`POST /api/questions/important` (JWT required, verified email, `Content-Type: application/json`). Generates university-exam-style important questions for ONE subject, **only from the text of the student's own uploaded papers** (Phase 3C-2), through the existing Gemini service and returns them grouped by question type and marks.

**Scope.** Only subjects of University of Madras, regulation `2023-2024`, programme BCA or B.Sc. Computer Science (an undergraduate department named "Computer Science" counts as B.Sc. Computer Science). Anything else is a `400`. It uses the existing collections and ObjectId links only (Subject -> Semester -> Regulation -> Department -> University).

**Content comes only from uploaded material (Phase 3C-2).** Upload a PDF / JPG / PNG (`POST /api/papers/upload`), extract its text (`POST /api/papers/:paperId/extract`), then send up to 3 of those `paperIds`. At least one is required. Each paper must belong to the signed-in student (someone else's paper is a plain `404`) and have a completed extraction (`409` while pending / processing, `422` if failed). The extracted text is read server-side, passed to Gemini as data (never as instructions) and is **never silently truncated**: if the combined text is over `MAX_MATERIAL_CHARS_PER_REQUEST` (default 120000 characters) the request is refused with `422` and nothing is sent to the AI. The old `units` / `topics` fields are removed and rejected with `400`; the database holds no syllabus (removed in Phase 3C-1). The response says `"basis": "uploaded_material"`, lists the `papers` used and returns `meta.extractionWarnings` (blank pages, low OCR confidence, rotated image, text cut off at extraction). Every response carries a `disclaimer` saying the questions are AI-generated practice questions based only on the uploaded papers, not official syllabus or past-paper content.

**Phase 2E: quality and controls.** Full request/response reference with examples: **`docs/AI_GENERATION_API.md`**. Summary:

- **Formats:** `mcq` (four options), `short_answer` and `essay`; the earlier `paragraph`, `long_answer` and `problem_solving` types still work. The correct option, explanation and `answerPoints` come from the answers endpoint (stage 2), not from this one.
- **Difficulty:** optional `difficulty`: `easy`, `medium`, `hard` or `balanced` (default; a mix of all three).
- **Marks and count:** marks must be `2`, `5`, `10` or `15`; `mcq` only for 2 marks, `essay` only for 10 or 15 marks; at most `MAX_QUESTIONS_PER_REQUEST` questions per request (default 30, maximum 50), validated and enforced on the server.
- **Quality:** a stricter prompt, a strict schema for every AI question, semantic duplicate removal, removal of questions that claim exam predictions or invent units, recovery of complete questions from a cut-off answer.
- **Honest reporting:** `meta.distributionSatisfied`, `meta.unmet`, `meta.difficultyBreakdown` and `meta.warnings` say exactly what could not be delivered. Questions are never described as predicted or guaranteed to appear in an exam.
- **Answer keys** (`correctAnswer`, `explanation`, `answerPoints`) are returned to the signed-in student only, and only by the answers endpoint (or when saved with a set). The public shared view never contains them.

**Two-stage generation.**

1. `POST /api/questions/important` returns the questions only: no `correctAnswer`, `explanation` or `answerPoints` (an MCQ shows its four options). Anything of that kind the AI adds anyway is discarded. The questions are stored for the signed-in student (a `GeneratedQuestionSet`, deleted automatically after 30 days) and the response adds `data.generationId`, `data.answersGenerated: false` and a `questionId` on every question.
2. `POST /api/questions/important/:generationId/answers` with `{ "questionIds": ["<questionId>", ...] }` (1 to `MAX_QUESTIONS_PER_REQUEST`, unique) generates answers for those questions only, from the same uploaded papers. Checks, in order: JWT; body shape (`400`); the set belongs to the caller (another student's or a missing set is the same `404`); every `questionId` belongs to that set (`404`, nothing sent to the AI); the academic records are still active and in scope; the source papers still belong to the caller, have completed extraction and fit the text limit (`404` / `409` / `422`). Questions that already have an answer are returned as stored without another AI call. The response lists the selected questions with their answer fields (`correctAnswer` + `explanation` for an MCQ, `answerPoints` otherwise, in the same flat shape that `POST /api/saved-question-sets` accepts) and `meta` with `requested`, `generated`, `alreadyAnswered`, `unanswered` (ids the AI could not answer from the material; request them again to retry) and `warnings`.
3. Saving: a question may be saved with or without its answer. An MCQ without an answer key is accepted (`correctAnswer` and `explanation` must come together); a `questionId` field is accepted and ignored.

Example: `POST /api/questions/important/664f1a2b3c4d5e6f7a8b9c0d/answers` with `{ "questionIds": ["664f1a2b3c4d5e6f7a8b9c11", "664f1a2b3c4d5e6f7a8b9c12"] }`.

**Request body** (stage 1)

| Field | Rules |
| ----- | ----- |
| `subjectId`, `semesterId`, `regulationId` | required, ObjectIds. The subject must belong to the semester and the semester to the regulation |
| `questionTypes` | required, 1-6 of `mcq`, `short_answer`, `essay`, `paragraph`, `long_answer`, `problem_solving` (case-insensitive) |
| `marksDistribution` | required, 1-8 entries `{ "marks": 2\|5\|10\|15, "count": 1+, "questionType"?: <one of questionTypes> }`; each marks value once, unless the entries name different `questionType`s; total at most `MAX_QUESTIONS_PER_REQUEST` |
| `difficulty` | optional: `easy`, `medium`, `hard`, `balanced` (default) |
| `questionCount` | optional; must equal the total of `marksDistribution` |
| `paperIds` | required, 1-3 different ObjectIds of the student's own uploaded papers with completed text extraction |

Unknown fields, control characters and line breaks in text are rejected. All user text is passed to the model as JSON data inside the request, never as instructions.

**Example request**

```json
{
  "subjectId": "665f1c2e8a1b2c3d4e5f6a01",
  "semesterId": "665f1c2e8a1b2c3d4e5f6a02",
  "regulationId": "665f1c2e8a1b2c3d4e5f6a03",
  "paperIds": ["665f2a7b9c1d2e3f4a5b6c01", "665f2a7b9c1d2e3f4a5b6c02"],
  "questionTypes": ["mcq", "short_answer", "essay"],
  "difficulty": "balanced",
  "marksDistribution": [
    { "marks": 2, "count": 2, "questionType": "mcq" },
    { "marks": 5, "count": 1, "questionType": "short_answer" },
    { "marks": 10, "count": 1, "questionType": "essay" }
  ]
}
```

**Example response (`200`, shortened)**

```json
{
  "success": true,
  "message": "Important questions generated successfully",
  "data": {
    "generationId": "664f1a2b3c4d5e6f7a8b9c0d",
    "stage": "questions",
    "answersGenerated": false,
    "basis": "uploaded_material",
    "difficulty": "balanced",
    "groups": [
      { "questionType": "mcq", "marks": 2, "questions": [
        { "questionId": "664f1a2b3c4d5e6f7a8b9c11", "questionType": "mcq", "marks": 2, "difficulty": "medium", "question": "Which data structure follows the LIFO principle?",
          "unit": null, "topic": null,
          "options": [{ "label": "A", "text": "Queue" }, { "label": "B", "text": "Stack" }, { "label": "C", "text": "Binary tree" }, { "label": "D", "text": "Hash table" }] }
      ] },
      { "questionType": "essay", "marks": 10, "questions": [
        { "questionId": "664f1a2b3c4d5e6f7a8b9c12", "questionType": "essay", "marks": 10, "difficulty": "hard", "question": "Discuss hashing in detail, comparing chaining and open addressing.",
          "unit": null, "topic": null }
      ] }
    ],
    "disclaimer": "AI-generated practice questions ... not taken from the official syllabus or from previous question papers, and there is no guarantee that any of them will appear in an examination. ..."
  },
  "meta": {
    "requested": 4, "generated": 4, "shortfall": 0, "duplicatesRemoved": 0, "generationMs": 5120,
    "distributionSatisfied": true, "unmet": [], "difficulty": "balanced", "difficultyMatched": true,
    "difficultyBreakdown": { "requested": { "easy": 1, "medium": 2, "hard": 1 }, "generated": { "easy": 1, "medium": 2, "hard": 1 } },
    "rejectedItems": 0, "rejectionReasons": {}, "warnings": [],
    "material": { "papers": 2, "characters": 7960, "maxCharacters": 120000 },
    "extractionWarnings": [{ "paperId": "665f2a7b9c1d2e3f4a5b6c02", "originalName": "unit2-notes.jpg", "warnings": ["The image was hard to read, so some text may be wrong. A clearer photo or scan gives better results."] }]
  }
}
```

`unit` and `topic` are kept only when they exactly match something the client supplied, otherwise `null`. Groups are ordered by question type (order above) and then marks. Each question repeats its own `questionType` and `marks`, so the questions can be flattened out of `groups` and sent to the save endpoint as they are.

**What the server does with the AI answer.** It is treated as untrusted: parsed (a code fence or a sentence around the JSON is tolerated; a cut-off answer keeps its complete questions), every item is checked against a strict schema and against the request (requested marks and allowed type, difficulty, MCQ block or answer points, sensible length), extras beyond the requested count are dropped, questions that claim exam predictions or mention an unsupplied unit are discarded, and repeated or semantically similar questions (70% of the meaningful words in common) are removed across the whole response. If fewer questions than requested remain, they are returned with `meta.shortfall` > 0 and `meta.unmet` / `meta.warnings` describing the gap (no hidden retry, so quota use stays at one call per request). If none remain the answer is `502`.

**Errors** (`{ success: false, message, errors? }`, never an API key, Gemini message or stack trace)

| Status | When |
| ------ | ---- |
| `400` | invalid or missing input; subject not in the given semester / semester not in the given regulation; subject outside the supported scope |
| `401` / `403` | no or invalid token / email not verified |
| `404` | subject, semester or regulation does not exist or is inactive (also when its department or university is inactive) |
| `422` | Gemini blocked the request or returned no text |
| `502` | Gemini failed or was unreachable, or its answer could not be used (not JSON, no valid questions) |
| `503` | AI service not configured, key rejected or quota reached |
| `504` | Gemini timeout (`GEMINI_TIMEOUT_MS`, default 45 s; raise it if large requests time out) |

Code: `routes/questionRoutes.js` -> `controllers/importantQuestionController.js` -> `validators/importantQuestionValidators.js` + `services/importantQuestionService.js` -> `services/geminiService.js` (`generateAnswer` accepts optional `systemInstruction`, `responseMimeType` and `maxOutputTokens`; calls without them behave exactly as before). There is no per-user rate limit on this endpoint yet; each call is one Gemini request. Tests: `tests/importantQuestions.test.js` (Gemini, the user lookup and the academic collections are mocked).


## Saved question sets (Phase 2B)

Students can keep the question sets generated by `POST /api/questions/important`. All four endpoints need a JWT (verified email) and work only on the caller's own sets. The owner always comes from the token: a `student` field in the body is rejected, and a set of another student is answered with the same `404` as a set that does not exist. Saving never calls Gemini.

Only the `subject`, `semester` and `regulation` ObjectIds are stored; names, code and department are read from the academic collections when a set is returned. Saving re-uses the Phase 2A academic checks (active records, subject in semester, semester in regulation, University of Madras / 2023-2024 / BCA or B.Sc. Computer Science).

| Method | Path | Result |
| ------ | ---- | ------ |
| POST | `/api/saved-question-sets` | `201` the saved set (with questions) |
| GET | `/api/saved-question-sets?page=1&limit=10&q=&subjectId=&semesterId=&departmentId=&shared=&sort=` | `200` history without questions + `meta { page, limit, total, totalPages }`; `limit` max 50 (see *Question set history*) |
| GET | `/api/saved-question-sets/:id` | `200` one set with questions |
| DELETE | `/api/saved-question-sets/:id` | `200` deleted |

**Save body**

| Field | Rules |
| ----- | ----- |
| `title` | required, 1-150 characters, single line |
| `subjectId`, `semesterId`, `regulationId` | required ObjectIds, consistent with each other |
| `questions` | required, 1 to `MAX_QUESTIONS_PER_REQUEST` (default 30) items, no duplicates: `{ "questionType": mcq\|short_answer\|essay\|paragraph\|long_answer\|problem_solving, "marks": 1-20 (integer), "question": 10-1000 characters, "unit"?: <=100, "topic"?: <=150, "difficulty"?: easy\|medium\|hard }`. Phase 2E: an `mcq` also needs `options` (four `{ label: A-D, text }`); its `correctAnswer` and `explanation` are optional but must come together (stage 1 questions have none yet); other types may carry `answerPoints` (1-8 texts); `questionId` (from a generated set) is accepted and ignored. See `docs/AI_GENERATION_API.md` |
| `questionCount` | optional; must equal `questions.length` |

Unknown fields are rejected. The request body is limited to 400 KB (`413`; it was 100 KB before Phase 2E added answer keys). The owner sees the answer key of a set; sets saved before Phase 2E are returned exactly as before. A student can keep at most 100 sets (`409`; delete one to save another).

**Errors:** `400` invalid body / ids / pagination / filters or inconsistent academic references, `401` no or invalid token, `403` email not verified, `404` academic record or saved set not found (also for another student's set), `409` saved-set limit reached, `413` body too large.

Code: `routes/savedQuestionSetRoutes.js` -> `controllers/savedQuestionSetController.js` -> `validators/savedQuestionSetValidators.js` + `services/savedQuestionSetService.js` -> `models/SavedQuestionSet.js`. Tests: `tests/savedQuestionSets.test.js` (database, user lookup and all outbound calls are mocked/blocked).


## Question set history (Phase 2D)

`GET /api/saved-question-sets` is the student's history. It extends the Phase 2B list endpoint (same path, same `{ success, message, data, meta }` envelope, same item shape) and never returns the questions; use `GET /api/saved-question-sets/:id` for those. Every query always includes the student id from the JWT, so another student's sets can never appear, whatever the query string says.

| Query parameter | Rules |
| --------------- | ----- |
| `page` | positive integer, default `1` |
| `limit` | integer `1`-`50`, default `10` |
| `q` | title search: case-insensitive "contains", 1-100 characters, surrounding and repeated spaces ignored, special characters are matched literally (never a regular expression). An empty value means no search |
| `subjectId` | ObjectId of a subject |
| `semesterId` | ObjectId of a semester |
| `departmentId` | ObjectId of the department / programme (e.g. BCA, B.Sc. Computer Science); matches sets of every semester of it |
| `shared` | `true` = shared sets, `false` = private sets (sets saved before sharing existed count as private) |
| `sort` | `newest` (default) or `oldest`, by creation date; ties are broken by id so pages never overlap |

All filters combine (a set must match every one). Unknown query parameters are ignored. A filter that matches nothing, or a student with no sets, gives `200` with `data: []` and `meta.total: 0`. A repeated parameter (`?shared=true&shared=false`) or an invalid value is `400` with `errors: [{ field, message }]`; no token is `401`.

**Item fields:** `_id`, `title`, `questionCount`, `isShared`, `sharedAt`, `subject { _id, name, subjectCode, subjectType, category }`, `semester { _id, semesterNumber }`, `regulation { _id, name }`, `department { _id, name, code, level }` (the programme), `createdAt`, `updatedAt`. The sharing token and link are never part of the list; the owner gets the link from `POST /api/saved-question-sets/:id/share`.

**Performance:** the programme is not stored on a set, it is reached through the set's regulation. `departmentId` therefore first reads that department's regulations (a handful of rows) and then filters by `regulation` with an index. Indexes on `SavedQuestionSet` (all start with `student`): `{ student, createdAt }`, `{ student, subject, semester, createdAt }`, `{ student, regulation, createdAt }`, `{ student, isShared, createdAt }`; the oldest/newest sort uses the same index in either direction. A student keeps at most 100 sets, so a title search only ever scans that student's own sets. Academic details of a page are loaded with 4 queries however many sets it holds. Mongoose builds the two new indexes on the next start (`autoIndex`).

**Example**

```
GET /api/saved-question-sets?q=tree&shared=true&departmentId=6561a1f2c3d4e5f607182911&sort=oldest&page=1&limit=2
Authorization: Bearer <jwt>
```
```json
{
  "success": true,
  "message": "Saved question sets retrieved successfully",
  "data": [
    {
      "_id": "6561a1f2c3d4e5f607182930",
      "title": "Binary trees - unit 3",
      "questionCount": 12,
      "isShared": true,
      "sharedAt": "2026-11-23T10:45:12.481Z",
      "subject": { "_id": "6561a1f2c3d4e5f607182921", "name": "Data Structures", "subjectCode": "BCA101", "subjectType": "theory", "category": "core" },
      "semester": { "_id": "6561a1f2c3d4e5f607182918", "semesterNumber": 1 },
      "regulation": { "_id": "6561a1f2c3d4e5f607182915", "name": "2023-2024" },
      "department": { "_id": "6561a1f2c3d4e5f607182911", "name": "BCA", "code": "BCA", "level": "UG" },
      "createdAt": "2026-11-20T08:12:03.114Z",
      "updatedAt": "2026-11-23T10:45:12.481Z"
    }
  ],
  "meta": { "page": 1, "limit": 2, "total": 1, "totalPages": 1 }
}
```

Invalid requests: pagination is checked first, e.g. `?limit=500` gives `400 { "success": false, "message": "\"limit\" must be an integer between 1 and 50" }`. Then the filters, e.g. `?shared=maybe&sort=up` gives `400 { "success": false, "message": "Validation failed", "errors": [{ "field": "shared", "message": "shared must be \"true\" or \"false\"" }, { "field": "sort", "message": "sort must be one of: newest, oldest" }] }`.

Code: `routes/savedQuestionSetRoutes.js` -> `controllers/savedQuestionSetController.js` -> `validators/savedQuestionSetValidators.js` (`validateListFilters`) + `services/savedQuestionSetService.js` (`listQuestionSets`) -> `models/SavedQuestionSet.js`. Tests: `tests/savedQuestionHistory.test.js`.


## Sharing saved question sets (Phase 2C)

Saved sets are **private by default** (`isShared: false`, `shareToken: null`, `sharedAt: null`). The owner can publish a read-only link and take it back at any time.

| Method | Path | Auth | Result |
| ------ | ---- | ---- | ------ |
| POST | `/api/saved-question-sets/:id/share` | JWT, owner only | `200` `{ _id, isShared, sharedAt, shareUrl, apiUrl }` |
| DELETE | `/api/saved-question-sets/:id/share` | JWT, owner only | `200` `{ _id, isShared: false, sharedAt: null, shareUrl: null, apiUrl: null }` |
| GET | `/api/shared/question-sets/:token` | none | `200` the set (questions + academic details), otherwise `404` |

- **Token**: 32 bytes from `crypto.randomBytes`, base64url (43 characters). It is unrelated to the set's `_id`, the owner and the time. It is stored in `shareToken` (unique index, only for sets that have one) and returned only inside the share URL to the owner; it never appears in other responses.
- **Enable** is idempotent: while a set is shared, repeating the request returns the same URL (`"Question set is already shared"`) and keeps `sharedAt`. A set is only updated when it has no token yet, so simultaneous requests cannot replace each other's token.
- **Revoke** sets `isShared=false`, `shareToken=null`, `sharedAt=null` in one write. The old link answers `404` immediately. Enabling again creates a brand-new token. Revoking a set that is not shared is harmless (`200`).
- **Share URL**: `<SHARE_BASE_URL>/shared/<token>` (the frontend page; `SHARE_BASE_URL` is optional and defaults to the first `CORS_ORIGIN`). `apiUrl` is the matching public API path.
- **Public response** contains only: `title`, `questionCount`, `subject { name, subjectCode, subjectType, category }`, `semester { semesterNumber }`, `regulation { name }`, `department { name, code, level }`, `questions [{ questionType, marks, question, unit, topic, difficulty?, options? }]`, `sharedAt`. Answer keys (`correctAnswer`, `explanation`, `answerPoints`) are never part of the public response. It contains no ids, no owner, no email, name, password or other account data. It is sent with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- **Safe 404**: a malformed, unknown, revoked or deleted-set token, or a token of a set that is not shared, all return the same `404 "Shared question set not found"`. Malformed tokens are rejected before any database query.
- **Read-only**: `/api/shared/...` accepts only `GET` (and `HEAD`); `POST`, `PUT`, `PATCH`, `DELETE` return `405` with `Allow: GET, HEAD` and change nothing. There is no list of shared sets.
- **Owner-only**: enable and revoke filter by the student id from the verified JWT; another student's set (or a missing one) is the same `404 "Saved question set not found"`. `401` without a valid token, `403` for an unverified email, `400` for a malformed `:id`. The owner's own `GET /api/saved-question-sets` and `/:id` now also show `isShared` and `sharedAt`.

**Example: enable**

```
POST /api/saved-question-sets/6561a1f2c3d4e5f607182930/share
Authorization: Bearer <jwt>
```
```json
{
  "success": true,
  "message": "Sharing enabled successfully",
  "data": {
    "_id": "6561a1f2c3d4e5f607182930",
    "isShared": true,
    "sharedAt": "2026-11-23T10:45:12.481Z",
    "shareUrl": "https://studywise.example.com/shared/q1W3x9Zk2mP0vB7nR4tYc8LfHd5JsAeUoGiKbXwTzNE",
    "apiUrl": "/api/shared/question-sets/q1W3x9Zk2mP0vB7nR4tYc8LfHd5JsAeUoGiKbXwTzNE"
  }
}
```

**Example: public view (no Authorization header)**

```
GET /api/shared/question-sets/q1W3x9Zk2mP0vB7nR4tYc8LfHd5JsAeUoGiKbXwTzNE
```
```json
{
  "success": true,
  "message": "Shared question set retrieved successfully",
  "data": {
    "title": "Data Structures - revision set",
    "questionCount": 2,
    "subject": { "name": "Data Structures", "subjectCode": "BCA101", "subjectType": "theory", "category": "core" },
    "semester": { "semesterNumber": 1 },
    "regulation": { "name": "2023-2024" },
    "department": { "name": "BCA", "code": "BCA", "level": "UG" },
    "questions": [
      { "questionType": "short_answer", "marks": 2, "question": "Define a stack and give one use of it.", "unit": "Unit 1", "topic": "Stacks" },
      { "questionType": "long_answer", "marks": 10, "question": "Explain the different tree traversal techniques with algorithms.", "unit": null, "topic": null }
    ],
    "sharedAt": "2026-11-23T10:45:12.481Z"
  }
}
```

**Example: revoke, then the old link**

```
DELETE /api/saved-question-sets/6561a1f2c3d4e5f607182930/share
```
```json
{ "success": true, "message": "Sharing revoked successfully",
  "data": { "_id": "6561a1f2c3d4e5f607182930", "isShared": false, "sharedAt": null, "shareUrl": null, "apiUrl": null } }
```
```
GET /api/shared/question-sets/q1W3x9Zk2mP0vB7nR4tYc8LfHd5JsAeUoGiKbXwTzNE   ->  404
{ "success": false, "message": "Shared question set not found" }
```

Code: `routes/savedQuestionSetRoutes.js` (owner routes) and `routes/sharedRoutes.js` (public route) -> `controllers/savedQuestionSetController.js` -> `services/savedQuestionSetService.js` -> `models/SavedQuestionSet.js`. Tests: `tests/sharedQuestionSets.test.js`.


### Roles and admin access

Every account has a `role`: `student` (default) or `admin`. The role is stored in MongoDB and is **never** taken from a request: public registration ignores any `role` in the body and always creates a student. The JWT only carries the user id; `protect` loads the user from the database on every request, so the role is always the current one (demoting or deleting an admin takes effect immediately, even for tokens that have not expired). Accounts created before roles existed have no stored role and are treated as students.

Protect a route for admins with `router.use(protect, requireAdmin)` (see `routes/adminRoutes.js`), or for other role lists with `authorizeRoles('student', 'admin')`. No JWT or an invalid one gives `401`; a valid JWT without the required role gives `403`.

#### Creating the first admin (one-time)

1. In `.env` (never committed) set `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 12 characters, at most 72 bytes). `.env.example` shows the names.
2. Run `npm run seed:admin`.
3. **Delete `ADMIN_PASSWORD` from `.env`.**

The password is hashed with bcrypt by the same model hook as registration and is never printed. If an admin already exists the script changes nothing, so running it again cannot create a second admin. If an account with `ADMIN_EMAIL` already exists it is left untouched; to make that existing account an admin (password unchanged) run `npm run seed:admin -- --promote-existing`.

### Email verification codes (Phase 0B)

When a student registers, the API creates the account with `emailVerified: false`, generates a random 6-digit code and emails it through Brevo SMTP. The code is valid for **5 minutes**.

- **Storage:** only an HMAC-SHA256 hash of the code (keyed with `OTP_HASH_SECRET`, or a key derived from `JWT_SECRET`, and the user id) is stored, in the `emailotps` collection. There is one document per student, and MongoDB removes it automatically after it expires. The plain code exists only in memory and in the outgoing email: it is never stored, logged or returned by the API.
- **Registration response:** the `user` (with `emailVerified: false`) but **no `token`**, plus `emailVerification` (`otpSent`, `sentTo` masked, `expiresInSeconds`, `resendCooldownSeconds`). If the email cannot be sent, the account is still created and `otpSent` is `false`; the student can ask for a new code.
- **Resend:** `POST /api/auth/resend-otp` with `{ "email": "..." }` issues a new code and replaces the previous one, which stops working immediately. Within `OTP_RESEND_COOLDOWN_SECONDS` (default 60) of the last code it answers `429` with `retryAfterSeconds` and a `Retry-After` header and sends nothing. Unknown, already verified and admin accounts get the same `200` answer as a real one (nothing is sent), so the endpoint does not reveal who has an account. There is also a per-IP limit (`OTP_RESEND_LIMIT_MAX` per 15 minutes).
- **Verify:** `POST /api/auth/verify-email` with `{ "email": "...", "otp": "123456" }` (public). `otp` must be a string of exactly 6 digits. A correct code marks the student `emailVerified: true`, is used up immediately (one use only) and the response contains the first JWT. A code older than 5 minutes never works. Unknown, already verified, admin and code-less accounts all get the same `400 Invalid or expired verification code`, so the endpoint does not reveal who has an account.
- **Attempt limit:** each code allows `OTP_MAX_ATTEMPTS` (default 5) wrong guesses. Every guess is counted atomically before it is compared, so parallel requests cannot get extra guesses. A wrong code answers `400` with `attemptsRemaining`; once the limit is reached the code is locked (`429`) and even the correct code is refused until a new code is requested with resend-otp (which resets the counter). There is also a per-IP limit on verify-email (`OTP_VERIFY_LIMIT_MAX` per 15 minutes).
- **Who must verify:** every account except admins. Login answers `403` with `"code": "EMAIL_NOT_VERIFIED"` for an unverified student (only after the correct password was given, so it reveals nothing to a stranger), and `protect` refuses the same student on every JWT-protected route, so tokens issued before this rule stop working until the email is verified. Admins (created by `npm run seed:admin`, never through registration) are exempt: an existing admin can always log in and use `/api/admin/*`, whatever their `emailVerified` value.
- **Existing student accounts** created before this rule have `emailVerified: false`. They must verify once: `POST /api/auth/resend-otp`, then `POST /api/auth/verify-email`.

#### Setting up Brevo SMTP

1. Create a Brevo account. Under **SMTP & API > SMTP** copy the **SMTP login** and generate an **SMTP key**.
2. Under **Senders, Domains & Dedicated IPs** add the address you want emails to come from and verify it.
3. In your `.env` set `BREVO_SMTP_USER` (the SMTP login), `BREVO_SMTP_PASS` (the SMTP key) and `EMAIL_FROM_ADDRESS` (the verified sender). Do not put real values in `.env.example`.
4. Run `npm install` (adds `nodemailer`) and restart. The startup log shows `Brevo SMTP configured` or a warning if the three values are missing.
5. Register a student with a real inbox, or call `POST /api/auth/resend-otp`, and check the email. A failed send is logged with an error code and a hint (for example `EAUTH` = wrong SMTP login or key).

#### Testing in Postman

1. `POST /api/auth/register` with a real inbox you can read. Status `201`, `"role": "student"`, `"emailVerified": false`, **no `token`**, and `emailVerification.otpSent: true`. Open the email and note the 6-digit code.
2. `POST /api/auth/login` with that email and password: `403` with `"code": "EMAIL_NOT_VERIFIED"` and no token.
3. `POST /api/auth/verify-email` with `{ "email": "...", "otp": "<wrong code>" }`: `400` with `attemptsRemaining: 4`.
4. Same request with the correct code: `200`, `"emailVerified": true` and a `token`. Send the same request again: `400` (a code works only once).
5. `GET /api/auth/profile` with `Authorization: Bearer <token>`: `200`. Now `POST /api/auth/login` works too.
6. `GET /api/admin/access-check` with the student token gives `403`. Without a token it gives `401`.
7. `POST /api/auth/login` with the admin's email and password (no verification needed), copy that `token`, and send the same GET: `200` with the admin's details.
8. Register with `"role": "admin"` in the body: the account is still created as a student.
9. Lock test: register another student, send 5 wrong codes: the 5th answers `429`. The correct code is now refused as well. Wait `OTP_RESEND_COOLDOWN_SECONDS`, call `POST /api/auth/resend-otp`, then verify with the NEW code.
10. Expiry test: wait more than 5 minutes after a code was sent, then verify: `400 Invalid or expired verification code`.

## Academic data models (Phase 1C)

Five independent collections linked only by ObjectId references (nothing is embedded):
`University` (`universities`) <- `Department` (`departments`, field `university`) <- `Regulation` (`regulations`, field `department`) <- `Semester` (`semesters`, field `regulation`) <- `Subject` (`subjects`, field `semester`).
There is no College model and no college field: a department simply belongs to a university.

| Model | Required fields | Unique index |
| ----- | --------------- | ------------ |
| University | `name` (optional `code`, `description`) | `code`, when present (partial) |
| Department | `name`, `code`, `university`, `level` (`UG` or `PG`) | `{ university, code }` |
| Regulation | `name` (syllabus year / regulation identifier, for example `2023-2024`), `department` | `{ department, name }` |
| Semester | `semesterNumber` (whole number 1-8), `regulation` | `{ regulation, semesterNumber }` (partial: only documents that have a regulation) |
| Subject | `name`, `subjectType`, `category`, `semester`; `subjectCode` is **optional** | `{ semester, subjectCode }` (partial: only subjects with a non-empty code) |

All have `isActive` (default `true`) and timestamps. Codes are trimmed and stored upper-case; a blank subject code means "no code" and is not stored, so any number of code-less subjects can share a semester.

Allowed values (`utils/academicEnums.js`, matched case-insensitively and stored normalised):

- `level`: `UG`, `PG`
- `subjectType`: `theory`, `practical`, `project`, `internship`
- `category`: `core`, `elective`, `allied`, `language`, `skill_enhancement`, `ability_enhancement`, `non_major_elective`, `value_added`, `extra_credit`, `other`

No academic data is seeded: every collection starts empty and is filled through the admin APIs.

## Academic admin APIs

Admin-only CRUD for `universities`, `departments`, `regulations`, `semesters` and `subjects` under `/api/admin/` (JWT + `admin` role: `401` without a token, `403` for students, for reads as well as writes). Responses use the usual `{ success, message, data, meta }` format: a single record is `data.university` / `department` / `regulation` / `semester` / `subject`, a list is `data.universities` / `departments` / `regulations` / `semesters` / `subjects` with `meta: { page, limit, total, totalPages }`.

| Resource | Body fields (`*` = required on create) | Filters on the list |
| -------- | -------------------------------------- | ------------------- |
| `/universities` | `name*`, `code`, `description`, `isActive` | - |
| `/departments` | `name*`, `code*`, `university*` (id), `level*` (`UG`/`PG`), `isActive` | `?university=<id>`, `?level=UG|PG` |
| `/regulations` | `name*`, `department*` (id), `isActive` | `?department=<id>` |
| `/semesters` | `semesterNumber*` (1-8), `regulation*` (id), `isActive` | `?regulation=<id>`, `?semesterNumber=<1-8>`, `?department=<id>` (old filter: every regulation of that department) |
| `/subjects` | `name*`, `subjectType*`, `category*`, `semester*` (id), `subjectCode`, `choiceGroup`, `choiceGroupLabel`, `choiceRule`, `isActive` | `?semester=<id>`, `?subjectType=`, `?category=` |

All lists also accept `?isActive=true|false`, `?page=` (default 1) and `?limit=` (default 20, max 100). Without `isActive` the admin sees active and inactive records. Filters combine.

- **Validation:** types, lengths, enum values and ids are checked (`400` with `errors: [{ field, message }]`); unknown fields are rejected (a semester sent with the old `department` field is a `400`). `PUT` is a partial update: only the fields you send change, and `null` or a blank value clears the optional `code` / `description` of a university and the optional `subjectCode` of a subject.
- **Parents:** a referenced parent must exist (`400`, `"<Parent> not found"`) and be active (`409`) when a child is created, moved to another parent (`PUT` with a new parent id) or re-activated.
- **Duplicates (`409`):** university `code`; department `code` per university; regulation `name` per department; semester number per regulation; subject code per semester (only when a code is given; codes are case-insensitive: stored upper-case).
- **`DELETE` never removes data.** It sets `isActive=false` (`200`; repeating it is harmless). The record stays readable and can be re-activated with `PUT { "isActive": true }`.
- **Dependents:** a record with active children cannot be deactivated, by `DELETE` or by `PUT { "isActive": false }`: `409` "it still has N active ...". Nothing is cascaded; deactivate the children first (subject, semester, regulation, department, then university).
- **Records saved before Phase 1C** (a department without a level, a subject without type or category) stay readable and can be deactivated; an update only validates the fields it changes.
- Unknown record `404`; invalid id in the URL `400`.

Tests: `tests/academicAdmin.test.js` and `tests/academicSchema.test.js` run these APIs against an in-memory stand-in for the five models (`tests/helpers/fakeAcademicDb.js`, which enforces the real schemas, enums and unique indexes including the partial ones), so no database is needed.

## Subject choice groups (electives / conditional subjects)

Optional fields on a subject that mark it as one **alternative** of a group instead of a compulsory subject. Subjects without a group are completely unchanged (nothing is stored or returned for them).

| Field | Rules |
| ----- | ----- |
| `choiceGroup` | nullable; stable identifier, max 50 chars: letters, digits, `-`, `_`, no spaces; stored lower-case (e.g. `elective-1`) |
| `choiceGroupLabel` | nullable; student-friendly label, max 100 chars (e.g. `Elective I`) |
| `choiceRule` | `choose_one` or `choose_multiple`; defaults to `choose_one` when a `choiceGroup` is set |

- **Scope:** a group is `(semester, choiceGroup)`; the same identifier in another semester is a different group.
- **Consistency (`400` with per-field errors):** all **active** subjects of one group must share the same label (ignoring case and repeated spaces; "no label" is its own value) and the same rule (a missing rule counts as `choose_one`). A label or rule without a `choiceGroup` is rejected. Inactive subjects do not constrain a group, but re-activating or moving a subject re-checks it. The check is a read-then-write, not a database constraint, so two simultaneous requests could in theory both pass it.
- **Update (`PUT`):** `choiceGroup: null` removes the subject from its group and clears its label and rule. A lone member may change the whole group definition.
- **Bulk import:** records accept the same three optional fields. Non-duplicate records are checked against the group's stored subjects and earlier records of the same request; an inconsistent record is reported `invalid` (dry run) / `failed` (import) and the others still go through. Duplicates are skipped before this check and existing subjects are never changed. A dry run runs the same checks and writes nothing.
- **Student API:** `GET /api/academic/semesters/:semesterId/subjects` adds `choiceGroup`, `choiceGroupLabel` (`null` if none) and `choiceRule` to grouped subjects, and `data.choiceGroups: [{ choiceGroup, choiceGroupLabel, choiceRule, subjectIds }]` (empty array when there are none). Only active subjects appear, and the summary reflects any `?category=` / `?subjectType=` filter.
- **Existing data:** no migration needed; existing subjects keep their IDs and data and simply have no group.

Code: `models/Subject.js`, `utils/choiceGroups.js`, `services/academicService.js`, `services/academicImportService.js`, `services/studentAcademicService.js`. Tests: `tests/subjectChoiceGroups.test.js`.

## Academic subject bulk import (Part 1)

Admin-only endpoint to add many subjects at once to the **existing semesters** of one regulation. It is reusable for any department and regulation and ships **no syllabus data**: you supply the subjects in the request.

`POST /api/admin/academic-imports/subjects` (JWT + `admin` role: `401` without a token, `403` for students).

```json
{
  "departmentId": "VALID_DEPARTMENT_OBJECT_ID",
  "regulationId": "VALID_REGULATION_OBJECT_ID",
  "dryRun": true,
  "subjects": [
    { "semesterNumber": 1, "name": "Example Subject", "subjectCode": "SUB101", "subjectType": "theory", "category": "core" },
    { "semesterNumber": 1, "name": "Example Elective", "subjectCode": "ELE101", "subjectType": "theory", "category": "elective", "choiceGroup": "elective-1", "choiceGroupLabel": "Elective I", "choiceRule": "choose_one" }
  ]
}
```

- **`dryRun` defaults to `true`.** Nothing is written unless the request contains the JSON boolean `false` (the text `"false"` is rejected with `400`).
- **Request checks (whole request rejected):** `departmentId` / `regulationId` must be valid ids of existing records (`400`), the regulation must belong to the department (`400`), both must be active (`409`), unknown top-level fields (`400`), `subjects` must be a non-empty array of at most **200** records (`400`), and the body may not exceed **128 KB** (`413`).
- **Record checks (only that record is reported as invalid):** `semesterNumber` (1-8, and that semester must exist and be active under *that regulation*), `name` (required, max 150), optional `subjectCode` (max 20, stored trimmed and upper-case), `subjectType` and `category` (the existing enum lists). Unknown fields are rejected, including client-supplied semester ids: the semester is **always resolved on the server** from `regulationId` + `semesterNumber`, and a missing semester is never created.
- **Duplicates (always inside one semester; the same code in another semester is not a duplicate):** a record **with** a code is a duplicate when that semester already has the code (case-insensitive, inactive subjects included) or an earlier record of the same request used it. A record **without** a code is identified by its **name** (ignoring case and repeated spaces) against the semester's existing subjects and earlier records of the request.
- **Never destructive:** the only write is inserting a new subject. Existing subjects are never overwritten, changed or deactivated, and nothing else (universities, departments, regulations, semesters) is touched. Running the same import again therefore inserts nothing (`skipped` = every record).
- **Partial failures:** records are inserted one by one; one failing record never stops or rolls back the others. A duplicate-key error at insert time (another request created it first) is reported as `skipped`; any other error is `failed` with a generic reason (details go to the server log only).

Response (`200`, `success: true`). `results` has one entry per received record, in order (`index` starts at 0):

| Field | Dry run | Real import |
| ----- | ------- | ----------- |
| `dryRun`, `totalReceived` | as sent / count | as sent / count |
| `validRecords`, `newRecords`, `duplicates`, `invalidRecords` | preview of the analysis | the analysis that was done before writing |
| `imported` | always `0` | subjects actually inserted |
| `skipped` | duplicates that would be skipped | duplicates skipped (+ any lost insert race) |
| `failed` | invalid records | invalid records (+ any record that could not be saved) |
| `results[].status` | `new` / `duplicate` / `invalid` | `imported` / `skipped` / `failed` |

Each result also carries `semesterNumber`, `name`, `subjectCode`, and as applicable `errors: [{ field, message }]`, `reason`, `existingSubjectId` (+ `existingIsActive`), `duplicateOfIndex` or `subjectId` (the new subject).

Typical flow: send the payload with `dryRun` omitted, fix whatever is `invalid`, then send the same payload with `"dryRun": false`.

Code: `routes/adminRoutes.js` -> `controllers/academicImportController.js` -> `validators/academicImportValidators.js` + `services/academicImportService.js`. Tests: `tests/academicImport.test.js` (same in-memory model stand-in as the academic admin tests, no database needed).

## Student academic APIs

Read-only endpoints under `/api/academic` for any logged-in student (verified email) or admin. `401` without a valid JWT. Every method except `GET`/`HEAD` answers `405`: academic records can only be changed through the admin APIs, which students cannot use (`403`).

| Endpoint | Returns (sorted) |
| -------- | ---------------- |
| `GET /api/academic/universities` | `data.universities`: `_id`, `name`, `code`, `description` (alphabetical) |
| `GET /api/academic/universities/:universityId/departments[?level=UG|PG]` | `data.departments`: `_id`, `name`, `code`, `level`, `university` (alphabetical) |
| `GET /api/academic/departments/:departmentId/regulations` | `data.regulations`: `_id`, `name`, `department` (alphabetical) |
| `GET /api/academic/regulations/:regulationId/semesters` | `data.semesters`: `_id`, `semesterNumber`, `regulation`, `department` (by semester number) |
| `GET /api/academic/departments/:departmentId/semesters[?regulation=<id>]` | same payload, for every ACTIVE regulation of the department (existing route, kept for compatibility) |
| `GET /api/academic/semesters/:semesterId/subjects[?subjectType=&category=]` | `data.subjects`: `_id`, `name`, `subjectCode` (absent when the subject has none), `subjectType`, `category`, `semester`, plus `choiceGroup`, `choiceGroupLabel`, `choiceRule` for subjects in a choice group (alphabetical by name); `data.choiceGroups`: one summary per group (see *Subject choice groups*) |
| `GET /api/academic/official-question-paper-portal` | `data.portal`: `name`, `url`, `description` |

Each response also has `meta.total` (the portal one does not). Alphabetical sorting ignores letter case.

- **Active only:** inactive records are never returned (admins included; admins see everything through `/api/admin`). An inactive parent counts as missing.
- **Hierarchy:** a list is served only if its parent exists and every ancestor above it is active; children are always filtered by the id in the URL, so a record of another parent never appears. An empty list is a normal `200`. Semesters that still have no regulation (not migrated yet) are never returned.
- **Errors:** `400` invalid ObjectId or invalid filter value, `404` parent not found (`"University not found"`, `"Department not found"`, `"Regulation not found"`, `"Semester not found"`).
- **Official portal:** returns the fixed link `https://egovernance.unom.ac.in/qpregular/FrmStudDownloadQP.ASPX?IDE_REG=REG` ("University of Madras Official Question Paper Portal") for the frontend to open. The backend never fetches, scrapes, copies or stores anything from that site.

Tests: `tests/academicStudent.test.js` and `tests/academicSchema.test.js` (same in-memory model stand-in as the admin tests).

## Migrating existing academic data (to Phase 1C)

Only needed if your database already holds academic records created before Phase 1C (a fresh database needs nothing: just start the server). Before Phase 1C a semester pointed at a department and had no regulation; departments had no level; subjects had no type or category. The migration script moves this data to the new structure **without deleting or inventing anything**.

What it will and will not do:

- **Dry run by default.** `npm run migrate:academic` only prints a JSON report.
- **Nothing is guessed.** A department level (`UG`/`PG`) and a regulation name must come from you, per department or as one explicit value for all. Whatever you do not supply is listed in the report and left untouched.
- **Nothing is deleted.** Documents are only updated. The old `department` field of a semester is kept. Only the obsolete `department_1_semesterNumber_1` index of `semesters` is dropped (it would reject new semesters, which have no department).
- **Regulations** you name are created with `isActive` copied from the department (an existing regulation with that name is reused). Old semesters are attached to them; a semester whose number already exists in the target regulation is reported as a `conflict` and left alone.
- **Subjects** without a type or category are only reported (an admin fills them in with `PUT /api/admin/subjects/:id`). Blank-string subject codes are removed so they are not indexed as real codes.
- **Safe to repeat:** a second run changes nothing.

Procedure:

1. Back up the database (Atlas: take a snapshot, or `mongodump`).
2. Dry run and read the report: `npm run migrate:academic`
   (`needLevel` = departments without a level, `needRegulationName` = departments that still have old semesters, `orphaned` = semesters whose department no longer exists, `conflicts`, `missingTypeOrCategory`).
3. Prepare your choices. One value for everything: `--level UG --regulation "2023-2024"`. Different values per department: `--level-map levels.json --regulation-map regulations.json`, where each file is `{ "<departmentId>": "<value>" }` (department ids are in the report). For example, `levels.json`: `{ "64f0c1...": "UG", "64f0c2...": "PG" }` and `regulations.json`: `{ "64f0c1...": "2023-2024", "64f0c2...": "R2021" }`.
4. Dry run again with your options, then apply: `npm run migrate:academic -- --apply --level-map levels.json --regulation-map regulations.json`
   After the changes the script runs `syncIndexes` on the five academic collections so the new partial unique indexes exist.
5. Fix what the report still lists (usually subject type and category), then run it once more: `needsAttention` should be `false`.

Until a legacy semester is migrated it is invisible to the student APIs (it has no regulation) and does not block new semesters (the semester index is partial). Run the migration BEFORE creating new semesters, because the old unique index on `{ department, semesterNumber }` would otherwise reject a second new semester with the same number. `npm run sync:academic-indexes` remains available for index-only repairs.

Tests: `tests/academicMigration.test.js` (in-memory stand-in for the native collections; covers dry run, no guessing, no deletion, idempotence, conflicts, orphans and invalid options).

## NPM scripts

| Script               | What it does                                           |
| -------------------- | ------------------------------------------------------ |
| `npm run dev`        | Development: nodemon restarts the server on changes    |
| `npm start`          | Runs `node server.js` using the `.env` settings        |
| `npm run start:prod` | Production: forces `NODE_ENV=production` (Windows safe) |
| `npm test`           | Runs the automated tests in `tests/`                    |
| `npm run seed:admin` | One-time creation of the initial admin (see Roles and admin access) |
| `npm run sync:academic-indexes` | Index-only repair: make the academic collections' indexes match the schemas (never changes documents) |
| `npm run migrate:academic` | Migrate pre-Phase-1C academic data to regulations (dry run unless `--apply`, see Migrating existing academic data) |

## Environment variables

See `.env.example`. `MONGO_URI` and `JWT_SECRET` are required; the rest have safe defaults.

| Variable             | Default                 | Purpose                                      |
| -------------------- | ----------------------- | -------------------------------------------- |
| `NODE_ENV`           | `development`           | `development`, `production` or `test`        |
| `PORT`               | `5000`                  | HTTP port                                    |
| `MONGO_URI`          | none (required)         | MongoDB Atlas connection string              |
| `CORS_ORIGIN`        | `http://localhost:5173` | Comma-separated list of allowed frontend origins |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | none | Used only by `npm run seed:admin`; remove `ADMIN_PASSWORD` afterwards |
| `JWT_SECRET`         | none (required)         | JWT signing secret, at least 32 characters   |
| `JWT_EXPIRES_IN`     | `7d`                    | JWT lifetime (for example `7d`, `12h`)       |
| `BCRYPT_SALT_ROUNDS` | `10`                    | Password hashing cost (10 to 15)             |
| `RATE_LIMIT_WINDOW_MS` | `900000`              | Rate limit window (15 minutes)               |
| `RATE_LIMIT_MAX`     | `300`                   | Max requests per IP per window               |
| `PDF_TIMEOUT_MS`     | `60000`                 | Stop reading a PDF after this long           |
| `MAX_PDF_PAGES`      | `200`                   | Refuse PDFs with more pages                  |
| `OCR_TIMEOUT_MS`     | `90000`                 | Stop one OCR job after this long             |
| `OCR_MAX_QUEUE`      | `5`                     | Max OCR jobs waiting (then `503`)            |
| `OCR_LANG`           | `eng`                   | Tesseract language                           |
| `OCR_LANG_PATH`      | empty                   | Folder with an uncompressed `.traineddata` for offline OCR |
| `MAX_EXTRACTED_TEXT_CHARS` | `1000000`         | Extracted text longer than this is cut off   |
| `EXTRACT_LIMIT_MAX`  | `20`                    | Extract calls per student per 15 minutes     |
| `BREVO_SMTP_USER`    | empty                   | Brevo SMTP login (set together with the next two, or none) |
| `BREVO_SMTP_PASS`    | empty                   | Brevo SMTP key (secret)                      |
| `EMAIL_FROM_ADDRESS` | empty                   | Sender address verified in Brevo             |
| `EMAIL_FROM_NAME`    | `STUDYWISE AI`          | Sender display name                          |
| `BREVO_SMTP_HOST`    | `smtp-relay.brevo.com`  | Brevo SMTP server                            |
| `BREVO_SMTP_PORT`    | `587`                   | `587` (STARTTLS) or `465` (implicit TLS)     |
| `EMAIL_TIMEOUT_MS`   | `15000`                 | Stop waiting for the SMTP server after this long |
| `OTP_RESEND_COOLDOWN_SECONDS` | `60`           | Wait time before a new code can be requested (10 to 3600) |
| `OTP_RESEND_LIMIT_MAX` | `10`                  | Resend requests per IP per 15 minutes        |
| `OTP_MAX_ATTEMPTS`   | `5`                     | Wrong guesses allowed per code before it is locked (3 to 10) |
| `OTP_VERIFY_LIMIT_MAX` | `20`                  | verify-email requests per IP per 15 minutes  |
| `OTP_HASH_SECRET`    | empty                   | Optional 32+ character key for hashing codes (empty = derived from `JWT_SECRET`) |
| `GEMINI_API_KEY`     | empty                   | Gemini API key (needed for `/api/questions/ask`) |
| `GEMINI_MODEL`       | `gemini-3.8-flash`      | Gemini model name                            |
| `GEMINI_TIMEOUT_MS`  | `45000`                 | Stop waiting for Gemini after this long      |
| `GEMINI_MAX_OUTPUT_TOKENS` | `8192`            | Maximum length of the generated answer (includes thinking tokens) |
| `GEMINI_THINKING_LEVEL` | `low`                | `low`, `medium`, `high` (or `none` to not send it) |
| `MAX_QUESTIONS_PER_REQUEST` | `30`             | Most questions in one generation request or saved set (1 to 50) |
| `MAX_MATERIAL_CHARS_PER_REQUEST` | `120000` | Most characters of uploaded paper text sent to Gemini per generation request (5000 to 400000); over the limit the request is refused, never truncated |

Never commit `.env`. It is already listed in `.gitignore`.

## Troubleshooting

- **"npm.ps1 cannot be loaded because running scripts is disabled"** - run this once, then reopen the terminal:
  `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`
- **"MONGO_URI is not set" / "still contains <placeholders>"** - create `.env` (step 3) and put your real Atlas connection string in `MONGO_URI`.
- **"Authentication failed"** - check the database username and password; URL-encode special characters in the password.
- **"Could not reach the database"** - in Atlas **Network Access**, add your current IP address, and make sure the cluster is not paused.
- **"The cluster address could not be resolved"** - check the host part of `MONGO_URI` and your internet connection.
- **Registration works but no verification email arrives** - read the server log line `Brevo SMTP send failed: code=..., smtpResponse=..., CAUSE: ...`. `code=MODULE_NOT_FOUND` means `nodemailer` is not installed: run `npm install` and restart. `EAUTH` = wrong SMTP login/key; `EENVELOPE`/`550` = `EMAIL_FROM_ADDRESS` is not a verified Brevo sender; `ECONNECTION`/`ETIMEDOUT` = network, firewall or port problem. The log never contains the SMTP key, the code or the recipient, and the API answer stays generic.
- **"Port 5000 is already in use"** - change `PORT` in `.env`, or stop the other program using that port.
- **"Configuration problem(s) found"** - the message says which `.env` value is invalid (for example a non-numeric `PORT`).
- **"'cross-env' is not recognized"** - run `npm install` again.
- **Engine / version errors during `npm install`** - upgrade Node.js to 20.19 or newer.

## Creating a ZIP of this project (PowerShell)

Run from the folder that contains `studywise-ai-backend`. This excludes `node_modules`, `.env` and uploaded PDFs:

```powershell
$stage = Join-Path $env:TEMP 'studywise-zip-stage'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
robocopy .\studywise-ai-backend "$stage\studywise-ai-backend" /E /XD node_modules /XF .env *.pdf | Out-Null
Compress-Archive -Path "$stage\studywise-ai-backend" -DestinationPath .\STUDYWISE-AI-Day1-Backend.zip -Force
Remove-Item $stage -Recurse -Force
```

## Next steps

1. Phase 1 (not started).
2. Subjects and further AI features (not started).
