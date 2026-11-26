# AI question generation API (Phase 2E, updated for Phase 3C-1 and Phase 3C-2)

Endpoints covered: `POST /api/questions/important` (generate), `POST /api/saved-question-sets` (save),
`GET /api/saved-question-sets/:id` (owner view) and `GET /api/shared/question-sets/:token` (public view).
Every other endpoint, including `POST /api/questions/ask` and `POST /api/questions/ask/stream`, is unchanged.

Authentication: `Authorization: Bearer <JWT>` (verified email) on everything except the public shared view.
Success responses are `{ success: true, message, data, meta? }`. Errors are `{ success: false, message, errors? }` with
`errors: [{ field, message }]` for validation problems. No API key, Gemini message or stack trace is ever returned.

**Phase 3C-1: syllabus management removed.** The server stores no syllabus units or topics, and the former syllabus-unit
admin, student and import endpoints no longer exist. `unit` and `topic` on saved question sets remain optional text fields
for backward compatibility, and existing saved sets are unchanged.

**Phase 3C-2: questions come only from uploaded material.** `POST /api/questions/important` now takes `paperIds` (1 to 3
of the student's own uploaded papers whose text extraction has completed) and generates questions **only** from the text
extracted from those PDFs / images. The old client-supplied `units` and `topics` are no longer a content source: sending
either one is a `400`. The response reports `"basis": "uploaded_material"` and any extraction warnings. Difficulty, question
types, marks, question count, saved sets, history and sharing are unchanged.

---

## Two-stage generation (questions first, answers on request)

`POST /api/questions/important` (section 1) now generates **questions only**. It never returns `correctAnswer`, `explanation` or `answerPoints` (an MCQ shows its four options); anything of that kind the AI adds is discarded. The questions are stored for the signed-in student and the response carries `data.generationId`, `data.answersGenerated: false` and a `questionId` on every question. Everything else in section 1 (validation, question types, marks, difficulty, history, quality report) is unchanged.

### 1b. Generate answers for selected questions

`POST /api/questions/important/:generationId/answers` (JWT required, verified email)

```json
{ "questionIds": ["664f1a2b3c4d5e6f7a8b9c11", "664f1a2b3c4d5e6f7a8b9c12"] }
```

- `questionIds`: required, 1 to `MAX_QUESTIONS_PER_REQUEST` distinct ObjectIds taken from stage 1. Other fields are rejected (`400`).
- Ownership: the set is looked up by id AND the signed-in student. Another student's set and a missing set give the same `404 Generated question set not found`. A `questionId` that is not in that set gives `404 Question not found` (with `errors[].field` such as `questionIds[1]`) and nothing is sent to the AI.
- The academic records are checked again (active, consistent, University of Madras / 2023-2024 / BCA or B.Sc. Computer Science).
- Source material: the papers the set was generated from are loaded again with the same rules as stage 1 (must still belong to the student, completed extraction, enough text, within `MAX_MATERIAL_CHARS_PER_REQUEST`): `404` / `409` / `422`. Answers are written only from that text.
- Questions that already have an answer are returned as stored, without a new AI call.

Example response (`200`, shortened):

```json
{
  "success": true,
  "message": "Answers generated successfully",
  "data": {
    "generationId": "664f1a2b3c4d5e6f7a8b9c0d",
    "stage": "answers",
    "basis": "uploaded_material",
    "questions": [
      { "questionId": "664f1a2b3c4d5e6f7a8b9c11", "questionType": "mcq", "marks": 2, "difficulty": "medium",
        "question": "Which data structure follows the LIFO principle?", "unit": null, "topic": null,
        "options": [{ "label": "A", "text": "Queue" }, { "label": "B", "text": "Stack" }, { "label": "C", "text": "Binary tree" }, { "label": "D", "text": "Hash table" }],
        "correctAnswer": "B", "explanation": "A stack removes the most recently added element first (last in, first out)." },
      { "questionId": "664f1a2b3c4d5e6f7a8b9c12", "questionType": "essay", "marks": 10, "difficulty": "hard",
        "question": "Discuss hashing in detail, comparing chaining and open addressing.", "unit": null, "topic": null,
        "answerPoints": ["Hash function and table", "Why collisions occur", "Chaining", "Open addressing", "Comparison"] }
    ],
    "disclaimer": "..."
  },
  "meta": { "requested": 2, "generated": 2, "alreadyAnswered": 0, "unanswered": [], "generationMs": 5120, "material": { "papers": 1, "characters": 8450, "maxCharacters": 120000 }, "extractionWarnings": [], "warnings": [] }
}
```

`meta.unanswered` lists the `questionId`s the AI could not answer from the material (or whose answer failed validation); request them again to retry. If no valid answer at all can be produced the response is `502`. An MCQ answer must name one of the stored options. Answer keys are returned only to the owner; the public shared view never contains them.

A stage 1 or stage 2 question object can be saved as it is with `POST /api/saved-question-sets` (`questionId` is accepted and ignored). An MCQ may be saved without its answer key; if `correctAnswer` or `explanation` is sent, both are required.

Stored generated sets expire automatically after 30 days; saved sets are the long-term history.

## 1. Generate questions

`POST /api/questions/important`

### Request body

| Field | Required | Rules |
| ----- | -------- | ----- |
| `subjectId`, `semesterId`, `regulationId` | yes | ObjectIds. The subject must belong to the semester and the semester to the regulation. Scope: University of Madras, regulation 2023-2024, BCA or B.Sc. Computer Science |
| `paperIds` | yes | Array of 1 to 3 different paper ids (ObjectIds) from `POST /api/papers/upload`. Each paper must belong to the signed-in student and have `extractionStatus: "completed"` (`POST /api/papers/:paperId/extract`). Order is kept. This is the only source of question content |
| `questionTypes` | yes | 1-6 of `mcq`, `short_answer`, `essay` (Phase 2E formats) and `paragraph`, `long_answer`, `problem_solving` (earlier types, still accepted). Case-insensitive, so `"MCQ"` works |
| `marksDistribution` | yes | 1-8 entries `{ "marks": 2 \| 5 \| 10 \| 15, "count": 1-<limit>, "questionType"?: <one of questionTypes> }` |
| `difficulty` | no | `easy`, `medium`, `hard` (every question at that level) or `balanced` (a mix of all three; `mixed` is accepted as an alias). Default `balanced` |
| `questionCount` | no | Must equal the total of `marksDistribution` |
| ~~`units`~~, ~~`topics`~~ | removed | No longer accepted. Sending either returns `400` with `"units is no longer supported. Questions are generated only from your uploaded papers: send paperIds instead"` |

**Distribution rules (all enforced with a `400` and per-field errors)**

- Allowed marks are exactly `2`, `5`, `10`, `15`.
- `mcq` can only be asked for 2 marks. `essay` can only be asked for 10 or 15 marks. The other types fit any supported marks.
- An entry without `questionType` may use any selected type that suits its marks (the AI chooses a sensible mix); it needs at least one such type.
- The same marks value may be listed twice only when both entries name a different `questionType`
  (for example 3 MCQs and 2 short answers, both for 2 marks).
- The total number of questions may not exceed the server limit `MAX_QUESTIONS_PER_REQUEST` (default 30, at most 50). The same limit applies to a saved set.
- Unknown fields, control characters and line breaks are rejected.

**Difficulty.** With a single level, every returned question must carry that level (others are discarded and reported).
With `balanced`, the server plans the mix (cycling medium, easy, hard, so the three levels never differ by more than one
question) and tells the model how many of each level every marks line needs. The model labels each question; the label
counts are checked and reported in `meta`.

### Example request

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

### Example response (`200`)

```json
{
  "success": true,
  "message": "Important questions generated successfully",
  "data": {
    "subject": { "_id": "665f...a01", "name": "Data Structures", "subjectCode": "BCA101", "subjectType": "theory", "category": "core" },
    "academic": {
      "university": { "_id": "...", "name": "University of Madras" },
      "department": { "_id": "...", "name": "BCA", "code": "BCA", "level": "UG" },
      "regulation": { "_id": "...", "name": "2023-2024" },
      "semester": { "_id": "...", "semesterNumber": 1 }
    },
    "basis": "uploaded_material",
    "difficulty": "balanced",
    "papers": [
      { "paperId": "665f2a7b9c1d2e3f4a5b6c01", "originalName": "ds-model-paper.pdf", "fileType": "pdf", "extractionMethod": "pdf-text", "pageCount": 4, "characters": 6120 },
      { "paperId": "665f2a7b9c1d2e3f4a5b6c02", "originalName": "unit2-notes.jpg", "fileType": "image", "extractionMethod": "ocr", "pageCount": 1, "characters": 1840 }
    ],
    "groups": [
      {
        "questionType": "mcq",
        "marks": 2,
        "questions": [
          {
            "questionType": "mcq",
            "marks": 2,
            "difficulty": "medium",
            "question": "Which data structure follows the LIFO principle?",
            "unit": null,
            "topic": null,
            "options": [
              { "label": "A", "text": "Queue" },
              { "label": "B", "text": "Stack" },
              { "label": "C", "text": "Binary tree" },
              { "label": "D", "text": "Hash table" }
            ],
            "correctAnswer": "B",
            "explanation": "A stack removes the most recently added element first (last in, first out); a queue is first in, first out."
          },
          {
            "questionType": "mcq",
            "marks": 2,
            "difficulty": "easy",
            "question": "Which operation adds an element to the top of a stack?",
            "unit": null,
            "topic": null,
            "options": [
              { "label": "A", "text": "pop" },
              { "label": "B", "text": "peek" },
              { "label": "C", "text": "push" },
              { "label": "D", "text": "enqueue" }
            ],
            "correctAnswer": "C",
            "explanation": "push inserts onto the top; pop removes the top element and peek only reads it."
          }
        ]
      },
      {
        "questionType": "short_answer",
        "marks": 5,
        "questions": [
          {
            "questionType": "short_answer",
            "marks": 5,
            "difficulty": "hard",
            "question": "Differentiate between a circular queue and a linear queue, stating the problem a circular queue solves.",
            "unit": null,
            "topic": null,
            "answerPoints": [
              "A linear queue cannot reuse freed slots at the front once the rear reaches the end",
              "A circular queue wraps the rear around to the front using modulo arithmetic",
              "Full and empty conditions differ between the two",
              "Circular queues use array space efficiently"
            ]
          }
        ]
      },
      {
        "questionType": "essay",
        "marks": 10,
        "questions": [
          {
            "questionType": "essay",
            "marks": 10,
            "difficulty": "medium",
            "question": "Discuss hashing in detail, comparing chaining and open addressing for collision resolution.",
            "unit": null,
            "topic": null,
            "answerPoints": [
              "Definition of hash function and hash table",
              "Why collisions occur",
              "Separate chaining with a small example",
              "Open addressing: linear probing, quadratic probing, double hashing",
              "Load factor and its effect on performance",
              "Comparison and conclusion"
            ]
          }
        ]
      }
    ],
    "disclaimer": "AI-generated practice questions based only on the papers you uploaded. They are not taken from the official syllabus or from previous question papers, and there is no guarantee that any of them will appear in an examination. Text read from uploads can contain mistakes. Answers, options and explanations are AI-generated study aids: check them against your textbooks and notes."
  },
  "meta": {
    "requested": 4,
    "generated": 4,
    "shortfall": 0,
    "duplicatesRemoved": 0,
    "generationMs": 5120,
    "distributionSatisfied": true,
    "unmet": [],
    "difficulty": "balanced",
    "difficultyMatched": true,
    "difficultyBreakdown": {
      "requested": { "easy": 1, "medium": 2, "hard": 1 },
      "generated": { "easy": 1, "medium": 2, "hard": 1 }
    },
    "rejectedItems": 0,
    "rejectionReasons": {},
    "warnings": [],
    "material": { "papers": 2, "characters": 7960, "maxCharacters": 120000 },
    "extractionWarnings": [
      {
        "paperId": "665f2a7b9c1d2e3f4a5b6c02",
        "originalName": "unit2-notes.jpg",
        "warnings": ["The image was hard to read, so some text may be wrong. A clearer photo or scan gives better results."]
      }
    ]
  }
}
```

### Question fields

| Field | Present on | Meaning |
| ----- | ---------- | ------- |
| `questionType`, `marks`, `difficulty`, `question` | every question | `difficulty` is `easy`, `medium` or `hard` |
| `unit`, `topic` | every question | Always `null` for generated questions (kept so the shape matches saved sets, where they remain optional text) |
| `options` | `mcq` | Exactly four `{ label: "A".."D", text }` |
| `correctAnswer`, `explanation` | `mcq` | The correct label and why it is correct |
| `answerPoints` | every other type | 1-8 short points an answer should contain (guidance, not a full answer) |

Each question repeats its own `questionType` and `marks`, so the questions can be flattened out of `groups` and sent to
the save endpoint exactly as they are.

**Answer keys.** `correctAnswer`, `explanation` and `answerPoints` are returned only to the authenticated student who
generated or saved the questions. They are never part of the public shared view (section 3).

### Reporting an unmet request

A partly usable AI answer is not an error. The valid questions are returned with status `200` and `meta` says exactly what
is missing:

| `meta` field | Meaning |
| ------------ | ------- |
| `requested`, `generated`, `shortfall` | Totals |
| `distributionSatisfied` | `true` only when every marks / type line has all of its questions |
| `unmet` | `[{ marks, questionType, requested, generated }]` for each line that fell short (`questionType` is `null` for a flexible line) |
| `difficulty`, `difficultyBreakdown` | The requested mode and the requested / generated count per level |
| `difficultyMatched` | For `balanced`: `false` when a level is off by more than one question |
| `duplicatesRemoved` | Repeated or very similar questions removed |
| `rejectedItems`, `rejectionReasons` | Items discarded, by reason (see below) |
| `material` | `{ papers, characters, maxCharacters }`: how many papers and characters of text were sent to the AI, and the server limit |
| `extractionWarnings` | `[{ paperId, originalName, warnings: [...] }]` for each selected paper whose extraction had warnings (blank pages, low OCR confidence, rotated image, text cut off when it was saved). Empty array when there are none. Questions only reflect text that was actually extracted, so heed these |
| `warnings` | Human-readable sentences, for example `Only 2 of the 3 requested questions could be produced. Missing: 1 x 2-mark question. Try again to fill the gap.` |

Example of a shortfall (`difficulty: "easy"`, 3 questions asked, one came back as medium):

```json
"meta": {
  "requested": 3, "generated": 2, "shortfall": 1, "duplicatesRemoved": 0, "generationMs": 3900,
  "distributionSatisfied": false,
  "unmet": [{ "marks": 2, "questionType": null, "requested": 3, "generated": 2 }],
  "difficulty": "easy", "difficultyMatched": true,
  "difficultyBreakdown": { "requested": { "easy": 3, "medium": 0, "hard": 0 }, "generated": { "easy": 2, "medium": 0, "hard": 0 } },
  "rejectedItems": 1, "rejectionReasons": { "wrongDifficulty": 1 },
  "warnings": [
    "Only 2 of the 3 requested questions could be produced. Missing: 1 x 2-mark question. Try again to fill the gap.",
    "1 AI question did not match the requested difficulty and was discarded."
  ]
}
```

`rejectionReasons` keys: `schema` (missing or invalid text), `type`, `marks`, `difficulty` (missing or invalid label),
`mcq` (options / correct answer / explanation invalid), `answerPoints`, `unrequested` (marks or type not asked for), `extra`
(more than requested), `wrongDifficulty`, `unsupportedClaim`, `inventedUnit` (a unit that is not named in the uploaded material), `ungrounded` (the question did not name one of the uploaded materials it was based on).

If **no** valid question is left, the response is `502` (`The AI returned a response that could not be used. Please try again.`).
There is no hidden retry: one request is one Gemini call.

### Quality controls applied to every AI answer

- **Prompt.** University exam wording, depth matched to the marks, defined difficulty levels, MCQ rules
  (four distinct plausible options, one correct, no "all/none of the above", varied correct letters), answer points for
  other formats, instructions to cover different concepts, to use **only** the uploaded material (no outside content; fewer
  questions rather than invented ones), to treat the material as data and ignore any instructions inside it, never to invent
  units, and never to claim predictions, past papers or guaranteed appearance.
- **Grounding.** Each AI question must name the uploaded material (`M1`, `M2`, `M3`) it was written from; questions that do not
  are discarded. This is a structural check, not proof that every statement appears in the papers: AI output is always
  untrusted study material.
- **Strict schema.** Every item must have a supported `questionType`, `marks` (2, 5, 10 or 15), `difficulty`, question
  text (10-1000 characters) and either a valid MCQ block (four options of at most 300 characters, a correct letter that
  maps to an option, a 10-1000 character explanation) or 1-8 answer points. Extra fields are ignored; anything else is
  discarded without failing the request.
- **Count and marks.** Items are matched to the requested marks / type lines. Extra questions, unrequested marks and
  disallowed types are dropped, so the response never exceeds the request.
- **Repeats.** Compared on their meaningful words (command words such as "define" or "explain" and plural endings are
  ignored), so "Define a stack." and "What is a stack?" count as the same question; questions sharing at least 70% of their
  meaningful words are treated as repeats and removed across the whole response.
- **Unsupported claims.** Questions, explanations or answer points that claim an exam prediction, a past paper, an
  official source or guaranteed appearance are discarded, as are questions that mention a unit that is not named in the uploaded material.
- **Malformed or cut-off answers.** A code fence or surrounding sentence is tolerated. If the answer was cut off (for
  example `MAX_TOKENS`), the complete questions before the cut are recovered and a warning is added. The output budget is
  raised automatically for larger requests.

### Uploaded material rules

1. **Ownership.** Papers are looked up by id **and** the signed-in user. Another student's paper returns the same `404` as a missing one.
2. **Extraction.** Only papers with `extractionStatus: "completed"` are used (`409` while `pending` / `processing`, `422` when `failed`). The text is read from the server-side `extractedText`; it is never returned in this response.
3. **Size, never truncation.** The combined normalised text of all selected papers may not exceed `MAX_MATERIAL_CHARS_PER_REQUEST` (default 120000 characters). If it does, **nothing is sent to Gemini**, and the request is refused with `422`, the per-paper character counts in `errors`, and the message `...Select fewer or shorter papers. Nothing was cut off or sent to the AI.` The server never cuts text to make it fit. (Text that was already cut off when the paper was extracted, because it exceeded `MAX_EXTRACTED_TEXT_CHARS`, is reported in `meta.extractionWarnings`.)
4. **Normalisation.** Page breaks become blank lines and control characters are removed; no words are dropped.
5. **Timeout.** Gemini handling is unchanged: the existing `GEMINI_TIMEOUT_MS` (default 45 s) applies, and a timeout is a `504`. If students regularly select large papers, raise `GEMINI_TIMEOUT_MS`.
6. **Order of checks.** Input validation, then academic references (`404` / `400`), then papers (`404` / `409` / `422`), then the Gemini call.

Example (`422`, too much text):

```json
{
  "success": false,
  "message": "The selected papers contain 131204 characters of text, which is over the limit of 120000 characters per request. Select fewer or shorter papers. Nothing was cut off or sent to the AI.",
  "errors": [
    { "field": "paperIds[0]", "message": "98000 characters" },
    { "field": "paperIds[1]", "message": "33204 characters" }
  ]
}
```

### Errors

| Status | When |
| ------ | ---- |
| `400` | Invalid or missing input (including a missing / empty `paperIds`, more than 3 papers, a repeated or malformed paper id, or the removed `units` / `topics` fields), including an unsupported marks value, a format that does not fit its marks, an unknown difficulty, a total above the limit; subject outside the semester / regulation or outside the supported scope |
| `401` / `403` | No or invalid token / email not verified |
| `404` | Subject, semester or regulation missing or inactive; a paper that does not exist **or belongs to another student** (`Paper not found`, with `errors[].field` such as `paperIds[1]`; the two cases are indistinguishable) |
| `409` | A selected paper's extraction is still `pending` or `processing` |
| `422` | A selected paper's extraction `failed`; a paper has too little readable text (under 100 characters); the combined text is over the limit (see below); Gemini blocked the request or returned no text |
| `502` | Gemini failed or was unreachable, or its answer had no usable question |
| `503` | AI service not configured, key rejected or quota reached |
| `504` | Gemini timeout (`GEMINI_TIMEOUT_MS`) |

Example validation error (`400`):

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "marksDistribution[0].questionType", "message": "mcq questions can only be requested for 2 marks" },
    { "field": "marksDistribution[1].marks", "message": "Marks must be one of: 2, 5, 10, 15" },
    { "field": "difficulty", "message": "difficulty must be one of: easy, medium, hard (one level for every question) or balanced (a mix of all three)" }
  ]
}
```

---

## 2. Save a set (owner)

`POST /api/saved-question-sets`

The `questions` array accepts what the generator returned. New optional fields on a question:

| Field | Rules |
| ----- | ----- |
| `questionType` | `mcq`, `short_answer`, `essay`, `paragraph`, `long_answer` or `problem_solving` |
| `marks` | Whole number 1-20 (unchanged, so sets saved before Phase 2E stay valid) |
| `difficulty` | Optional, `easy`, `medium` or `hard` |
| `options`, `correctAnswer`, `explanation` | Required for `mcq` (four options labelled A, B, C, D in order, different from each other; a label A-D; 10-1000 characters); not allowed for other types |
| `answerPoints` | Optional for non-`mcq` types: 1-8 texts of 3-300 characters; not allowed for `mcq` |

A question without any of the new fields (the Phase 2B shape) is saved exactly as before. The request body limit is now
400 KB (it was 100 KB) because answer keys make questions larger. A set still holds at most `MAX_QUESTIONS_PER_REQUEST` questions.

Example request body:

```json
{
  "title": "Data Structures - hashing and stacks",
  "subjectId": "665f1c2e8a1b2c3d4e5f6a01",
  "semesterId": "665f1c2e8a1b2c3d4e5f6a02",
  "regulationId": "665f1c2e8a1b2c3d4e5f6a03",
  "questions": [
    {
      "questionType": "mcq", "marks": 2, "difficulty": "medium",
      "question": "Which data structure follows the LIFO principle?",
      "unit": "Unit 2", "topic": "Stacks",
      "options": [
        { "label": "A", "text": "Queue" }, { "label": "B", "text": "Stack" },
        { "label": "C", "text": "Binary tree" }, { "label": "D", "text": "Hash table" }
      ],
      "correctAnswer": "B",
      "explanation": "A stack removes the most recently added element first."
    },
    {
      "questionType": "essay", "marks": 10, "difficulty": "medium",
      "question": "Discuss hashing in detail, comparing chaining and open addressing for collision resolution.",
      "unit": "Unit 2", "topic": "Hashing",
      "answerPoints": ["Hash function and table", "Why collisions occur", "Chaining", "Open addressing", "Load factor", "Comparison"]
    }
  ]
}
```

The `201` response, `GET /api/saved-question-sets/:id` and the history list keep their existing shapes. For the owner, each
question in a set read by id includes `difficulty`, `options`, `correctAnswer`, `explanation` and `answerPoints` whenever they were
stored. Sets saved before Phase 2E have none of these keys and read exactly as before.

---

## 3. Public shared view

`GET /api/shared/question-sets/:token` (no login) is unchanged except that Phase 2E questions may include `difficulty`
and, for MCQs, `options`. **No answer key is ever returned here:** no `correctAnswer`, no `explanation`, no `answerPoints`.

```json
{
  "success": true,
  "message": "Shared question set retrieved successfully",
  "data": {
    "title": "Data Structures - hashing and stacks",
    "questionCount": 2,
    "subject": { "name": "Data Structures", "subjectCode": "BCA101", "subjectType": "theory", "category": "core" },
    "semester": { "semesterNumber": 1 },
    "regulation": { "name": "2023-2024" },
    "department": { "name": "BCA", "code": "BCA", "level": "UG" },
    "questions": [
      {
        "questionType": "mcq", "marks": 2, "question": "Which data structure follows the LIFO principle?",
        "unit": "Unit 2", "topic": "Stacks", "difficulty": "medium",
        "options": [
          { "label": "A", "text": "Queue" }, { "label": "B", "text": "Stack" },
          { "label": "C", "text": "Binary tree" }, { "label": "D", "text": "Hash table" }
        ]
      },
      {
        "questionType": "essay", "marks": 10,
        "question": "Discuss hashing in detail, comparing chaining and open addressing for collision resolution.",
        "unit": "Unit 2", "topic": "Hashing", "difficulty": "medium"
      }
    ],
    "sharedAt": "2026-11-23T10:15:00.000Z"
  }
}
```

---

## 4. Configuration

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `MAX_QUESTIONS_PER_REQUEST` | `30` | Server-enforced maximum number of questions in one generation request and in one saved set (whole number 1-50). An invalid value stops the server at start-up with a clear message |
| `MAX_MATERIAL_CHARS_PER_REQUEST` | `120000` | Most characters of uploaded paper text (all selected papers together) sent to Gemini in one request (whole number 5000-400000). Over the limit the request is refused, never truncated. An invalid value stops the server at start-up |
| `GEMINI_MAX_OUTPUT_TOKENS` | `8192` | Minimum output budget. Question generation raises it automatically to roughly `1500 + 450 x questions` (at most 24576) when that is larger |

Existing environment variables are unchanged.

## 5. Compatibility notes

- Endpoints, paths, authentication and the `{ success, message, data, meta }` envelope are unchanged. `/api/questions/ask` and `/api/questions/ask/stream` are untouched.
- Earlier question types (`paragraph`, `long_answer`, `problem_solving`) are still accepted for generation and saving.
- Stored question sets need no migration. New fields are optional in the schema and are left out of responses when absent.
- Deliberate tightening for generation requests: marks must now be 2, 5, 10 or 15 (before: any whole number 1-20), the per-entry count is capped only by the total limit (before: 10), and each AI question must include `difficulty` plus an answer key (otherwise it is discarded). Saved sets still accept marks 1-20.
- Responses gain fields (`data.difficulty`, per-question `questionType`, `marks`, `difficulty`, `answerPoints` / MCQ fields, and the extra `meta` fields). Existing clients that ignore unknown fields keep working.
- **Phase 3C-2 (breaking for generation requests only):** `paperIds` (1-3) is now required, and `units` / `topics` are rejected with `400`. In the response, `basis` is `"uploaded_material"` (the values `supplied_topics` and `subject_name_only` no longer occur), `data.units` / `data.topics` are replaced by `data.papers`, generated questions carry `unit: null` and `topic: null`, and `meta` gains `material` and `extractionWarnings`. Saved sets, history and sharing endpoints, stored question sets, papers and every other collection are untouched; no migration is needed.
- Paper records gain an optional internal `extractionWarnings` field, filled by new extractions only. It is never returned by the paper endpoints. Papers extracted earlier still work: their warnings are derived from the saved text, confidence and page data (the image-rotation notice cannot be recovered).
