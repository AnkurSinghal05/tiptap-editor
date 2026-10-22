import { useCallback, useEffect, useRef, useState } from "react";
import { Editor, type EditorHandle, type OpenRequest } from "./editor/Editor";
import type { ImportResult, ImportTarget } from "./editor/importJson";
import type { FileImport } from "./editor/importFile";
import { labelOf } from "./editor/taxonomy";
import { apiMode, kbApi } from "./api/kb";
import { PROJECTS, PROJECT_CODE, setProjectCode, type ProjectCode } from "./api/kb/config";
import { missingTokenHint } from "./api/kb/errors";
import { DOC_TYPES, type DocType } from "./api/kb/types";
import { Stepper, type StepInfo } from "./components/flow/Stepper";
import { TypeStep, shortTypeLabel } from "./components/flow/TypeStep";
import { VerticalStep, type EntitiesState } from "./components/flow/VerticalStep";

type Step = "type" | "vertical" | "edit";

// Create flow: document type → vertical → editor. The editor stays mounted
// (hidden on the first two steps), so going back keeps its unsaved changes
// until another document is opened.
export const App = () => {
  const editorRef = useRef<EditorHandle>(null);
  const [step, setStep] = useState<Step>("type");
  const [docType, setDocType] = useState<DocType | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null);
  // The verticals, from GET /knowledge-base/entities: fetched the first time
  // step 2 opens, then kept (null until then).
  const [entities, setEntities] = useState<EntitiesState | null>(null);

  const loadEntities = useCallback(() => {
    setEntities({ state: "loading" });
    kbApi.listEntities().then(
      (list) => setEntities({ state: "ready", list }),
      (err: unknown) =>
        setEntities({ state: "error", message: err instanceof Error ? err.message : String(err), hint: missingTokenHint(err) }),
    );
  }, []);

  useEffect(() => {
    if (step === "vertical" && entities === null) loadEntities();
  }, [step, entities, loadEntities]);

  const verticalName = (id: string) =>
    (entities?.state === "ready" ? entities.list.find((e) => e.entity_id === id)?.entity_name : undefined) ?? id;
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

  // The API client, the vertical list and the open document all belong to one
  // project, so switching stores the choice and reloads.
  const switchProject = (code: ProjectCode) => {
    if (code === PROJECT_CODE) return;
    const label = PROJECTS.find((p) => p.code === code)?.label ?? code;
    if (editorRef.current && !editorRef.current.confirmLeave(`You have unsaved changes. Discard them and switch to ${label}?`)) return;
    setProjectCode(code);
    window.location.reload();
  };

  const checkJson = useCallback(
    (text: string, target: ImportTarget): ImportResult =>
      editorRef.current?.checkJson(text, target) ?? { ok: false, errors: ["The editor isn't ready yet."] },
    [],
  );
  const readFile = useCallback(
    (file: File): Promise<FileImport> =>
      editorRef.current?.readFile(file) ?? Promise.reject(new Error("The editor isn't ready yet.")),
    [],
  );

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Tiptap Structured Editor</h1>
          <p>Document → Section → Clause → Blocks</p>
        </div>
        <label
          className="project-switch"
          title={apiMode === "mock" ? "The mock only models Thriwe's base document. Switch to Live to work as a program." : undefined}
        >
          Project
          <select
            value={PROJECT_CODE}
            disabled={apiMode === "mock"}
            onChange={(e) => switchProject(e.target.value as ProjectCode)}
          >
            {PROJECTS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label} ({p.code})
              </option>
            ))}
          </select>
        </label>
      </header>

      <Stepper steps={steps} current={step} canGoTo={canGoTo} onGoTo={setStep} />

      {step === "type" && <TypeStep value={docType} onChange={setDocType} onNext={() => setStep("vertical")} />}
      {step === "vertical" && docType && (
        <VerticalStep
          docType={docType}
          entities={entities}
          onRetryEntities={loadEntities}
          value={entityId}
          onChange={setEntityId}
          onBack={() => setStep("type")}
          onOpen={open}
          checkJson={checkJson}
          readFile={readFile}
        />
      )}

      <div hidden={step !== "edit"}>
        <Editor ref={editorRef} active={step === "edit"} onChangeVertical={() => setStep("vertical")} />
      </div>
    </div>
  );
};
