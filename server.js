const express = require('express');
const path = require('path');
const http = require('http');
const socketio = require('socket.io');
const formatMessage = require('./utils/chatMessage');
const mongoClient = require('mongodb').MongoClient;

const dbname = 'chatApp';
const chatCollection = 'chats';
const userCollection = 'onlineUsers';


const port = 5000;
const database = 'mongodb://localhost:27017/';
const app = express();

const server=http.createServer(app);
const io = socketio(server);

let db;

mongoClient.connect(database, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}, (err, client) => {
    if (err) throw err;

    db = client.db(dbname);

    io.on('connection', (socket) => {

        socket.on('userDetails', (data) => {
            if (!data || !data.fromUser || !data.toUser) return;

            socket.join(data.fromUser);

            const online = db.collection(userCollection);
            const chat = db.collection(chatCollection);

            online.updateOne(
                { name: data.fromUser },
                { $set: { ID: socket.id } },
                { upsert: true }
            );

            chat.find({
                from: { $in: [data.fromUser, data.toUser] },
                to: { $in: [data.fromUser, data.toUser] }
            }, { projection: { _id: 0 } })
            .toArray((err, res) => {
                if (!err) socket.emit('output', res);
            });
        });

        socket.on('chatMessage', (data) => {
            const chat = db.collection(chatCollection);
            const dataElement = formatMessage(data);

            chat.insertOne(dataElement, (err) => {
                if (err) return console.log(err);

                socket.emit('message', dataElement);
                io.to(data.toUser).emit('message', dataElement);
            });
        });

        socket.on('disconnect', () => {
            const online = db.collection(userCollection);
            online.deleteOne({ ID: socket.id });
        });

    });

    app.use(express.static(path.join(__dirname,'front')));

    server.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
});
