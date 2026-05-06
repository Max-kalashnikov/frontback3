const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const bodyParser = require('body-parser');
const cors = require('cors');
const express = require('express');
const { Server } = require('socket.io');
const webpush = require('web-push');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const PUBLIC_DIR = path.join(__dirname, 'public');

const vapidKeys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  ? {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    }
  : webpush.generateVAPIDKeys();

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:student@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(PUBLIC_DIR));

let subscriptions = [];
const reminders = new Map();

function createServer() {
  const certPath = path.join(__dirname, 'localhost.pem');
  const keyPath = path.join(__dirname, 'localhost-key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return https.createServer({
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    }, app);
  }

  return http.createServer(app);
}

function sendPush(payload) {
  subscriptions = subscriptions.filter((subscription) => {
    webpush.sendNotification(subscription, JSON.stringify(payload)).catch((error) => {
      console.error('Push error:', error.message);
    });
    return true;
  });
}

function scheduleReminder({ id, text, reminderTime }) {
  const delay = Number(reminderTime) - Date.now();

  if (!id || !text || delay <= 0) {
    return false;
  }

  if (reminders.has(id)) {
    clearTimeout(reminders.get(id).timeoutId);
  }

  const timeoutId = setTimeout(() => {
    sendPush({
      title: 'Напоминание о периферии',
      body: text,
      reminderId: id
    });
    reminders.delete(id);
  }, delay);

  reminders.set(id, { timeoutId, text, reminderTime: Number(reminderTime) });
  return true;
}

app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }

  subscriptions = subscriptions.filter((item) => item.endpoint !== subscription.endpoint);
  subscriptions.push(subscription);
  return res.status(201).json({ message: 'Subscription saved' });
});

app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  subscriptions = subscriptions.filter((subscription) => subscription.endpoint !== endpoint);
  return res.status(200).json({ message: 'Subscription removed' });
});

app.post('/snooze', (req, res) => {
  const reminderId = Number(req.query.reminderId);

  if (!reminderId || !reminders.has(reminderId)) {
    return res.status(404).json({ error: 'Reminder not found' });
  }

  const reminder = reminders.get(reminderId);
  clearTimeout(reminder.timeoutId);

  const reminderTime = Date.now() + 5 * 60 * 1000;
  scheduleReminder({
    id: reminderId,
    text: reminder.text,
    reminderTime
  });

  return res.status(200).json({ message: 'Reminder snoozed for 5 minutes' });
});

const server = createServer();
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('newTask', (task) => {
    const safeTask = {
      text: String(task?.text || '').slice(0, 200),
      timestamp: Date.now()
    };

    io.emit('taskAdded', safeTask);
    sendPush({
      title: 'Новая задача по периферии',
      body: safeTask.text
    });
  });

  socket.on('newReminder', (reminder) => {
    const safeReminder = {
      id: Number(reminder?.id),
      text: String(reminder?.text || '').slice(0, 200),
      reminderTime: Number(reminder?.reminderTime)
    };

    if (scheduleReminder(safeReminder)) {
      io.emit('reminderScheduled', safeReminder);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  const protocol = server instanceof https.Server ? 'https' : 'http';
  console.log(`Peripheral Planner is running at ${protocol}://localhost:${PORT}`);
  console.log(`VAPID public key: ${vapidKeys.publicKey}`);
});
