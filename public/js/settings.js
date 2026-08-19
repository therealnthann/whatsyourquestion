const settingsOverlay =
  document.getElementById("settings-overlay");

const settingsClose =
  document.getElementById("settings-close");

const themeOptions =
  document.querySelectorAll(".theme-option");

const messageSoundToggle =
  document.getElementById(
    "message-sound-toggle"
  );

const settingsUsername =
  document.getElementById(
    "settings-username"
  );

const settingsUserId =
  document.getElementById(
    "settings-user-id"
  );

const changeUsernameButton =
  document.getElementById(
    "change-username-button"
  );

const logoutButton =
  document.getElementById(
    "logout-button"
  );

let settingsReturnFocus = null;
let usernameChangeReturnFocus = null;


const usernameChangeOverlay =
  document.getElementById(
    "username-change-overlay"
  );

const usernameChangeClose =
  document.getElementById(
    "username-change-close"
  );

const usernameChangeCancel =
  document.getElementById(
    "username-change-cancel"
  );

const usernameChangeForm =
  document.getElementById(
    "change-username-form"
  );

const newUsernameInput =
  document.getElementById(
    "new-username"
  );

const usernameAccessCodeInput =
  document.getElementById(
    "username-access-code"
  );

const usernameChangeError =
  document.getElementById(
    "username-change-error"
  );


const savedTheme =
  localStorage.getItem("theme") ||
  "neutral";

const savedMessageSound =
  localStorage.getItem(
    "messageSound"
  ) !== "false";


function applyTheme(theme) {
  document.documentElement.dataset.theme =
    theme;

  localStorage.setItem(
    "theme",
    theme
  );

  themeOptions.forEach(
    (option) => {
      option.classList.toggle(
        "selected",
        option.dataset.theme === theme
      );
    }
  );
}


function applyMessageSound(enabled) {
  localStorage.setItem(
    "messageSound",
    String(enabled)
  );

  messageSoundToggle.checked =
    enabled;
}


function openSettings() {
  settingsReturnFocus = document.activeElement;

  settingsOverlay.classList.remove(
    "hidden"
  );

  settingsOverlay.setAttribute(
    "aria-hidden",
    "false"
  );

  settingsClose.focus();
}


function closeSettings() {
  settingsOverlay.classList.add(
    "hidden"
  );

  settingsOverlay.setAttribute(
    "aria-hidden",
    "true"
  );

  if (settingsReturnFocus) {
    settingsReturnFocus.focus();
    settingsReturnFocus = null;
  }
}


function openUsernameChange() {
  usernameChangeReturnFocus = document.activeElement;

  usernameChangeError.textContent = "";

  newUsernameInput.value =
    settingsUsername.textContent === "-"
      ? ""
      : settingsUsername.textContent;

  usernameAccessCodeInput.value = "";

  usernameChangeOverlay.classList.remove(
    "hidden"
  );

  newUsernameInput.focus();
}


function closeUsernameChange() {
  usernameChangeOverlay.classList.add(
    "hidden"
  );

  usernameChangeError.textContent = "";

  if (usernameChangeReturnFocus) {
    usernameChangeReturnFocus.focus();
    usernameChangeReturnFocus = null;
  }
}


window.updateSettingsUser =
  function (user) {
    if (!user) {
      return;
    }

    settingsUsername.textContent =
      user.username || "-";

    settingsUserId.textContent =
      `ID: ${user.id}`;
  };


themeOptions.forEach(
  (option) => {
    option.addEventListener(
      "click",
      () => {
        applyTheme(
          option.dataset.theme
        );
      }
    );
  }
);


messageSoundToggle.addEventListener(
  "change",
  () => {
    applyMessageSound(
      messageSoundToggle.checked
    );
  }
);


document
  .getElementById("settings-button")
  .addEventListener(
    "click",
    openSettings
  );

settingsClose.addEventListener(
  "click",
  closeSettings
);

settingsOverlay.addEventListener(
  "click",
  (event) => {
    if (
      event.target === settingsOverlay
    ) {
      closeSettings();
    }
  }
);


changeUsernameButton.addEventListener(
  "click",
  openUsernameChange
);

usernameChangeClose.addEventListener(
  "click",
  closeUsernameChange
);

usernameChangeCancel.addEventListener(
  "click",
  closeUsernameChange
);

usernameChangeOverlay.addEventListener(
  "click",
  (event) => {
    if (
      event.target ===
      usernameChangeOverlay
    ) {
      closeUsernameChange();
    }
  }
);


usernameChangeForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    usernameChangeError.textContent =
      "";

    const username =
      newUsernameInput.value.trim();

    const accessCode =
      usernameAccessCodeInput.value;

    if (!username) {
      usernameChangeError.textContent =
        "Please enter a username.";

      return;
    }

    if (!accessCode) {
      usernameChangeError.textContent =
        "Please enter your access code.";

      return;
    }

    try {
      const response =
        await fetch(
          "/api/change-username",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              username,
              accessCode,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        usernameChangeError.textContent =
          data.error ||
          "Could not change username.";

        return;
      }

      settingsUsername.textContent =
        data.user.username;

      usernameAccessCodeInput.value =
        "";

      closeUsernameChange();

      window.dispatchEvent(
        new CustomEvent(
          "usernameChanged",
          {
            detail: data.user,
          }
        )
      );

    } catch (error) {
      console.error(
        "Username change failed:",
        error
      );

      usernameChangeError.textContent =
        "Could not connect to the server.";
    }
  }
);


logoutButton.addEventListener(
  "click",
  async () => {
    try {
      const response =
        await fetch(
          "/api/logout",
          {
            method: "POST",
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          "Logout failed."
        );
      }

      closeSettings();

      window.location.reload();

    } catch (error) {
      console.error(
        "Logout failed:",
        error
      );
    }
  }
);


document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (
      !usernameChangeOverlay
        .classList
        .contains("hidden")
    ) {
      closeUsernameChange();

      return;
    }

    if (
      !settingsOverlay
        .classList
        .contains("hidden")
    ) {
      closeSettings();
    }
  }
);


applyTheme(savedTheme);

applyMessageSound(
  savedMessageSound
);