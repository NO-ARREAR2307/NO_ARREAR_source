// Text extraction before question generation.
//
// The backend generates questions only from papers whose text has been extracted (extractionStatus "completed") and answers
// 409 / 422 "Text has not been extracted from this paper yet" otherwise. Extraction is its own existing endpoint,
// POST /api/papers/:paperId/extract, so the generator runs it first for every selected paper that is not completed yet.
// The functions here are plain (the API calls are passed in) so they can be tested without a server.

const sleepFor = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })

const cancelled = () => ({ message: 'Cancelled', cancelled: true })

/**
 * Extracts the text of one paper and resolves when it is finished (rejects with { message, status } when it fails).
 * The backend extracts a paper once: a completed one answers straight away from its stored text. If another request is
 * already extracting the same paper (409), this waits for it by checking the paper until it is completed or failed.
 *  extract(id)    -> POST /papers/:id/extract
 *  fetchPaper(id) -> GET /papers/:id (the paper, with extractionStatus / extractionError)
 */
export async function ensureExtracted(paper, { extract, fetchPaper, signal, pollMs = 2000, maxWaitMs = 180000, sleep = sleepFor } = {}) {
  try {
    await extract(paper._id)
    return
  } catch (err) {
    if (err?.status !== 409) throw err // not "already in progress": the backend's own message is the explanation
  }

  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await sleep(pollMs, signal)
    if (signal?.aborted) throw cancelled()
    const current = await fetchPaper(paper._id)
    if (current?.extractionStatus === 'completed') return
    if (current?.extractionStatus === 'failed') {
      throw { message: current.extractionError || 'Text extraction failed for this paper.', status: 422 }
    }
  }
  throw { message: 'Reading this paper is taking longer than expected. Please try again in a moment.', status: 504 }
}

/** A selected paper needs extraction unless it is known to be completed. */
export const needsExtraction = (paper, done = new Set()) => !done.has(paper?._id) && String(paper?.extractionStatus ?? '').toLowerCase() !== 'completed'

/** Progress of one paper: waiting | running | done | failed. */
export const initialProgress = (papers) => papers.map((paper) => ({ _id: paper._id, title: paper.title, state: 'waiting', message: '' }))

/**
 * Extracts the given papers one after another (one at a time keeps the server's per-user extraction limit and OCR load
 * in check). `onProgress(id, state, message)` is called as each paper starts, finishes or fails; `onDone(id)` after each success.
 * Stops at the first failure and rejects with { message, status, paperId, title } so nothing is generated from a paper that
 * could not be read.
 */
export async function extractPapers(papers, { extract, fetchPaper, signal, onProgress = () => {}, onDone = () => {}, ...timing } = {}) {
  for (const paper of papers) {
    if (signal?.aborted) throw cancelled()
    onProgress(paper._id, 'running', '')
    try {
      await ensureExtracted(paper, { extract, fetchPaper, signal, ...timing })
    } catch (err) {
      if (err?.cancelled || signal?.aborted) throw cancelled()
      const message = err?.message || 'Text extraction failed for this paper.'
      onProgress(paper._id, 'failed', message)
      throw { message, status: err?.status ?? null, paperId: paper._id, title: paper.title }
    }
    onProgress(paper._id, 'done', '')
    onDone(paper._id)
  }
}
