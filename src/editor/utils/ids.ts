// New clauses get a temporary id until the backend assigns the real `cl-…`
// id on save (append returns the new ids in the order the clauses were sent).
const TEMP_PREFIX = "tmp-";

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const generateTempClauseId = () => `${TEMP_PREFIX}${uuid()}`;

export const isTempClauseId = (id: unknown): id is string =>
  typeof id === "string" && id.startsWith(TEMP_PREFIX);
