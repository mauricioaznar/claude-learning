<script>
  import { onMount } from "svelte";
  import { listUploads, uploadFile, downloadUrl } from "./api.js";

  let rows = [];
  let status = "";
  let busy = false;
  let fileInput;

  const fmtSize = (b) =>
    b < 1024
      ? `${b} B`
      : b < 1024 * 1024
        ? `${(b / 1024).toFixed(0)} KB`
        : `${(b / 1024 / 1024).toFixed(1)} MB`;

  async function refresh() {
    rows = await listUploads();
  }
  onMount(refresh);

  async function onUpload() {
    const file = fileInput.files[0];
    if (!file) {
      status = "Pick a PDF first.";
      return;
    }
    busy = true;
    try {
      await uploadFile(file, (s) => (status = s));
      status = "Done.";
      fileInput.value = "";
      await refresh();
    } catch (e) {
      status = e.message;
    } finally {
      busy = false;
    }
  }

  async function onDownload(id) {
    window.open(await downloadUrl(id), "_blank");
  }
</script>

<main>
  <h1>File uploads <span class="tag">nestjs + svelte</span></h1>
  <p class="hint">
    PDF only, up to the server's size cap. The file goes straight to storage — it
    never passes through this server.
  </p>

  <section class="uploader">
    <input type="file" accept="application/pdf" bind:this={fileInput} />
    <button on:click={onUpload} disabled={busy}>Upload</button>
    <span class="status">{status}</span>
  </section>

  <h2>Uploads</h2>
  <ul class="list">
    {#if rows.length === 0}
      <li class="empty">No uploads yet.</li>
    {/if}
    {#each rows as r (r.id)}
      <li>
        <div>
          <div class="name">{r.filename}</div>
          <div class="meta">
            {fmtSize(r.size)} · {new Date(r.createdAt).toLocaleString()}
          </div>
        </div>
        <div class="row-actions">
          <span class="badge {r.status}">{r.status}</span>
          {#if r.status === "uploaded"}
            <button class="link" on:click={() => onDownload(r.id)}>Download</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</main>
