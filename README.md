# Tiptap Structured Document Editor

A Tiptap-based editor for the knowledge base (T&C, FAQ, SLA and redemption-process documents). It loads documents from the Knowledge Base API and saves changes back, clause by clause.

```
Document
 └── Section (id)                        id = entity id, fixed list (e.g. golf-booking)
      ├── Heading (H1)
      ├── Clause*
      └── SubSection (type, id, name)*   type = facility | partner | service; id = real entity id
           ├── Heading (H2)              (shows the subsection name)
           ├── Clause*
           └── Workflow (id)*            id = fixed list (see taxonomy.ts)
                ├── Heading (H3)
                └── Clause*
```

## How it works

- **Opening a document:** a three-step flow. (1) Pick a document type (T&C, redemption process, FAQ or SLA). (2) Pick a vertical; this is the API's entity (`entity_id`, the section id). Verticals come from a fixed list in `src/editor/taxonomy.ts`, since the API can't list them. Picking one fetches its document once, and the editor reuses that response. (3) Edit. Earlier steps can be revisited from the stepper without losing unsaved changes; opening a different document asks first.
- **New documents:** a vertical with no document of the chosen type starts blank, **from a file** or **from JSON**.
  - **From a file** (PDF, DOCX or TXT, up to 10 MB): the file is read in the browser (mammoth for Word, pdf.js for PDF, loaded only when needed) and split into clauses: each paragraph becomes a clause, a list joins the paragraph before it, and headings become tags on the clauses below them ("2. Cancellation" → `cancellation`). A first line that looks like the title is left out, and Word formatting (bold, italic, lists) is kept. Everything goes directly under the vertical, because subsections need a catalog type and id a file can't provide. A preview shows the result before the editor opens. Scanned PDFs have no text layer and can't be read.
  - **From JSON:** paste `{ type, doc }` (the body of `POST /knowledge-base`), an API response with `data`, a Tiptap doc or a single section. The pasted JSON is checked before the editor opens: the section id becomes the chosen vertical, missing titles are filled in, and clause ids are left to the server. Nothing is saved until **Create document**.
- **Narrowing:** in the editor, optionally pick a subsection and a workflow and click **Load**. Containers above the loaded scope are shown read-only, for context.
- **JSON tab:** the open document as editable JSON. **Apply** turns the edits into an ordinary editor change. The same rules apply (no renaming saved titles, no moving saved clauses, nothing outside the loaded scope), it can be undone, and **Save** sends it like any other edit.
- **Saving:** **Save** compares the editor with what was loaded. New clauses go first: one new clause is sent with a single add (`POST /knowledge-base/clauses`), several with `append` (500 per request, all or nothing). Then it sends one PATCH per edited clause, and the deleted clauses in batch deletes (`POST /knowledge-base/clauses/delete`, up to 50 per request). When everything succeeds the scope is reloaded from the backend. When something fails, the rest stays saved and the failed clauses are highlighted in red (hover for the reason). The **Pending requests** tab shows exactly what Save would send.
- **Clause ids:** a new clause gets a `tmp-…` id until the backend assigns its `cl-…` id. Unsaved clauses are outlined in amber.
- **What the backend doesn't support, so the editor doesn't either:**
  - Clauses can't be reordered. New clauses always go at the end of their container, where the backend puts them.
  - Saved titles (entity, subsection, workflow) can't be renamed. A new container's title can be edited until its first save.
  - A container can't be deleted on its own. Deleting a subsection or workflow deletes its clauses, after a confirmation.
  - Saved clauses can't be moved to another container or reordered; the editor blocks it. Copy the text into a new clause instead.
- **Structure rules:** entities, subsection types and workflow ids come from fixed lists in `src/editor/taxonomy.ts`. A subsection's (type, id) is unique within its entity, and each workflow appears at most once per subsection. Heading levels are set automatically, and headings can't appear inside clauses.
- **Backend:** see [docs/kb-api-integration.md](docs/kb-api-integration.md).
  - **Mock / Live switch** (editor header): **Live** uses the Knowledge Base API, by default staging (`https://stag-pgm-mgmt-api.thriwe.com/api/v1`). **Mock** uses an in-memory backend (`src/api/kb/mock.ts`) with sample data from the backend team's Postman collection, which resets on page reload. The choice is remembered in the browser; switching reloads the page. `VITE_KB_API_MODE` sets the starting mode (default `live`).
  - **Local setup:** copy `.env.example` to `.env.local`. Live mode needs a session token in `VITE_KB_TOKEN`; it's only used in development and never included in a build. `VITE_KB_API_BASE_URL` points at a different API.
  - **Dev proxy:** the API doesn't allow browser calls from `localhost` (no CORS headers), so in development live calls go to `/kb-api` on the dev server, which forwards them (see `vite.config.ts`). A built app calls the API directly, so the API must allow the deployed app's origin. To skip the proxy in development, set `VITE_KB_API_DEV_PROXY=off` in `.env.local` and restart `npm run dev`; that only works once the API allows `http://localhost:5173`.
  - **API log** tab: records every call in both modes (method, endpoint, `Project-Code` header, request body, status and response; live mode shows the server's raw response). Entries can be expanded, cleared or downloaded as JSON, and each call is also logged to the browser console (debug level). The token is never logged.
  - This milestone always sends `Project-Code: THRIWE_APP` (base editing only).

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```
