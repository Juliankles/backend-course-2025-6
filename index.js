#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');

const express = require('express');
const multer = require('multer');
const { Command } = require('commander');
const swaggerUi = require('swagger-ui-express');
const superagent = require('superagent');

console.log('Superagent version:', superagent.VERSION || 'installed');

const program = new Command();

program
  .requiredOption('-h, --host <host>', 'Server host (обов\'язковий параметр)')
  .requiredOption('-p, --port <port>', 'Server port (обов\'язковий параметр)', (value) => parseInt(value, 10))
  .requiredOption('-c, --cache <dir>', 'Cache directory (обов\'язковий параметр)');

program.parse(process.argv);
const options = program.opts();

const HOST = options.host;
const PORT = options.port;
const CACHE_DIR = path.resolve(options.cache);

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log('Створено теку кешу:', CACHE_DIR);
}

let nextId = 1;
const inventory = [];

function findItemById(id) {
  return inventory.find((item) => item.id === id);
}

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(__dirname));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CACHE_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Inventory Service API',
    version: '1.0.0',
    description: 'Простий сервіс інвентаризації для лабораторної роботи №6'
  },
  servers: [
    {
      url: `http://${HOST}:${PORT}`,
      description: 'Локальний сервер'
    }
  ],
  paths: {
    '/register': {
      post: {
        summary: 'Реєстрація нового пристрою',
        responses: {
          '201': { description: 'Створено нову річ' },
          '400': { description: 'Не задано імʼя речі' }
        }
      }
    },
    '/inventory': {
      get: {
        summary: 'Список всіх речей',
        responses: {
          '200': { description: 'JSON список речей' }
        }
      }
    },
    '/inventory/{id}': {
      get: {
        summary: 'Отримати інформацію про річ',
        responses: {
          '200': { description: 'Інформація про річ' },
          '404': { description: 'Річ не знайдено' }
        }
      },
      put: {
        summary: 'Оновити імʼя/опис речі',
        responses: {
          '200': { description: 'Оновлено' },
          '404': { description: 'Річ не знайдена' }
        }
      },
      delete: {
        summary: 'Видалити річ',
        responses: {
          '200': { description: 'Видалено' },
          '404': { description: 'Річ не знайдена' }
        }
      }
    },
    '/inventory/{id}/photo': {
      get: {
        summary: 'Отримати фото речі',
        responses: {
          '200': { description: 'Фото' },
          '404': { description: 'Річ або фото не знайдено' }
        }
      },
      put: {
        summary: 'Оновити фото речі',
        responses: {
          '200': { description: 'Фото оновлено' },
          '404': { description: 'Річ не знайдена' }
        }
      }
    },
    '/search': {
      post: {
        summary: 'Пошук речі за ID через форму',
        responses: {
          '201': { description: 'Знайдена річ' },
          '404': { description: 'Річ не знайдена' }
        }
      }
    }
  }
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.post('/register', upload.single('photo'), (req, res) => {
  const { inventory_name, description } = req.body;

  if (!inventory_name) {
    return res.status(400).json({ error: 'Поле inventory_name є обов\'язковим' });
  }

  const id = nextId++;
  const photoFilename = req.file ? req.file.filename : null;

  const item = {
    id,
    inventory_name,
    description: description || '',
    photoFilename,
    photo: photoFilename ? `/inventory/${id}/photo` : null
  };

  inventory.push(item);
  return res.status(201).json(item);
});

app.get('/inventory', (req, res) => {
  return res.status(200).json(inventory);
});

app.get('/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = findItemById(id);

  if (!item) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  return res.status(200).json(item);
});

app.put('/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = findItemById(id);

  if (!item) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  const { inventory_name, description } = req.body;

  if (inventory_name !== undefined) item.inventory_name = inventory_name;
  if (description !== undefined) item.description = description;

  return res.status(200).json(item);
});

app.get('/inventory/:id/photo', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = findItemById(id);

  if (!item || !item.photoFilename) {
    return res.status(404).json({ error: 'Фото не знайдено' });
  }

  const filePath = path.join(CACHE_DIR, item.photoFilename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Фото не знайдено' });
  }

  res.setHeader('Content-Type', 'image/jpeg');
  return res.sendFile(filePath);
});

app.put('/inventory/:id/photo', upload.single('photo'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = findItemById(id);

  if (!item) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Не передано файл photo' });
  }

  if (item.photoFilename) {
    const oldPath = path.join(CACHE_DIR, item.photoFilename);
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
    }
  }

  item.photoFilename = req.file.filename;
  item.photo = `/inventory/${id}/photo`;

  return res.status(200).json(item);
});

app.delete('/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const index = inventory.findIndex((item) => item.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  const [deleted] = inventory.splice(index, 1);
  if (deleted.photoFilename) {
    const photoPath = path.join(CACHE_DIR, deleted.photoFilename);
    if (fs.existsSync(photoPath)) {
      fs.unlinkSync(photoPath);
    }
  }

  return res.status(200).json({ message: 'Річ видалено' });
});

app.post('/search', (req, res) => {
  const id = parseInt(req.body.id, 10);
  const hasPhoto = !!req.body.has_photo;

  const item = findItemById(id);
  if (!item) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  const result = { ...item };

  if (hasPhoto && item.photo) {
    const photoUrl = `${req.protocol}://${req.get('host')}${item.photo}`;
    result.description = (result.description || '') + ` Фото: ${photoUrl}`;
  }

  return res.status(201).json(result);
});

app.use((req, res) => {
  const method = req.method;
  const url = req.path;

  if (url === '/register') {
    if (method !== 'POST') return res.status(405).send('Method not allowed');
  } else if (url === '/inventory') {
    if (method !== 'GET') return res.status(405).send('Method not allowed');
  } else if (/^\/inventory\/[^/]+\/photo$/.test(url)) {
    if (!['GET', 'PUT'].includes(method)) return res.status(405).send('Method not allowed');
  } else if (/^\/inventory\/[^/]+$/.test(url)) {
    if (!['GET', 'PUT', 'DELETE'].includes(method)) return res.status(405).send('Method not allowed');
  } else if (url === '/RegisterForm.html' || url === '/SearchForm.html') {
    if (method !== 'GET') return res.status(405).send('Method not allowed');
  } else if (url === '/search') {
    if (method !== 'POST') return res.status(405).send('Method not allowed');
  } else if (url.startsWith('/docs')) {
    if (method !== 'GET') return res.status(405).send('Method not allowed');
  } else {
    return res.status(404).send('Not found');
  }

  return res.status(404).send('Not found');
});

const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  console.log(`Server is running at http://${HOST}:${PORT}`);
  console.log('Cache directory:', CACHE_DIR);
  console.log('Swagger docs: http://' + HOST + ':' + PORT + '/docs');
});
