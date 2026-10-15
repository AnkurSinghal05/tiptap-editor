import { confirmDeleteContainer, createContainerNode } from "./createContainerNode";
import type { WorkflowId } from "../taxonomy";

export interface WorkflowAttrs {
  id: WorkflowId | null;
}

// Workflow = a lifecycle stage within a SubSection (Booking, Pending, ...).
// Its id is one of the fixed WORKFLOWS, at most once per subsection.
// Only valid inside a SubSection.
export const Workflow = createContainerNode({
  name: "workflow",
  content: "heading clause*",
  label: "workflow",
  deleteConfirmation: (node) => confirmDeleteContainer(node),
});
