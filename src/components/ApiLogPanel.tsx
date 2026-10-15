import { useState, useSyncExternalStore } from "react";
import type { ApiLog, ApiLogEntry } from "../api/kb/apiLog";

const json = (value: unknown) => JSON.stringify(value, null, 2);

const statusClass = (status: number) =>
  status === 0 ? "api-log__status--none" : status < 300 ? "api-log__status--ok" : "api-log__status--error";

const EntryRow = ({ entry }: { entry: ApiLogEntry }) => {
  const [open, setOpen] = useState(false);
  return (
    <details className="api-log__entry" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className={`api-log__method api-log__method--${entry.method.toLowerCase()}`}>{entry.method}</span>
        <span className="api-log__path">{entry.path}</span>
        <span className={`api-log__status ${statusClass(entry.status)}`}>{entry.status || "no response"}</span>
        <span className="api-log__meta">
          {entry.durationMs} ms · {new Date(entry.at).toLocaleTimeString()}
        </span>
      </summary>
      {/* Bodies can be large documents, so they're only rendered when expanded. */}
      {open && (
        <div className="api-log__body">
          <h4>Request headers</h4>
          <pre>{json(entry.headers)}</pre>
          {entry.requestBody !== undefined && (
            <>
              <h4>Request body</h4>
              <pre>{json(entry.requestBody)}</pre>
            </>
          )}
          <h4>Response</h4>
          <pre>{json(entry.response)}</pre>
        </div>
      )}
    </details>
  );
};

// Every call made to the mock backend: endpoint, payload and response.
export const ApiLogPanel = ({ log }: { log: ApiLog }) => {
  const entries = useSyncExternalStore(log.subscribe, log.entries);

  const download = () => {
    const blob = new Blob([json([...entries].reverse())], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kb-api-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="panel-body api-log">
      <div className="api-log__toolbar">
        <span>
          {entries.length} call{entries.length === 1 ? "" : "s"} · newest first
        </span>
        <button type="button" onClick={download} disabled={entries.length === 0}>
          Download JSON
        </button>
        <button type="button" onClick={() => log.clear()} disabled={entries.length === 0}>
          Clear
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="api-log__empty">No API calls yet.</p>
      ) : (
        entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)
      )}
    </div>
  );
};
