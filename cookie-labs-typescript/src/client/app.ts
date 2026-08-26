// Scaffolded SPA: a login view and a dashboard view, plus tiny history-based
// routing. This is the "beginning" client — it just calls the API with fetch.
//
// The token transport is the part you'll build:
//   Phase 1 — hold the access token in a module variable, send it as
//             `Authorization: Bearer <token>`, and route calls through an
//             `authedFetch` wrapper.
//   Phase 2 — on a 401, refresh once and retry, collapsing concurrent refreshes
//             with a single-flight promise.
// Search for TODO(phase-1) / TODO(phase-2) below for where each hooks in.

const app = document.querySelector<HTMLElement>("#app")!;

interface User {
  displayName: string;
  username: string;
}

function navigate(path: string): void {
  history.pushState({}, "", path);
  void render();
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const link = target.closest<HTMLAnchorElement>("a[data-link]");
  if (!link) return;
  event.preventDefault();
  navigate(link.getAttribute("href") ?? "/");
});

window.addEventListener("popstate", () => void render());

async function fetchMe(): Promise<User | null> {
  // TODO(phase-1): route this through authedFetch so it carries the Bearer token.
  const res = await fetch("/api/me");
  if (!res.ok) return null;
  return (await res.json()) as User;
}

function loginView(): void {
  app.innerHTML = `
    <section class="card">
      <h1>Sign in</h1>
      <form id="login-form">
        <label>Username <input name="username" autocomplete="username" required value="mau" /></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required value="hunter2" /></label>
        <button type="submit">Log in</button>
      </form>
      <p class="hint">Try <code>mau</code> / <code>hunter2</code></p>
      <p class="error" id="error" hidden></p>
    </section>
  `;

  const error = document.querySelector<HTMLParagraphElement>("#error")!;
  const form = document.querySelector<HTMLFormElement>("#login-form")!;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;

    const data = new FormData(form);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        password: data.get("password"),
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      error.textContent = body.error ?? "Login failed";
      error.hidden = false;
      return;
    }

    // TODO(phase-1): read { accessToken } from the response body and store it in memory.
    navigate("/dashboard");
  });
}

function dashboardView(user: User): void {
  app.innerHTML = `
    <section class="card">
      <h1>Hello, <span id="display-name"></span></h1>
      <p>You are signed in as <code id="username"></code>.</p>
      <button id="logout">Log out</button>
    </section>
  `;

  document.querySelector<HTMLSpanElement>("#display-name")!.textContent = user.displayName;
  document.querySelector<HTMLElement>("#username")!.textContent = user.username;

  document.querySelector<HTMLButtonElement>("#logout")!.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    // TODO(phase-1): also drop the in-memory access token here.
    navigate("/login");
  });
}

async function render(): Promise<void> {
  const user = await fetchMe();

  if (!user) {
    if (location.pathname !== "/login") return navigate("/login");
    return loginView();
  }

  if (location.pathname !== "/dashboard") return navigate("/dashboard");
  dashboardView(user);
}

void render();
