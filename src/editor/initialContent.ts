import type { JSONContent } from "@tiptap/react";
import { generateClauseId, generateSectionId } from "./utils/ids";

export const initialContent: JSONContent = {
  type: "doc",
  content: [
    {
      type: "section",
      attrs: { id: generateSectionId() },
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Payment Terms" }],
        },
        {
          type: "clause",
          attrs: { id: generateClauseId(), tags: ["finance", "important"] },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Payment must be completed within 30 days from invoice generation.",
                },
              ],
            },
          ],
        },
        {
          type: "clause",
          attrs: { id: generateClauseId(), tags: ["late-fee"] },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Late payment may incur additional penalties." },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "section",
      attrs: { id: generateSectionId() },
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Termination" }],
        },
        {
          type: "clause",
          attrs: { id: generateClauseId(), tags: ["legal", "termination"] },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Either party may terminate the agreement with 30 days written notice.",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
