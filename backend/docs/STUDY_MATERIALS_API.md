# Study Material Management API (Phase 4.1) and Secure Sharing (Phase 4.3A)

Study materials are the existing **papers**: same `/api/papers` routes, same `Paper` model, same private upload
folder and the same text extraction (PDF text layer, image OCR). Phase 4.1 adds metadata and full CRUD on top.
Phase 4.3A adds secure, revocable share links on top (see *Secure sharing* below).

## Who may do what

Every route requires a valid JWT **and** a role of `student` or `admin` (checked against the database on every request).

| Action                         | Student            | Admin         |
| ------------------------------ | ------------------ | ------------- |
| Upload                         | yes (owns it)      | yes (owns it) |
| List / view / view file        | own materials only | all materials |
| Edit metadata                  | own materials only | all materials |
| Delete                         | own materials only | all materials |
| Extract text (existing route)  | own materials only | all materials |

The rule is part of the database query, not a check made afterwards. A student asking for someone else's material
gets **404 "Paper not found"**, exactly like a material that does not exist (a 403 would reveal that it exists).
`401` = not logged in, `403` = role not allowed, `400` = invalid input.

## Endpoints

All responses use `{ success, message, data?, meta? }`. A material is returned as:

```json
{
  "_id": "…", "uploadedBy": "…", "title": "Data Structures Model Paper", "description": "",
  "materialType": "question_paper", "originalName": "ds.pdf", "size": 12345, "mimeType": "application/pdf",
  "fileType": "pdf", "extractionStatus": "pending", "extractionError": null, "extractionMethod": null,
  "pageCount": null, "ocrConfidence": null, "extractedAt": null, "uploadedAt": "…", "updatedAt": null,
  "isShared": false, "sharedAt": null
}
```

The stored file name, the extracted text and the extraction warnings are never part of it. `isShared` / `sharedAt` (Phase 4.3A)
show whether a public link is active; the link, its token and its hash are never part of it.

### `POST /api/papers/upload`
`multipart/form-data`: the file in the field `file` (PDF, JPG, JPEG or PNG, max 10 MB) plus optional text fields
`title`, `description`, `materialType`. The title defaults to the file name without its extension; `materialType`
defaults to `question_paper`. Unknown fields (for example `uploadedBy`) are refused with 400 and the file is removed.
Extension, declared MIME type and the real file bytes must all agree.

### `GET /api/papers`
Query: `page`, `limit` (default 20, max 100), `materialType`, `extractionStatus`, `search` (title or file name, literal
text, max 100 characters), `sort` (`newest` default, `oldest`, `title`), and `uploadedBy` (admin only; ignored for
students, whose list is always limited to their own materials). Returns `data.papers` and
`meta { page, limit, total, totalPages }`.

### `GET /api/papers/:paperId`
One material (metadata only).

### `PATCH /api/papers/:paperId`
JSON body with at least one of `title` (1–150 characters), `description` (0–1000; `""` clears it) and `materialType`
(`question_paper`, `notes`, `syllabus`, `other`). Any other field (ownership, storage or extraction fields) is
refused with 400. Values must be strings; control, zero-width and bidi-override characters are removed.

### `DELETE /api/papers/:paperId`
Deletes the record and then the stored file. Question sets already generated from the material keep working until they
expire, but generating their answers afterwards reports "Paper not found" because the source text is gone.

### `GET /api/papers/:paperId/file` (`?download=true` to force a download)
Streams the stored file after the same access check. The `Content-Type` comes from the verified file bytes, never from
the client; responses carry `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`. The uploads
folder is never served statically.

### `POST /api/papers/:paperId/extract` (existing, unchanged behaviour)
Admins may now extract any material; students still only their own.

## Not changed on purpose
* AI question generation (`/api/questions/important` and its answers stage) still uses only the signed-in user's own papers, admins included.
* Replacing the file of an existing material is not supported; upload a new one and delete the old one.
* No frontend changes.

## Secure sharing (Phase 4.3A)

A material is **private by default** (`isShared: false`; every material saved before Phase 4.3A is private). Its owner
(or an admin) can create a read-only public link, and revoke it at any time. Anyone with the link can open that one
material **without logging in**; nothing else becomes reachable.

| Method | Path | Auth | Result |
| ------ | ---- | ---- | ------ |
| POST   | `/api/papers/:paperId/share` | JWT, owner or admin | `201` the link (shown only now); `409` if a link is already active |
| POST   | `/api/papers/:paperId/share?replace=true` | JWT, owner or admin | `200` a NEW link; the previous one stops working |
| GET    | `/api/papers/:paperId/share` | JWT, owner or admin | `200` `{ _id, isShared, sharedAt, sharedBy }` (never the link) |
| DELETE | `/api/papers/:paperId/share` | JWT, owner or admin | `200` link revoked (also `200` if it was not shared) |
| GET    | `/api/shared/materials/:token` | none | `200` public metadata of the shared material, otherwise `404` |
| GET    | `/api/shared/materials/:token/file` | none | `200` the file (`?download=true` forces a download), otherwise `404` |

### Permissions
* Create / replace / revoke / status use the same rule as the rest of this API (`utils/paperAccess.js`, inside the database
  query): **admin -> any material, student -> only their own**. Someone else's material is `404 "Paper not found"`, never 403.
  `401` without a login, `403` for a role other than student/admin, `400` for a malformed `:paperId`.
* Opening a link needs no login and no role; the token is the access.
* The share fields cannot be set any other way: upload and `PATCH` refuse `isShared`, `shareTokenHash`, `sharedAt`, `sharedBy` (400).

### Token handling
* **256-bit token**: 32 bytes from `crypto.randomBytes`, base64url, 43 characters. Unrelated to the material id, the owner or the time.
* **Only the SHA-256 hash is stored** (`Paper.shareTokenHash`, unique partial index, `select: false`, removed from every
  response). The token itself is in no database record: a database leak does not yield working links, and a leaked hash does
  not open anything (it is not a valid token for the public routes).
* **Shown once**: the create response is the only place the link exists. It cannot be read back; if it is lost, revoke it or
  use `?replace=true` to issue a new one.
* **Create is never silent about an existing link**: while a link is active, a second `POST` is `409` and changes nothing
  (the existing link keeps working). Concurrent requests cannot replace each other's token (the write only matches a material
  that has no link yet).
* **Revoke** sets `isShared=false`, `sharedAt=null` and removes `shareTokenHash` / `sharedBy` in one atomic write. The old
  link is `404` immediately and can never work again; sharing again creates a new token. Deleting the material kills the link too.
* **Malformed tokens** are refused with the same `404` before any database query. Unknown, revoked, never-shared and
  deleted-material tokens are indistinguishable: `404 "Shared material not found"`.
* **Rate limit**: public routes are limited per IP (`SHARED_ACCESS_LIMIT_MAX`, default 100 per `SHARED_ACCESS_LIMIT_WINDOW_MS`,
  default 15 minutes) and count every request, valid token or not -> `429`.
* **Logs**: the access log and the error logger replace the token in `/shared/materials/<token>` with `[redacted]`; the
  application never logs a token or a share URL.
* **Public responses** carry `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` and
  `X-Content-Type-Options: nosniff`. The file's `Content-Type` comes from the verified bytes. Only `GET`/`HEAD` are accepted
  (`405` with `Allow: GET, HEAD` otherwise). There is no list or search of shared materials.

### Create
`POST /api/papers/6561a1f2c3d4e5f607182930/share` -> `201`
```json
{
  "success": true,
  "message": "Share link created successfully",
  "data": {
    "_id": "6561a1f2c3d4e5f607182930",
    "isShared": true,
    "sharedAt": "2026-11-25T09:10:11.123Z",
    "shareUrl": "https://studywise.example.com/shared/materials/q1W3x9Zk2mP0vB7nR4tYc8LfHd5JsAeUoGiKbXwTzNE",
    "apiUrl": "/api/shared/materials/q1W3x9Zk2mP0vB7nR4tYc8LfHd5JsAeUoGiKbXwTzNE",
    "fileUrl": "/api/shared/materials/q1W3x9Zk2mP0vB7nR4tYc8LfHd5JsAeUoGiKbXwTzNE/file"
  }
}
```
`shareUrl` is `<SHARE_BASE_URL>/shared/materials/<token>` (the future frontend page; `SHARE_BASE_URL` defaults to the first
`CORS_ORIGIN`). `apiUrl` / `fileUrl` are the public API paths.

### Public view (no Authorization header)
`GET /api/shared/materials/<token>` -> `200`
```json
{
  "success": true,
  "message": "Shared study material retrieved successfully",
  "data": {
    "title": "Data Structures Model Paper", "description": "Unit 1 to 3", "materialType": "question_paper",
    "fileName": "ds.pdf", "fileType": "pdf", "mimeType": "application/pdf", "size": 12345, "pageCount": 4,
    "uploadedAt": "2026-11-20T08:00:00.000Z", "sharedAt": "2026-11-25T09:10:11.123Z",
    "fileUrl": "/api/shared/materials/<token>/file"
  }
}
```
A visitor never receives ids, the owner, the stored file name, extracted text, extraction state or anything about who shared it.

### Revoke, then the old link
`DELETE /api/papers/6561a1f2c3d4e5f607182930/share` -> `200`
```json
{ "success": true, "message": "Share link revoked successfully. The link no longer works.",
  "data": { "_id": "6561a1f2c3d4e5f607182930", "isShared": false, "sharedAt": null } }
```
`GET /api/shared/materials/<token>` -> `404 { "success": false, "message": "Shared material not found" }`

### Notes for the frontend phase
* The API sends helmet's default `X-Frame-Options: SAMEORIGIN` and `Cross-Origin-Resource-Policy: same-origin`. They were not
  relaxed for the shared file route; if the shared page embeds the file in an `<iframe>`/`<img>` from another origin, decide
  that then. Fetching with CORS (already enabled for `CORS_ORIGIN`) works as is.
* The Phase 2C question-set links (`/api/shared/question-sets/:token`) are unchanged (they still store the token itself and
  return the same link on repeat, which materials deliberately do not).

## Tests
`npm test` runs everything. The Phase 4.1 tests are `tests/studyMaterials.test.js` (HTTP-level permissions and CRUD, no
database needed) and `tests/paperValidators.unit.test.js`. Phase 4.3A adds `tests/paperSharing.test.js` (HTTP-level:
owner/admin/other-student permissions, public access, privacy, revocation, token storage, concurrency),
`tests/paperSharingLimiter.test.js` (rate limit) and `tests/shareToken.unit.test.js` (token generation, hashing, log redaction).
