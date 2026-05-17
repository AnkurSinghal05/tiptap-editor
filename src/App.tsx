import { Editor } from "./editor/Editor";

export const App = () => {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Tiptap Structured Editor</h1>
        <p>Document → Section → Clause → Blocks</p>
      </header>
      <Editor />
    </div>
  );
};
