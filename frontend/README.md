# NO_ARREAR – Frontend

React + Vite frontend (plain CSS, React Router, Axios).

```bash
npm install
cp .env.example .env   # set VITE_API_URL to your backend, e.g. http://localhost:5000/api
npm run dev
```

## Routes
| Path | Access | Page |
|---|---|---|
| `/` | public | Landing |
| `/register`, `/login` | guests only | Registration (university → course → department dropdowns, Semester 1–6) / login |
| `/verify-email` | public | 6-digit email OTP |
| `/profile` | logged-in only | Students: My Information (profile, course, department, semester). Admins: own account details only |
| `/dashboard` | logged-in only | Students: overview (welcome, profile, course/department/semester). Admins: admin overview (live department/subject totals, shortcuts, own profile) |
| `/academics` | logged-in only | Academic selection + subjects, loaded from `/api/academic/*` |
| `/materials` | logged-in only | Study materials: upload, view, edit, delete, download. Students manage only their own; admins manage all |
| `/generate-questions` | logged-in only | AI question generation (Phase 5.1): academic selection → uploaded papers → question settings → generated questions (no answers) |
| `/saved-questions` | logged-in only | Saved questions: the student's saved sets (manual and generated from papers) with search, sort, pagination, a view dialog with answers and delete with confirmation. "Save question set" buttons sit under the generated and typed questions on `/generate-questions` |
| `/components` | admin only (role-checked, others redirected to `/dashboard`) | UI component showcase |

## Study materials API (backend `/api/papers`)
`GET /` (page, limit, search, materialType, sort, admin-only uploadedBy) · `POST /upload` (multipart: `file`, optional `title`, `description`, `materialType`) ·
`GET /:id` · `PATCH /:id` · `DELETE /:id` · `GET /:id/file[?download=true]`.
Ownership is enforced by the backend (a student asking for someone else's material gets 404); the frontend only shows what it returns.
Files are fetched as blobs through Axios because the token travels in the `Authorization` header (plain links cannot send it).
Allowed types: PDF, JPG, PNG up to 10 MB. The type list lives in `src/utils/materials.js` (`MATERIAL_TYPES`) and must match the
backend's `utils/paperMetadata.js`. Sharing links are not implemented yet.

## Saved questions API (backend `/api/saved-question-sets`)
`POST /` (subjectId, semesterId, regulationId, title, questions) · `GET /` (page, limit, q, sort=newest|oldest) · `GET /:id` · `DELETE /:id`.
All routes are scoped to the signed-in student by the backend (someone else's set answers 404). A list item has no questions; the single set
has them, with options, MCQ key, explanation and `answerPoints` when stored. Code: `services/savedQuestionService.js`, `utils/savedQuestions.js`,
`hooks/useSavedSets.js`, `hooks/useSetSources.js`, `components/saved/`, `pages/SavedQuestions.jsx`.

**Manual vs generated:** the backend stores no origin on a saved set. The frontend records it in this browser when it saves a set and,
for other sets, works it out by opening them quietly (generated questions always have a difficulty, typed ones never do). If the backend
ever adds a `source` field, only `readBackendSource` in `utils/savedQuestions.js` needs to change. Search covers the title only, and
sorting is by date only, because that is all the backend offers.

## Auth API (backend `/api/auth`)
`POST /register` · `POST /verify-email` · `POST /resend-otp` · `POST /login` · `GET /profile`

## Structure
```
src/
  components/ ui/ layout/ landing/ auth/ materials/ questions/ saved/
  context/    AuthContext, AuthProvider
  hooks/      useAuth, useForm
  pages/      Landing, Login, Register, VerifyEmail, Dashboard, Materials, Home, NotFound
  routes/     AppRoutes, ProtectedRoute (+ GuestRoute)
  services/   api.js (Axios), authService.js, authStorage.js, materialService.js
  styles/     variables, base, layout, components, pages, landing, auth
  utils/      validation, errors
```

## Registration dropdowns
`/api/academic/*` requires a logged-in, verified user, so registration reads its options from
`src/services/academicCatalog.js` (University of Madras → BCA / B.Sc.; Semester 1–6).
Department is derived from the course and read-only: BCA → "Computer Applications",
B.Sc. → "Computer Science". Changing the course resets the semester.
The API receives `course`, `department` (names, not IDs) and `semester` as a number.
Replace the functions in that file with API calls if a public academic endpoint is added.

## Academics (Phase 3)
`services/academicService.js` calls the backend's read-only `/api/academic/*` routes (universities → departments →
regulations → semesters → subjects). Courses are `BCA` and `B.Sc.`, mapped by name to the departments
"Computer Applications" and "Computer Science" in the API response (`utils/academic.js`); no IDs or academic
records are hardcoded. Semesters are limited to 1–6.

## Semester handling (single source of truth)

- `src/utils/semester.js` decides the current semester: a locally saved change the server hasn't confirmed wins, otherwise the server profile value. No hardcoded default.
- `AuthProvider.updateSemester(n)` updates every view instantly (dashboard, sidebar, profile, academics), calls `PUT /auth/profile { semester }`, and stores the choice per user in `localStorage` (`noarrear_semester:<userId>`), so refresh and re-login keep it. A pending change is re-sent on the next profile load.
- Backend requirement: the profile-update route could not be verified from the frontend. If `PUT /auth/profile` does not exist or accepts a different payload, change `updateProfile` in `src/services/authService.js`. Until the backend persists it, the value is saved on this device only.
- Tests: `npm test`.

## Course / department handling
- `utils/academic.js › withAcademicProfile` gives every view separate `course` and `department` strings (object values are read by `name`; a department that is missing or just a copy of the course is taken from the course mapping).
- Changing the course in Academics calls `AuthProvider.updateAcademics`, which updates the dashboard/profile at once, sends `PUT /auth/profile { course, department }`, and remembers the choice per user (`noarrear_academic:<userId>`) until the server confirms it, so refresh and re-login keep it.

## Admin overview – data sources
Departments and subjects are counted live from `/api/academic/*`. **Total students** and **Total courses** show "Unavailable"
because no existing endpoint provides them; they need an admin-only backend endpoint (e.g. `GET /api/admin/stats`).

## AI question generation (Phase 5.1)
Page `/generate-questions` (`pages/GenerateQuestions.jsx`) calls the existing backend `POST /api/questions/important`
(`services/questionService.js`, 180 s timeout because the model needs time). Request body, exactly:
`{ subjectId, semesterId, regulationId, paperIds, questionTypes, marksDistribution: [{ marks, count }], difficulty, questionCount }`.

- **Academic details**: not chosen on this page. The existing `useAcademicSelection` hook supplies the selection made in Academics (University, Course, Regulation, and the saved profile Semester); the page shows it read-only with a "Change in Academics" link, and only asks for the **Subject** of that semester (the backend requires `subjectId`).
- **Papers**: the student's uploads from `GET /api/papers` (same list as Study materials). The newest eligible papers are **preselected automatically** (at most 3, the backend limit); the person can change the selection, and "Use automatic selection" restores it. At least one paper is required. A paper that reports a pending/failed text-extraction status (`extractionStatus`) is not preselected and is marked "May not be ready", but it can still be ticked (the backend decides and explains if it cannot be used). Choices survive paging and search. Admins see only their own uploads (the backend only accepts the caller's papers).
  Questions come only from the selected papers: no syllabus unit/topic input exists and no answers are requested.
- **Question types**: MCQ, Short Answer, Essay, Paragraph, Long Answer, Problem Solving. **Difficulty**: Easy, Medium, Hard, Balanced (default).
- **Marks**: 2, 5, 10, 15 with a count each (total ≤ 30). MCQ is only offered for 2 marks and Essay only for 10 / 15 marks: a marks row that no selected type can fill is disabled and sent as nothing.
- **Result**: grouped by type, then marks; shows MCQ options, difficulty, a partial-generation warning (`meta.shortfall` / `unmet`), `meta.warnings`, `meta.extractionWarnings` and the backend `disclaimer`.
- **Search**: a box above the generated questions filters them instantly by question text or question type (`mcq`, `short answer`, ...). Grouping by type and marks is kept, and "No questions found" shows when nothing matches.
- **Errors**: client-side checks mirror the backend; backend validation errors (`errors: [{ field, message }]`) and other API errors are shown above the button.
- Rules and limits live in `src/utils/questionGeneration.js` (keep in sync with the backend's validators; `MAX_TOTAL_QUESTIONS` is the backend default `MAX_QUESTIONS_PER_REQUEST`).
- Tests: `npm test` (adds `tests/questionGeneration.test.js`).

### Two modes (Phase 5.3)
Tabs at the top of `/generate-questions` switch between:
- **Generate from uploaded papers**: everything above, unchanged.
- **Enter questions manually** (`components/questions/ManualQuestions.jsx`, `hooks/useManualQuestions.js`, `utils/manualQuestions.js`): type or paste questions, choose a type and marks for each (same rules: MCQ = 2 marks, Essay = 10 / 15; text 10–1000 characters, duplicates refused), add as many as you like, and edit or delete them. No papers, subject or PDFs are needed. "Generate answers" sends each question to the backend's existing `POST /api/questions/ask` (one request per question, a few at a time) and turns the Markdown answer into short answer points; nothing is stored on the server. The PDF-based answers use a different endpoint (`POST /api/questions/important/:generationId/answers`) and are unaffected. They are shown in the same grouped, searchable list, with Edit / Delete buttons.
  Typed questions are kept in the tab's session storage (per user) and are never sent to the server.
- **Answer generation compatibility**: the backend's answers route (`POST /api/questions/important/:generationId/answers`) takes `questionIds` of a set the server generated and stored for the student, and no backend route accepts typed questions. So answers cannot be requested for manual questions yet, and the list says so instead of pretending. Supporting them needs a new backend endpoint (for example one that stores a student's own questions and returns ids the answers step can use).

### Paper selection (Phase 5.4)
Selected papers are listed in a highlighted panel above the paper list (chips with a check mark, "x of 3 selected", Clear selection, Use automatic selection), and every selected row shows a "Selected" tag. Ticking and unticking uses functional state updates, works across pages and searches, and the ids go to the API as `paperIds` in selection order. When 3 papers (the backend limit) are selected the other rows are disabled with an explanation. Pressing Enter in the paper search no longer submits the generation form. Manual Entry is unaffected and needs no papers.
