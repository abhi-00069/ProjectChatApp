const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');


const app = express();
const server = http.createServer(app);
const io = socketio(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});


const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

if (!MONGO_URI) {
    console.error("MONGO_URI is missing");
    process.exit(1);
}

if (!JWT_SECRET) {
    console.error("JWT_SECRET is missing");
    process.exit(1);
}


app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'front')));


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|pdf|txt|mp4|webm/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        ext ? cb(null, true) : cb(new Error('File type not allowed'));
    }
});



const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    avatar: { type: String, default: '' },
    status: { type: String, default: 'Hey there! I am using Nexus Chat.' },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    socketId: { type: String, default: '' },
}, { timestamps: true });


const roomSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, enum: ['private', 'group'], default: 'private' },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    avatar: { type: String, default: '' },
    roomId: { type: String, unique: true },
}, { timestamps: true });


const messageSchema = new mongoose.Schema({
    roomId: { type: String, required: true },
    sender: { type: String, required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, default: '' },
    fileUrl: { type: String, default: '' },
    fileType: { type: String, default: '' },
    fileName: { type: String, default: '' },
    type: { type: String, enum: ['text', 'file', 'system'], default: 'text' },
    readBy: [{ type: String }],
    deleted: { type: Boolean, default: false },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);
const Message = mongoose.model('Message', messageSchema);


const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(403).json({ error: 'Invalid or expired token' });
    }
};




app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password)
            return res.status(400).json({ error: 'All fields required' });

        const exists = await User.findOne({ $or: [{ email }, { username }] });
        if (exists) return res.status(409).json({ error: 'Username or email already taken' });

        const hashed = await bcrypt.hash(password, 12);
        const colors = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#00b0f4'];
        const avatar = colors[Math.floor(Math.random() * colors.length)];

        const user = await User.create({ username, email, password: hashed, avatar });
        const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            token,
            user: { id: user._id, username: user.username, email: user.email, avatar: user.avatar }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});


app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Incorrect password' });

        const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            token,
            user: { id: user._id, username: user.username, email: user.email, avatar: user.avatar, status: user.status }
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/users', authMiddleware, async (req, res) => {
    try {
        const users = await User.find(
            { username: { $ne: req.user.username } },
            { password: 0 }
        ).sort({ isOnline: -1, username: 1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});


app.post('/api/rooms/private', authMiddleware, async (req, res) => {
    try {
        const { targetUsername } = req.body;
        const me = req.user.username;
        const roomId = [me, targetUsername].sort().join('_');

        let room = await Room.findOne({ roomId });
        if (!room) {
            const [u1, u2] = await Promise.all([
                User.findOne({ username: me }),
                User.findOne({ username: targetUsername })
            ]);
            room = await Room.create({
                name: `${me} & ${targetUsername}`,
                type: 'private',
                members: [u1._id, u2._id],
                roomId
            });
        }
        res.json(room);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});


app.post('/api/rooms/group', authMiddleware, async (req, res) => {
    try {
        const { name, members } = req.body;
        const creator = req.user.username;
        const allMembers = [...new Set([creator, ...members])];
        const roomId = `group_${Date.now()}`;

        const userDocs = await User.find({ username: { $in: allMembers } });
        const room = await Room.create({
            name,
            type: 'group',
            members: userDocs.map(u => u._id),
            createdBy: userDocs.find(u => u.username === creator)?._id,
            roomId
        });
        res.status(201).json(room);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});


app.get('/api/messages/:roomId', authMiddleware, async (req, res) => {
    try {
        const { roomId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        const messages = await Message.find({ roomId, deleted: false })
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(limit);

        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});


app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileType = req.file.mimetype.startsWith('image') ? 'image'
        : req.file.mimetype.startsWith('video') ? 'video' : 'file';
    res.json({
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        fileType
    });
});


app.get('/api/backup', authMiddleware, async (req, res) => {
    try {
        const messages = await Message.find().lean();
        fs.writeFileSync('backup.json', JSON.stringify(messages, null, 2));
        res.json({ success: true, count: messages.length });
    } catch (err) {
        res.status(500).json({ error: 'Backup failed' });
    }
});


app.get('/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'front', 'index.html'));
});



const typingUsers = {};

io.use((socket, next) => {
    try {
        let token = socket.handshake.auth?.token
            || socket.handshake.query?.token;

        console.log('Socket token received:', token ? 'EXISTS' : 'MISSING');

        if (!token) return next(new Error('No token provided'));

        socket.user = jwt.verify(token, JWT_SECRET);
        console.log('✅ Socket authenticated:', socket.user.username);
        next();
    } catch (err) {
        console.log('❌ JWT error:', err.message);
        next(new Error('Invalid token'));
    }
});

io.on('connection', async (socket) => {
    if (!socket.user) return socket.disconnect();

    const { username, id: userId } = socket.user;
    console.log(`🟢 Connected: ${username} (${socket.id})`);

    await User.findByIdAndUpdate(userId, { isOnline: true, socketId: socket.id });
    io.emit('userOnline', { username, isOnline: true });

    
    socket.on('joinRoom', async ({ roomId }) => {
        socket.join(roomId);
        socket.currentRoom = roomId;

        const messages = await Message.find({ roomId, deleted: false })
            .sort({ createdAt: -1 }).limit(50).lean();
        socket.emit('messageHistory', messages.reverse());

        await Message.updateMany(
            { roomId, readBy: { $ne: username } },
            { $addToSet: { readBy: username } }
        );
        io.to(roomId).emit('messagesRead', { roomId, username });
    });


    socket.on('sendMessage', async (data) => {
        try {
            const { roomId, text, fileUrl, fileType, fileName } = data;
            const msgDoc = await Message.create({
                roomId, sender: username, senderId: userId,
                text:     text     || '',
                fileUrl:  fileUrl  || '',
                fileType: fileType || '',
                fileName: fileName || '',
                type:     fileUrl ? 'file' : 'text',
                readBy:   [username]
            });
            io.to(roomId).emit('newMessage', msgDoc.toObject());
        } catch (err) {
            console.error('sendMessage error:', err);
        }
    });


    socket.on('deleteMessage', async ({ messageId, roomId }) => {
        try {
            await Message.findByIdAndUpdate(messageId, { deleted: true });
            io.to(roomId).emit('messageDeleted', { messageId });
        } catch (err) {
            console.error('deleteMessage error:', err);
        }
    });


    socket.on('typing', ({ roomId }) => {
        if (!typingUsers[roomId]) typingUsers[roomId] = new Set();
        typingUsers[roomId].add(username);
        socket.to(roomId).emit('typing', { roomId, users: [...typingUsers[roomId]] });
    });

    socket.on('stopTyping', ({ roomId }) => {
        if (typingUsers[roomId]) typingUsers[roomId].delete(username);
        socket.to(roomId).emit('typing', { roomId, users: [...(typingUsers[roomId] || [])] });
    });


    socket.on('disconnect', async () => {
        await User.findByIdAndUpdate(userId, {
            isOnline: false,
            lastSeen: new Date(),
            socketId: ''
        });
        io.emit('userOnline', { username, isOnline: false, lastSeen: new Date() });

        Object.keys(typingUsers).forEach(room => {
            typingUsers[room]?.delete(username);
            io.to(room).emit('typing', { room, users: [...(typingUsers[room] || [])] });
        });

        console.log(`🔴 Disconnected: ${username}`);
    });
});

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('✅ MongoDB Connected via Mongoose');
        server.listen(PORT, () => console.log(`🚀 Nexus Chat running on port ${PORT}`));
    })
    .catch(err => {
        console.error('❌ MongoDB connection failed:', err.message);
        process.exit(1);
    });
