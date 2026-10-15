# Knowledge Base API: frontend integration review

Oct 14, 2026 · updated Oct 15 for "Knowledge base and mappings API: FE handover" (Oct 15, 2026) and the latest Postman collection

This compares the T&C editor in this repo with the Knowledge Base API, as described in the backend team's FE handover and Postman collection (including their recorded responses). It covers what fits, how the editor uses the API, the open questions for the backend, and the decisions made.

**Summary:** the data model lines up, and the sample documents from Postman load into the editor and match its schema. The backend has no "save the whole scope" call, so the editor's Save turns the edits into per-clause calls:
- new clauses: a single add or one `append`
- edited clauses: a PATCH each
- removed clauses: batch deletes of up to 50

The editor already does this, and reloads with GET after saving.

## What changed in the Oct 15 handover

| Change | Effect on the frontend |
|---|---|
| **Batch delete:** `POST /knowledge-base/clauses/delete` with `{ type, entity_id, clause_ids }`, 1 to 50 ids of one entity, all or nothing. The single `DELETE /knowledge-base/clauses/{id}` is gone | Save sends removed clauses in batches of 50 instead of one request each |
| A batch delete with an unknown id deletes nothing and returns 404, listing each missing id as `clause_ids[<index>]` | Those ids are already gone, so the editor treats them as deleted and retries the rest once |
| **`vendor` is not a subSection type any more.** The API accepts only `partner`, `facility` and `service` (subSections are discovery catalog items) | Removed from the editor's list. Existing vendor subSections are flagged on load (see open question 6) |
| **Writes return only ids:** add, append, update, delete and revert return `{ "clause_ids": [...] }`. Create still returns the document | The editor reads `clause_ids` and reloads with GET after saving |
| **Program catalog mappings** documented: a program sees a subSection only if that exact catalog item is mapped to it | Not used by base editing; see "Program catalog mappings" |

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
| Entities aren't a fixed list; there are 4 document types (`tnc`, `faq`, `sla`, `redemption_process`) | Filter bar with a document-type dropdown; the entity list comes from `GET /knowledge-base` |
| A document is created once (base only, at least one clause) | "+ New entity…" opens a create mode that sends `POST /knowledge-base` |
| Response wrapper `{ message, code, data }`; 400 errors carry field paths | The HTTP client reads the wrapper; validation errors are pinned to the clause they point at |
| Base deletes are final for every program | Save asks for confirmation before deleting clauses |
| Some writes can fail while others succeed | Saved changes are kept; failed clauses stay unsaved and are highlighted with the reason |
| Every request needs `Project-Code` | `THRIWE_APP` for this milestone; program views come later |

## Open questions for the backend

1. **Anyone logged in can act as `THRIWE_APP`.** The handover still lists "Access control per program" as a gap. Anyone could change base T&C for every program, live immediately, with no approval step. For member-facing legal text, this should be treated as a blocker before production.
2. **Two editors can overwrite each other.** There's no version check, so the last PATCH silently wins.
3. **Retried adds create duplicates.** Single add and append aren't idempotent. If a request succeeds but the response is lost, retrying duplicates the clauses and not retrying may lose them; the editor blocks saving until a reload in that case. Request: accept an `Idempotency-Key` header. (Batch delete is safe to retry: ids that are already gone come back as a 404, and the editor treats them as deleted.)
4. **There's no "list entities" endpoint for the base program.** `THRIWE_APP` can only pick entities that already have a document; a new entity's id has to be typed in.
5. **Should the backend validate workflow ids too?** subSection types are now validated; workflow ids still accept anything, so other clients can add values outside the agreed list (`noshow` instead of `no-show`). `rentals` arrived this way before it was added to the list.
6. **What happens to existing `vendor` subSections?** Data recorded on Oct 14 has vendor subSections (`V-1` Caddie Services, `VND-0031` Watersports Desk, `VND-0045` Poolside Cafe). The editor loads them but flags them. Adding a clause to one would likely be rejected, since append and single add send the subSection's type. Will they be migrated to partner / facility / service, or removed?

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

## Program catalog mappings

Not used by base editing; relevant once program views are built. A program sees an entity's documents only if it has an **entity mapping** to that entity. Inside a mapped entity, it sees a subSection only if that exact catalog item (`partner`, `facility` or `service` + discovery id) has a **catalog mapping** under the same entity; clauses directly under the entity are always visible. `THRIWE_APP` skips both checks.

For program views this means:
- **Filter lists:** the subsection list in the filter bar must come from what the program can see.
- **Errors:** writing to a clause in an unmapped subSection returns 403.

The handover also notes that catalog id validation is off for testing, and that there's no endpoint yet to list partners, facilities and services to pick from.

## Fixed lists

| List | Values | Validated by the backend |
|---|---|---|
| SubSection types | `facility`, `partner`, `service` (`vendor` removed Oct 15, 2026) | Yes |
| Workflow ids | `booking`, `pending`, `confirmed`, `failed`, `modification`, `rescheduling`, `cancellation`, `no-show`, `rentals` (added Oct 15, 2026) | No |

If a document contains a value outside these lists, the editor still loads it but flags it, and the value can't be used for new subSections or workflows.

## Decisions

Agreed on Oct 14, 2026, and built in this repo:

1. **Save model: (A).** A single Save button.
   - **Order:** new clauses first (a single add for one, `append` for several, split at 500, all or nothing); then one PATCH per edited clause; then removed clauses in batch deletes of up to 50. After that, the scope is reloaded from the backend.
   - **If some requests fail:** the rest stay saved and the failed clauses are highlighted.
   - **If an add or append gets no response:** saving is blocked until the user reloads, so the clauses can't be added twice.
2. **First milestone:** base editing only. Every request sends `Project-Code: THRIWE_APP`; program views (program selector, Revert, History) come later.
3. **Backend URL:** a placeholder (`VITE_KB_API_BASE_URL` in `.env.example`). Until it's set, the editor uses an in-memory mock that follows the handover. The mock's sample data comes from the Postman collection, minus the vendor subSections the API no longer accepts.
