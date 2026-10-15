import type { Node as PMNode } from "@tiptap/pm/model";

// Stable keys for containers, matching how the backend identifies them:
// the entity, subSection (type + id) within it, workflow (id) within that.
export const sectionKey = (section: PMNode) => `section:${section.attrs.id}`;
export const subSectionKey = (parentKey: string, sub: PMNode) =>
  `${parentKey}/sub:${sub.attrs.type}:${sub.attrs.id}`;
export const workflowKey = (parentKey: string, wf: PMNode) => `${parentKey}/wf:${wf.attrs.id}`;

export interface ContainerVisit {
  node: PMNode;
  pos: number;
  key: string;
}

// Visits every section, subSection and workflow with its key.
export const forEachContainer = (doc: PMNode, fn: (visit: ContainerVisit) => void) => {
  doc.forEach((section, sectionOffset) => {
    const sKey = sectionKey(section);
    fn({ node: section, pos: sectionOffset, key: sKey });
    section.forEach((sub, subOffset) => {
      if (sub.type.name !== "subSection") return;
      const subPos = sectionOffset + 1 + subOffset;
      const subKey = subSectionKey(sKey, sub);
      fn({ node: sub, pos: subPos, key: subKey });
      sub.forEach((wf, wfOffset) => {
        if (wf.type.name !== "workflow") return;
        fn({ node: wf, pos: subPos + 1 + wfOffset, key: workflowKey(subKey, wf) });
      });
    });
  });
};

export const titleOf = (container: PMNode) => container.firstChild?.textContent.trim() ?? "";
