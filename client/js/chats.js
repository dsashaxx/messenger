const token = localStorage.getItem("token");
const myUserId = Number(localStorage.getItem("user_id"));

const socket = io({
    auth: {
        token: token
    }
});

let currentChatId = null;
let oldestMessageId = null;
let hasMore = true;

const chatsList = document.getElementById("chatsList");
const chatTitle = document.getElementById("chatTitle");
const messagesDiv = document.getElementById("messages");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const searchToggleBtn = document.getElementById("searchToggleBtn");
const searchBox = document.getElementById("searchBox");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const searchResults = document.getElementById("searchResults");
const createGroupBtn = document.getElementById("createGroupBtn");
const groupModal = document.getElementById("groupModal");
const closeGroupBtn = document.getElementById("closeGroupBtn");
const saveGroupBtn = document.getElementById("saveGroupBtn");
const groupNameInput = document.getElementById("groupNameInput");
const usersList = document.getElementById("usersList");
const membersToggleBtn = document.getElementById("membersToggleBtn");
const membersModal = document.getElementById("membersModal");
const closeMembersBtn = document.getElementById("closeMembersBtn");
const membersList = document.getElementById("membersList");
const memberIdInput = document.getElementById("memberIdInput");
const addMemberBtn = document.getElementById("addMemberBtn");

//кнопки удаления
const deleteChatBtn = document.getElementById("deleteChatBtn");
const deleteAccountBtn = document.getElementById("deleteAccountBtn");

loadChats();

//показать чаты
async function loadChats() {
    const response = await fetch("/chats", {
        headers: {
            Authorization: "Bearer " + token
        }
    });

    const chats = await response.json();

    chatsList.innerHTML = "";

    for (let chat of chats) {
        const div = document.createElement("div");

        div.className = "chat-item";
        div.textContent = chat.name || "Личный чат";

        div.onclick = function() {
            openChat(chat.id, chat.name || "Личный чат");
        };

        chatsList.appendChild(div);
    }
}

//открыть чат
async function openChat(chatId, name) {
    currentChatId = chatId;
    oldestMessageId = null;
    hasMore = true;

    chatTitle.textContent = name;
    messagesDiv.innerHTML = "";
    searchResults.innerHTML = "";
    searchResults.classList.add("hidden");

    socket.emit("join_chat", chatId);

    await loadMessages(false);

    messageInput.focus();
}

//показать смс
async function loadMessages(prepend) {
    if (!currentChatId || !hasMore) {
        return;
    }

    let url = "/chats/" + currentChatId + "/messages?limit=30";

    if (oldestMessageId) {
        url += "&before=" + oldestMessageId;
    }

    const response = await fetch(url, {
        headers: {
            Authorization: "Bearer " + token
        }
    });

    const messages = await response.json();

    if (messages.error) {
        alert(messages.error);
        return;
    }

    if (messages.length === 0) {
        hasMore = false;
        loadMoreBtn.classList.add("hidden");
        return;
    }

    oldestMessageId = messages[0].id;

    for (let message of messages) {
        appendMessage(message, prepend);
    }

    if (messages.length < 30) {
        hasMore = false;
        loadMoreBtn.classList.add("hidden");
    } else {
        loadMoreBtn.classList.remove("hidden");
    }

    if (!prepend) {
        scrollToBottom();
    }
}

messageForm.addEventListener("submit", function(event) {
    event.preventDefault();
    sendMessage();
});

//отправить смс
function sendMessage() {
    const text = messageInput.value.trim();

    if (!currentChatId || text === "") {
        return;
    }

    socket.emit("send_message", {
        chatId: currentChatId,
        text: text
    });

    messageInput.value = "";
}

socket.on("new_message", function(message) {
    if (Number(message.chat_id) === Number(currentChatId)) {
        appendMessage(message, false);
        scrollToBottom();
    }
});

loadMoreBtn.addEventListener("click", function() {
    loadMessages(true);
});

//добавить смс
function appendMessage(message, prepend) {
    const div = document.createElement("div");

    div.className = "message";
    div.dataset.messageId = message.id;

    const isMyMessage =
        Number(message.sender_id) === Number(myUserId);

    if (isMyMessage) {
        div.classList.add("own");
    }

    div.innerHTML = `
        <div class="message-author">
            ${escapeHtml(message.sender_name || "User")}
        </div>

        <div class="message-text">
            ${escapeHtml(message.text)}
        </div>

        <div class="message-bottom">
            <span class="message-time">
                ${formatDate(message.created_at)}
            </span>

            ${
                isMyMessage
                    ? `
                        <button
                            class="delete-message-btn"
                            onclick="deleteMessage(${message.id})"
                        >
                            Удалить
                        </button>
                    `
                    : ""
            }
        </div>
    `;

    if (prepend) {
        messagesDiv.prepend(div);
    } else {
        messagesDiv.appendChild(div);
    }
}

function scrollToBottom() {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
//отформатировать дату
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit"
    });
}
//выйти
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
searchToggleBtn.addEventListener("click", function() {
    searchBox.classList.toggle("hidden");
});
searchBtn.addEventListener("click", searchMessages);
//поиск по смс
async function searchMessages() {
    const q = searchInput.value.trim();
    if (!currentChatId || q === "") {
        return;
    }
    const response = await fetch(
        "/chats/" + currentChatId + "/search?q=" + encodeURIComponent(q),
        {
            headers: {
                Authorization: "Bearer " + token
            }
        }
    );
    const results = await response.json();
    searchResults.innerHTML = "";
    searchResults.classList.remove("hidden");
    if (results.error) {
        searchResults.textContent = results.error;
        return;
    }
    if (results.length === 0) {
        searchResults.textContent = "Ничего не найдено";
        return;
    }
    for (let message of results) {
        const div = document.createElement("div");
        div.className = "search-result";
        div.innerHTML = `
            <b>${escapeHtml(message.sender_name || "User")}</b>:
            ${escapeHtml(message.text)}
        `;
        searchResults.appendChild(div);
    }
}
createGroupBtn.addEventListener("click", async function() {
    groupModal.classList.remove("hidden");
    await loadUsersForGroup();
});
closeGroupBtn.addEventListener("click", function() {
    groupModal.classList.add("hidden");
});

//создать группу
async function loadUsersForGroup() {
    const response = await fetch("/users", {
        headers: {
            Authorization: "Bearer " + token
        }
    });
    const users = await response.json();
    usersList.innerHTML = "";
    for (let user of users) {
        const label = document.createElement("label");

        label.className = "user-checkbox";

        label.innerHTML = `
            <input type="checkbox" value="${user.id}">
            ${escapeHtml(user.username)}
        `;

        usersList.appendChild(label);
    }
}
saveGroupBtn.addEventListener("click", async function() {
    const name = groupNameInput.value.trim();
    const checkedUsers = usersList.querySelectorAll("input:checked");
    const memberIds = Array.from(checkedUsers).map(function(input) {
        return Number(input.value);
    });
    if (name === "") {
        alert("Введите название группы");
        return;
    }
    const response = await fetch("/chats/group", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token
        },
        body: JSON.stringify({
            name: name,
            memberIds: memberIds
        })
    });
    const result = await response.json();
    if (result.error) {
        alert(result.error);
        return;
    }
    groupModal.classList.add("hidden");
    groupNameInput.value = "";
    loadChats();
});
membersToggleBtn.addEventListener("click", async function() {
    if (!currentChatId) {
        return;
    }
    membersModal.classList.remove("hidden");
    await loadMembers();
});
closeMembersBtn.addEventListener("click", function() {
    membersModal.classList.add("hidden");
});
//загрузить участников
async function loadMembers() {
    const response = await fetch(
        "/chats/" + currentChatId + "/members",
        {
            headers: {
                Authorization: "Bearer " + token
            }
        }
    );
    const members = await response.json();
    membersList.innerHTML = "";
    if (members.error) {
        membersList.textContent = members.error;
        return;
    }
    for (let member of members) {
        const div = document.createElement("div");
        div.className = "member-item";
        div.innerHTML = `
            <span>
                ${escapeHtml(member.username)} — ${escapeHtml(member.role)}
            </span>

            <button onclick="deleteMember(${member.id})">
                Удалить
            </button>
        `;
        membersList.appendChild(div);
    }
}
addMemberBtn.addEventListener("click", async function() {
    const userId = Number(memberIdInput.value);
    if (!userId) {
        alert("Введите ID пользователя");
        return;
    }
    const response = await fetch(
        "/chats/" + currentChatId + "/members",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token
            },
            body: JSON.stringify({
                userId: userId
            })
        }
    );
    const result = await response.json();
    if (result.error) {
        alert(result.error);
        return;
    }
    memberIdInput.value = "";
    loadMembers();
});

//удалить участника
async function deleteMember(userId) {
    const response = await fetch(
        "/chats/" + currentChatId + "/members/" + userId,
        {
            method: "DELETE",
            headers: {
                Authorization: "Bearer " + token
            }
        }
    );
    const result = await response.json();
    if (result.error) {
        alert(result.error);
        return;
    }
    loadMembers();
}


//удалить смс
async function deleteMessage(messageId) {
    if (!currentChatId) {
        return;
    }
    const answer = confirm("Удалить сообщение?");
    if (!answer) {
        return;
    }
    const response = await fetch(
        "/chats/" +
        currentChatId +
        "/messages/" +
        messageId,
        {
            method: "DELETE",
            headers: {
                Authorization: "Bearer " + token
            }
        }
    );
    const result = await response.json();
    if (!response.ok) {
        alert(result.error || "Не удалось удалить сообщение");
        return;
    }

    const messageElement = document.querySelector(
        `[data-message-id="${messageId}"]`
    );

    if (messageElement) {
        messageElement.remove();
    }
}
//удалить чат
if (deleteChatBtn) {
    deleteChatBtn.addEventListener("click", deleteChat);
}
async function deleteChat() {
    if (!currentChatId) {
        alert("Сначала выберите чат");
        return;
    }
    const answer = confirm(
        "Удалить чат вместе со всеми сообщениями?"
    );

    if (!answer) {
        return;
    }
    const response = await fetch(
        "/chats/" + currentChatId,
        {
            method: "DELETE",
            headers: {
                Authorization: "Bearer " + token
            }
        }
    );
    const result = await response.json();
    if (!response.ok) {
        alert(result.error || "Не удалось удалить чат");
        return;
    }
    currentChatId = null;
    oldestMessageId = null;
    hasMore = true;
    chatTitle.textContent = "Выберите чат";
    messagesDiv.innerHTML = "";
    searchResults.innerHTML = "";
    searchResults.classList.add("hidden");
    loadMoreBtn.classList.add("hidden");
    loadChats();
}


//удалить аккаунт
if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener(
        "click",
        deleteAccount
    );
}

async function deleteAccount() {
    const answer = confirm(
        "Удалить аккаунт? Это действие нельзя отменить."
    );
    if (!answer) {
        return;
    }
    const response = await fetch(
        "/users/me",
        {
            method: "DELETE",
            headers: {
                Authorization: "Bearer " + token
            }
        }
    );
    const result = await response.json();
    if (!response.ok) {
        alert(result.error || "Не удалось удалить аккаунт");
        return;
    }
    localStorage.removeItem("token");
    localStorage.removeItem("user_id");
    localStorage.removeItem("user");
    window.location.href = "/";
}