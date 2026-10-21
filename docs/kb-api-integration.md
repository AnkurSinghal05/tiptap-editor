# Knowledge Base API: frontend integration review

Oct 14, 2026 · updated Oct 15 for "Knowledge base and mappings API: FE handover" (Oct 15, 2026) and the latest Postman collection · updated Oct 16 for "Knowledge Base & Mappings — FE Handover" (Oct 16, 2026)

This compares the T&C editor in this repo with the Knowledge Base API, as described in the backend team's FE handover and Postman collection (including their recorded responses). It covers what fits, how the editor uses the API, the open questions for the backend, and the decisions made.

**Summary:** the data model lines up, and the sample documents from Postman load into the editor and match its schema. The backend has no "save the whole scope" call, so the editor's Save turns the edits into per-clause calls:
- new clauses: a single add or one `append`
- edited clauses: a PATCH each
- removed clauses: batch deletes of up to 50

The editor already does this, and reloads with GET after saving.

The Oct 16 handover changes nothing that base editing relies on. It specifies program-scoped (per-project) editing in full, which the editor doesn't do yet; see "Program views".

## What changed in the Oct 16 handover

Compared with our previous review, these are new or now described in detail.

| Change | Effect on the frontend |
|---|---|
| **Program-scoped changes:** a program sees the base plus its own changes, only for entities and catalog items mapped to it. Its PATCH creates its own version of a base clause, its delete hides the clause for that program only, and its adds are visible only to it. It never changes the base | None for base editing (`THRIWE_APP`). This is what program views build on |
| **Revert and history** in full: revert is for programs only (400 for `THRIWE_APP`, 409 when there's nothing to revert). History returns items oldest first, with a `snapshot` and `project_code` (`""` for a base change) | Not used by base editing |
| **Entity mappings** (map, list, update or restore, soft delete) documented next to catalog mappings, with a setup order: base document, then entity mapping, then catalog mappings | Not used by base editing. A program without them gets an empty list or 403s |
| **Create is `THRIWE_APP` only** (403 for a program) | The editor's create mode stays base only |
| **Headers:** every request needs `Authorization: Bearer <token>` (401 without it), `Project-Code` and, with a body, `Content-Type: application/json` | `Content-Type` is already sent. The bearer token is sent only in local development; see open question 7 |
| **Document rules** spelled out: at most one heading per container, and any node type other than `heading`, `clause`, `subSection` and `workflow` in a container is a 400 | The editor's schema already allows only these. The mock now checks both rules too |
| **Pagination:** `total` is counted before unmapped subSections are hidden, so a page can be shorter than `limit` | None: the editor only fetches one entity's document at a time (`limit=1`). Only program views get shorter pages |
| **Error messages** listed per status, e.g. 404 `Knowledge base not found for this type and entity`, 409 `Knowledge base already exists for this type and entity` | The mock uses the same messages now. The editor checks status codes, not messages |

## The handover's questions for the frontend

1. **Does the editor produce these nodes and attribute names?** Yes, so no mapping layer is needed. The editor's schema is the same tree: section `attrs.id`; subSection `type` / `id` / `name`; workflow `id`; clause `id` / `tags`. Heading levels 1 to 3 are set from the container. The editor always sends a heading for every container, which append allows.
2. **How will the UI mark a clause the program has customised?** It needs the GET response to say so (open question 8). Calling History for every clause would be one request per clause on every load.
3. **Should the catalog-mapping screen list discovery items to pick from?** Our recommendation is yes. Catalog ids aren't checked yet, so a mistyped id would create a mapping that matches nothing, with no error. This is a product decision that hasn't been made.

## What changed in the Oct 15 handover

| Change | Effect on the frontend |
|---|---|
| **Batch delete:** `POST /knowledge-base/clauses/delete` with `{ type, entity_id, clause_ids }`, 1 to 50 ids of one entity, all or nothing. The single `DELETE /knowledge-base/clauses/{id}` is gone | Save sends removed clauses in batches of 50 instead of one request each |
| A batch delete with an unknown id deletes nothing and returns 404, listing each missing id as `clause_ids[<index>]` | Those ids are already gone, so the editor treats them as deleted and retries the rest once |
| **`vendor` is not a subSection type any more.** The API accepts only `partner`, `facility` and `service` (subSections are discovery catalog items) | Removed from the editor's list. Existing vendor subSections are flagged on load (see open question 6) |
| **Writes return only ids:** add, append, update, delete and revert return `{ "clause_ids": [...] }`. Create still returns the document | The editor reads `clause_ids` and reloads with GET after saving |
| **Program catalog mappings** documented: a program sees a subSection only if that exact catalog item is mapped to it | Not used by base editing; see "Program views" |

## What already matches

- **Same nesting and attributes:** section `id`; subSection `type` / `id` / `name`; workflow `id`; clause `id` / `tags`. Clause content is the same Tiptap JSON.
- **Same filters:** entity, then subSection type + id, then workflow. The backend returns only the matching part, which is how the editor loads a scope.
- **Clause ids come from the server** (`cl-<uuid>`). The editor gives new clauses a temporary id and swaps in the real one from `clause_ids` after saving.
- **`name` is the source of truth for a subSection's title.** The backend writes `name` into the heading, and the editor does the same.

## How the editor uses the API

| Backend behaviour | What the editor does |
|---|---|
| No "save scope" endpoint | **Save** compares the edits with what was loaded and sends, in order: new clauses (a single add, `POST /knowledge-base/clauses`, for one; `append` for several, split at 500); one PATCH per edited clause; removed clauses in batch deletes (split at 50). Then it reloads the scope with GET |
| New clauses always go at the **end** of their container; no moving or reordering | No drag handles; "add clause" adds at the end; moving or reordering a saved clause (e.g. by cut and paste) is blocked |
| Titles can't be renamed after creation | Titles of saved entities, subSections and workflows are read-only; a new container's title is editable until its first save |
| A subSection or workflow with no clauses isn't stored; containers can't be deleted directly | A new subSection or workflow starts with one clause and needs at least one to save; deleting a container deletes its clauses, after a confirmation |
| subSection types are limited to partner / facility / service; workflow ids aren't validated | Both are **fixed lists** the user picks from (see "Fixed lists") |
| `GET /knowledge-base` needs an `entity_id`; `GET /knowledge-base/entities` lists every entity (`entity_id`, `entity_name`); there are 4 document types (`tnc`, `faq`, `sla`, `redemption_process`) | A three-step flow: document type, then vertical (the entity), then the editor. The verticals come from `GET /knowledge-base/entities`, fetched once when step 2 first opens. Choosing one fetches that entity's document once; the editor and its subsection filter reuse it |
| A document is created once (base only, at least one clause) | For an entity with no document of the chosen type, the flow starts a new one, blank, from a PDF / DOCX / TXT file split into clauses, or from pasted JSON (both checked first), in a create mode that sends `POST /knowledge-base` |
| Response wrapper `{ message, code, data }`; 400 errors carry field paths | The HTTP client reads the wrapper; validation errors are pinned to the clause they point at |
| Base deletes are final for every program, including programs' own versions of the clause | Save asks for confirmation before deleting clauses |
| Some writes can fail while others succeed | Saved changes are kept; failed clauses stay unsaved and are highlighted with the reason |
| Every request needs `Project-Code` | `THRIWE_APP` for this milestone; program views come later |

## Open questions for the backend

1. **Can anyone logged in act as `THRIWE_APP`?** The Oct 16 handover makes this sharper: the `Project-Code` header, which the client chooses, decides what the caller is allowed to do. The Oct 15 handover listed "Access control per program" as a gap. The Oct 16 one no longer lists it, but doesn't say how the backend checks that a user may send `THRIWE_APP`. If it doesn't check, anyone could change base T&C for every program, live immediately: the approval workflow isn't available yet, and every change is `approved` at once. For member-facing legal text, this should be treated as a blocker before production.
2. **Two editors can overwrite each other.** There's no version check, so the last PATCH silently wins. Not addressed in the Oct 16 handover.
3. **Retried adds create duplicates.** Single add and append aren't idempotent. If a request succeeds but the response is lost, retrying duplicates the clauses and not retrying may lose them; the editor blocks saving until a reload in that case. Request: accept an `Idempotency-Key` header. (Batch delete is safe to retry: ids that are already gone come back as a 404, and the editor treats them as deleted.) Not addressed in the Oct 16 handover.
4. **Resolved Oct 21, 2026: listing entities.** `GET /knowledge-base/entities` returns every entity's `entity_id` and `entity_name`, and the editor's vertical list now comes from it instead of a fixed list on the frontend.
5. **Should the backend validate workflow ids too?** subSection types are now validated; workflow ids still accept anything, so other clients can add values outside the agreed list (`noshow` instead of `no-show`). `rentals` arrived this way before it was added to the list. The Oct 16 handover only requires a workflow id to be present and unique in its subSection.
6. **What happens to existing `vendor` subSections?** Data recorded on Oct 14 has vendor subSections (`V-1` Caddie Services, `VND-0031` Watersports Desk, `VND-0045` Poolside Cafe). The editor loads them but flags them. Adding a clause to one would likely be rejected, since append and single add send the subSection's type. Will they be migrated to partner / facility / service, or removed? Not addressed in the Oct 16 handover.
7. **Is the session cookie accepted, or is a bearer token required?** The handover lists `Authorization: Bearer <token>` as required (401 without it). The editor sends a bearer token only in local development (`VITE_KB_TOKEN`); otherwise it relies on the session cookie. If a token is required, where does the frontend get it in production?
8. **Can GET mark which clauses a program has customised?** The handover says GET doesn't flag them and History is the only way to tell, which would be one request per clause on every load. Request: a field on each clause in a program's GET saying whether it's the base clause, the program's version of a base clause, or a clause the program added.
9. **How does a program find the clauses it removed?** A program's delete hides the clause for that program, and Revert brings a base clause back, but Revert and History both need the clause id. If GET leaves hidden clauses out, the UI can only offer Revert for clauses removed in the current session. Request: a GET option that includes hidden clauses, flagged, or an endpoint that lists them.
10. **Does a program's version keep the base clause's id?** The handover says to use the id from GET for PATCH, delete, revert and history, which suggests yes. Please confirm: the editor tracks clauses by id across saves and reloads.
11. **How do catalog mappings match facility and service subSections?** A subSection carries only `type`, `id` and `name`. Is its `id` matched against `facility_id` (facility) or `service_id` (service), and is `partner_id` part of the match? The frontend can't read a `partner_id` from the document, so the mapping screen has to get it from discovery.
12. **Do documents with no clauses still appear in GET?** The mock leaves them out. After a save that empties the loaded entity, the editor checks again whether it has a document: if it's left out, the entity offers "Start document"; if GET still returns it with no clauses, the entity offers "Load" instead, and loads an empty document. The mock should match the answer.
13. **CORS for the deployed app.** Staging answers a browser preflight from `http://localhost:5173` with 204 but no `Access-Control-Allow-Origin`, so browsers block direct calls. In development the editor works around this with a dev-server proxy, but a deployed build calls the API directly. Request: allow the origin the editor will be deployed on, with the `Authorization`, `Project-Code` and `Content-Type` headers and credentials.

**Resolved:**

- **SubSection name vs heading:** `name` wins.
- **Title of a new workflow:** the frontend always sends one. It starts as the workflow's label (e.g. "Booking"), is editable until the first save, then read-only.
- **Free-form vs fixed values:** subSection types and workflow ids are fixed lists; there's no free-text entry.
- **Write responses:** documented in the Oct 15 handover. Add, append, update, delete and revert return `{ clause_ids }`; create returns the document.
- **Delete:** replaced by the batch delete, which returns the ids sent.
- **Handover out of date:** fixed in the Oct 15 handover ("Writes return little… Re-fetch with GET").
- **Catalog mapping questions:**
  - `vendor` is not a subSection type.
  - A mapping matches the exact subSection `type` + `id`.
  - The ids are discovery ids.

## Program views

Not built yet. Every request sends `Project-Code: THRIWE_APP` (decision 2). The Oct 16 handover is enough to plan them; this is what each part needs.

**Seeing a program's content:**
- A way to pick the program. There's no endpoint that lists programs, so codes have to be typed in or come from configuration.
- Requests sent with the program's `Project-Code`. GET then returns the base plus the program's own changes. It only includes entities mapped to the program, and inside them only subSections whose exact catalog item (`partner`, `facility` or `service` + discovery id) is mapped. Clauses directly under the entity are always visible. `THRIWE_APP` skips both checks.
- The subsection list in the filter bar comes from what the program can see, so it follows from the same GET.

**Editing as a program:**
- Edits, adds and deletes apply to that program only. Delete is worded "Remove for this program", without the "deletes for every program" confirmation.
- Revert and History per clause. Revert is shown only on clauses the program has changed or removed, and never for `THRIWE_APP`. Both depend on open questions 8 to 10.
- Create is hidden: only `THRIWE_APP` can create a document.
- Writing to a clause in an unmapped subSection returns 403. Before a program adds clauses under a partner, facility or service, the UI should check that the program has that catalog mapping.

**Managing mappings:**
- Entity mappings: map, remove (a soft delete that keeps the program's clauses and catalog mappings) and restore.
- Catalog mappings: map partners, facilities and services under an entity, and remove them. A removed catalog mapping hides the program's clauses in that subSection until it's mapped again; there's no restore. This needs open question 11 answered and the discovery decision above.

The handover also notes that catalog ids aren't checked against discovery yet (each name is saved as its id), and that there's no endpoint yet to list partners, facilities and services to pick from.

## Fixed lists

| List | Values | Validated by the backend |
|---|---|---|
| Entities | 17 entities, kept in `src/editor/taxonomy.ts`: ids are the kebab-case of the names (`golf-booking`, `airport-transfer-booking`, …). Same list for every document type | Unknown |
| SubSection types | `facility`, `partner`, `service` (`vendor` removed Oct 15, 2026) | Yes |
| Workflow ids | `booking`, `pending`, `confirmed`, `failed`, `modification`, `rescheduling`, `cancellation`, `no-show`, `rentals` (added Oct 15, 2026) | No |

If a document contains a subSection type or workflow id outside these lists, the editor still loads it but flags it, and the value can't be used for new subSections or workflows. An entity outside the list can't be chosen.

## Decisions

Agreed on Oct 14, 2026, and built in this repo:

1. **Save model: (A).** A single Save button.
   - **Order:** new clauses first (a single add for one, `append` for several, split at 500, all or nothing); then one PATCH per edited clause; then removed clauses in batch deletes of up to 50. After that, the scope is reloaded from the backend.
   - **If some requests fail:** the rest stay saved and the failed clauses are highlighted.
   - **If an add or append gets no response:** saving is blocked until the user reloads, so the clauses can't be added twice.
2. **First milestone:** base editing only. Every request sends `Project-Code: THRIWE_APP`; program views (program selector, Revert, History) come later.
3. **Backend:** staging, `https://stag-pgm-mgmt-api.thriwe.com/api/v1` (overridable with `VITE_KB_API_BASE_URL`), with a **Mock / Live** switch in the editor. Mock is an in-memory backend that follows the handover; its sample data comes from the Postman collection, minus the vendor subSections the API no longer accepts. In development, live calls go through a dev-server proxy (see open question 13). On Vercel, a function (`api/kb-proxy.ts`) does the same and adds the token from a server-side Secret, so the token never reaches the browser; the deployment must be behind Vercel Authentication (see the README).
