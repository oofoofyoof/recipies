const itemGrid = document.querySelector("#item-grid");
const itemCount = document.querySelector("#item-count");
const adminLink = document.querySelector("#admin-link");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const adminEditor = document.querySelector("#admin-editor");
const itemForm = document.querySelector("#item-form");
const itemMessage = document.querySelector("#item-message");
let items = [];
let activeFilter = "all";

function renderItems() {
  const visibleItems = activeFilter === "all"
    ? items
    : items.filter((item) => item.rarity === activeFilter);

  itemCount.textContent = items.length;
  if (visibleItems.length === 0) {
    itemGrid.innerHTML = activeFilter === "all"
      ? '<div class="empty-state"><strong>The archive is open.</strong>No Hoplite Mythical or Legendary items have been added yet.</div>'
      : `<div class="empty-state"><strong>No ${activeFilter} items yet.</strong>Check back when the archive grows.</div>`;
    return;
  }

  itemGrid.replaceChildren(...visibleItems.map((item) => {
    const card = document.createElement("article");
    card.className = "recipe-card";

    if (item.imageUrl) {
      const image = document.createElement("img");
      image.className = "recipe-image";
      image.src = item.imageUrl;
      image.alt = item.name;
      image.loading = "lazy";
      card.append(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "recipe-image recipe-image-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.textContent = "✦";
      card.append(placeholder);
    }

    const body = document.createElement("div");
    body.className = "recipe-body";
    const tag = document.createElement("span");
    tag.className = `tag ${item.rarity}`;
    tag.textContent = item.rarity;
    const name = document.createElement("h3");
    name.textContent = item.name;
    const description = document.createElement("p");
    description.textContent = item.description;
    body.append(tag, name, description);

    if (item.guide) {
      const guide = document.createElement("details");
      guide.className = "item-guide";
      const summary = document.createElement("summary");
      summary.textContent = "Recipe or guide";
      const guideText = document.createElement("p");
      guideText.textContent = item.guide;
      guide.append(summary, guideText);
      body.append(guide);
    }

    card.append(body);
    return card;
  }));
}

function showAdminState(isAdmin, configured) {
  loginForm.hidden = isAdmin;
  adminEditor.hidden = !isAdmin;
  adminLink.childNodes[0].textContent = isAdmin ? "Manage items " : "Admin sign in ";
  const passwordInput = loginForm.querySelector('input[name="password"]');
  const loginButton = loginForm.querySelector('button[type="submit"]');
  passwordInput.disabled = !configured;
  loginButton.disabled = !configured;
  if (!configured) {
    loginMessage.textContent = "Admin login is not configured. Set ADMIN_PASSWORD to a password at least 12 characters long.";
    loginMessage.classList.add("error");
  } else {
    loginMessage.textContent = "";
    loginMessage.classList.remove("error");
  }
}

async function loadAdminState() {
  const response = await fetch("/api/auth");
  if (!response.ok) throw new Error("Could not check admin access.");
  const state = await response.json();
  showAdminState(state.isAdmin, state.configured);
}

async function loadItems() {
  try {
    const response = await fetch("/api/items");
    if (!response.ok) throw new Error("Could not load items.");
    items = await response.json();
    renderItems();
  } catch {
    itemGrid.innerHTML = '<div class="empty-state"><strong>Could not open the item archive.</strong>Please refresh the page to try again.</div>';
  }
}

document.querySelectorAll(".filter").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(".filter.active").classList.remove("active");
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    renderItems();
  });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  loginMessage.classList.remove("error");
  loginMessage.textContent = "Signing in…";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: new FormData(loginForm).get("password") }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not sign in.");
    loginForm.reset();
    showAdminState(true, true);
  } catch (error) {
    loginMessage.classList.add("error");
    loginMessage.textContent = error.message || "Could not sign in. Please try again.";
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("Could not sign out.");
    showAdminState(false, true);
  } catch (error) {
    itemMessage.classList.add("error");
    itemMessage.textContent = error.message;
  }
});

itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = itemForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  itemMessage.classList.remove("error");
  itemMessage.textContent = "Adding item…";

  try {
    const response = await fetch("/api/items", {
      method: "POST",
      body: new FormData(itemForm),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        showAdminState(false, true);
        loginMessage.classList.add("error");
        loginMessage.textContent = result.error || "Your admin session expired. Sign in again.";
        return;
      }
      throw new Error(result.error || "Could not save this item.");
    }

    items.unshift(result);
    activeFilter = "all";
    document.querySelectorAll(".filter").forEach((button) => {
      button.classList.toggle("active", button.dataset.filter === "all");
    });
    renderItems();
    itemForm.reset();
    itemMessage.textContent = "Item added to the archive.";
  } catch (error) {
    itemMessage.classList.add("error");
    itemMessage.textContent = error.message || "Could not save this item. Please try again.";
  } finally {
    submitButton.disabled = false;
  }
});

loadItems();
loadAdminState().catch(() => {
  loginMessage.classList.add("error");
  loginMessage.textContent = "Could not check admin access. Refresh the page to try again.";
});
