# Tiptap Structured Document Editor

A Tiptap-based editor for the knowledge base (T&C, FAQ, SLA and redemption-process documents). It loads documents from the Knowledge Base API and saves changes back, clause by clause.

```
Document
 └── Section (id)                        id = entity id from the backend (e.g. golf-booking)
      ├── Heading (H1)
      ├── Clause*
      └── SubSection (type, id, name)*   type = facility | partner | service | vendor; id = real entity id
           ├── Heading (H2)              (shows the subsection name)
           ├── Clause*
           └── Workflow (id)*            id = fixed list (see taxonomy.ts)
                ├── Heading (H3)
                └── Clause*
```

## How it works

- **Loading:** pick a document type and an entity, then optionally a subsection and a workflow, and click **Load**. Containers above the loaded scope are shown read-only, for context. Choose **+ New entity…** to start a document for an entity that doesn't have one yet.
- **Saving:** **Save** compares the editor with what was loaded. New clauses go first: one new clause is sent with a single add (`POST /knowledge-base/clauses`), several with `append` (500 per request, all or nothing). Then it sends one PATCH per edited clause and one DELETE per deleted clause. When everything succeeds the scope is reloaded from the backend. When something fails, the rest stays saved and the failed clauses are highlighted in red (hover for the reason). The **Pending requests** tab shows exactly what Save would send.
- **Clause ids:** a new clause gets a `tmp-…` id until the backend assigns its `cl-…` id. Unsaved clauses are outlined in amber.
- **What the backend doesn't support, so the editor doesn't either:**
  - Clauses can't be reordered. New clauses always go at the end of their container, where the backend puts them.
  - Saved titles (entity, subsection, workflow) can't be renamed. A new container's title can be edited until its first save.
  - A container can't be deleted on its own. Deleting a subsection or workflow deletes its clauses, after a confirmation.
  - Saved clauses can't be moved to another container or reordered; the editor blocks it. Copy the text into a new clause instead.
- **Structure rules:** subsection types and workflow ids come from fixed lists in `src/editor/taxonomy.ts`. A subsection's (type, id) is unique within its entity, and each workflow appears at most once per subsection. Heading levels are set automatically, and headings can't appear inside clauses.
- **Backend:** see [docs/kb-api-integration.md](docs/kb-api-integration.md). Copy `.env.example` to `.env.local` and set `VITE_KB_API_BASE_URL` (and `VITE_KB_TOKEN` for local development) to use the real API. Without it, an in-memory mock (`src/api/kb/mock.ts`) is used, seeded with the documents from the backend team's Postman collection; its data resets on page reload. While the mock is in use, the **API log** tab records every call (method, endpoint, `Project-Code` header, request body, status and response in the real API's envelope); entries can be expanded, cleared or downloaded as JSON, and each call is also logged to the browser console (debug level). This milestone always sends `Project-Code: THRIWE_APP` (base editing only).

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
