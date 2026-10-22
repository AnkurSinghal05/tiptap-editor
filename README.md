# Tiptap Structured Document Editor

A Tiptap-based editor for the knowledge base (T&C, FAQ, SLA and redemption-process documents). It loads documents from the Knowledge Base API and saves changes back, clause by clause.

```
Document
 └── Section (id)                        id = entity id (e.g. golf-booking)
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

- **Opening a document:** a three-step flow. (1) Pick a document type (T&C, redemption process, FAQ or SLA). (2) Pick a vertical; this is the API's entity (`entity_id`, the section id). Verticals come from `GET /knowledge-base/entities`, fetched once when step 2 first opens. Picking one fetches its document once, and the editor reuses that response. (3) Edit. Earlier steps can be revisited from the stepper without losing unsaved changes; opening a different document asks first.
- **New documents:** a vertical with no document of the chosen type starts blank, **from a file** or **from JSON**.
  - **From a file** (PDF, DOCX or TXT, up to 10 MB): the file is read in the browser (mammoth for Word, pdf.js for PDF, loaded only when needed) and split into clauses: each paragraph becomes a clause, a list joins the paragraph before it, and headings become tags on the clauses below them ("2. Cancellation" → `cancellation`). A first line that looks like the title is left out, and Word formatting (bold, italic, lists) is kept. Everything goes directly under the vertical, because subsections need a catalog type and id a file can't provide. A preview shows the result before the editor opens. Scanned PDFs have no text layer and can't be read.
  - **From JSON:** paste `{ type, doc }` (the body of `POST /knowledge-base`), an API response with `data`, a Tiptap doc or a single section. The pasted JSON is checked before the editor opens: the section id becomes the chosen vertical, missing titles are filled in, and clause ids are left to the server. Nothing is saved until **Create document**.
- **Narrowing:** in the editor, optionally pick a subsection and a workflow and click **Load**. Containers above the loaded scope are shown read-only, for context.
- **Tags:** each clause shows its tags under its text. **Edit tags** (or **+ Add tags**) opens the tags editor, which also suggests tags already used in the document. A tag change is an ordinary edit: undoable, listed in Pending requests and saved as a PATCH.
- **Tables:** a clause can hold a table. The toolbar can insert one (two columns with a header row), add rows and columns, and delete rows, columns or the whole table. The API stores clause content as sent, so anything else that displays these T&C must render Tiptap table nodes (`table`, `tableRow`, `tableHeader`, `tableCell`).
- **JSON tab:** the open document as editable JSON. **Apply** turns the edits into an ordinary editor change. The same rules apply (no renaming saved titles, no moving saved clauses, nothing outside the loaded scope), it can be undone, and **Save** sends it like any other edit.
- **Saving:** **Save** compares the editor with what was loaded. New clauses go first: one new clause is sent with a single add (`POST /knowledge-base/clauses`), several with `append` (500 per request, all or nothing). Then it sends one PATCH per edited clause, and the deleted clauses in batch deletes (`POST /knowledge-base/clauses/delete`, up to 50 per request). When everything succeeds the scope is reloaded from the backend. When something fails, the rest stays saved and the failed clauses are highlighted in red (hover for the reason). The **Pending requests** tab shows exactly what Save would send.
- **Clause ids:** a new clause gets a `tmp-…` id until the backend assigns its `cl-…` id. Unsaved clauses are outlined in amber.
- **What the backend doesn't support, so the editor doesn't either:**
  - Clauses can't be reordered. New clauses always go at the end of their container, where the backend puts them.
  - Saved titles (entity, subsection, workflow) can't be renamed. A new container's title can be edited until its first save.
  - A container can't be deleted on its own. Deleting a subsection or workflow deletes its clauses, after a confirmation.
  - Saved clauses can't be moved to another container or reordered; the editor blocks it. Copy the text into a new clause instead.
- **Structure rules:** subsection types and workflow ids come from fixed lists in `src/editor/taxonomy.ts`. A subsection's (type, id) is unique within its entity, and each workflow appears at most once per subsection. Heading levels are set automatically, and headings can't appear inside clauses.
- **Backend:** see [docs/kb-api-integration.md](docs/kb-api-integration.md).
  - **Mock / Live switch** (editor header): **Live** uses the Knowledge Base API, by default staging (`https://stag-pgm-mgmt-api.thriwe.com/api/v1`). **Mock** uses an in-memory backend (`src/api/kb/mock.ts`) with sample data from the backend team's Postman collection, which resets on page reload. The choice is remembered in the browser; switching reloads the page. `VITE_KB_API_MODE` sets the starting mode (default `live`).
  - **Local setup:** copy `.env.example` to `.env.local`. Live mode needs a session token in `VITE_KB_TOKEN`; it's only used in development and never included in a build. `VITE_KB_API_BASE_URL` points at a different API.
  - **Proxy:** the API doesn't allow browser calls from `localhost` (no CORS headers), so in development live calls go to `/kb-api` on the dev server, which forwards them (see `vite.config.ts`). On Vercel, `/kb-api` is served by `api/kb-proxy.ts` instead (see "Deploy on Vercel"). `VITE_KB_API_PROXY` switches it: on by default in development, off in other builds, which call `VITE_KB_API_BASE_URL` directly. `VITE_KB_API_PROXY=off` in development only works once the API allows `http://localhost:5173` (`VITE_KB_API_DEV_PROXY` is the old name and still works in development).
  - **API log** tab: records every call in both modes: method, the real API endpoint it reached (for calls through the `/kb-api` proxy, the URL the proxy reports in its `X-KB-Upstream-URL` response header; mock calls are marked as answered in the browser), `Project-Code` header, request body, status and response (live mode shows the server's raw response). Entries can be expanded, cleared or downloaded as JSON, and each call is also logged to the browser console (debug level). The token is never logged.
  - **Project switch** (header): **Thriwe (`THRIWE_APP`)** edits the base T&C every program inherits; **ENBD (`ENBD_V3`)** edits ENBD's own version on top of the base. Every request sends the chosen code as `Project-Code`; the choice is remembered in the browser and switching reloads the page (unsaved changes are confirmed first). As a program: a save's edits and removals apply to that program only, verticals without a document can't be started (only Thriwe can create documents), and the delete warning says so. Mock mode always works as Thriwe, since the mock only models the base document. Revert and history aren't in the editor yet. Projects are listed in `PROJECTS` in `src/api/kb/config.ts`.

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

## Deploy on Vercel

Live mode on Vercel goes through a Vercel Function, so the API token stays on the server: the browser calls `/kb-api/…` on the deployment, `vercel.json` rewrites that to `api/kb-proxy.ts`, and the function adds `Authorization: Bearer <KB_API_TOKEN>` and forwards the call to the API. The browser never sees the token and only talks to its own origin, so CORS doesn't apply.

The function only forwards Knowledge Base endpoints (`/knowledge-base…`) with GET, POST or PATCH, only the `Project-Code` values in `KB_API_PROJECT_CODES` (default `THRIWE_APP,ENBD_V3`), and never forwards cookies or the browser's own headers.

Set it up in this order:

1. **Protect the deployment first.** Anyone who can open it can edit the base T&C with the token. In the project's **Settings → Deployment Protection**, enable **Vercel Authentication** with **All Deployments** (free on every plan). Standard Protection leaves the production domain public. To let people in without a Vercel account, create a **Shareable Link**: open the production deployment, click **Share**, choose **Anyone with the link** and copy the link (revoke it by switching back to **Only people with access**). Hobby accounts get one shareable link in total.
2. **Add the token as a Secret** (Settings → Environment Variables, type **Secret**), or in your own terminal: `vercel env add KB_API_TOKEN production --sensitive`. Use a name without the `VITE_` prefix: `VITE_*` values are built into the public JavaScript.
3. **Add the Config variables:**

   | Variable | Value |
   |---|---|
   | `VITE_KB_API_MODE` | `live` (or `mock` for a demo with sample data) |
   | `VITE_KB_API_PROXY` | `on` |
   | `VITE_KB_API_BASE_URL` | optional; defaults to staging. The function uses it too (or `KB_API_BASE_URL`) |
   | `KB_API_PROJECT_CODES` | optional; defaults to `THRIWE_APP,ENBD_V3` (the editor's projects) |

   Don't add `VITE_KB_TOKEN` or `VITE_KB_API_DEV_PROXY`; they're for local development only.
4. **Redeploy.** Vite builds the `VITE_*` values into the app, so changes apply only to new deployments.

Search engines are kept out even when the deployment is public: `public/robots.txt` disallows crawling, and every response carries `X-Robots-Tag: noindex` (`vercel.json`) plus a `noindex` meta tag. These are requests crawlers honour, not access control.

Things to know: every edit through the deployment is recorded under the token's user (`changed_by`), whoever made it, and a session token that expires has to be replaced (update the Secret, then redeploy). A long-lived service token from the backend team avoids both.
