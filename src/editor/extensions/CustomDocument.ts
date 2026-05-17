import Document from "@tiptap/extension-document";

// Top-level document is a list of sections.
export const CustomDocument = Document.extend({
  content: "section+",
});
