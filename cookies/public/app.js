const app = document.querySelector("#app");

function navigate(path) {
  history.pushState({}, "", path);
  render();
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-link]");
  if (!link) return;
  event.preventDefault();
  navigate(link.getAttribute("href"));
});

window.addEventListener("popstate", render);

async function fetchMe() {
  const res = await fetch("/api/me");
  if (!res.ok) return null;
  return res.json();
}

function loginView() {
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

  const error = document.querySelector("#error");

  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;

    const form = new FormData(event.target);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      error.textContent = body.error ?? "Login failed";
      error.hidden = false;
      return;
    }

    navigate("/dashboard");
  });
}

function dashboardView(user) {
  app.innerHTML = `
    <section class="card">
      <h1>Hello, <span id="display-name"></span></h1>
      <p>You are signed in as <code id="username"></code>.</p>
      <button id="logout">Log out</button>
    </section>
  `;

  document.querySelector("#display-name").textContent = user.displayName;
  document.querySelector("#username").textContent = user.username;

  document.querySelector("#logout").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    navigate("/login");
  });
}

async function render() {
  const user = await fetchMe();

  if (!user) {
    if (location.pathname !== "/login") return navigate("/login");
    return loginView();
  }

  if (location.pathname !== "/dashboard") return navigate("/dashboard");
  dashboardView(user);
}

render();
