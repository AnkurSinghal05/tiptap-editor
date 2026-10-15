# Knowledge Base API: frontend integration review

Oct 14, 2026 · updated Oct 15 for the revised handoff (append endpoint, required subSection names), the frontend decisions on workflows and subSection types, and the new clause-write responses

This compares the T&C editor in this repo with the Knowledge Base API described in "Knowledge Base API — Frontend Handoff" (Oct 14, 2026, revised the same day) and the Postman collections, including their recorded responses. It lists what already fits, what the frontend must change, the open questions for the backend, and the decisions needed before the integration is built.

**Summary:** the data model lines up, and the sample documents from Postman load into the editor and match its schema. The main difference is in how saving works. The backend has no "save the whole scope" call. New clauses can now be added in one all-or-nothing call (`POST /knowledge-base/append`), but edits and deletes are still one clause per request. Most of the existing frontend can stay, but its save logic and some editing features have to change. SubSection types and workflow ids stay fixed lists chosen in the frontend, but the lists must be extended to cover the values already in the data.

## What changed in the Oct 15 collection

Clause writes now return only the ids of the clauses they touched, without the updated document:

```json
{ "message": "Success", "code": 200, "data": { "clause_ids": ["cl-3c0d6749-…"] } }
```

| Endpoint | Before | Now |
|---|---|---|
| `POST /knowledge-base/append` | `{ clause_ids, document }` | `{ clause_ids }` (201) |
| `POST /knowledge-base/clauses` (single add) | `{ clause_id, document }` | `{ clause_ids: [id] }` (201) |
| `PATCH /knowledge-base/clauses/{id}` | `{ clause_id, document }` | `{ clause_ids: [id] }` (200) |

**Effect on the frontend:** small. The editor never re-rendered from the returned document; it reloads the selection with GET after a save. It now reads every write's ids from `clause_ids`. Until every endpoint is confirmed, it also still accepts the old single `clause_id`.

**Confirmed so far:** append, single add and PATCH all have recorded `{ clause_ids }` responses in the latest collection. The DELETE example has been removed from the collection, so its response is still unconfirmed.

## What changed in the revised handoff

| Change | Effect on the frontend |
|---|---|
| New `POST /knowledge-base/append`: send only the new parts, in the document shape, all or nothing | All new clauses in a save go in **one** request, so adding clauses can no longer half-succeed. The response's `clause_ids` are in the order the clauses were sent, which is how temporary ids are swapped for real ones |
| Every subSection needs a name (`attrs.name` or a heading), even an existing one | The editor already sets `name` on every subSection; append must send it too |
| At most 500 clauses per request (create and append) | Split larger saves into several append calls |
| Append is documented as **not idempotent** | A retry after a successful but lost response adds the clauses twice (see open question 3) |

## What already matches

- **Same nesting and attributes:** section `id`; subSection `type` / `id` / `name`; workflow `id`; clause `id` / `tags`. Clause content is the same Tiptap JSON.
- **Same filters:** entity, then subSection type + id, then workflow. The backend returns only the matching part, which is how the editor already loads a scope.
- **Clause ids come from the server.** The ids look like `cl-<uuid>`. The editor already gives new clauses a temporary id and swaps in the real one after saving; only the source of the real ids changes.
- **`name` is the source of truth for a subSection's title.** The recorded responses show the backend writes `name` into the heading. A subSection created with heading "Partner Golf Course" and name "Abu Dhabi Golf Course" comes back with heading "Abu Dhabi Golf Course". The editor should do the same: fill the heading from `name` instead of the other way round.

## What has to change in the frontend

| Backend behaviour | Frontend change |
|---|---|
| No "save scope" endpoint. New clauses: single add or `append`. Edits and deletes: one request per clause | **Save** compares the edits with what was loaded. One new clause goes in a single add (`POST /knowledge-base/clauses`); several go in one `append` (split at 500). Then one PATCH per edited clause and one DELETE per deleted clause |
| New clauses always go at the **end** of their container; no moving or reordering | Remove drag handles; "add clause" always adds at the end, so the editor matches what's stored; moving or reordering a saved clause (e.g. by cut and paste) is blocked |
| Titles can't be renamed after creation (names sent for existing containers are ignored) | Titles of existing entities, subSections and workflows become read-only |
| A subSection or workflow with no clauses isn't stored; containers can't be deleted directly | A new subSection or workflow needs at least one clause before saving; deleting a container means deleting its clauses (with a confirmation) |
| The backend accepts any subSection type and workflow id. Real data already uses `vendor`, `rescheduling`, `confirmed`, `modification` and `no-show`, which aren't in the editor's lists | Keep both as **fixed lists** that the user picks from, and extend them to cover the values already in use (see "Fixed lists" below) |
| Entities aren't a fixed list (e.g. `beach-club`); there are 4 document types (`tnc`, `faq`, `sla`, `redemption_process`) | The filter bar gets a document-type dropdown; the entity list comes from the backend instead of the editor's fixed list of verticals |
| Response wrapper `{ message, code, data }`; 400 errors carry field paths | New HTTP client; validation errors highlight the matching clause |
| A document is created once (base only, at least one clause); after that it's added to with `append` and edited clause by clause | A "Create document" mode for entities with no document yet |
| Every request needs a `Project-Code` header | A program selector; programs get Revert and History per clause |
| History snapshots use their own shape (`clause` content plus `tags` and location fields), not a clause node | The History view converts each snapshot back into a clause before displaying it |
| Edits and deletes can still succeed for some clauses and fail for others | Clauses that saved are marked clean; failed ones stay marked unsaved, with the error shown |

## Open questions for the backend

1. **Anyone logged in can act as `THRIWE_APP`.** The handoff says any user can send any `Project-Code`. Anyone could therefore change base T&C for every program, and the change goes live immediately because there's no approval step yet. For member-facing legal text, this should be treated as a blocker before production.
2. **Two editors can overwrite each other.** There's no version check, so the last PATCH silently wins. Saving clause by clause makes this less likely, but it can still happen.
3. **Retried adds create duplicates.** Both `append` and single add are non-idempotent. If a request succeeds but the response is lost (a timeout, a dropped connection), the frontend can't tell whether to retry. Retrying duplicates the clauses; not retrying may lose them. Request: accept an `Idempotency-Key` header and return the original response when the same key is seen again.
4. **There's no "list entities" endpoint for the base program.** Without one, `THRIWE_APP` can only pick entities that already have a document. Creating the first document for a new entity would need a typed-in entity id, or a new list endpoint.
5. **Should the backend enforce the same fixed lists?** The frontend will only offer values from its lists, but the backend accepts anything. Postman, scripts or other clients can therefore still add a value outside the lists, such as `noshow` instead of `no-show`. For example, the Oct 15 collection appended a workflow `rentals` before it was in the list (it has since been added). Request: validate subSection `type` and workflow `id` against the same lists, and agree on where those lists live so both sides stay in sync.
6. **Does DELETE return `{ clause_ids }` too?** The latest collection no longer has a DELETE example (the earlier one showed the old `{ clause_id, document }`). The frontend accepts both, but the shape should be confirmed. The same goes for create (`POST /knowledge-base`), whose example still returns the whole document.
7. **Please update the handoff document.** The latest revision still says the single-clause writes return `clause_id` and the updated document, and that the UI should "re-render from the mutation response". Its "What's new" table also says single add has no change to its response.

**Resolved since the first review:**

- **SubSection name vs heading:** `name` wins (see "What already matches").
- **Title of a new workflow:** the frontend always sends a heading. When a workflow is created, its heading starts as the label of the chosen workflow (e.g. "Booking", "Cancellation"). The user can edit it before the first save; after that it's read-only, because the backend doesn't support renaming. A heading is mandatory.
- **Free-form vs fixed values:** subSection types and workflow ids are fixed lists. The user picks from them when creating a subSection or workflow; there's no free-text entry.

## Coming later: program catalog mappings

The latest collection adds `/program-catalog-mappings` (create, list, delete), which will limit what a program sees by partner, facility and service. The handoff says it isn't needed yet, so nothing is built for it. Questions to settle before it is:

- **Vendors:** `mapping_type` is `partner`, `facility` or `service`, but subSections can also be `vendor`. Can a program be limited to certain vendors?
- **Hierarchy:** a facility mapping carries a `partner_id`, and a service mapping a `partner_id` and optionally a `facility_id`. In documents, subSections are flat (one `type` + `id`). How does a mapping select subSections: by `facility_id` = subSection `id` with type `facility`, and so on?
- **Ids:** are `partner_id` / `facility_id` / `service_id` the same values as subSection ids (e.g. `PTR-0042`, `FAC-DXB-T3`)?

## Fixed lists

Agreed values (Oct 14, 2026). They include the values already in the stored data, so existing documents load without errors:

| List | Values |
|---|---|
| SubSection types | `facility`, `partner`, `service`, `vendor` |
| Workflow ids | `booking`, `pending`, `confirmed`, `failed`, `modification`, `rescheduling`, `cancellation`, `no-show`, `rentals` (added Oct 15, 2026) |

If a document from the backend contains a value outside these lists, the editor still loads it but flags it, and it can't be used for new subSections or workflows.

## Decisions

Agreed on Oct 14, 2026, and built in this repo:

1. **Save model: (A).** A single Save button. New clauses go first: a single add (`POST /knowledge-base/clauses`) when there's one, one `append` call when there are several (split at 500 clauses, all or nothing). Then one PATCH per edited clause and one DELETE per deleted clause, then the scope is reloaded from the backend. If some requests fail, the rest stay saved and the failed clauses are highlighted. If an add or append gets no response at all, saving is blocked until the user reloads, so the clauses can't be added twice.
2. **First milestone:** base editing only. Every request sends `Project-Code: THRIWE_APP`; program views (program selector, Revert, History) come later.
3. **Backend URL:** a placeholder (`VITE_KB_API_BASE_URL` in `.env.example`). Until it's set, the editor uses an in-memory mock that follows this handoff and is seeded with the documents from the Postman collection.
