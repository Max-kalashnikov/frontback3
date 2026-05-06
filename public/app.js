const contentDiv = document.getElementById('app-content');
const tabs = document.querySelectorAll('.tab');
const connectionStatus = document.getElementById('connection-status');
const offlineStatus = document.getElementById('offline-status');
const enablePushBtn = document.getElementById('enable-push');
const disablePushBtn = document.getElementById('disable-push');

const socket = window.io ? window.io() : null;

function setActiveButton(page) {
  tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.page === page);
  });
}

async function loadContent(page) {
  try {
    const response = await fetch(`/content/${page}.html`);

    if (!response.ok) {
      throw new Error(`Page ${page} not found`);
    }

    contentDiv.innerHTML = await response.text();
    contentDiv.focus();

    if (page === 'home') {
      initNotes();
    }
  } catch (error) {
    contentDiv.innerHTML = '<p class="empty-state">Не удалось загрузить страницу. Проверьте кэш Service Worker.</p>';
    console.error(error);
  }
}

function updateNetworkStatus() {
  offlineStatus.textContent = navigator.onLine ? 'Сеть: онлайн' : 'Сеть: офлайн';
  offlineStatus.classList.toggle('is-offline', !navigator.onLine);
}

function getNotes() {
  return JSON.parse(localStorage.getItem('peripheral-notes') || '[]');
}

function saveNotes(notes) {
  localStorage.setItem('peripheral-notes', JSON.stringify(notes));
}

function formatReminder(timestamp) {
  if (!timestamp) {
    return '';
  }

  return new Date(timestamp).toLocaleString('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function initNotes() {
  const form = document.getElementById('note-form');
  const input = document.getElementById('note-input');
  const reminderForm = document.getElementById('reminder-form');
  const reminderText = document.getElementById('reminder-text');
  const reminderTime = document.getElementById('reminder-time');
  const list = document.getElementById('notes-list');
  const clearBtn = document.getElementById('clear-notes');

  function renderNotes() {
    const notes = getNotes();

    if (!notes.length) {
      list.innerHTML = '<li class="empty-state">Пока задач нет. Добавьте первую задачу по периферии.</li>';
      return;
    }

    list.innerHTML = notes.map((note) => {
      const reminder = note.reminder
        ? `<small>Напоминание: ${formatReminder(note.reminder)}</small>`
        : '<small>Без напоминания</small>';

      return `
        <li class="note-card">
          <div>
            <strong>${escapeHtml(note.text)}</strong>
            ${reminder}
          </div>
          <button class="icon-button" type="button" data-delete="${note.id}" title="Удалить задачу">×</button>
        </li>
      `;
    }).join('');
  }

  function addNote(text, reminder = null) {
    const notes = getNotes();
    const newNote = {
      id: Date.now(),
      text,
      reminder
    };

    notes.unshift(newNote);
    saveNotes(notes);
    renderNotes();

    if (reminder) {
      socket?.emit('newReminder', {
        id: newNote.id,
        text,
        reminderTime: reminder
      });
    } else {
      socket?.emit('newTask', {
        text,
        timestamp: Date.now()
      });
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();

    if (text) {
      addNote(text);
      input.value = '';
    }
  });

  reminderForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = reminderText.value.trim();
    const timestamp = new Date(reminderTime.value).getTime();

    if (!text || Number.isNaN(timestamp)) {
      return;
    }

    if (timestamp <= Date.now()) {
      alert('Дата напоминания должна быть в будущем.');
      return;
    }

    addNote(text, timestamp);
    reminderText.value = '';
    reminderTime.value = '';
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-delete]');

    if (!button) {
      return;
    }

    const id = Number(button.dataset.delete);
    saveNotes(getNotes().filter((note) => note.id !== id));
    renderNotes();
  });

  clearBtn.addEventListener('click', () => {
    saveNotes([]);
    renderNotes();
  });

  renderNotes();
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Push-уведомления не поддерживаются этим браузером.');
    return;
  }

  const permission = await Notification.requestPermission();

  if (permission !== 'granted') {
    alert('Для push-уведомлений нужно разрешение браузера.');
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const currentSubscription = await registration.pushManager.getSubscription();

  if (currentSubscription) {
    return currentSubscription;
  }

  const keyResponse = await fetch('/vapid-public-key');
  const { publicKey } = await keyResponse.json();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });

  await fetch('/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription)
  });

  enablePushBtn.hidden = true;
  disablePushBtn.hidden = false;
  showToast('Уведомления включены');
  return subscription;
}

async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    return;
  }

  await fetch('/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint })
  });
  await subscription.unsubscribe();
  enablePushBtn.hidden = false;
  disablePushBtn.hidden = true;
  showToast('Уведомления отключены');
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    setActiveButton(tab.dataset.page);
    loadContent(tab.dataset.page);
  });
});

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
enablePushBtn.addEventListener('click', subscribeToPush);
disablePushBtn.addEventListener('click', unsubscribeFromPush);

if (socket) {
  socket.on('connect', () => {
    connectionStatus.textContent = 'Сервер: подключен';
    connectionStatus.classList.remove('is-offline');
  });

  socket.on('disconnect', () => {
    connectionStatus.textContent = 'Сервер: отключен';
    connectionStatus.classList.add('is-offline');
  });

  socket.on('taskAdded', (task) => {
    showToast(`Новая задача: ${task.text}`);
  });

  socket.on('reminderScheduled', (reminder) => {
    showToast(`Напоминание запланировано: ${formatReminder(reminder.reminderTime)}`);
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription = await registration.pushManager?.getSubscription();
      enablePushBtn.hidden = Boolean(subscription);
      disablePushBtn.hidden = !subscription;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  });
}

updateNetworkStatus();
loadContent('home');
