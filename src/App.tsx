import { useCallback, useRef, useState } from "react";
import { Editor, type EditorHandle, type OpenRequest } from "./editor/Editor";
import type { ImportResult, ImportTarget } from "./editor/importJson";
import { ENTITIES, labelOf, type EntityId } from "./editor/taxonomy";
import { DOC_TYPES, type DocType } from "./api/kb/types";
import { Stepper, type StepInfo } from "./components/flow/Stepper";
import { TypeStep, shortTypeLabel } from "./components/flow/TypeStep";
import { VerticalStep } from "./components/flow/VerticalStep";

type Step = "type" | "vertical" | "edit";

const verticalName = (id: string) => ENTITIES.find((e) => e.value === id)?.label ?? id;

// Create flow: document type → vertical → editor. The editor stays mounted
// (hidden on the first two steps), so going back keeps its unsaved changes
// until another document is opened.
export const App = () => {
  const editorRef = useRef<EditorHandle>(null);
  const [step, setStep] = useState<Step>("type");
  const [docType, setDocType] = useState<DocType | null>(null);
  const [entityId, setEntityId] = useState<EntityId | null>(null);
  // What's open in the editor, once something is.
  const [opened, setOpened] = useState<{ docType: DocType; entityId: string } | null>(null);

  const steps: StepInfo<Step>[] = [
    { key: "type", title: "Document type", detail: docType ? labelOf(DOC_TYPES, docType) : "T&C, redemption, FAQ or SLA" },
    { key: "vertical", title: "Vertical", detail: entityId ? verticalName(entityId) : "Golf, airport transfer, meet & greet…" },
    {
      key: "edit",
      title: "Edit",
      detail: opened ? `${shortTypeLabel(opened.docType)} · ${verticalName(opened.entityId)}` : "Sections and clauses",
    },
  ];
  const canGoTo = (key: Step) => key === "type" || (key === "vertical" && !!docType) || (key === "edit" && !!opened);

  const open = (request: OpenRequest): string[] | null => {
    const editor = editorRef.current;
    if (!editor) return ["The editor isn't ready yet. Try again in a moment."];
    if (editor.isDirty() && !window.confirm("The editor has unsaved changes. Discard them and open this document instead?")) {
      return null;
    }
    const errors = editor.open(request);
    if (errors) return errors;
    setOpened({ docType: request.docType, entityId: request.entityId });
    setStep("edit");
    return null;
  };

  const checkJson = useCallback(
    (text: string, target: ImportTarget): ImportResult =>
      editorRef.current?.checkJson(text, target) ?? { ok: false, errors: ["The editor isn't ready yet."] },
    [],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>Tiptap Structured Editor</h1>
        <p>Document → Section → Clause → Blocks</p>
      </header>

      <Stepper steps={steps} current={step} canGoTo={canGoTo} onGoTo={setStep} />

      {step === "type" && <TypeStep value={docType} onChange={setDocType} onNext={() => setStep("vertical")} />}
      {step === "vertical" && docType && (
        <VerticalStep
          docType={docType}
          value={entityId}
          onChange={setEntityId}
          onBack={() => setStep("type")}
          onOpen={open}
          checkJson={checkJson}
        />
      )}

      <div hidden={step !== "edit"}>
        <Editor ref={editorRef} active={step === "edit"} onChangeVertical={() => setStep("vertical")} />
      </div>
    </div>
  );
};
