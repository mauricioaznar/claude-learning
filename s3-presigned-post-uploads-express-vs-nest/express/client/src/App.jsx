import { useEffect, useRef, useState } from "react";
import { listUploads, uploadFile, downloadUrl, deleteUpload } from "./api.js";

const fmtSize = (b) =>
  b < 1024
    ? `${b} B`
    : b < 1024 * 1024
      ? `${(b / 1024).toFixed(0)} KB`
      : `${(b / 1024 / 1024).toFixed(1)} MB`;

export default function App() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const refresh = async () => setRows(await listUploads());
  useEffect(() => {
    refresh();
  }, []);

  const onUpload = async () => {
    const file = fileRef.current?.files[0];
    if (!file) {
      setStatus("Pick a PDF first.");
      return;
    }
    setBusy(true);
    try {
      await uploadFile(file, setStatus);
      setStatus("Done.");
      fileRef.current.value = "";
      refresh();
    } catch (e) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onDownload = async (id) => {
    window.open(await downloadUrl(id), "_blank");
  };

  // Hard delete — confirm first (bytes are gone for good, no soft-delete here).
  const onDelete = async (id, filename) => {
    if (!window.confirm(`Delete "${filename}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await deleteUpload(id);
      setStatus("Deleted.");
      refresh();
    } catch (e) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>
        File uploads <span className="tag">express + react</span>
      </h1>
      <p className="hint">
        PDF only, up to the server's size cap. The file goes straight to storage
        — it never passes through this server.
      </p>

      <section className="uploader">
        <input type="file" accept="application/pdf" ref={fileRef} />
        <button onClick={onUpload} disabled={busy}>
          Upload
        </button>
        <span className="status">{status}</span>
      </section>

      <h2>Uploads</h2>
      <ul className="list">
        {rows.length === 0 && <li className="empty">No uploads yet.</li>}
        {rows.map((r) => (
          <li key={r.id}>
            <div>
              <div className="name">{r.filename}</div>
              <div className="meta">
                {fmtSize(r.size)} · {new Date(r.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="row-actions">
              <span className={`badge ${r.status}`}>{r.status}</span>
              {r.status === "uploaded" && (
                <button className="link" onClick={() => onDownload(r.id)}>
                  Download
                </button>
              )}
              <button
                className="link danger"
                onClick={() => onDelete(r.id, r.filename)}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
