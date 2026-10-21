import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import type { ApiLog, ApiLogEntry } from "../api/kb/apiLog";

const json = (value: unknown) => JSON.stringify(value, null, 2);

const statusClass = (status: number) =>
  status === 0 ? "api-log__status--none" : status < 300 ? "api-log__status--ok" : "api-log__status--error";

const splitPath = (path: string) => {
  const i = path.indexOf("?");
  return i === -1 ? { pathname: path, search: "" } : { pathname: path.slice(0, i), search: path.slice(i + 1) };
};

// The full URL, with the host and query string muted and line breaks allowed
// after the host and between parameters, so long URLs wrap instead of being
// cut off.
const PathText = ({ path }: { path: string }) => {
  const host = /^https?:\/\/[^/]+/.exec(path)?.[0] ?? "";
  const { pathname, search } = splitPath(path.slice(host.length));
  const params = search ? search.split("&") : [];
  return (
    <span className="api-log__path">
      {host && (
        <>
          <span className="api-log__host">{host}</span>
          <wbr />
        </>
      )}
      {pathname}
      {params.map((param, i) => (
        <Fragment key={i}>
          <wbr />
          <span className="api-log__query">
            {i === 0 ? "?" : "&"}
            {param}
          </span>
        </Fragment>
      ))}
    </span>
  );
};

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (e.g. insecure context); the URL is still selectable.
    }
  };

  return (
    <button type="button" className="api-log__copy" onClick={copy} title={text}>
      {copied ? "Copied" : label}
    </button>
  );
};

// Where the request went: the API URL it reached, else what the browser asked for.
const shownUrl = (entry: ApiLogEntry) => entry.endpoint ?? (entry.via === "mock" ? entry.path : entry.requestUrl);

const routeNote = (entry: ApiLogEntry) => {
  switch (entry.via) {
    case "mock":
      return "Answered by the mock backend in the browser; nothing was sent.";
    case "direct":
      return "Sent straight from the browser to the API.";
    default:
      return entry.endpoint
        ? `Sent to ${splitPath(entry.requestUrl).pathname} on this site, which forwarded it to the API.`
        : `Sent to ${splitPath(entry.requestUrl).pathname} on this site, which didn't forward it to the API (see the response).`;
  }
};

const EntryRow = ({ entry }: { entry: ApiLogEntry }) => {
  const [open, setOpen] = useState(false);
  const { search } = splitPath(entry.path);
  return (
    <details className="api-log__entry" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className={`api-log__method api-log__method--${entry.method.toLowerCase()}`}>{entry.method}</span>
        <PathText path={shownUrl(entry)} />
        <span className={`api-log__status ${statusClass(entry.status)}`}>{entry.status || "no response"}</span>
        <span className="api-log__meta">
          {entry.durationMs} ms · {new Date(entry.at).toLocaleTimeString()}
        </span>
      </summary>
      {/* Bodies can be large documents, so they're only rendered when expanded. */}
      {open && (
        <div className="api-log__body">
          <div className="api-log__actions">
            <span className="api-log__route">{routeNote(entry)}</span>
            <CopyButton text={shownUrl(entry)} label="Copy URL" />
          </div>
          {search && (
            <>
              <h4>Query parameters</h4>
              <table className="api-log__params">
                <tbody>
                  {[...new URLSearchParams(search)].map(([key, value], i) => (
                    <tr key={i}>
                      <th>{key}</th>
                      <td>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
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

// Every API call, mock or live: endpoint, payload and response.
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
      {/* StrictMode only double-runs effects in development builds. */}
      {import.meta.env.DEV && (
        <p className="api-log__note">
          Dev build: React StrictMode runs effects twice when a component first mounts, so a call made at that
          moment shows up twice. The first result is thrown away. Production builds send it once.
        </p>
      )}
      {entries.length === 0 ? (
        <p className="api-log__empty">No API calls yet.</p>
      ) : (
        entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)
      )}
    </div>
  );
};
