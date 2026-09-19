// The data-plane flow, framework-agnostic. Nothing here is React-specific — the
// same file appears in the Svelte client. The file goes browser -> storage
// directly; only the tiny JSON calls hit our server.

export async function listUploads() {
  const res = await fetch("/uploads");
  return res.json();
}

export async function uploadFile(file, onStatus) {
  // 1. Ask the server to sign an upload (control plane).
  onStatus("Requesting signature…");
  const signRes = await fetch("/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  if (!signRes.ok) {
    const { error } = await signRes.json().catch(() => ({}));
    throw new Error(error ?? `Rejected (${signRes.status})`);
  }
  const { id, upload } = await signRes.json();

  // 2. POST the bytes straight to storage. Policy fields first, file LAST.
  onStatus("Uploading to storage…");
  const form = new FormData();
  Object.entries(upload.fields).forEach(([k, v]) => form.append(k, v));
  form.append("file", file);
  const putRes = await fetch(upload.url, { method: "POST", body: form });
  if (!putRes.ok) {
    throw new Error(`Storage rejected the upload (${putRes.status})`);
  }

  // 3. Ask the server to verify + mark complete.
  onStatus("Verifying…");
  await fetch(`/uploads/${id}/complete`, { method: "POST" });
}

export async function downloadUrl(id) {
  const res = await fetch(`/uploads/${id}/url`);
  const { url } = await res.json();
  return url;
}

export async function deleteUpload(id) {
  // Hard delete: server removes the object then the row, and replies 204 (no
  // body — don't parse it). A repeat delete of an already-gone row is a 404.
  const res = await fetch(`/uploads/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    throw new Error(error ?? `Delete failed (${res.status})`);
  }
}
