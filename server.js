const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// Игровые данные
let players = {};
let foods = [];
let projectiles = [];

// Генерация еды
function generateFood(count) {
    for (let i = 0; i < count; i++) {
        foods.push({
            id: Date.now() + i,
            x: Math.random() * 4000 - 2000,
            y: Math.random() * 4000 - 2000,
            size: 5,
            color: `hsl(${Math.random() * 360}, 100%, 50%)`
        });
    }
}

// Обновление игрока
function updatePlayer(id, data) {
    const player = players[id];
    if (!player) return;
    
    // Ограничение скорости
    const speed = 10 / (player.size / 20);
    const dx = data.x - player.x;
    const dy = data.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > speed) {
        player.x += (dx / dist) * speed;
        player.y += (dy / dist) * speed;
    } else {
        player.x = data.x;
        player.y = data.y;
    }
    
    // Границы мира
    const worldSize = 2000;
    player.x = Math.max(-worldSize, Math.min(worldSize, player.x));
    player.y = Math.max(-worldSize, Math.min(worldSize, player.y));
    
    // Сбор еды
    foods = foods.filter(food => {
        const dx = player.x - food.x;
        const dy = player.y - food.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < player.size + food.size) {
            player.size += 0.5;
            player.score += 10;
            return false;
        }
        return true;
    });
    
    // Столкновения с другими игроками
    Object.keys(players).forEach(otherId => {
        if (otherId === id) return;
        const other = players[otherId];
        
        const dx = player.x - other.x;
        const dy = player.y - other.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < player.size + other.size) {
            if (player.size > other.size * 1.25) {
                // Поглощение меньшего игрока
                player.size += other.size * 0.5;
                player.score += other.size * 20;
                
                // Уведомления
                io.to(otherId).emit('eaten', { by: player.name });
                io.to(id).emit('eat', { player: other.name });
                
                // Удаление съеденного игрока
                delete players[otherId];
                io.to(otherId).emit('gameOver');
                other.socket.disconnect();
            }
        }
    });
    
    // Восполнение еды
    if (foods.length < 500 && Math.random() < 0.1) {
        generateFood(1);
    }
}

// Игровой цикл
setInterval(() => {
    // Обновление снарядов
    projectiles = projectiles.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.lifetime--;
        return p.lifetime > 0;
    });
    
    // Отправка состояния всем игрокам
    io.emit('gameState', {
        players: players,
        foods: foods,
        projectiles: projectiles
    });
}, 1000 / 60); // 60 FPS

// WebSocket соединения
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Новый игрок
    socket.on('join', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: Math.random() * 1000 - 500,
            y: Math.random() * 1000 - 500,
            size: 20,
            color: data.color || '#ff0000',
            name: data.name || 'Player',
            score: 0,
            socket: socket
        };
        
        // Приветственное сообщение
        socket.emit('welcome', {
            id: socket.id,
            worldSize: 4000
        });
        
        // Уведомление других игроков
        socket.broadcast.emit('playerJoined', {
            id: socket.id,
            name: data.name
        });
    });
    
    // Движение
    socket.on('move', (data) => {
        updatePlayer(socket.id, data);
    });
    
    // Разделение
    socket.on('split', () => {
        const player = players[socket.id];
        if (player && player.size >= 30) {
            player.size /= 2;
            
            // Создание второй клетки
            const newCell = {
                ...player,
                x: player.x + player.size,
                y: player.y + player.size,
                size: player.size
            };
            
            // Можно хранить несколько клеток у одного игрока
            // Для простоты пока не реализуем
        }
    });
    
    // Стрельба
    socket.on('shoot', (data) => {
        const player = players[socket.id];
        if (player && player.size > 15) {
            player.size -= 2; // Трата массы на выстрел
            
            const angle = Math.atan2(data.y - 300, data.x - 400);
            projectiles.push({
                id: Date.now(),
                x: player.x,
                y: player.y,
                vx: Math.cos(angle) * 15,
                vy: Math.sin(angle) * 15,
                size: 8,
                color: player.color,
                playerId: socket.id,
                damage: player.size * 0.5,
                lifetime: 100
            });
        }
    });
    
    // Отключение
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('playerLeft', socket.id);
        }
    });
});

// Статические файлы
app.use(express.static(__dirname));

// Запуск сервера
server.listen(PORT, () => {
    console.log(`Clash.io server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
    
    // Начальная генерация еды
    generateFood(500);
});
