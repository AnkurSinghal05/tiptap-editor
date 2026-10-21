import type { JSONContent } from "@tiptap/core";
import { MAX_CLAUSES_PER_DELETE, MAX_CLAUSES_PER_REQUEST } from "./config";
import { KbApiError, type KbApi } from "./client";
import { MOCK_ENTITIES, MOCK_SEED } from "./mockSeed";
import { DOC_TYPES, type AddClauseBody, type DocType, type FieldError, type KbDocument } from "./types";

// In-memory stand-in for the Knowledge Base API, following the backend's
// frontend handoff (base program only). State resets on page reload.

export interface MockKbOptions {
  latencyMs?: number;
  seed?: KbDocument[];
  // Test hook: return an error to make a request fail.
  failWith?: (op: "add" | "append" | "update" | "delete" | "create", clauseId?: string) => KbApiError | null;
}

const clone = <T>(value: T): T => structuredClone(value);
const kids = (node: JSONContent) => node.content ?? [];
const isClause = (n: JSONContent) => n.type === "clause";
const textOf = (n: JSONContent | undefined): string =>
  !n ? "" : n.text ?? kids(n).map(textOf).join("");
const headingNode = (level: 1 | 2 | 3, text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const titleCase = (id: string) => id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

const countClauses = (node: JSONContent): number =>
  kids(node).reduce((n, c) => n + (isClause(c) ? 1 : countClauses(c)), 0);

// Within each container: heading, then clauses, then child containers.
// Containers without any clauses are not stored.
const normalize = (node: JSONContent): JSONContent => {
  const heading = kids(node).filter((c) => c.type === "heading");
  const clauses = kids(node).filter(isClause);
  const children = kids(node)
    .filter((c) => c.type === "subSection" || c.type === "workflow")
    .map(normalize)
    .filter((c) => countClauses(c) > 0);
  return { ...node, content: [...heading, ...clauses, ...children] };
};

// The API accepts only these subSection types (not `vendor`).
const SUBSECTION_TYPES = ["partner", "facility", "service"];
const SUBSECTION_TYPE_ERROR = "A subSection type must be partner, facility or service";

const cleanClause = (c: JSONContent, id: string): JSONContent => ({
  type: "clause",
  attrs: { id, tags: Array.isArray(c.attrs?.tags) ? c.attrs!.tags : [] },
  content: c.content,
});

// Validation shared by create and append (handoff "Document format" rules).
const validateDocument = (body: KbDocument, { requireHeading }: { requireHeading: boolean }) => {
  const errors: FieldError[] = [];
  if (!DOC_TYPES.some((t) => t.value === body.type)) errors.push({ field: "type", message: "is invalid" });
  const top = kids(body.doc);
  if (top.length !== 1 || top[0].type !== "section") {
    errors.push({ field: "doc.content", message: "must contain exactly one section" });
    return errors;
  }
  const section = top[0];
  const sp = "doc.content[0]";
  const sectionId = section.attrs?.id;
  if (!sectionId) errors.push({ field: `${sp}.attrs.id`, message: "is required" });
  else if (String(sectionId).length > 100) errors.push({ field: `${sp}.attrs.id`, message: "must be at most 100 characters" });
  if (requireHeading && !textOf(kids(section).find((c) => c.type === "heading")).trim()) {
    errors.push({ field: `${sp}`, message: "section needs a heading with text" });
  }

  let total = 0;
  const checkClause = (c: JSONContent, path: string) => {
    total++;
    if (!c.content || c.content.length === 0) errors.push({ field: `${path}.content`, message: "must not be empty" });
    const tags = c.attrs?.tags;
    if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))) {
      errors.push({ field: `${path}.attrs.tags`, message: "must be an array of strings" });
    }
  };
  // At most one heading per container, and only the node types it allows.
  const checkChildren = (container: JSONContent, path: string, allowed: string[]) => {
    if (kids(container).filter((c) => c.type === "heading").length > 1) {
      errors.push({ field: path, message: "can have at most one heading" });
    }
    kids(container).forEach((c, i) => {
      if (!allowed.includes(c.type ?? "")) {
        errors.push({ field: `${path}.content[${i}]`, message: `${c.type ?? "node"} is not allowed in a ${container.type}` });
      }
    });
  };

  // A workflow directly under the section gets its own error below.
  checkChildren(section, sp, ["heading", "clause", "subSection", "workflow"]);
  const subKeys = new Set<string>();
  kids(section).forEach((child, i) => {
    const path = `${sp}.content[${i}]`;
    if (isClause(child)) return checkClause(child, path);
    if (child.type === "workflow") return errors.push({ field: path, message: "workflow must be inside a subSection" });
    if (child.type !== "subSection") return;
    const { type, id, name } = child.attrs ?? {};
    if (!type) errors.push({ field: `${path}.attrs.type`, message: "is required" });
    else if (!SUBSECTION_TYPES.includes(type)) errors.push({ field: `${path}.attrs.type`, message: SUBSECTION_TYPE_ERROR });
    if (!id) errors.push({ field: `${path}.attrs.id`, message: "is required" });
    else if (String(id).length > 100) errors.push({ field: `${path}.attrs.id`, message: "must be at most 100 characters" });
    if (!String(name ?? "").trim() && !textOf(kids(child).find((c) => c.type === "heading")).trim()) {
      errors.push({ field: `${path}.attrs.name`, message: "is required" });
    }
    if (subKeys.has(`${type}:${id}`)) {
      errors.push({ field: `${path}.attrs.id`, message: "duplicate subSection type and id in this section" });
    }
    subKeys.add(`${type}:${id}`);

    checkChildren(child, path, ["heading", "clause", "workflow"]);
    const wfIds = new Set<string>();
    kids(child).forEach((wf, j) => {
      const wpath = `${path}.content[${j}]`;
      if (isClause(wf)) return checkClause(wf, wpath);
      if (wf.type !== "workflow") return;
      const wid = wf.attrs?.id;
      if (!wid) errors.push({ field: `${wpath}.attrs.id`, message: "is required" });
      else if (wfIds.has(wid)) errors.push({ field: `${wpath}.attrs.id`, message: "duplicate workflow id in this subSection" });
      wfIds.add(wid);
      checkChildren(wf, wpath, ["heading", "clause"]);
      kids(wf).forEach((c, k) => isClause(c) && checkClause(c, `${wpath}.content[${k}]`));
    });
  });

  if (total === 0) errors.push({ field: "doc", message: "must contain at least one clause" });
  if (total > MAX_CLAUSES_PER_REQUEST) {
    errors.push({ field: "doc", message: `must contain at most ${MAX_CLAUSES_PER_REQUEST} clauses` });
  }
  return errors;
};

// Validation for a single add (handoff "Add a clause").
const validateAddClause = (body: AddClauseBody) => {
  const errors: FieldError[] = [];
  if (!DOC_TYPES.some((t) => t.value === body.type)) errors.push({ field: "type", message: "is invalid" });
  if (!body.entity_id) errors.push({ field: "entity_id", message: "is required" });
  if (body.workflow && !body.sub_section) errors.push({ field: "sub_section", message: "is required when workflow is given" });
  if (body.sub_section) {
    if (!body.sub_section.type) errors.push({ field: "sub_section.type", message: "is required" });
    else if (!SUBSECTION_TYPES.includes(body.sub_section.type)) errors.push({ field: "sub_section.type", message: SUBSECTION_TYPE_ERROR });
    if (!body.sub_section.id) errors.push({ field: "sub_section.id", message: "is required" });
    else if (body.sub_section.id.length > 100) errors.push({ field: "sub_section.id", message: "must be at most 100 characters" });
  }
  if (body.workflow && !body.workflow.id) errors.push({ field: "workflow.id", message: "is required" });
  if (!body.clause?.content || body.clause.content.length === 0) errors.push({ field: "clause.content", message: "must not be empty" });
  const tags = body.clause?.attrs?.tags;
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))) {
    errors.push({ field: "clause.attrs.tags", message: "must be an array of strings" });
  }
  return errors;
};

export const createMockKbApi = (options: MockKbOptions = {}): KbApi => {
  const latency = options.latencyMs ?? 250;
  const delay = () => new Promise((r) => setTimeout(r, latency));
  // key: `${type}:${entityId}` → section node
  const store = new Map<string, JSONContent>();
  for (const d of options.seed ?? MOCK_SEED) {
    const section = kids(d.doc)[0];
    store.set(`${d.type}:${section.attrs!.id}`, normalize(clone(section)));
  }

  const toDocument = (type: DocType, section: JSONContent): KbDocument | null =>
    countClauses(section) > 0 ? { type, doc: { type: "doc", content: [clone(section)] } } : null;

  const getSection = (type: DocType, entityId: string) => {
    const section = store.get(`${type}:${entityId}`);
    if (!section || countClauses(section) === 0) throw new KbApiError(404, "Knowledge base not found for this type and entity");
    return section;
  };

  // Finds a clause and its parent container in a stored section.
  const locate = (section: JSONContent, clauseId: string): { parent: JSONContent; index: number } | null => {
    const visit = (node: JSONContent): ReturnType<typeof locate> => {
      const list = kids(node);
      for (let i = 0; i < list.length; i++) {
        if (isClause(list[i]) && list[i].attrs?.id === clauseId) return { parent: node, index: i };
        if (!isClause(list[i])) {
          const found = visit(list[i]);
          if (found) return found;
        }
      }
      return null;
    };
    return visit(section);
  };

  const fail = (op: Parameters<NonNullable<MockKbOptions["failWith"]>>[0], clauseId?: string) => {
    const err = options.failWith?.(op, clauseId);
    if (err) throw err;
  };

  const appendCore = (body: KbDocument) => {
    const errors = validateDocument(body, { requireHeading: false });
    if (errors.length) throw new KbApiError(400, "validation_error", errors);
    const incoming = kids(body.doc)[0];
    const section = clone(getSection(body.type, incoming.attrs!.id));
    const clauseIds: string[] = [];
    const newClause = (c: JSONContent) => {
      const id = `cl-${uuid()}`;
      clauseIds.push(id);
      return cleanClause(c, id);
    };
    // New clauses go after the container's last clause; new containers at the end.
    const addClauses = (container: JSONContent, clauses: JSONContent[]) => {
      const list = kids(container);
      let at = list.length;
      while (at > 0 && !isClause(list[at - 1]) && list[at - 1].type !== "heading") at--;
      container.content = [...list.slice(0, at), ...clauses, ...list.slice(at)];
    };

    addClauses(section, kids(incoming).filter(isClause).map(newClause));
    for (const sub of kids(incoming).filter((c) => c.type === "subSection")) {
      let target = kids(section).find(
        (c) => c.type === "subSection" && c.attrs?.type === sub.attrs?.type && c.attrs?.id === sub.attrs?.id,
      );
      if (!target) {
        const name = String(sub.attrs?.name ?? "").trim() || textOf(kids(sub).find((c) => c.type === "heading")).trim();
        target = { type: "subSection", attrs: { type: sub.attrs!.type, id: sub.attrs!.id, name }, content: [headingNode(2, name)] };
        section.content = [...kids(section), target];
      }
      addClauses(target, kids(sub).filter(isClause).map(newClause));
      for (const wf of kids(sub).filter((c) => c.type === "workflow")) {
        let wfTarget = kids(target).find((c) => c.type === "workflow" && c.attrs?.id === wf.attrs?.id);
        if (!wfTarget) {
          const title = textOf(kids(wf).find((c) => c.type === "heading")).trim() || titleCase(wf.attrs!.id);
          wfTarget = { type: "workflow", attrs: { id: wf.attrs!.id }, content: [headingNode(3, title)] };
          target.content = [...kids(target), wfTarget];
        }
        addClauses(wfTarget, kids(wf).filter(isClause).map(newClause));
      }
    }

    const stored = normalize(section);
    store.set(`${body.type}:${incoming.attrs!.id}`, stored);
    return { clause_ids: clauseIds };
  };

  return {
    async listEntities() {
      await delay();
      return clone(MOCK_ENTITIES);
    },
    async listDocuments(params) {
      await delay();
      const errors: FieldError[] = [];
      if (!!params.sub_section_type !== !!params.sub_section_id) {
        errors.push({ field: "sub_section_type", message: "sub_section_type and sub_section_id go together" });
      }
      // The backend can't list documents across entities.
      if (!params.entity_id) errors.push({ field: "entity_id", message: "is required" });
      if (params.workflow_id && !params.sub_section_id) errors.push({ field: "workflow_id", message: "needs the subSection filter" });
      const limit = params.limit ?? 10;
      const offset = params.offset ?? 0;
      if (limit < 1 || limit > 100) errors.push({ field: "limit", message: "must be between 1 and 100" });
      if (offset < 0) errors.push({ field: "offset", message: "must be 0 or more" });
      if (errors.length) throw new KbApiError(400, "validation_error", errors);

      const documents: KbDocument[] = [];
      const keys = [...store.keys()].sort((a, b) => {
        const [ta, ea] = a.split(/:(.*)/s);
        const [tb, eb] = b.split(/:(.*)/s);
        return ea.localeCompare(eb) || ta.localeCompare(tb);
      });
      for (const key of keys) {
        const [type, entityId] = key.split(/:(.*)/s) as [DocType, string];
        if (params.type && params.type !== type) continue;
        if (params.entity_id && params.entity_id !== entityId) continue;
        let section = store.get(key)!;

        if (params.sub_section_id) {
          const sub = kids(section).find(
            (c) => c.type === "subSection" && c.attrs?.type === params.sub_section_type && c.attrs?.id === params.sub_section_id,
          );
          if (!sub) continue;
          let prunedSub = sub;
          if (params.workflow_id) {
            const wf = kids(sub).find((c) => c.type === "workflow" && c.attrs?.id === params.workflow_id);
            if (!wf) continue;
            prunedSub = { ...sub, content: [...kids(sub).filter((c) => c.type === "heading"), wf] };
          }
          section = { ...section, content: [...kids(section).filter((c) => c.type === "heading"), prunedSub] };
        }
        const doc = toDocument(type, section);
        if (doc) documents.push(doc);
      }
      const total = documents.length;
      return {
        documents: documents.slice(offset, offset + limit),
        pagination: { limit, offset, total, pages: Math.max(1, Math.ceil(total / limit)) },
      };
    },

    async createDocument(body) {
      await delay();
      fail("create");
      const errors = validateDocument(body, { requireHeading: true });
      if (errors.length) throw new KbApiError(400, "validation_error", errors);
      const section = clone(kids(body.doc)[0]);
      const key = `${body.type}:${section.attrs!.id}`;
      if (store.has(key) && countClauses(store.get(key)!) > 0) {
        throw new KbApiError(409, "Knowledge base already exists for this type and entity");
      }
      const assign = (node: JSONContent): JSONContent => {
        if (isClause(node)) return cleanClause(node, `cl-${uuid()}`);
        let content = kids(node).map(assign);
        if (node.type === "subSection") {
          const name = String(node.attrs?.name ?? "").trim() || textOf(kids(node).find((c) => c.type === "heading")).trim();
          content = [headingNode(2, name), ...content.filter((c) => c.type !== "heading")];
          return { type: "subSection", attrs: { type: node.attrs!.type, id: node.attrs!.id, name }, content };
        }
        if (node.type === "workflow") {
          const title = textOf(kids(node).find((c) => c.type === "heading")).trim() || titleCase(node.attrs!.id);
          content = [headingNode(3, title), ...content.filter((c) => c.type !== "heading")];
          return { type: "workflow", attrs: { id: node.attrs!.id }, content };
        }
        return { ...node, content };
      };
      const stored = normalize(assign(section));
      store.set(key, stored);
      return toDocument(body.type, stored)!;
    },

    async append(body) {
      await delay();
      fail("append");
      return appendCore(body);
    },

    async addClause(body) {
      await delay();
      fail("add");
      const errors = validateAddClause(body);
      if (errors.length) throw new KbApiError(400, "validation_error", errors);
      const section = getSection(body.type, body.entity_id);
      const clause: JSONContent = { ...body.clause, type: "clause" };
      let content: JSONContent[] = [clause];
      if (body.sub_section) {
        const existing = kids(section).find(
          (c) => c.type === "subSection" && c.attrs?.type === body.sub_section!.type && c.attrs?.id === body.sub_section!.id,
        );
        // An existing subSection keeps its name; a new one must have one.
        const name = existing ? existing.attrs!.name : String(body.sub_section.name ?? "").trim();
        if (!existing && !name) {
          throw new KbApiError(400, "validation_error", [{ field: "sub_section.name", message: "is required for a new subSection" }]);
        }
        if (body.workflow) {
          const wf: JSONContent = { type: "workflow", attrs: { id: body.workflow.id }, content: [clause] };
          if (body.workflow.heading?.trim()) wf.content!.unshift(headingNode(3, body.workflow.heading.trim()));
          content = [wf];
        }
        content = [{ type: "subSection", attrs: { type: body.sub_section.type, id: body.sub_section.id, name }, content }];
      }
      // Single add shares append's logic.
      const res = appendCore({
        type: body.type,
        doc: { type: "doc", content: [{ type: "section", attrs: { id: body.entity_id }, content }] },
      });
      return { clause_ids: res.clause_ids };
    },

    async updateClause(clauseId, body) {
      await delay();
      fail("update", clauseId);
      const section = clone(getSection(body.type, body.entity_id));
      const found = locate(section, clauseId);
      if (!found) throw new KbApiError(404, "Clause not found");
      const current = kids(found.parent)[found.index];
      const tags = body.clause.attrs?.tags;
      if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))) {
        throw new KbApiError(400, "validation_error", [{ field: "clause.attrs.tags", message: "must be an array of strings" }]);
      }
      if (body.clause.content !== undefined && body.clause.content.length === 0) {
        throw new KbApiError(400, "validation_error", [{ field: "clause.content", message: "must not be empty" }]);
      }
      found.parent.content![found.index] = {
        ...current,
        attrs: { ...current.attrs, tags: tags ?? current.attrs?.tags ?? [] },
        content: body.clause.content ?? current.content,
      };
      store.set(`${body.type}:${body.entity_id}`, section);
      return { clause_ids: [clauseId] };
    },

    async deleteClauses(body) {
      await delay();
      const ids = body.clause_ids;
      const errors: FieldError[] = [];
      if (!Array.isArray(ids) || ids.length === 0) errors.push({ field: "clause_ids", message: "must hold at least 1 id" });
      else if (ids.length > MAX_CLAUSES_PER_DELETE) {
        errors.push({ field: "clause_ids", message: `must hold at most ${MAX_CLAUSES_PER_DELETE} ids` });
      } else {
        ids.forEach((id, i) => {
          if (typeof id !== "string" || !id) errors.push({ field: `clause_ids[${i}]`, message: "must be a non-empty string" });
          else if (ids.indexOf(id) !== i) errors.push({ field: `clause_ids[${i}]`, message: "is a duplicate" });
        });
      }
      if (errors.length) throw new KbApiError(400, "validation_error", errors);
      ids.forEach((id) => fail("delete", id));

      // All or nothing: every id must exist before anything is deleted.
      const section = clone(getSection(body.type, body.entity_id));
      const missing = ids
        .map((id, i) => ({ id, i }))
        .filter(({ id }) => !locate(section, id))
        .map(({ id, i }) => ({ field: `clause_ids[${i}]`, message: `clause ${id} not found` }));
      if (missing.length) throw new KbApiError(404, "Clause not found", missing);

      for (const id of ids) {
        const found = locate(section, id)!;
        found.parent.content!.splice(found.index, 1);
      }
      store.set(`${body.type}:${body.entity_id}`, normalize(section));
      return { clause_ids: [...ids] };
    },
  };
};
