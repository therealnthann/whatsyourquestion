const loginScreen = document.getElementById("login-screen");
const usernameScreen = document.getElementById("username-screen");
const chatScreen = document.getElementById("chat-screen");

const loginForm = document.getElementById("login-form");
const usernameForm = document.getElementById("username-form");

const accessCodeInput = document.getElementById("access-code");
const usernameInput = document.getElementById("username");

const loginError = document.getElementById("login-error");
const usernameError = document.getElementById("username-error");


window.showScreen = function (screen) {
  loginScreen.classList.add("hidden");
  usernameScreen.classList.add("hidden");
  chatScreen.classList.add("hidden");

  screen.classList.remove("hidden");
};


async function checkSession() {
  try {
    const response = await fetch("/api/me");
    const data = await response.json();

    if (!data.loggedIn) {
      showScreen(loginScreen);
      return;
    }

    if (!data.user.username) {
    showScreen(usernameScreen);
    return;
    }

    if (window.updateSettingsUser) {
    window.updateSettingsUser(data.user);
    }

    showScreen(chatScreen);
  } catch (error) {
    console.error("Session check failed:", error);

    showScreen(loginScreen);
  }
}


loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  loginError.textContent = "";

  const accessCode = accessCodeInput.value;

  if (!accessCode) {
    loginError.textContent =
      "Please enter your access code.";

    return;
  }

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accessCode,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      loginError.textContent =
        data.error || "Login failed.";

      return;
    }

    accessCodeInput.value = "";

    if (data.needsUsername) {
    showScreen(usernameScreen);

    usernameInput.focus();
    } else {
    if (window.updateSettingsUser) {
        window.updateSettingsUser({
        id: data.userId,
        username: data.username,
        });
    }

    showScreen(chatScreen);
    }
  } catch (error) {
    console.error("Login failed:", error);

    loginError.textContent =
      "Could not connect to the server.";
  }
});


usernameForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  usernameError.textContent = "";

  const username = usernameInput.value.trim();

  if (!username) {
    usernameError.textContent =
      "Please enter a username.";

    return;
  }

  try {
    const response = await fetch(
      "/api/setup-username",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      usernameError.textContent =
        data.error || "Could not set username.";

      return;
    }

    usernameInput.value = "";

    if (window.updateSettingsUser) {
      window.updateSettingsUser(data.user);
    }

    showScreen(chatScreen);
  } catch (error) {
    console.error(
      "Username setup failed:",
      error
    );

    usernameError.textContent =
      "Could not connect to the server.";
  }
});


checkSession();