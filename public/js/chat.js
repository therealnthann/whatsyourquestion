let audioContext = null;

function playMessageSound() {
  const enabled = localStorage.getItem("messageSound") !== "false";

  if (!enabled) {
    return;
  }

  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();

    const gain = audioContext.createGain();

    oscillator.type = "sine";

    oscillator.frequency.setValueAtTime(660, audioContext.currentTime);

    oscillator.frequency.exponentialRampToValueAtTime(
      880,
      audioContext.currentTime + 0.08,
    );

    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);

    gain.gain.exponentialRampToValueAtTime(
      0.12,
      audioContext.currentTime + 0.01,
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      audioContext.currentTime + 0.12,
    );

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start();

    oscillator.stop(audioContext.currentTime + 0.12);
  } catch (error) {
    console.warn("Could not play message sound:", error);
  }
}

let socket = null;
let currentUser = null;

const messagesContainer = document.getElementById("messages");

const messageForm = document.getElementById("message-form");

const messageInput = document.getElementById("message-input");

const typingIndicator = document.getElementById("typing-indicator");

const typingText = document.getElementById("typing-text");

const onlineDot = document.getElementById("online-dot");

const onlineText = document.getElementById("online-text");

const messageCount = document.getElementById("message-count");

const deleteModal = document.getElementById("delete-modal");

const deleteCancel = document.getElementById("delete-cancel");

const deleteConfirm = document.getElementById("delete-confirm");

const unreadIndicator = document.getElementById("unread-indicator");

const unreadCount = document.getElementById("unread-count");

const deleteBackdrop = deleteModal.querySelector(".modal-backdrop");

const messageSearchInput = document.getElementById("message-search-input");

const messageSearchCount = document.getElementById("message-search-count");

const messageSearchClear = document.getElementById("message-search-clear");

let searchResults = [];
let currentSearchResult = -1;

let searchTimeout = null;
let searchRequestId = 0;

function updateSearchClearButton() {
  messageSearchClear.classList.toggle(
    "visible",
    messageSearchInput.value.length > 0,
  );
}

let typingTimeout = null;
let replyToMessage = null;

let tabNotificationActive = false;
let tabIsVisible = document.visibilityState === "visible";

let unreadMessageCount = 0;

const normalFavicon = "/assets/favicon.svg";

const notificationFavicon = "/assets/favicon-notification.svg";

const originalTitle = document.title;

const onlineUsers = new Map();

let messagePendingDelete = null;

async function loadCurrentUser() {
  const response = await fetch("/api/me");

  const data = await response.json();

  if (!data.loggedIn || !data.user) {
    return false;
  }

  currentUser = data.user;

  return true;
}

function updateOnlineStatus() {
  const otherUsers = Array.from(onlineUsers.values()).filter(
    (user) => Number(user.id) !== Number(currentUser.id),
  );

  if (otherUsers.length === 0) {
    onlineDot.classList.remove("online");

    onlineText.textContent = "No one else online";

    return;
  }

  onlineDot.classList.add("online");

  if (otherUsers.length === 1) {
    onlineText.textContent = `${otherUsers[0].username} online`;

    return;
  }

  onlineText.textContent = `${otherUsers.length} others online`;
}

function updateMessageCount(count) {
  const number = Number(count) || 0;

  messageCount.textContent = `${number.toLocaleString()} ${
    number === 1 ? "message" : "messages"
  }`;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getDateKey(timestamp) {
  const date = new Date(timestamp);

  return [date.getFullYear(), date.getMonth(), date.getDate()].join("-");
}

function formatDateSeparator(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();

  const todayKey = getDateKey(now);

  const yesterday = new Date(now);

  yesterday.setDate(yesterday.getDate() - 1);

  const yesterdayKey = getDateKey(yesterday);

  const messageKey = getDateKey(timestamp);

  if (messageKey === todayKey) {
    return "Today";
  }

  if (messageKey === yesterdayKey) {
    return "Yesterday";
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], {
      month: "long",
      day: "numeric",
    });
  }

  return date.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function addDateSeparator(timestamp) {
  const existingMessages = messagesContainer.querySelectorAll(".message");

  if (existingMessages.length === 0) {
    createDateSeparator(timestamp);

    return;
  }

  const previousMessage = existingMessages[existingMessages.length - 1];

  const previousDate = previousMessage.dataset.createdAt;

  if (!previousDate) {
    return;
  }

  if (getDateKey(previousDate) === getDateKey(timestamp)) {
    return;
  }

  createDateSeparator(timestamp);
}

function createDateSeparator(timestamp) {
  const separator = document.createElement("div");

  separator.className = "date-separator";

  const lineLeft = document.createElement("span");

  const text = document.createElement("span");

  const lineRight = document.createElement("span");

  text.textContent = formatDateSeparator(timestamp);

  separator.appendChild(lineLeft);

  separator.appendChild(text);

  separator.appendChild(lineRight);

  messagesContainer.appendChild(separator);
}

function shouldGroupWithPrevious(message) {
  const previous = messagesContainer.lastElementChild;

  if (!previous) {
    return false;
  }

  return previous.dataset.userId === String(message.user_id);
}

function isNearBottom() {
  const threshold = 100;

  return (
    messagesContainer.scrollHeight -
      messagesContainer.scrollTop -
      messagesContainer.clientHeight <=
    threshold
  );
}

function markMessagesAsRead() {
  unreadMessageCount = 0;

  unreadIndicator.classList.add("hidden");

  updateNotificationIndicator();
}

function addUnreadMessage() {
  unreadMessageCount++;

  unreadCount.textContent = unreadMessageCount;

  unreadIndicator.classList.remove("hidden");

  updateNotificationIndicator();
}

unreadIndicator.addEventListener("click", () => {
  scrollToBottom();
  markMessagesAsRead();
});

document.addEventListener("visibilitychange", () => {
  tabIsVisible = document.visibilityState === "visible";

  if (tabIsVisible) {
    if (isNearBottom()) {
      tabNotificationActive = false;

      markMessagesAsRead();

      return;
    }

    tabNotificationActive = false;

    updateNotificationIndicator();
  }
});

function updateNotificationIndicator() {
  const shouldNotify = unreadMessageCount > 0 || tabNotificationActive;

  if (shouldNotify) {
    const total = unreadMessageCount;

    document.title = total > 0 ? `(${total}) ${originalTitle}` : originalTitle;

    setFavicon(notificationFavicon);

    return;
  }

  document.title = originalTitle;

  setFavicon(normalFavicon);
}

function setFavicon(path) {
  let favicon = document.querySelector('link[rel="icon"]');

  if (!favicon) {
    favicon = document.createElement("link");

    favicon.rel = "icon";

    document.head.appendChild(favicon);
  }

  favicon.href = `${path}?v=${Date.now()}`;
}

function addMessage(message, shouldScroll = true) {
  addDateSeparator(message.created_at);

  const grouped = shouldGroupWithPrevious(message);

  const element = document.createElement("div");

  const isOwn = Number(message.user_id) === Number(currentUser.id);

  element.className = `message${isOwn ? " own" : ""}${
    grouped ? " grouped" : ""
  }`;

  element.dataset.userId = message.user_id;

  element.dataset.messageId = message.id;

  element.dataset.createdAt = message.created_at;

  if (!grouped) {
    const author = document.createElement("div");

    author.className = "message-author";

    author.textContent = isOwn ? "You" : message.username;

    element.appendChild(author);
  }

  if (message.reply_to_message_id && message.reply_content) {
    const reply = document.createElement("button");

    reply.className = "message-reply-preview";

    reply.type = "button";

    const replyName = document.createElement("span");

    replyName.className = "reply-name";

    replyName.textContent = message.reply_username;

    const replyContent = document.createElement("span");

    replyContent.className = "reply-content";

    replyContent.textContent = message.reply_content;

    reply.appendChild(replyName);
    reply.appendChild(replyContent);

    reply.addEventListener("click", () => {
      jumpToMessage(message.reply_to_message_id);
    });

    element.appendChild(reply);
  }

  const bubble = document.createElement("div");

  bubble.className = "message-bubble";

  if (message.deleted_at) {
    bubble.classList.add("deleted-message");

    bubble.textContent = "Message deleted";
  } else {
    bubble.textContent = message.content;
  }

  element.appendChild(bubble);

  if (message.edited_at && !message.deleted_at) {
    const edited = document.createElement("span");

    edited.className = "edited-label";

    edited.textContent = "edited";

    bubble.appendChild(document.createTextNode(" "));

    bubble.appendChild(edited);
  }

  const controls = document.createElement("div");

  controls.className = "message-controls";

  const replyButton = document.createElement("button");

  replyButton.type = "button";

  replyButton.className = "message-action";

  replyButton.textContent = "Reply";

  replyButton.addEventListener("click", () => {
    startReply(message);
  });

  controls.appendChild(replyButton);

  if (isOwn && !message.deleted_at) {
    const editButton = document.createElement("button");

    editButton.type = "button";

    editButton.className = "message-action";

    editButton.textContent = "Edit";

    editButton.addEventListener("click", () => {
      editMessage(message);
    });

    controls.appendChild(editButton);

    const deleteButton = document.createElement("button");

    deleteButton.type = "button";

    deleteButton.className = "message-action delete-action";

    deleteButton.textContent = "Delete";

    deleteButton.addEventListener("click", () => {
      deleteMessage(message);
    });

    controls.appendChild(deleteButton);
  }

  element.appendChild(controls);

  const time = document.createElement("div");

  time.className = "message-time";

  time.textContent = formatTime(message.created_at);

  element.appendChild(time);

  messagesContainer.appendChild(element);

  if (shouldScroll) {
    scrollToBottom();
  }
}

function editMessage(message) {
  const element = document.querySelector(`[data-message-id="${message.id}"]`);

  if (!element) {
    return;
  }

  const bubble = element.querySelector(".message-bubble");

  if (!bubble) {
    return;
  }

  const oldContent = message.content;

  const input = document.createElement("input");

  input.type = "text";
  input.className = "message-edit-input";
  input.maxLength = 2000;
  input.value = oldContent;

  bubble.replaceWith(input);

  input.focus();
  input.select();

  let finished = false;

  function finishEdit(save) {
    if (finished) {
      return;
    }

    finished = true;

    const newContent = input.value.trim();

    if (!save || !newContent) {
      input.replaceWith(bubble);
      return;
    }

    if (newContent === oldContent) {
      input.replaceWith(bubble);
      return;
    }

    socket.emit("chat:edit", {
      messageId: message.id,
      content: newContent,
    });

    bubble.innerHTML = "";

    bubble.appendChild(document.createTextNode(newContent));

    const edited = document.createElement("span");

    edited.className = "edited-label";

    edited.textContent = "edited";

    bubble.appendChild(document.createTextNode(" "));

    bubble.appendChild(edited);

    input.replaceWith(bubble);
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();

      finishEdit(true);
    }

    if (event.key === "Escape") {
      event.preventDefault();

      finishEdit(false);
    }
  });

  input.addEventListener("blur", () => {
    finishEdit(true);
  });
}

function deleteMessage(message) {
  messagePendingDelete = message;

  deleteModal.classList.remove("hidden");

  deleteCancel.focus();
}

function closeDeleteModal() {
  messagePendingDelete = null;

  deleteModal.classList.add("hidden");
}

deleteCancel.addEventListener("click", () => {
  closeDeleteModal();
});

deleteBackdrop.addEventListener("click", () => {
  closeDeleteModal();
});

deleteConfirm.addEventListener("click", () => {
  if (!messagePendingDelete || !socket) {
    closeDeleteModal();
    return;
  }

  socket.emit("chat:delete", {
    messageId: messagePendingDelete.id,
  });

  closeDeleteModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !deleteModal.classList.contains("hidden")) {
    closeDeleteModal();
  }
});

function replaceMessageElement(message) {
  const element = document.querySelector(`[data-message-id="${message.id}"]`);

  if (!element) {
    return;
  }

  const bubble = element.querySelector(".message-bubble");

  if (!bubble) {
    return;
  }

  bubble.innerHTML = "";

  const text = document.createTextNode(message.content);

  bubble.appendChild(text);

  const edited = document.createElement("span");

  edited.className = "edited-label";
  edited.textContent = "edited";

  bubble.appendChild(document.createTextNode(" "));

  bubble.appendChild(edited);
}

function markMessageDeleted(messageId) {
  const element = document.querySelector(`[data-message-id="${messageId}"]`);

  if (!element) {
    return;
  }

  const bubble = element.querySelector(".message-bubble");

  if (!bubble) {
    return;
  }

  bubble.innerHTML = "";

  bubble.classList.add("deleted-message");

  bubble.textContent = "Message deleted";

  const controls = element.querySelector(".message-controls");

  if (controls) {
    controls.innerHTML = "";
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");

  div.textContent = value ?? "";

  return div.innerHTML;
}

function startReply(message) {
  replyToMessage = message;

  messageInput.focus();

  showReplyBar(message);
}

function showReplyBar(message) {
  let replyBar = document.getElementById("reply-bar");

  if (!replyBar) {
    replyBar = document.createElement("div");

    replyBar.id = "reply-bar";

    replyBar.className = "reply-bar";

    messageForm.parentElement.insertBefore(replyBar, messageForm);
  }

  replyBar.innerHTML = "";

  const text = document.createElement("div");

  text.className = "reply-bar-text";

  text.innerHTML = `
    <strong>
      Replying to ${escapeHtml(message.username)}
    </strong>

    <span>
      ${escapeHtml(message.content)}
    </span>
  `;

  const cancel = document.createElement("button");

  cancel.type = "button";

  cancel.className = "reply-cancel";

  cancel.textContent = "Ã—";

  cancel.addEventListener("click", cancelReply);

  replyBar.appendChild(text);

  replyBar.appendChild(cancel);

  replyBar.classList.remove("hidden");
}

function cancelReply() {
  replyToMessage = null;

  const replyBar = document.getElementById("reply-bar");

  if (replyBar) {
    replyBar.classList.add("hidden");
  }

  messageInput.focus();
}

function jumpToMessage(messageId) {
  const target = document.querySelector(`[data-message-id="${messageId}"]`);

  if (!target) {
    return;
  }

  target.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });

  target.classList.add("message-highlight");

  setTimeout(() => {
    target.classList.remove("message-highlight");
  }, 1200);
}

async function searchServerMessages(query) {
  const trimmedQuery = query.trim();

  clearTimeout(searchTimeout);

  if (!trimmedQuery) {
    searchResults = [];
    currentSearchResult = -1;

    document
      .querySelectorAll(".message-search-match, .message-search-current")
      .forEach((element) => {
        element.classList.remove("message-search-match");

        element.classList.remove("message-search-current");
      });

    messageSearchCount.textContent = "";

    return;
  }

  searchTimeout = setTimeout(async () => {
    const requestId = ++searchRequestId;

    try {
      const response = await fetch(
        `/api/messages/search?q=${encodeURIComponent(trimmedQuery)}`,
      );

      if (!response.ok) {
        throw new Error("Search request failed.");
      }

      const data = await response.json();

      if (requestId !== searchRequestId) {
        return;
      }

      searchResults = data.messages;

      document.querySelectorAll(".message-search-match").forEach((element) => {
        element.classList.remove("message-search-match");

        element.classList.remove("message-search-current");
      });

      for (const message of searchResults) {
        const element = document.querySelector(
          `[data-message-id="${message.id}"]`,
        );

        if (element) {
          element.classList.add("message-search-match");
        }
      }

      searchResults.reverse();

      if (searchResults.length === 0) {
        currentSearchResult = -1;

        messageSearchCount.textContent = "0 results";

        return;
      }

      currentSearchResult = 0;

      await jumpToSearchResult();
    } catch (error) {
      console.error("Message search failed:", error);
    }
  }, 300);
}

async function loadMessageContext(messageId) {
  try {
    const response = await fetch(`/api/messages/context/${messageId}`);

    if (!response.ok) {
      throw new Error("Could not load message context.");
    }

    const data = await response.json();

    messagesContainer.innerHTML = "";

    for (const message of data.messages) {
      addMessage(message, false);
    }

    return document.querySelector(`[data-message-id="${messageId}"]`);
  } catch (error) {
    console.error("Could not load message context:", error);

    return null;
  }
}

function searchMessages(query) {
  const normalizedQuery = query.trim().toLowerCase();

  searchResults = [];
  currentSearchResult = -1;

  messageSearchCount.textContent = "";

  document
    .querySelectorAll(".message-search-match, .message-search-current")
    .forEach((element) => {
      element.classList.remove("message-search-match");

      element.classList.remove("message-search-current");
    });

  if (!normalizedQuery) {
    return;
  }

  const messages = messagesContainer.querySelectorAll(".message");

  for (const message of messages) {
    const bubble = message.querySelector(".message-bubble");

    if (!bubble) {
      continue;
    }

    if (bubble.classList.contains("deleted-message")) {
      continue;
    }

    const content = bubble.textContent.toLowerCase();

    if (content.includes(normalizedQuery)) {
      searchResults.push(message);
    }
  }

  for (const message of searchResults) {
    message.classList.add("message-search-match");
  }

  if (searchResults.length > 0) {
    currentSearchResult = searchResults.length - 1;

    jumpToSearchResult();
  }
}

async function jumpToSearchResult() {
  document.querySelectorAll(".message-search-current").forEach((element) => {
    element.classList.remove("message-search-current");
  });

  if (currentSearchResult < 0 || currentSearchResult >= searchResults.length) {
    messageSearchCount.textContent = "";

    return;
  }

  const message = searchResults[currentSearchResult];

  let target = document.querySelector(`[data-message-id="${message.id}"]`);

  if (!target) {
    target = await loadMessageContext(message.id);

    if (!target) {
      return;
    }

    for (const result of searchResults) {
      const element = document.querySelector(
        `[data-message-id="${result.id}"]`,
      );

      if (element) {
        element.classList.add("message-search-match");
      }
    }

    target = document.querySelector(`[data-message-id="${message.id}"]`);
  }

  if (!target) {
    return;
  }

  target.classList.add("message-search-current");

  messageSearchCount.textContent = `${currentSearchResult + 1} / ${
    searchResults.length
  }`;

  target.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });

  target.classList.add("message-highlight");

  setTimeout(() => {
    target.classList.remove("message-highlight");
  }, 1200);
}

function nextSearchResult() {
  if (searchResults.length === 0) {
    return;
  }

  currentSearchResult = (currentSearchResult + 1) % searchResults.length;

  jumpToSearchResult();
}

function previousSearchResult() {
  if (searchResults.length === 0) {
    return;
  }

  currentSearchResult =
    (currentSearchResult - 1 + searchResults.length) % searchResults.length;

  jumpToSearchResult();
}

messageSearchInput.addEventListener("input", () => {
  searchServerMessages(messageSearchInput.value);

  updateSearchClearButton();
});

messageSearchClear.addEventListener("click", () => {
  messageSearchInput.value = "";

  searchMessages("");

  updateSearchClearButton();

  messageSearchInput.focus();
});

messageSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();

    messageSearchInput.value = "";

    searchMessages("");

    updateSearchClearButton();
  }

  if (event.shiftKey) {
    previousSearchResult();
  } else {
    nextSearchResult();
  }
});

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function initializeChat() {
  const authenticated = await loadCurrentUser();

  if (!authenticated) {
    return;
  }

  socket = io();

  socket.on("connect", () => {
    onlineDot.classList.remove("online");

    onlineText.textContent = "Checking...";
  });

  socket.on("disconnect", () => {
    onlineUsers.clear();

    onlineDot.classList.remove("online");

    onlineText.textContent = "Disconnected";
  });

  socket.on("users:online", (users) => {
    onlineUsers.clear();

    for (const user of users) {
      onlineUsers.set(Number(user.id), user);
    }

    updateOnlineStatus();
  });

  socket.on("user:online", (user) => {
    onlineUsers.set(Number(user.id), user);

    updateOnlineStatus();
  });

  socket.on("user:offline", (user) => {
    onlineUsers.delete(Number(user.id));

    updateOnlineStatus();

    typingIndicator.classList.add("hidden");
  });

  socket.on("chat:history", (messages) => {
    messagesContainer.innerHTML = "";

    for (const message of messages) {
      addMessage(message, false);
    }

    scrollToBottom();

    markMessagesAsRead();
  });

  socket.on("chat:message", (message) => {
    const wasNearBottom = isNearBottom();

    const isOwnMessage = Number(message.user_id) === Number(currentUser.id);

    if (!isOwnMessage) {
      playMessageSound();
    }

    if (!isOwnMessage && !tabIsVisible) {
      tabNotificationActive = true;

      updateNotificationIndicator();
    }

    addMessage(message, wasNearBottom);

    if (isOwnMessage) {
      return;
    }

    if (wasNearBottom) {
      return;
    }

    addUnreadMessage();
  });

  socket.on("chat:edited", (updatedMessage) => {
    replaceMessageElement(updatedMessage);
  });

  socket.on("chat:deleted", (data) => {
    markMessageDeleted(data.id);
  });

  socket.on("messages:count", (count) => {
    updateMessageCount(count);
  });

  socket.on("user:typing", (user) => {
    typingText.textContent = `${user.username} is typing...`;

    typingIndicator.classList.remove("hidden");
  });

  socket.on("user:stopped-typing", () => {
    typingIndicator.classList.add("hidden");
  });

  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const content = messageInput.value.trim();

    if (!content || !socket) {
      return;
    }

    socket.emit("chat:send", {
      content,

      replyToMessageId: replyToMessage ? replyToMessage.id : null,
    });

    messageInput.value = "";

    cancelReply();

    stopTyping();

    messageInput.focus();
  });

  messageInput.addEventListener("input", () => {
    if (!socket) {
      return;
    }

    socket.emit("typing:start");

    clearTimeout(typingTimeout);

    typingTimeout = setTimeout(stopTyping, 1000);
  });

  messagesContainer.addEventListener("scroll", () => {
    if (isNearBottom()) {
      markMessagesAsRead();
    }
  });
}

function stopTyping() {
  if (!socket) {
    return;
  }

  socket.emit("typing:stop");

  clearTimeout(typingTimeout);
}

const originalShowScreen = window.showScreen;

if (originalShowScreen) {
  window.showScreen = function (screen) {
    originalShowScreen(screen);

    if (screen.id === "chat-screen" && !socket) {
      initializeChat();
    }
  };
}
