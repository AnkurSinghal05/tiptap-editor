import { createContainerNode } from "./createContainerNode";

export interface SectionAttrs {
  // The entity id (e.g. `golf-booking`), from the backend.
  id: string | null;
}

// Section = an entity (Airport Transfer, Golf Booking, ...). Root-only: the
// document is `section+` and nothing else names `section` in its content.
export const Section = createContainerNode({
  name: "section",
  content: "heading clause* subSection*",
  label: "section",
  deleteBlockedReason: (doc) =>
    doc.childCount <= 1 ? "Document must contain at least one section." : null,
});
